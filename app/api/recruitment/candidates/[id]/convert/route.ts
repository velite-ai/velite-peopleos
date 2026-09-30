import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";
import { hashPassword } from "@/lib/password";

const taskSchema = z.object({
  title: z.string().min(2).max(200),
  category: z.string().min(2).max(60),
  assignedTo: z.uuid().nullable().optional(),
  dueDate: z.iso.date().nullable().optional(),
});

const accountSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({ mode: z.literal("existing"), userId: z.uuid() }),
  z.object({
    mode: z.literal("new"),
    email: z.email().optional(),
    fullName: z.string().min(2).max(120).optional(),
    temporaryPassword: z.string().min(12).max(128),
  }),
]);

const schema = z.object({
  offerId: z.uuid().optional(),
  employeeCode: z.string().min(2).max(30),
  dateJoined: z.iso.date().optional(),
  departmentId: z.uuid().nullable().optional(),
  firstName: z.string().min(1).max(80).optional(),
  lastName: z.string().max(80).nullable().optional(),
  position: z.string().min(2).max(120).optional(),
  workEmail: z.email().nullable().optional(),
  employmentType: z.enum(["permanent", "probationer", "trainee", "intern", "consultant", "fixed_term"]).optional(),
  probationEndDate: z.iso.date().nullable().optional(),
  onboarding: z.object({
    templateName: z.string().min(2).max(120).default("Standard onboarding"),
    ownerId: z.uuid().nullable().optional(),
    tasks: z.array(taskSchema).max(100).default([]),
  }).default({ templateName: "Standard onboarding", tasks: [] }),
  account: accountSchema.default({ mode: "none" }),
  reason: z.string().min(5).max(2000),
});

type Candidate = {
  id: string;
  business_head_id: string;
  department_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  position: string;
  stage: string;
  consented_at: string | null;
  employment_type: string | null;
};

type Offer = {
  id: string;
  candidate_id: string;
  offered_position: string;
  offered_ctc: string | number;
  proposed_joining_date: string;
  status: string;
  responded_at: string | null;
  created_at: string;
};

type Employee = {
  id: string;
  employee_code: string;
  user_id: string | null;
  business_head_id: string;
  department_id: string | null;
  first_name: string;
  last_name: string | null;
  position: string;
  date_joined: string;
  status: string;
  source_candidate_id: string | null;
  source_offer_id: string | null;
};

class ConversionFailure extends Error {
  constructor(message: string, readonly status = 409, readonly details?: unknown) {
    super(message);
  }
}

const allowedEmploymentTypes = new Set(["permanent", "probationer", "trainee", "intern", "consultant", "fixed_term"]);

function normalizedEmail(value: string | null | undefined) {
  const email = value?.trim().toLowerCase();
  return email || null;
}

function normalizedPhone(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") || "";
  return digits.length >= 7 ? digits : null;
}

function candidateName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || fullName.trim(), lastName: parts.length > 1 ? parts.slice(1).join(" ") : null };
}

