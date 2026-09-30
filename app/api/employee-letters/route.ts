import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { hasPermissionForScope } from "@/lib/auth";
import { db } from "@/lib/database";

const letterType = z.enum([
  "appointment",
  "confirmation",
  "salary_revision",
  "employment_verification",
  "experience",
  "relieving",
]);

const createSchema = z.object({
  employeeId: z.uuid(),
  letterType,
  templateVersion: z.string().min(1).max(50),
  effectiveDate: z.iso.date(),
  reason: z.string().min(5).max(1000),
}).strict();

const listSchema = z.object({
  businessHeadId: z.uuid(),
  employeeId: z.uuid().nullable().optional(),
  status: z.enum(["draft", "pending", "approved", "rejected", "issued", "cancelled"]).nullable().optional(),
}).strict();

type EmployeeSnapshotSource = {
  id: string;
  employee_code: string;
  business_head_id: string;
  department_id: string | null;
  first_name: string;
  last_name: string | null;
  position: string;
  grade: string | null;
  employment_type: string;
  status: string;
  date_joined: string;
  confirmation_date: string | null;
  last_working_date: string | null;
  business_head: string;
  department: string | null;
  reporting_manager: string | null;
  legal_entity: string | null;
  work_location_name: string | null;
};

type LetterListRow = {
  id: string;
  employee_id: string;
  letter_type: string;
  template_version: string;
  effective_date: string;
  snapshot: Record<string, unknown>;
  document_id: string | null;
  status: string;
  requested_by: string;
  request_reason: string;
  approved_by: string | null;
  decision_reason: string | null;
  decided_at: string | null;
  generated_at: string;
  issued_at: string | null;
  updated_at: string;
  employee_code: string;
  employee_name: string;
  requested_by_name: string;
  approved_by_name: string | null;
  generation_status: string | null;
  generation_error: string | null;
};

function employeeSnapshot(employee: EmployeeSnapshotSource) {
  return {
    employee: {
      id: employee.id,
      code: employee.employee_code,
      fullName: [employee.first_name, employee.last_name].filter(Boolean).join(" "),
      position: employee.position,
      grade: employee.grade,
      employmentType: employee.employment_type,
      status: employee.status,
      dateJoined: employee.date_joined,
      confirmationDate: employee.confirmation_date,
      lastWorkingDate: employee.last_working_date,
    },
    organisation: {
      businessHead: employee.business_head,
      department: employee.department,
      legalEntity: employee.legal_entity,
      workLocation: employee.work_location_name,
      reportingManager: employee.reporting_manager,
    },
  };
}

