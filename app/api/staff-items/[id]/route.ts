import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";
import { parseEdit } from "@/lib/staff-item-rules";
import { indiaToday } from "@/lib/staff-items";

/** Correct the details, quantity, date given or note of an item that was recorded. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("Item not found", 404);
    const sql = db();
    const [item] = await sql`SELECT i.id, i.details, i.quantity, i.issued_on::text AS issued_on, i.note, i.status, e.business_head_id, e.department_id FROM staff_items i JOIN employees e ON e.id = i.employee_id WHERE i.id = ${id}::uuid`;
    if (!item) return fail("Item not found", 404);
    const user = await requireApiUser("assets:write", item.business_head_id, item.department_id);
    if (user instanceof Response) return user;
    const parsed = parseEdit((await request.json().catch(() => ({}))) as Record<string, unknown>, await indiaToday());
    if (!parsed.ok) return fail(parsed.message, 422);
    const v = parsed.value;
    const changed = [v.details !== item.details && "details", v.quantity !== item.quantity && "quantity", v.issuedOn !== item.issued_on && "date given", v.note !== item.note && "note"].filter(Boolean) as string[];
    if (!changed.length) return ok({ id, unchanged: true });
    const row = await sql.begin(async tx => {
      const [after] = await tx`UPDATE staff_items SET details = ${v.details}, quantity = ${v.quantity}, issued_on = ${v.issuedOn}::date, note = ${v.note}, updated_at = now() WHERE id = ${id}::uuid RETURNING id, details, quantity, issued_on::text AS issued_on, note, status`;
      await tx`INSERT INTO staff_item_events (item_id, event, occurred_on, note, performed_by) VALUES (${id}::uuid, 'edited', ${await indiaToday()}::date, ${`Changed: ${changed.join(", ")}`}, ${user.id})`;
      await tx`INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, business_head_id, before_data, after_data, reason) VALUES (${user.id}, 'staff_item.edit', 'staff_item', ${id}, ${item.business_head_id}, ${JSON.stringify({ details: item.details, quantity: item.quantity, issued_on: item.issued_on, note: item.note })}::jsonb, ${JSON.stringify(after)}::jsonb, ${`Changed: ${changed.join(", ")}`})`;
      return after;
    });
    return ok(row);
  } catch (error) { return apiError(error); }
}
