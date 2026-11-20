import { apiError, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";
import { ITEM_STATUSES } from "@/lib/staff-item-rules";

/** The company-wide list of items given to staff, with filters. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const head = url.searchParams.get("businessHeadId") || null;
    const typeId = url.searchParams.get("typeId") || null;
    const statusParam = url.searchParams.get("status") || "";
    const status = (ITEM_STATUSES as readonly string[]).includes(statusParam) ? statusParam : null;
    const q = (url.searchParams.get("q") || "").trim().slice(0, 80);
    const user = await requireApiUser("assets:read", head);
    if (user instanceof Response) return user;
    const like = q ? `%${q.replace(/[%_\\]/g, m => `\\${m}`)}%` : null;
    return ok(await db()`SELECT i.id, i.employee_id, e.employee_code, concat_ws(' ', e.first_name, e.last_name) AS employee_name, e.status AS employee_status, e.business_head_id, b.name AS business_head,
        t.id AS item_type_id, t.name AS type_name, i.details, i.quantity, i.issued_on::text AS issued_on, i.status, i.status_on::text AS status_on, i.note
      FROM staff_items i JOIN employees e ON e.id = i.employee_id JOIN business_heads b ON b.id = e.business_head_id JOIN staff_item_types t ON t.id = i.item_type_id
      WHERE (${head}::uuid IS NULL OR e.business_head_id = ${head}::uuid) AND (${typeId}::uuid IS NULL OR t.id = ${typeId}::uuid) AND (${status}::text IS NULL OR i.status = ${status})
        AND (${like}::text IS NULL OR concat_ws(' ', e.first_name, e.last_name) ILIKE ${like} OR e.employee_code ILIKE ${like} OR i.details ILIKE ${like})
      ORDER BY lower(concat_ws(' ', e.first_name, e.last_name)), t.sort_order, i.issued_on DESC LIMIT 3000`);
  } catch (error) { return apiError(error); }
}
