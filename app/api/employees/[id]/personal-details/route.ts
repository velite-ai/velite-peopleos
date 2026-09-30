import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { hasPermissionForScope } from "@/lib/auth";
import { db } from "@/lib/database";
import { openJson, sealJson } from "@/lib/encryption";

const addressSchema = z.object({
  line1: z.string().min(2).max(160),
  line2: z.string().max(160).nullable().optional(),
  city: z.string().min(2).max(100),
  state: z.string().min(2).max(100),
  postalCode: z.string().min(3).max(20),
  country: z.string().min(2).max(80).default("India"),
}).strict();

const personalDetailsSchema = z.object({
  preferredName: z.string().min(1).max(100).nullable().optional(),
  dateOfBirth: z.iso.date().nullable().optional(),
  gender: z.string().min(1).max(50).nullable().optional(),
  pronouns: z.string().min(1).max(50).nullable().optional(),
  maritalStatus: z.string().min(1).max(50).nullable().optional(),
  nationality: z.string().min(2).max(80).nullable().optional(),
  bloodGroup: z.string().regex(/^(A|B|AB|O)[+-]$/).nullable().optional(),
  address: addressSchema.nullable().optional(),
}).strict();

const updateSchema = z.object({
  personalEmail: z.email().nullable().optional(),
  phone: z.string().min(7).max(30).nullable().optional(),
  personalDetails: personalDetailsSchema.optional(),
  reason: z.string().min(3).max(1000),
}).strict().refine(
  input => input.personalEmail !== undefined || input.phone !== undefined || Object.keys(input.personalDetails || {}).length > 0,
  "At least one profile field is required",
);

type PersonalDetails = z.infer<typeof personalDetailsSchema>;
type EmployeeRecord = {
  id: string;
  user_id: string | null;
  business_head_id: string;
  department_id: string | null;
  personal_email: string | null;
  phone: string | null;
  personal_details_encrypted: Uint8Array | null;
};

const selfEditablePersonalFields = new Set(["preferredName", "pronouns", "address"]);

function decryptPersonalDetails(value: Uint8Array | null) {
  return value ? openJson<PersonalDetails>(value) : null;
}

function mergePersonalDetails(previous: PersonalDetails | null, patch: PersonalDetails | undefined) {
  if (!patch) return previous;
  return { ...(previous || {}), ...patch };
}

async function employeeRecord(id: string) {
  const [employee] = await db()<EmployeeRecord[]>`
    SELECT id,user_id,business_head_id,department_id,personal_email,phone,personal_details_encrypted
    FROM employees WHERE id=${id}
  `;
  return employee;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const employee = await employeeRecord(id);
    if (!employee) return fail("Employee not found", 404);

    const actor = await requireApiUser();
    if (actor instanceof Response) return actor;
    const self = !actor.apiKeyId && employee.user_id === actor.id;
    if (!self) {
      const scoped = await requireApiUser("people:read", employee.business_head_id, employee.department_id);
      if (scoped instanceof Response) return scoped;
    }

    const fullAccess = self || hasPermissionForScope(actor, "people:write", employee.business_head_id, employee.department_id);
    if (!fullAccess) {
      return ok({
        employeeId: id,
        personalEmail: null,
        phone: null,
        personalDetails: null,
        fieldAccess: { personalContact: false, personalDetails: false },
        completion: {
          personalEmail: Boolean(employee.personal_email),
          phone: Boolean(employee.phone),
          personalDetails: Boolean(employee.personal_details_encrypted),
        },
      });
    }

    const personalDetails = decryptPersonalDetails(employee.personal_details_encrypted);
    await db()`
      INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason)
      VALUES (${actor.id},'employee.personal_details_view','employee',${id},${employee.business_head_id},
        ${JSON.stringify({ self, fields: ["personalEmail", "phone", "personalDetails"] })}::jsonb,
        ${self ? "Employee viewed own personal details" : "Authorised HR personal-details view"})
    `;
    return ok({
      employeeId: id,
      personalEmail: employee.personal_email,
      phone: employee.phone,
      personalDetails,
      fieldAccess: { personalContact: true, personalDetails: true },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = updateSchema.parse(await request.json());
    const employee = await employeeRecord(id);
    if (!employee) return fail("Employee not found", 404);

    const actor = await requireApiUser();
    if (actor instanceof Response) return actor;
    const self = !actor.apiKeyId && employee.user_id === actor.id;
    const requestedPersonalFields = Object.keys(input.personalDetails || {});
    const hasHrOnlyField = requestedPersonalFields.some(field => !selfEditablePersonalFields.has(field));
    if (!self || hasHrOnlyField) {
      const scoped = await requireApiUser("people:write", employee.business_head_id, employee.department_id);
      if (scoped instanceof Response) return scoped;
    }

    const changedFields = [
      ...(input.personalEmail !== undefined ? ["personalEmail"] : []),
      ...(input.phone !== undefined ? ["phone"] : []),
      ...requestedPersonalFields.map(field => `personalDetails.${field}`),
    ];
    const [updated] = await db().begin(async tx => {
      const [locked] = await tx<EmployeeRecord[]>`
        SELECT id,user_id,business_head_id,department_id,personal_email,phone,personal_details_encrypted
        FROM employees WHERE id=${id} FOR UPDATE
      `;
      if (!locked) throw new Error("Employee disappeared during profile update");
      const previousDetails = decryptPersonalDetails(locked.personal_details_encrypted);
      const nextDetails = mergePersonalDetails(previousDetails, input.personalDetails);
      const rows = await tx`
        UPDATE employees
        SET personal_email=CASE WHEN ${input.personalEmail !== undefined} THEN ${input.personalEmail ?? null} ELSE personal_email END,
            phone=CASE WHEN ${input.phone !== undefined} THEN ${input.phone ?? null} ELSE phone END,
            personal_details_encrypted=CASE WHEN ${input.personalDetails !== undefined}
              THEN ${nextDetails ? sealJson(nextDetails) : null}
              ELSE personal_details_encrypted END,
            updated_at=now()
        WHERE id=${id}
        RETURNING id,updated_at,(personal_details_encrypted IS NOT NULL) AS has_personal_details
      `;
      await tx`
        INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason)
        VALUES (${actor.id},'employee.personal_details_update','employee',${id},${employee.business_head_id},
          ${JSON.stringify({ changedFields, personalDetailsPresent: Boolean(locked.personal_details_encrypted) })}::jsonb,
          ${JSON.stringify({ changedFields, personalDetailsPresent: Boolean(rows[0].has_personal_details), self })}::jsonb,
          ${input.reason})
      `;
      return rows;
    });
    return ok({ ...updated, changedFields });
  } catch (error) {
    return apiError(error);
  }
}
