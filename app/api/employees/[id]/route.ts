import { z } from "zod";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { hasPermissionForScope } from "@/lib/auth";
import { db } from "@/lib/database";

const schema = z.object({
  position: z.string().min(2).max(120).optional(),
  guardianName: z.string().max(160).nullable().optional(),
  dateJoined: z.iso.date().optional(),
  departmentId: z.uuid().nullable().optional(),
  reportingManagerId: z.uuid().nullable().optional(),
  grade: z.string().max(40).nullable().optional(),
  workLocation: z.string().max(120).nullable().optional(),
  workEmail: z.email().nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  status: z.enum(["probation", "active", "notice_period", "separated", "archived"]).optional(),
  probationEndDate: z.iso.date().nullable().optional(),
  confirmationDate: z.iso.date().nullable().optional(),
  nextSalaryRevisionDate: z.iso.date().nullable().optional(),
  effectiveDate: z.iso.date(),
  reason: z.string().min(3).max(2000),
});

const deleteSchema = z.object({
  confirmationCode: z.string().min(1).max(30),
  reason: z.string().min(5).max(2000),
});

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sql = db();
    const [record] = await sql<{business_head_id:string;department_id:string|null}[]>`SELECT business_head_id,department_id FROM employees WHERE id=${id}`;
    if (!record) return fail("Employee not found", 404);
    const user = await requireApiUser("people:read", record.business_head_id, record.department_id);
    if (user instanceof Response) return user;
    const canViewCompensation = hasPermissionForScope(user, "payroll:read", record.business_head_id, record.department_id);
    const [employee, events, compensation, salaryRegisterLines] = await Promise.all([
      sql`SELECT e.id,e.employee_code,e.user_id,e.business_head_id,e.department_id,e.reporting_manager_id,e.first_name,e.last_name,e.guardian_name,e.source_metadata,e.work_email,e.phone,e.position,e.grade,e.work_location,e.employment_type,e.status,e.date_joined,e.probation_end_date,e.confirmation_date,e.next_salary_revision_date,e.notice_start_date,e.last_working_date,e.legal_entity_id,e.work_location_id,e.cost_centre_id,e.job_position_id,e.created_at,e.updated_at,b.name AS business_head,d.name AS department,concat_ws(' ',m.first_name,m.last_name) AS reporting_manager FROM employees e JOIN business_heads b ON b.id=e.business_head_id LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN employees m ON m.id=e.reporting_manager_id WHERE e.id=${id}`,
      sql`SELECT ev.id,ev.event_type,ev.effective_date,ev.previous_values,ev.new_values,ev.reason,ev.approved_by,ev.created_by,ev.created_at,u.full_name AS created_by_name FROM employee_events ev JOIN users u ON u.id=ev.created_by WHERE ev.employee_id=${id} ORDER BY ev.effective_date DESC,ev.created_at DESC`,
      canViewCompensation ? sql`SELECT id,effective_from,effective_to,annual_ctc,monthly_gross,structure,reason,created_at FROM employee_compensation WHERE employee_id=${id} ORDER BY effective_from DESC` : Promise.resolve([]),
      canViewCompensation ? sql`SELECT l.id,i.period_month,i.source_file_name,l.register_type,l.attendance_days,l.monthly_rates,l.earned_dues,l.deductions,l.total_dues,l.total_deductions,l.net_payable FROM salary_register_lines l JOIN salary_register_imports i ON i.id=l.import_id WHERE l.employee_id=${id} ORDER BY i.period_month DESC` : Promise.resolve([]),
    ]);
    if (canViewCompensation) await sql`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,reason) VALUES (${user.id},'employee.compensation_view','employee',${id},${record.business_head_id},'Authorised compensation and salary-register history viewed')`;
    return ok({ employee: employee[0], events, compensation, salaryRegisterLines, fieldAccess: { compensation: canViewCompensation } });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = schema.parse(await request.json());
    const sql = db();
    const [record] = await sql<any[]>`SELECT * FROM employees WHERE id=${id}`;
    if (!record) return fail("Employee not found", 404);
    const user = await requireApiUser("people:write", record.business_head_id, record.department_id);
    if (user instanceof Response) return user;
    if (input.reportingManagerId === id) return fail("An employee cannot report to themselves", 422);
    if (input.departmentId) {
      const [department] = await sql`SELECT id FROM departments WHERE id=${input.departmentId} AND business_head_id=${record.business_head_id}`;
      if (!department) return fail("Department does not belong to the employee business head", 422);
    }
    if (input.reportingManagerId) {
      const [manager] = await sql`SELECT id FROM employees WHERE id=${input.reportingManagerId} AND business_head_id=${record.business_head_id} AND status IN ('probation','active','notice_period')`;
      if (!manager) return fail("Reporting manager must be an active employee in the same business head", 422);
    }
    const [updated] = await sql.begin(async tx => {
      const rows = await tx`
        UPDATE employees SET
          position=CASE WHEN ${input.position !== undefined} THEN ${input.position ?? null} ELSE position END,
          guardian_name=CASE WHEN ${input.guardianName !== undefined} THEN ${input.guardianName ?? null} ELSE guardian_name END,
          date_joined=CASE WHEN ${input.dateJoined !== undefined} THEN ${input.dateJoined ?? null}::date ELSE date_joined END,
          department_id=CASE WHEN ${input.departmentId !== undefined} THEN ${input.departmentId ?? null}::uuid ELSE department_id END,
          reporting_manager_id=CASE WHEN ${input.reportingManagerId !== undefined} THEN ${input.reportingManagerId ?? null}::uuid ELSE reporting_manager_id END,
          grade=CASE WHEN ${input.grade !== undefined} THEN ${input.grade ?? null} ELSE grade END,
          work_location=CASE WHEN ${input.workLocation !== undefined} THEN ${input.workLocation ?? null} ELSE work_location END,
          work_email=CASE WHEN ${input.workEmail !== undefined} THEN ${input.workEmail ?? null} ELSE work_email END,
          phone=CASE WHEN ${input.phone !== undefined} THEN ${input.phone ?? null} ELSE phone END,
          status=coalesce(${input.status ?? null}::employment_status,status),
          probation_end_date=CASE WHEN ${input.probationEndDate !== undefined} THEN ${input.probationEndDate ?? null}::date ELSE probation_end_date END,
          confirmation_date=CASE WHEN ${input.confirmationDate !== undefined} THEN ${input.confirmationDate ?? null}::date ELSE confirmation_date END,
          next_salary_revision_date=CASE WHEN ${input.nextSalaryRevisionDate !== undefined} THEN ${input.nextSalaryRevisionDate ?? null}::date ELSE next_salary_revision_date END,
          updated_at=now()
        WHERE id=${id} RETURNING *
      `;
      await tx`INSERT INTO employee_events (employee_id,event_type,effective_date,previous_values,new_values,reason,approved_by,created_by) VALUES (${id},'profile_change',${input.effectiveDate},${JSON.stringify(record)}::jsonb,${JSON.stringify(rows[0])}::jsonb,${input.reason},${user.id},${user.id})`;
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason) VALUES (${user.id},'employee.update','employee',${id},${record.business_head_id},${JSON.stringify(record)}::jsonb,${JSON.stringify(rows[0])}::jsonb,${input.reason})`;
      return rows;
    });
    return ok(updated);
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = deleteSchema.parse(await request.json());
    const sql = db();
    const [record] = await sql<any[]>`SELECT * FROM employees WHERE id=${id}`;
    if (!record) return fail("Employee not found", 404);
    const user = await requireApiUser("people:write", record.business_head_id, record.department_id);
    if (user instanceof Response) return user;
    if (record.status === "archived") return fail("Employee has already been removed from People", 409);
    if (input.confirmationCode !== record.employee_code) return fail("Employee code confirmation does not match", 422);
    if (record.user_id === user.id) return fail("You cannot remove your own employee record", 409);
    const result = await sql.begin(async tx => {
      const directReports = await tx`UPDATE employees SET reporting_manager_id=NULL,updated_at=now() WHERE reporting_manager_id=${id} RETURNING id`;
      const [archived] = await tx`
        UPDATE employees SET
          status='archived',
          source_metadata=coalesce(source_metadata,'{}'::jsonb) || ${tx.json({ removedFromPeopleAt: new Date().toISOString(), removedFromPeopleBy: user.id })},
          updated_at=now()
        WHERE id=${id}
        RETURNING *
      `;
      await tx`INSERT INTO employee_events (employee_id,event_type,effective_date,previous_values,new_values,reason,approved_by,created_by) VALUES (${id},'removed_from_people',current_date,${tx.json(record)},${tx.json({ status: "archived", directReportsUnassigned: directReports.length })},${input.reason},${user.id},${user.id})`;
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason) VALUES (${user.id},'employee.remove_from_people','employee',${id},${record.business_head_id},${tx.json({ employeeCode: record.employee_code, status: record.status })},${tx.json({ employeeCode: record.employee_code, status: "archived", directReportsUnassigned: directReports.length, historicalRecordsPreserved: true })},${input.reason})`;
      return { id: archived.id, employeeCode: archived.employee_code, status: archived.status, directReportsUnassigned: directReports.length, historicalRecordsPreserved: true };
    });
    return ok(result);
  } catch (error) { return apiError(error); }
}
