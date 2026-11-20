import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";
import { eventFor, ItemStatus, parseStatusChange, STATUS_LABEL } from "@/lib/staff-item-rules";
import { indiaToday, WORKING } from "@/lib/staff-items";

/** Mark an item returned, lost or damaged, or put it back with the person (to fix a mistake). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("Item not found", 404);
    const sql = db();
    const [item] = await sql`SELECT i.id, i.status, i.issued_on::text AS issued_on, e.business_head_id, e.department_id, e.status AS employee_status, t.name AS type_name FROM staff_items i JOIN employees e ON e.id = i.employee_id JOIN staff_item_types t ON t.id = i.item_type_id WHERE i.id = ${id}::uuid`;
    if (!item) return fail("Item not found", 404);
    const user = await requireApiUser("assets:write", item.business_head_id, item.department_id);
    if (user instanceof Response) return user;
    const parsed = parseStatusChange((await request.json().catch(() => ({}))) as Record<string, unknown>, item.status as ItemStatus, await indiaToday(), item.issued_on);
    if (!parsed.ok) return fail(parsed.message, 422);
    const { action, on, note } = parsed.value;
    if (action === "reopen" && !WORKING.includes(item.employee_status)) return fail("This person has left, so the item cannot be put back with them.", 409);
    const row = await sql.begin(async tx => {
      const [current] = await tx`SELECT status FROM staff_items WHERE id = ${id}::uuid FOR UPDATE`;
      if (current.status !== item.status) return null; // somebody else changed it a moment ago
      const [after] = await tx`UPDATE staff_items SET status = ${parsed.to}, status_on = ${action === "reopen" ? null : on}::date, updated_at = now() WHERE id = ${id}::uuid RETURNING id, status, status_on::text AS status_on`;
      const event = eventFor(action);
      await tx`INSERT INTO staff_item_events (item_id, event, occurred_on, note, performed_by) VALUES (${id}::uuid, ${event}, ${on}::date, ${note}, ${user.id})`;
      await tx`INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, business_head_id, before_data, after_data, reason) VALUES (${user.id}, ${`staff_item.${event}`}, 'staff_item', ${id}, ${item.business_head_id}, ${JSON.stringify({ status: item.status })}::jsonb, ${JSON.stringify(after)}::jsonb, ${note || `${item.type_name}: ${STATUS_LABEL[parsed.to]}`})`;
      return after;
    });
    return row ? ok(row) : fail("This item was just changed by someone else. Reload and try again.", 409);
  } catch (error) { return apiError(error); }
}
