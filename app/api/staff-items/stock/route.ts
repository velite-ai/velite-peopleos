import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";
import { parseStockEntry } from "@/lib/staff-item-rules";
import { indiaToday, stockRows } from "@/lib/staff-items";

/** Stock per company and item type, plus the latest stock entries. */
export async function GET(request: Request) {
  try {
    const head = new URL(request.url).searchParams.get("businessHeadId") || null;
    const user = await requireApiUser("assets:read", head);
    if (user instanceof Response) return user;
    const entries = await db()`SELECT s.id, b.name AS business_head, t.name AS type_name, s.entry_type, s.quantity, s.entry_on::text AS entry_on, s.note, u.full_name AS by, s.created_at
      FROM staff_item_stock_entries s JOIN business_heads b ON b.id = s.business_head_id JOIN staff_item_types t ON t.id = s.item_type_id LEFT JOIN users u ON u.id = s.created_by
      WHERE (${head}::uuid IS NULL OR s.business_head_id = ${head}::uuid) ORDER BY s.entry_on DESC, s.created_at DESC LIMIT 200`;
    return ok({ rows: await stockRows(head), entries });
  } catch (error) { return apiError(error); }
}

const ids = z.object({ businessHeadId: z.uuid(), itemTypeId: z.uuid() });

/** Add stock that was bought or received, or take stock out (sold, scrapped, given away). */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const idCheck = ids.safeParse(body);
    if (!idCheck.success) return fail("Choose the company and the item.", 422);
    const { businessHeadId, itemTypeId } = idCheck.data;
    const user = await requireApiUser("assets:write", businessHeadId);
    if (user instanceof Response) return user;
    const parsed = parseStockEntry(body, await indiaToday());
    if (!parsed.ok) return fail(parsed.message, 422);
    const v = parsed.value;
    const sql = db();
    const result = await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`staff-item-stock:${businessHeadId}:${itemTypeId}`}))`;
      const [type] = await tx`SELECT id, name, active FROM staff_item_types WHERE id = ${itemTypeId}::uuid`;
      if (!type) return { error: "That item type was not found.", status: 404 };
      if (v.entryType === "removed") {
        const row = (await stockRows(businessHeadId)).find(item => item.item_type_id === itemTypeId);
        if (!row || v.quantity > row.in_stock) return { error: `Only ${Math.max(0, row?.in_stock ?? 0)} ${type.name} in stock, so ${v.quantity} cannot be taken out.`, status: 409 };
      }
      const [entry] = await tx`INSERT INTO staff_item_stock_entries (business_head_id, item_type_id, entry_type, quantity, entry_on, note, created_by) VALUES (${businessHeadId}::uuid, ${itemTypeId}::uuid, ${v.entryType}, ${v.quantity}, ${v.entryOn}::date, ${v.note}, ${user.id}) RETURNING id, entry_type, quantity, entry_on::text AS entry_on, note`;
      await tx`INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, business_head_id, after_data, reason) VALUES (${user.id}, ${`staff_item_stock.${v.entryType}`}, 'staff_item_stock', ${entry.id}, ${businessHeadId}::uuid, ${JSON.stringify({ ...entry, type: type.name })}::jsonb, ${v.note || `${type.name} stock ${v.entryType}`})`;
      return { entry };
    });
    if ("error" in result) return fail(result.error as string, result.status as number);
    return ok(result.entry, { status: 201 });
  } catch (error) { return apiError(error); }
}
