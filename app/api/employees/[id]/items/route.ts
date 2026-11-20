import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { hasPermissionForScope } from "@/lib/auth";
import { db } from "@/lib/database";
import { parseIssue } from "@/lib/staff-item-rules";
import { indiaToday, stockRows, WORKING } from "@/lib/staff-items";

type Emp = { id: string; business_head_id: string; department_id: string | null; status: string; first_name: string; last_name: string | null };
async function employeeOf(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [employee] = await db()<Emp[]>`SELECT id, business_head_id, department_id, status, first_name, last_name FROM employees WHERE id = ${id}::uuid`;
  return employee || null;
}

/** Everything given to this person, its history, and the stock of each type in their company. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const employee = await employeeOf(id);
    if (!employee) return fail("Employee not found", 404);
    const user = await requireApiUser("assets:read", employee.business_head_id, employee.department_id);
    if (user instanceof Response) return user;
    const sql = db();
    const items = await sql`SELECT i.id, i.item_type_id, t.name AS type_name, i.details, i.quantity, i.issued_on::text AS issued_on, i.status, i.status_on::text AS status_on, i.note, i.created_at
      FROM staff_items i JOIN staff_item_types t ON t.id = i.item_type_id WHERE i.employee_id = ${id}::uuid
      ORDER BY (i.status = 'with_staff') DESC, i.issued_on DESC, i.created_at DESC`;
    const events = await sql`SELECT e.item_id, e.event, e.occurred_on::text AS occurred_on, e.note, e.created_at, u.full_name AS by
      FROM staff_item_events e JOIN staff_items i ON i.id = e.item_id LEFT JOIN users u ON u.id = e.performed_by
      WHERE i.employee_id = ${id}::uuid ORDER BY e.created_at DESC LIMIT 500`;
    const stock = (await stockRows(employee.business_head_id)).map(row => ({ item_type_id: row.item_type_id, in_stock: row.in_stock, set_up: row.set_up }));
    return ok({ items, events, stock, canWrite: hasPermissionForScope(user, "assets:write", employee.business_head_id, employee.department_id), working: WORKING.includes(employee.status) });
  } catch (error) { return apiError(error); }
}

/** Give an item to this person. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const employee = await employeeOf(id);
    if (!employee) return fail("Employee not found", 404);
    const user = await requireApiUser("assets:write", employee.business_head_id, employee.department_id);
    if (user instanceof Response) return user;
    if (!WORKING.includes(employee.status)) return fail("Items can only be given to people who are currently working.", 409);
    const parsed = parseIssue((await request.json().catch(() => ({}))) as Record<string, unknown>, await indiaToday());
    if (!parsed.ok) return fail(parsed.message, 422);
    const v = parsed.value;
    const sql = db();
    const row = await sql.begin(async tx => {
      const [type] = await tx`SELECT id, name, active FROM staff_item_types WHERE id = ${v.itemTypeId}::uuid`;
      if (!type?.active) return null;
      const [item] = await tx`INSERT INTO staff_items (employee_id, item_type_id, details, quantity, issued_on, note, created_by) VALUES (${id}::uuid, ${v.itemTypeId}::uuid, ${v.details}, ${v.quantity}, ${v.issuedOn}::date, ${v.note}, ${user.id}) RETURNING id, item_type_id, details, quantity, issued_on::text AS issued_on, status, note`;
      await tx`INSERT INTO staff_item_events (item_id, event, occurred_on, note, performed_by) VALUES (${item.id}, 'given', ${v.issuedOn}::date, ${v.note}, ${user.id})`;
      await tx`INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, business_head_id, after_data, reason) VALUES (${user.id}, 'staff_item.give', 'staff_item', ${item.id}, ${employee.business_head_id}, ${JSON.stringify({ ...item, type: type.name, employeeId: id })}::jsonb, ${`${type.name} given`})`;
      return { ...item, type_name: type.name };
    });
    return row ? ok(row, { status: 201 }) : fail("That item type is not available. Choose another or add it first.", 422);
  } catch (error) { return apiError(error); }
}