function validateLetterEligibility(employee: EmployeeSnapshotSource, type: z.infer<typeof letterType>, effectiveDate: string) {
  if (effectiveDate < String(employee.date_joined).slice(0, 10)) return "The effective date cannot be before the joining date";
  if (type === "confirmation" && !["probation", "active"].includes(employee.status)) {
    return "Confirmation letters are available only for probation or active employees";
  }
  if (["experience", "relieving"].includes(type) && !["notice_period", "separated", "archived"].includes(employee.status)) {
    return "Experience and relieving letters require an employee in notice period or separated status";
  }
  return null;
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const input = listSchema.parse({
      businessHeadId: params.get("businessHeadId"),
      employeeId: params.get("employeeId"),
      status: params.get("status"),
    });
    const actor = await requireApiUser("people:read", input.businessHeadId);
    if (actor instanceof Response) return actor;
    const canReadCompensation = hasPermissionForScope(actor, "payroll:read", input.businessHeadId);
    const rows = await db()<LetterListRow[]>`
      SELECT l.id,l.employee_id,l.letter_type,l.template_version,l.effective_date,l.snapshot,l.document_id,l.status,
        l.requested_by,l.request_reason,l.approved_by,l.decision_reason,l.decided_at,l.generated_at,l.issued_at,l.updated_at,
        e.employee_code,concat_ws(' ',e.first_name,e.last_name) AS employee_name,
        ru.full_name AS requested_by_name,au.full_name AS approved_by_name,
        j.status AS generation_status,j.error_message AS generation_error
      FROM generated_letters l
      JOIN employees e ON e.id=l.employee_id
      JOIN users ru ON ru.id=l.requested_by
      LEFT JOIN users au ON au.id=l.approved_by
      LEFT JOIN document_generation_jobs j ON j.job_type='letter' AND j.source_record_id=l.id
      WHERE e.business_head_id=${input.businessHeadId}
        AND (${input.employeeId || null}::uuid IS NULL OR l.employee_id=${input.employeeId || null}::uuid)
        AND (${input.status || null}::text IS NULL OR l.status=${input.status || null})
      ORDER BY l.generated_at DESC
      LIMIT 300
    `;
    const data = rows.map(row => {
      const snapshot = { ...(row.snapshot || {}) } as Record<string, unknown>;
      if (!canReadCompensation) delete snapshot.compensation;
      return { ...row, snapshot, fieldAccess: { compensation: canReadCompensation } };
    });
    if (canReadCompensation && data.some(row => row.letter_type === "salary_revision")) {
      await db()`
        INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason)
        VALUES (${actor.id},'employee_letter.compensation_snapshot_view','generated_letter',${input.businessHeadId},${input.businessHeadId},
          ${JSON.stringify({ employeeId: input.employeeId || null, count: data.length })}::jsonb,
          'Authorised salary-letter snapshot view')
      `;
    }
    return ok(data);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = createSchema.parse(await request.json());
    const sql = db();
    const [employee] = await sql<EmployeeSnapshotSource[]>`
      SELECT e.id,e.employee_code,e.business_head_id,e.department_id,e.first_name,e.last_name,e.position,e.grade,
        e.employment_type,e.status,e.date_joined,e.confirmation_date,e.last_working_date,b.name AS business_head,
        d.name AS department,concat_ws(' ',m.first_name,m.last_name) AS reporting_manager,
        le.legal_name AS legal_entity,wl.name AS work_location_name
      FROM employees e
      JOIN business_heads b ON b.id=e.business_head_id
      LEFT JOIN departments d ON d.id=e.department_id
      LEFT JOIN employees m ON m.id=e.reporting_manager_id
      LEFT JOIN legal_entities le ON le.id=e.legal_entity_id
      LEFT JOIN work_locations wl ON wl.id=e.work_location_id
      WHERE e.id=${input.employeeId}
    `;
    if (!employee) return fail("Employee not found", 404);
    const actor = await requireApiUser("people:write", employee.business_head_id, employee.department_id);
    if (actor instanceof Response) return actor;
    const eligibilityError = validateLetterEligibility(employee, input.letterType, input.effectiveDate);
    if (eligibilityError) return fail(eligibilityError, 422);

    let compensation: Record<string, unknown> | null = null;
    if (input.letterType === "salary_revision") {
      if (!hasPermissionForScope(actor, "payroll:read", employee.business_head_id, employee.department_id)) {
        return fail("Payroll read permission is required for a salary revision letter", 403);
      }
      const [record] = await sql<Record<string, unknown>[]>`
        SELECT id,effective_from,effective_to,annual_ctc,monthly_gross,structure
        FROM employee_compensation
        WHERE employee_id=${input.employeeId} AND effective_from<=${input.effectiveDate}
          AND (effective_to IS NULL OR effective_to>=${input.effectiveDate})
        ORDER BY effective_from DESC LIMIT 1
      `;
      if (!record) return fail("No approved compensation is effective on the letter date", 409);
      compensation = record;
    }

    const snapshot = {
      ...employeeSnapshot(employee),
      letter: { type: input.letterType, effectiveDate: input.effectiveDate, templateVersion: input.templateVersion },
      ...(compensation ? { compensation } : {}),
      capturedAt: new Date().toISOString(),
    };
    const [created] = await sql.begin(async tx => {
      const rows = await tx`
        INSERT INTO generated_letters
          (employee_id,letter_type,template_version,effective_date,snapshot,status,generated_by,requested_by,request_reason)
        VALUES (${input.employeeId},${input.letterType},${input.templateVersion},${input.effectiveDate},
          ${JSON.stringify(snapshot)}::jsonb,'pending',${actor.id},${actor.id},${input.reason})
        RETURNING id,employee_id,letter_type,template_version,effective_date,status,requested_by,request_reason,generated_at
      `;
      await tx`
        INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason)
        VALUES (${actor.id},'employee_letter.request','generated_letter',${rows[0].id},${employee.business_head_id},
          ${JSON.stringify({ employeeId: input.employeeId, letterType: input.letterType, effectiveDate: input.effectiveDate, templateVersion: input.templateVersion, compensationIncluded: Boolean(compensation), status: "pending" })}::jsonb,
          ${input.reason})
      `;
      return rows;
    });
    return ok(created, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
