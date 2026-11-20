import { apiError, fail, ok } from "@/lib/api";
import { currentUser, hasPermissionAnywhere } from "@/lib/auth";
import { db } from "@/lib/database";

/** Hide or show an item type. Items already given keep their type; a hidden type just leaves the drop-down. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await currentUser();
    if (!user) return fail("Authentication required", 401);
    if (!hasPermissionAnywhere(user, "assets:write")) return fail("You do not have permission for this action", 403);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("Item type not found", 404);
    const body = (await request.json().catch(() => ({}))) as { active?: unknown };
    if (typeof body.active !== "boolean") return fail("Say whether the type should be shown or hidden.", 422);
    const sql = db();
    const row = await sql.begin(async tx => {
      const [before] = await tx`SELECT id, name, active FROM staff_item_types WHERE id = ${id}::uuid FOR UPDATE`;
      if (!before) return null;
      const [after] = await tx`UPDATE staff_item_types SET active = ${body.active as boolean} WHERE id = ${id}::uuid RETURNING id, name, active, sort_order`;
      await tx`INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, before_data, after_data, reason) VALUES (${user.id}, ${body.active ? "staff_item_type.show" : "staff_item_type.hide"}, 'staff_item_type', ${id}, ${JSON.stringify(before)}::jsonb, ${JSON.stringify(after)}::jsonb, ${body.active ? "Item type shown" : "Item type hidden"})`;
      return after;
    });
    return row ? ok(row) : fail("Item type not found", 404);
  } catch (error) { return apiError(error); }
}
