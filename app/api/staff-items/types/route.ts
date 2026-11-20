import { apiError, fail, ok } from "@/lib/api";
import { currentUser, hasPermissionAnywhere } from "@/lib/auth";
import { db } from "@/lib/database";
import { parseTypeName } from "@/lib/staff-item-rules";

async function allowed(permission: string) {
  const user = await currentUser();
  if (!user) return { error: fail("Authentication required", 401) };
  if (user.mustChangePassword) return { error: fail("Password change required", 403, { code: "PASSWORD_CHANGE_REQUIRED" }) };
  if (!hasPermissionAnywhere(user, permission)) return { error: fail("You do not have permission for this action", 403) };
  return { user };
}

/** The list of item types (Laptop, Mobile phone, ...). Hidden types are included so they can be shown again. */
export async function GET() {
  try {
    const gate = await allowed("assets:read"); if (gate.error) return gate.error;
    return ok(await db()`SELECT id, name, active, sort_order FROM staff_item_types ORDER BY active DESC, sort_order, lower(name)`);
  } catch (error) { return apiError(error); }
}

/** Add a new type. A name that was hidden earlier is brought back instead of being added twice. */
export async function POST(request: Request) {
  try {
    const gate = await allowed("assets:write"); if (gate.error) return gate.error;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = parseTypeName(body.name);
    if (!parsed.ok) return fail(parsed.message, 422);
    const sql = db();
    const row = await sql.begin(async tx => {
      const [existing] = await tx`SELECT id, name, active, sort_order FROM staff_item_types WHERE lower(name) = lower(${parsed.name}) FOR UPDATE`;
      if (existing?.active) return { ...existing, already: true };
      if (existing) {
        const [back] = await tx`UPDATE staff_item_types SET active = true WHERE id = ${existing.id} RETURNING id, name, active, sort_order`;
        await tx`INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, after_data, reason) VALUES (${gate.user!.id}, 'staff_item_type.show', 'staff_item_type', ${back.id}, ${JSON.stringify(back)}::jsonb, 'Item type shown again')`;
        return back;
      }
      const [created] = await tx`INSERT INTO staff_item_types (name, sort_order) VALUES (${parsed.name}, (SELECT coalesce(max(sort_order), 0) + 10 FROM staff_item_types)) RETURNING id, name, active, sort_order`;
      await tx`INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, after_data, reason) VALUES (${gate.user!.id}, 'staff_item_type.create', 'staff_item_type', ${created.id}, ${JSON.stringify(created)}::jsonb, 'Item type added')`;
      return created;
    });
    return ok(row, { status: 201 });
  } catch (error) { return apiError(error); }
}
