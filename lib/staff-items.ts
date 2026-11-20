// Server-side helpers for company items given to staff.
import { db } from "./database";
import { inStock } from "./staff-item-rules";

export const WORKING = ["probation", "active", "notice_period"];
export const indiaToday = async () => (await db()<{ today: string }[]>`SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS today`)[0].today;

export type StockRowOut = { business_head_id: string; business_head: string; item_type_id: string; type_name: string; active: boolean; added: number; removed: number; with_staff: number; lost: number; damaged: number; in_stock: number; set_up: boolean };

/** Stock per company and item type. With one company chosen every shown type is listed; for all companies only rows that have any numbers. */
export async function stockRows(businessHeadId: string | null): Promise<StockRowOut[]> {
  const rows = await db()<Omit<StockRowOut, "in_stock" | "set_up">[]>`
    WITH s AS (
      SELECT business_head_id, item_type_id,
        coalesce(sum(quantity) FILTER (WHERE entry_type = 'added'), 0)::int AS added,
        coalesce(sum(quantity) FILTER (WHERE entry_type = 'removed'), 0)::int AS removed
      FROM staff_item_stock_entries GROUP BY 1, 2),
    i AS (
      SELECT e.business_head_id, it.item_type_id,
        coalesce(sum(it.quantity) FILTER (WHERE it.status = 'with_staff'), 0)::int AS with_staff,
        coalesce(sum(it.quantity) FILTER (WHERE it.status = 'lost'), 0)::int AS lost,
        coalesce(sum(it.quantity) FILTER (WHERE it.status = 'damaged'), 0)::int AS damaged
      FROM staff_items it JOIN employees e ON e.id = it.employee_id GROUP BY 1, 2)
    SELECT b.id AS business_head_id, b.name AS business_head, t.id AS item_type_id, t.name AS type_name, t.active,
      coalesce(s.added, 0)::int AS added, coalesce(s.removed, 0)::int AS removed,
      coalesce(i.with_staff, 0)::int AS with_staff, coalesce(i.lost, 0)::int AS lost, coalesce(i.damaged, 0)::int AS damaged
    FROM business_heads b CROSS JOIN staff_item_types t
    LEFT JOIN s ON s.business_head_id = b.id AND s.item_type_id = t.id
    LEFT JOIN i ON i.business_head_id = b.id AND i.item_type_id = t.id
    WHERE b.active AND (${businessHeadId}::uuid IS NULL OR b.id = ${businessHeadId}::uuid)
    ORDER BY b.name, t.sort_order, lower(t.name)`;
  return rows
    .map(row => ({ ...row, in_stock: inStock({ added: row.added, removed: row.removed, withStaff: row.with_staff, lost: row.lost, damaged: row.damaged }), set_up: row.added > 0 || row.removed > 0 }))
    .filter(row => row.added || row.removed || row.with_staff || row.lost || row.damaged || (businessHeadId && row.active));
}
