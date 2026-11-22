import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { hasPermissionForScope } from "@/lib/auth";
import { db } from "@/lib/database";
import { parseBulkGive } from "@/lib/staff-item-rules";
import { indiaToday, WORKING } from "@/lib/staff-items";

/** Give the same item to one or many people. All or nothing: if anyone chosen cannot receive it, nothing is saved. */
export async function POST(request: Request) {
  try {
    const parsed = parseBulkGive((await request.json().catch(() => ({}))) as Record<string, unknown>, await indiaToday());
    if (!parsed.ok) return fail(parsed.message, 422);
    const v = parsed.value;
    const sql = db();
    const people = await sql<{ id: string; name: string; business_head_id: string; department_id: string | null; status: string }[]>`SELECT id, concat_ws(' ', first_name, last_name) AS name, business_head_id, department_id, status FROM employees WHERE id = ANY(${parsed.employeeIds}::uuid[])`;
    if (people.length !== parsed.employeeIds.length) return fail("One or more of the people chosen could not be found.", 404);
    const user = await requireApiUser("assets:write", people[0].business_head_id, people[0].department_id);
    if (user instanceof Response) return user;
    const names = (list: { name: string }[]) => list.slice(0, 5).map(item => item.name).join(", ") + (list.length > 5 ? ` and ${list.length - 5} more` : "");
    const noAccess = people.filter(person => !hasPermissionForScope(user, "assets:write", person.business_head_id, person.department_id));
    if (noAccess.length) return fail(`You do not have permission to give items to: ${names(noAccess)}. Nothing was saved.`, 403);
    const notWorking = people.filter(person => !WORKING.includes(person.status));
    if (notWorking.length) return fail(`Items can only be given to people who are currently working. Not working: ${names(notWorking)}. Nothing was saved.`, 409);
    const result = await sql.begin(async tx => {
      const [type] = await tx`SELECT id, name, active FROM staff_item_types WHERE id = ${v.itemTypeId}::uuid`;
      if (!type?.active) return null;
      for (const person of people) {
        const [item] = await tx`INSERT INTO staff_items (employee_id, item_type_id, details, quantity, issued_on, note, created_by) VALUES (${person.id}::uuid, ${v.itemTypeId}::uuid, ${v.details}, ${v.quantity}, ${v.issuedOn}::date, ${v.note}, ${user.id}) RETURNING id, item_type_id, details, quantity, issued_on::text AS issued_on, status, note`;
        await tx`INSERT INTO staff_item_events (item_id, event, occurred_on, note, performed_by) VALUES (${item.id}, 'given', ${v.issuedOn}::date, ${v.note}, ${user.id})`;
        await tx`INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, business_head_id, after_data, reason) VALUES (${user.id}, 'staff_item.give', 'staff_item', ${item.id}, ${person.business_head_id}, ${JSON.stringify({ ...item, type: type.name, employeeId: person.id, bulk: people.length > 1 })}::jsonb, ${`${type.name} given`})`;
      }
      return { created: people.length, type: type.name };
    });
    return result ? ok(result, { status: 201 }) : fail("That item type is not available. Choose another or add it first.", 422);
  } catch (error) { return apiError(error); }
}