const defaultTasks = (dateJoined: string, employeeUserId: string | null) => [
  { title: "Submit and verify joining documents", category: "Employee", assignedTo: employeeUserId, dueDate: dateJoined },
  { title: "Prepare Day 1 induction and manager plan", category: "Manager", assignedTo: null, dueDate: dateJoined },
  { title: "Provision email, accounts and access", category: "IT", assignedTo: null, dueDate: dateJoined },
  { title: "Allocate equipment, access card and workspace", category: "Administration", assignedTo: null, dueDate: dateJoined },
  { title: "Verify bank, statutory and payroll information", category: "Finance", assignedTo: null, dueDate: dateJoined },
];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = schema.parse(await request.json());
    const sql = db();

    const [scope] = await sql<{business_head_id:string;department_id:string|null;email:string|null;full_name:string}[]>`
      SELECT business_head_id,department_id,email,full_name FROM candidates WHERE id=${id}
    `;
    if (!scope) return fail("Candidate not found", 404);

    const sourceActor = await requireApiUser("people:write", scope.business_head_id, scope.department_id);
    if (sourceActor instanceof Response) return sourceActor;

    const targetDepartmentId = input.departmentId === undefined ? scope.department_id : input.departmentId;
    if (targetDepartmentId) {
      const [department] = await sql<{business_head_id:string}[]>`SELECT business_head_id FROM departments WHERE id=${targetDepartmentId}`;
      if (!department) return fail("Department not found", 404);
      if (department.business_head_id !== scope.business_head_id) return fail("Department does not belong to the candidate's business head", 422);
    }
    const actor = targetDepartmentId === scope.department_id
      ? sourceActor
      : await requireApiUser("people:write", scope.business_head_id, targetDepartmentId);
    if (actor instanceof Response) return actor;

    const requestedAccountEmail = input.account.mode === "new"
      ? normalizedEmail(input.account.email || scope.email)
      : null;
    if (input.account.mode === "new" && !requestedAccountEmail) return fail("An email is required to create the employee account", 422);
    const passwordHash = input.account.mode === "new" ? await hashPassword(input.account.temporaryPassword) : null;

    const result = await sql.begin(async tx => {
      const [candidate] = await tx<Candidate[]>`
        SELECT c.id,c.business_head_id,c.department_id,c.full_name,c.email,c.phone,c.position,c.stage,c.consented_at,r.employment_type
        FROM candidates c LEFT JOIN job_requisitions r ON r.id=c.requisition_id
        WHERE c.id=${id} FOR UPDATE OF c
      `;
      if (!candidate) throw new ConversionFailure("Candidate not found", 404);
      if (candidate.business_head_id !== scope.business_head_id) throw new ConversionFailure("Candidate scope changed; retry the conversion", 409);

      const [directEmployee] = await tx<Employee[]>`SELECT * FROM employees WHERE source_candidate_id=${candidate.id} FOR UPDATE`;
      const caseLinks = await tx<{employee_id:string}[]>`
        SELECT DISTINCT employee_id FROM onboarding_cases
        WHERE candidate_id=${candidate.id} AND employee_id IS NOT NULL
      `;
      if (caseLinks.length > 1) throw new ConversionFailure("Candidate is linked to conflicting employee records", 409, { employeeIds: caseLinks.map(row => row.employee_id) });
      const [caseEmployee] = caseLinks[0]
        ? await tx<Employee[]>`SELECT * FROM employees WHERE id=${caseLinks[0].employee_id} FOR UPDATE`
        : [];
      if (directEmployee && caseEmployee && directEmployee.id !== caseEmployee.id) {
        throw new ConversionFailure("Candidate conversion links are inconsistent", 409, { employeeIds: [directEmployee.id, caseEmployee.id] });
      }
      let employee = directEmployee || caseEmployee || null;

      let offers: Offer[];
      if (input.offerId) {
        offers = await tx<Offer[]>`
          SELECT id,candidate_id,offered_position,offered_ctc,proposed_joining_date,status,responded_at,created_at
          FROM candidate_offers WHERE id=${input.offerId} AND candidate_id=${candidate.id} AND status='accepted' FOR UPDATE
        `;
      } else if (employee?.source_offer_id) {
        offers = await tx<Offer[]>`
          SELECT id,candidate_id,offered_position,offered_ctc,proposed_joining_date,status,responded_at,created_at
          FROM candidate_offers WHERE id=${employee.source_offer_id} AND candidate_id=${candidate.id} AND status='accepted' FOR UPDATE
        `;
      } else {
        offers = await tx<Offer[]>`
          SELECT id,candidate_id,offered_position,offered_ctc,proposed_joining_date,status,responded_at,created_at
          FROM candidate_offers WHERE candidate_id=${candidate.id} AND status='accepted'
          ORDER BY responded_at DESC NULLS LAST,created_at DESC LIMIT 2 FOR UPDATE
        `;
      }
      if (!offers.length) throw new ConversionFailure("An accepted offer is required before conversion", 409);
      if (!input.offerId && !employee?.source_offer_id && offers.length > 1) {
        throw new ConversionFailure("More than one accepted offer exists; select the offer to convert", 409, { offerIds: offers.map(offer => offer.id) });
      }
      const offer = offers[0];
      if (employee?.source_offer_id && employee.source_offer_id !== offer.id) {
        throw new ConversionFailure("Candidate was already converted from a different accepted offer", 409, { employeeId: employee.id, offerId: employee.source_offer_id });
      }
      if (!employee && !candidate.consented_at) throw new ConversionFailure("Record candidate consent before conversion", 409);
      if (!employee && ["rejected", "withdrawn"].includes(candidate.stage)) throw new ConversionFailure(`A ${candidate.stage} candidate cannot be converted`, 409);

      const parsedName = candidateName(candidate.full_name);
      const firstName = input.firstName || parsedName.firstName;
      const lastName = input.lastName === undefined ? parsedName.lastName : input.lastName;
      const dateJoined = input.dateJoined || String(offer.proposed_joining_date).slice(0, 10);
      const workEmail = normalizedEmail(input.workEmail);
      const personalEmail = normalizedEmail(candidate.email);
      const phone = candidate.phone?.trim() || null;
      const phoneKey = normalizedPhone(phone);
      const employmentType = input.employmentType || (candidate.employment_type && allowedEmploymentTypes.has(candidate.employment_type) ? candidate.employment_type : "permanent");
      let createdEmployee = false;

      if (!employee) {
        const duplicates = await tx<{
          id:string;employee_code:string;code_match:boolean;email_match:boolean;phone_match:boolean;
        }[]>`
          SELECT id,employee_code,
            (business_head_id=${candidate.business_head_id} AND employee_code=${input.employeeCode}) AS code_match,
            ((${personalEmail}::text IS NOT NULL AND (lower(work_email)=lower(${personalEmail}) OR lower(personal_email)=lower(${personalEmail}))) OR
             (${workEmail}::text IS NOT NULL AND (lower(work_email)=lower(${workEmail}) OR lower(personal_email)=lower(${workEmail})))) AS email_match,
            (${phoneKey}::text IS NOT NULL AND regexp_replace(coalesce(phone,''),'[^0-9]','','g')=${phoneKey}) AS phone_match
          FROM employees
          WHERE (business_head_id=${candidate.business_head_id} AND employee_code=${input.employeeCode})
             OR (${personalEmail}::text IS NOT NULL AND (lower(work_email)=lower(${personalEmail}) OR lower(personal_email)=lower(${personalEmail})))
             OR (${workEmail}::text IS NOT NULL AND (lower(work_email)=lower(${workEmail}) OR lower(personal_email)=lower(${workEmail})))
             OR (${phoneKey}::text IS NOT NULL AND regexp_replace(coalesce(phone,''),'[^0-9]','','g')=${phoneKey})
          FOR UPDATE
        `;
        if (duplicates.length) {
          throw new ConversionFailure("Potential duplicate employee records must be resolved before conversion", 409, {
            matches: duplicates.map(row => ({ employeeId: row.id, employeeCode: row.employee_code, fields: [row.code_match && "employeeCode", row.email_match && "email", row.phone_match && "phone"].filter(Boolean) })),
          });
        }
        const [created] = await tx<Employee[]>`
          INSERT INTO employees (
            employee_code,business_head_id,department_id,first_name,last_name,work_email,personal_email,phone,
            position,employment_type,status,date_joined,probation_end_date,source_candidate_id,source_offer_id
          ) VALUES (
            ${input.employeeCode},${candidate.business_head_id},${targetDepartmentId},${firstName},${lastName},${workEmail},${personalEmail},${phone},
            ${input.position || offer.offered_position || candidate.position},${employmentType},'probation',${dateJoined},${input.probationEndDate || null},${candidate.id},${offer.id}
          ) RETURNING *
        `;
        employee = created;
        createdEmployee = true;
      } else {
        if (employee.business_head_id !== candidate.business_head_id) throw new ConversionFailure("Converted employee belongs to a different business head", 409);
        if (!employee.source_candidate_id || !employee.source_offer_id) {
          const [repaired] = await tx<Employee[]>`
            UPDATE employees SET source_candidate_id=coalesce(source_candidate_id,${candidate.id}),source_offer_id=coalesce(source_offer_id,${offer.id}),updated_at=now()
            WHERE id=${employee.id} RETURNING *
          `;
          employee = repaired;
        }
      }

      let accountCreated = false;
      let accountLinked = false;
      let employeeUserId = employee.user_id;
      if (input.account.mode !== "none") {
        if (employeeUserId) {
          if (input.account.mode === "existing" && input.account.userId !== employeeUserId) {
            throw new ConversionFailure("Employee is already linked to a different user account", 409, { userId: employeeUserId });
          }
          if (input.account.mode === "new") {
            const [linked] = await tx<{email:string}[]>`SELECT email FROM users WHERE id=${employeeUserId}`;
            if (!linked || normalizedEmail(linked.email) !== requestedAccountEmail) {
              throw new ConversionFailure("Employee already has a user account; select that existing account", 409, { userId: employeeUserId });
            }
          }
        } else if (input.account.mode === "existing") {
          const [selected] = await tx<{id:string;email:string;active:boolean}[]>`SELECT id,email,active FROM users WHERE id=${input.account.userId} FOR UPDATE`;
          if (!selected) throw new ConversionFailure("User account not found", 404);
          if (!selected.active) throw new ConversionFailure("An inactive user account cannot be linked", 409);
          const [otherLink] = await tx<{id:string;employee_code:string}[]>`SELECT id,employee_code FROM employees WHERE user_id=${selected.id} AND id<>${employee.id}`;
          if (otherLink) throw new ConversionFailure("User account is already linked to another employee", 409, { employeeId: otherLink.id, employeeCode: otherLink.employee_code });
          employeeUserId = selected.id;
          accountLinked = true;
        } else {
          const [sameEmail] = await tx<{id:string}[]>`SELECT id FROM users WHERE lower(email)=lower(${requestedAccountEmail}) FOR UPDATE`;
          if (sameEmail) throw new ConversionFailure("A user account already exists for this email; link the existing account instead", 409, { userId: sameEmail.id });
          const [createdUser] = await tx<{id:string;email:string;full_name:string}[]>`
            INSERT INTO users (email,password_hash,full_name,must_change_password)
            VALUES (${requestedAccountEmail},${passwordHash},${input.account.fullName || candidate.full_name},true)
            RETURNING id,email,full_name
          `;
          employeeUserId = createdUser.id;
          accountCreated = true;
          accountLinked = true;
          await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason)
            VALUES (${actor.id},'candidate_conversion.user_create','user',${createdUser.id},${candidate.business_head_id},${JSON.stringify({ email: createdUser.email, employeeId: employee.id, candidateId: candidate.id })}::jsonb,${input.reason})`;
        }

        if (!employee.user_id && employeeUserId) {
          const [linkedEmployee] = await tx<Employee[]>`UPDATE employees SET user_id=${employeeUserId},updated_at=now() WHERE id=${employee.id} AND user_id IS NULL RETURNING *`;
          if (!linkedEmployee) throw new ConversionFailure("Employee account linkage changed during conversion; retry", 409);
          employee = linkedEmployee;
        }
        const [employeeRole] = await tx<{id:string}[]>`SELECT id FROM roles WHERE code='EMPLOYEE'`;
        if (!employeeRole) throw new Error("Missing seeded EMPLOYEE role");
        const roleRows = await tx`
          INSERT INTO user_roles (user_id,role_id,business_head_id,department_id)
          VALUES (${employeeUserId},${employeeRole.id},${employee.business_head_id},${employee.department_id})
          ON CONFLICT DO NOTHING RETURNING id
        `;
        if (accountLinked || roleRows.length) {
          await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason)
            VALUES (${actor.id},'candidate_conversion.user_link','employee',${employee.id},${employee.business_head_id},${JSON.stringify({ userId: employeeUserId, accountCreated, employeeRoleAssigned: roleRows.length > 0 })}::jsonb,${input.reason})`;
        }
      }

      const onboardingCases = await tx<{
        id:string;employee_id:string|null;template_name:string;planned_joining_date:string;status:string;
      }[]>`SELECT id,employee_id,template_name,planned_joining_date,status FROM onboarding_cases WHERE candidate_id=${candidate.id} ORDER BY created_at FOR UPDATE`;
      const conflictingCase = onboardingCases.find(item => item.employee_id && item.employee_id !== employee!.id);
      if (conflictingCase) throw new ConversionFailure("An onboarding case is linked to a different employee", 409, { onboardingCaseId: conflictingCase.id, employeeId: conflictingCase.employee_id });

      let onboardingCase = onboardingCases.find(item => item.status !== "completed") || onboardingCases[0];
      if (onboardingCase) {
        const [updated] = await tx<typeof onboardingCases>`
          UPDATE onboarding_cases SET employee_id=${employee.id},accepted_offer_id=${offer.id},converted_at=coalesce(converted_at,now()),converted_by=coalesce(converted_by,${actor.id})
          WHERE id=${onboardingCase.id} RETURNING id,employee_id,template_name,planned_joining_date,status
        `;
        onboardingCase = updated;
        await tx`UPDATE onboarding_cases SET employee_id=${employee.id},accepted_offer_id=coalesce(accepted_offer_id,${offer.id})
          WHERE candidate_id=${candidate.id} AND (employee_id IS NULL OR employee_id=${employee.id})`;
      } else {
        const [createdCase] = await tx<typeof onboardingCases>`
          INSERT INTO onboarding_cases (candidate_id,employee_id,template_name,planned_joining_date,owner_id,accepted_offer_id,converted_at,converted_by)
          VALUES (${candidate.id},${employee.id},${input.onboarding.templateName},${dateJoined},${input.onboarding.ownerId || actor.id},${offer.id},now(),${actor.id})
          RETURNING id,employee_id,template_name,planned_joining_date,status
        `;
        onboardingCase = createdCase;
      }

      const [taskCount] = await tx<{count:number}[]>`SELECT count(*)::int AS count FROM onboarding_tasks WHERE onboarding_case_id=${onboardingCase.id}`;
      let tasksCreated = 0;
      if (taskCount.count === 0) {
        const tasks = input.onboarding.tasks.length ? input.onboarding.tasks : defaultTasks(dateJoined, employeeUserId);
        for (const task of tasks) {
          await tx`INSERT INTO onboarding_tasks (onboarding_case_id,title,category,assigned_to,due_date)
            VALUES (${onboardingCase.id},${task.title},${task.category},${task.assignedTo || null},${task.dueDate || null})`;
          tasksCreated += 1;
        }
      }

      const documentConflicts = await tx<{id:string;employee_id:string}[]>`
        SELECT id,employee_id FROM documents WHERE candidate_id=${candidate.id} AND employee_id IS NOT NULL AND employee_id<>${employee.id}
      `;
      if (documentConflicts.length) throw new ConversionFailure("Candidate documents are linked to a different employee", 409, { documentIds: documentConflicts.map(row => row.id) });
      const linkedDocuments = await tx`
        UPDATE documents SET employee_id=${employee.id}
        WHERE candidate_id=${candidate.id} AND employee_id IS NULL RETURNING id
      `;
      const linkedUploadIntents = await tx`
        UPDATE document_upload_intents SET employee_id=${employee.id}
        WHERE candidate_id=${candidate.id} AND employee_id IS NULL AND completed_at IS NULL RETURNING id
      `;

      if (candidate.stage !== "hired") {
        await tx`INSERT INTO candidate_stage_events (candidate_id,from_stage,to_stage,notes,changed_by)
          VALUES (${candidate.id},${candidate.stage},'hired',${input.reason},${actor.id})`;
        await tx`UPDATE candidates SET stage='hired',updated_at=now() WHERE id=${candidate.id}`;
      }

      if (createdEmployee) {
        await tx`INSERT INTO employee_events (employee_id,event_type,effective_date,new_values,reason,approved_by,created_by)
          VALUES (${employee.id},'joining',${dateJoined},${JSON.stringify({
            candidateId: candidate.id,
            acceptedOfferId: offer.id,
            onboardingCaseId: onboardingCase.id,
            employeeCode: employee.employee_code,
            businessHeadId: employee.business_head_id,
            departmentId: employee.department_id,
            position: employee.position,
            offeredCtc: offer.offered_ctc,
            dateJoined,
            userId: employeeUserId,
          })}::jsonb,${input.reason},${actor.id},${actor.id})`;
      }

      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason)
        VALUES (${actor.id},${createdEmployee ? 'candidate.convert_to_employee' : 'candidate.convert_idempotent'},'candidate',${candidate.id},${candidate.business_head_id},${JSON.stringify({
          employeeId: employee.id,
          employeeCode: employee.employee_code,
          acceptedOfferId: offer.id,
          onboardingCaseId: onboardingCase.id,
          userId: employeeUserId,
          accountCreated,
          documentsLinked: linkedDocuments.length,
          uploadIntentsLinked: linkedUploadIntents.length,
          tasksCreated,
        })}::jsonb,${input.reason})`;

      return {
        created: createdEmployee,
        employee: {
          id: employee.id,
          employeeCode: employee.employee_code,
          businessHeadId: employee.business_head_id,
          departmentId: employee.department_id,
          status: employee.status,
          dateJoined: employee.date_joined,
          userId: employeeUserId,
        },
        acceptedOfferId: offer.id,
        onboardingCase: { id: onboardingCase.id, status: onboardingCase.status, tasksCreated },
        account: { linked: Boolean(employeeUserId), created: accountCreated },
        documentsLinked: linkedDocuments.length,
      };
    });

    return ok(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof ConversionFailure) return fail(error.message, error.status, error.details);
    if ((error as {code?:string})?.code === "23505") return fail("Conversion conflicts with an existing employee or user record", 409);
    return apiError(error);
  }
}
