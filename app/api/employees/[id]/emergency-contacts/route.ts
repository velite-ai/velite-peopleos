import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { hasPermissionForScope } from "@/lib/auth";
import { db } from "@/lib/database";
import { openJson, sealJson } from "@/lib/encryption";
import { maskPhone } from "@/lib/employee-records";

const createSchema = z.object({
  fullName: z.string().min(2).max(160),
  relationship: z.string().min(2).max(80).nullable().optional(),
  phone: z.string().min(7).max(30),
  priority: z.number().int().min(1).max(20).default(1),
  reason: z.string().min(3).max(1000),
}).strict();

type EmployeeScope = { id: string; user_id: string | null; business_head_id: string; department_id: string | null };

async function findEmployee(id: string) {
  const [employee] = await db()<EmployeeScope[]>`
    SELECT id,user_id,business_head_id,department_id FROM employees WHERE id=${id}
  `;
  return employee;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const employee = await findEmployee(id);
    if (!employee) return fail("Employee not found", 404);
    const actor = await requireApiUser();
    if (actor instanceof Response) return actor;
    const self = !actor.apiKeyId && actor.id === employee.user_id;
    if (!self) {
      const scoped = await requireApiUser("people:read", employee.business_head_id, employee.department_id);
      if (scoped instanceof Response) return scoped;
    }
    const fullAccess = self || hasPermissionForScope(actor, "people:write", employee.business_head_id, employee.department_id);
    const rows = await db()<{
      id: string; full_name: string; relationship: string | null; phone_encrypted: Uint8Array;
      priority: number; created_at: string; updated_at: string;
    }[]>`
      SELECT id,full_name,relationship,phone_encrypted,priority,created_at,updated_at
      FROM employee_emergency_contacts
      WHERE employee_id=${id} AND active=true
      ORDER BY priority,created_at
    `;
    const contacts = rows.map(row => {
      const phone = openJson<{ phone: string }>(row.phone_encrypted).phone;
      return {
        id: row.id,
        fullName: row.full_name,
        relationship: row.relationship,
        phone: fullAccess ? phone : maskPhone(phone),
        priority: row.priority,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
    await db()`
      INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason)
      VALUES (${actor.id},'employee.emergency_contacts_view','employee',${id},${employee.business_head_id},
        ${JSON.stringify({ count: contacts.length, masked: !fullAccess, self })}::jsonb,
        ${fullAccess ? "Emergency contacts viewed" : "Masked emergency contacts viewed"})
    `;
    return ok({ employeeId: id, contacts, fieldAccess: { phone: fullAccess } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = createSchema.parse(await request.json());
    const employee = await findEmployee(id);
    if (!employee) return fail("Employee not found", 404);
    const actor = await requireApiUser();
    if (actor instanceof Response) return actor;
    const self = !actor.apiKeyId && actor.id === employee.user_id;
    if (!self) {
      const scoped = await requireApiUser("people:write", employee.business_head_id, employee.department_id);
      if (scoped instanceof Response) return scoped;
    }
    const [created] = await db().begin(async tx => {
      const rows = await tx`
        INSERT INTO employee_emergency_contacts (employee_id,full_name,relationship,phone_encrypted,priority)
        VALUES (${id},${input.fullName},${input.relationship || null},${sealJson({ phone: input.phone })},${input.priority})
        RETURNING id,full_name,relationship,priority,created_at,updated_at
      `;
      await tx`
        INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason)
        VALUES (${actor.id},'employee.emergency_contact_create','employee_emergency_contact',${rows[0].id},${employee.business_head_id},
          ${JSON.stringify({ employeeId: id, relationship: rows[0].relationship, priority: rows[0].priority, phoneStoredEncrypted: true, self })}::jsonb,
          ${input.reason})
      `;
      return rows;
    });
    return ok(created, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
