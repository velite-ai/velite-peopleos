import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";
import { sealJson } from "@/lib/encryption";

const updateSchema = z.object({
  fullName: z.string().min(2).max(160).optional(),
  relationship: z.string().min(2).max(80).nullable().optional(),
  phone: z.string().min(7).max(30).optional(),
  priority: z.number().int().min(1).max(20).optional(),
  reason: z.string().min(3).max(1000),
}).strict().refine(
  input => input.fullName !== undefined || input.relationship !== undefined || input.phone !== undefined || input.priority !== undefined,
  "At least one contact field is required",
);

const deleteSchema = z.object({ reason: z.string().min(3).max(1000) }).strict();

type ContactScope = {
  id: string;
  employee_id: string;
  user_id: string | null;
  business_head_id: string;
  department_id: string | null;
  full_name: string;
  relationship: string | null;
  priority: number;
  active: boolean;
};

async function findContact(employeeId: string, contactId: string) {
  const [contact] = await db()<ContactScope[]>`
    SELECT c.id,c.employee_id,e.user_id,e.business_head_id,e.department_id,c.full_name,c.relationship,c.priority,c.active
    FROM employee_emergency_contacts c
    JOIN employees e ON e.id=c.employee_id
    WHERE c.id=${contactId} AND c.employee_id=${employeeId}
  `;
  return contact;
}

async function authoriseWrite(contact: ContactScope) {
  const actor = await requireApiUser();
  if (actor instanceof Response) return actor;
  const self = !actor.apiKeyId && actor.id === contact.user_id;
  if (!self) {
    const scoped = await requireApiUser("people:write", contact.business_head_id, contact.department_id);
    if (scoped instanceof Response) return scoped;
  }
  return { actor, self };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; contactId: string }> },
) {
  try {
    const { id, contactId } = await params;
    const input = updateSchema.parse(await request.json());
    const contact = await findContact(id, contactId);
    if (!contact || !contact.active) return fail("Emergency contact not found", 404);
    const access = await authoriseWrite(contact);
    if (access instanceof Response) return access;
    const changedFields = [
      ...(input.fullName !== undefined ? ["fullName"] : []),
      ...(input.relationship !== undefined ? ["relationship"] : []),
      ...(input.phone !== undefined ? ["phone"] : []),
      ...(input.priority !== undefined ? ["priority"] : []),
    ];
    const [updated] = await db().begin(async tx => {
      const rows = await tx`
        UPDATE employee_emergency_contacts
        SET full_name=CASE WHEN ${input.fullName !== undefined} THEN ${input.fullName ?? null} ELSE full_name END,
            relationship=CASE WHEN ${input.relationship !== undefined} THEN ${input.relationship ?? null} ELSE relationship END,
            phone_encrypted=CASE WHEN ${input.phone !== undefined} THEN ${input.phone ? sealJson({ phone: input.phone }) : null} ELSE phone_encrypted END,
            priority=CASE WHEN ${input.priority !== undefined} THEN ${input.priority ?? null} ELSE priority END,
            updated_at=now()
        WHERE id=${contactId} AND employee_id=${id} AND active=true
        RETURNING id,full_name,relationship,priority,updated_at
      `;
      await tx`
        INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason)
        VALUES (${access.actor.id},'employee.emergency_contact_update','employee_emergency_contact',${contactId},${contact.business_head_id},
          ${JSON.stringify({ employeeId: id, relationship: contact.relationship, priority: contact.priority, changedFields })}::jsonb,
          ${JSON.stringify({ employeeId: id, relationship: rows[0].relationship, priority: rows[0].priority, changedFields, self: access.self })}::jsonb,
          ${input.reason})
      `;
      return rows;
    });
    return ok({ ...updated, changedFields });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; contactId: string }> },
) {
  try {
    const { id, contactId } = await params;
    const input = deleteSchema.parse(await request.json());
    const contact = await findContact(id, contactId);
    if (!contact || !contact.active) return fail("Emergency contact not found", 404);
    const access = await authoriseWrite(contact);
    if (access instanceof Response) return access;
    await db().begin(async tx => {
      await tx`UPDATE employee_emergency_contacts SET active=false,updated_at=now() WHERE id=${contactId} AND employee_id=${id}`;
      await tx`
        INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason)
        VALUES (${access.actor.id},'employee.emergency_contact_archive','employee_emergency_contact',${contactId},${contact.business_head_id},
          ${JSON.stringify({ employeeId: id, active: true, priority: contact.priority })}::jsonb,
          ${JSON.stringify({ employeeId: id, active: false, self: access.self })}::jsonb,
          ${input.reason})
      `;
    });
    return ok({ id: contactId, archived: true });
  } catch (error) {
    return apiError(error);
  }
}
