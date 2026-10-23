import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { hasPermissionForScope } from "@/lib/auth";
import { db } from "@/lib/database";
import { addMonths, DEFAULT_PROBATION_MONTHS } from "@/lib/data-cleanup-rules";

// Recent joiners who are marked Active, so they can be put back on probation in one go.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const head = url.searchParams.get("businessHeadId") || null;
    const joinedWithin = Math.min(Math.max(Number(url.searchParams.get("joinedWithinMonths")) || 6, 1), 24);
    const probationMonths = Math.min(Math.max(Number(url.searchParams.get("probationMonths")) || DEFAULT_PROBATION_MONTHS, 1), 24);
    const user = await requireApiUser("people:write", head);
    if (user instanceof Response) return user;
    const rows = await db()<{ id: string; employee_code: string; name: string; position: string | null; business_head_id: string; business_head: string; department_id: string | null; date_joined: string; probation_end_date: string | null; confirmation_date: string | null }[]>`
      SELECT e.id,e.employee_code,concat_ws(' ',e.first_name,e.last_name) AS name,e.position,e.business_head_id,b.name AS business_head,e.department_id,e.date_joined::text AS date_joined,
        e.probation_end_date::text AS probation_end_date,e.confirmation_date::text AS confirmation_date
      FROM employees e JOIN business_heads b ON b.id=e.business_head_id
      WHERE e.status='active' AND e.date_joined>=current_date-make_interval(months=>${joinedWithin}::int) AND e.date_joined<=current_date
        AND (${head}::uuid IS NULL OR e.business_head_id=${head}::uuid)
      ORDER BY e.date_joined DESC,e.first_name`;
    const people = rows.filter(row => hasPermissionForScope(user, "people:write", row.business_head_id, row.department_id)).map(row => ({
      id: row.id, code: row.employee_code, name: row.name.replace(/\s+/g, " ").trim(), position: row.position, company: row.business_head, joined: row.date_joined,
      probationEnd: row.probation_end_date, confirmation: row.confirmation_date, suggestedEnd: addMonths(row.date_joined, probationMonths),
    }));
    return ok(people);
  } catch (error) { return apiError(error); }
}

const schema = z.object({
  items: z.array(z.object({ id: z.uuid(), probationEndDate: z.iso.date() })).min(1).max(300),
  clearConfirmation: z.boolean(),
  reason: z.string().trim().min(3).max(500),
});

// Puts the chosen Active people on probation with the given end date. Each person gets the same history and audit entries as an edit from their record.
export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const sql = db();
    const ids = [...new Set(input.items.map(item => item.id))];
    const found = await sql<{ id: string; business_head_id: string; department_id: string | null; status: string; date_joined: string }[]>`SELECT id,business_head_id,department_id,status::text AS status,date_joined::text AS date_joined FROM employees WHERE id=ANY(${ids}::uuid[])`;
    if (found.length !== ids.length) return fail("Someone in the list was not found. Reload the page and try again.", 404);
    const user = await requireApiUser("people:write", found[0].business_head_id, found[0].department_id);
    if (user instanceof Response) return user;
    for (const row of found) if (!hasPermissionForScope(user, "people:write", row.business_head_id, row.department_id)) return fail("You do not have permission to change everyone in this list.", 403);
    const endById = new Map(input.items.map(item => [item.id, item.probationEndDate]));
    for (const row of found) {
      const end = endById.get(row.id) as string;
      if (end < row.date_joined) return fail("A probation end date cannot be before the person's joining date.", 422);
    }
    const result = await sql.begin(async tx => {
      const changed: string[] = []; const skipped: string[] = [];
      for (const id of ids) {
        const [before] = await tx`SELECT * FROM employees WHERE id=${id} FOR UPDATE`;
        if (before.status !== "active") { skipped.push(id); continue; }
        const [after] = await tx`UPDATE employees SET status='probation',probation_end_date=${endById.get(id) as string}::date,confirmation_date=CASE WHEN ${input.clearConfirmation} THEN NULL ELSE confirmation_date END,updated_at=now() WHERE id=${id} RETURNING *`;
        await tx`INSERT INTO employee_events (employee_id,event_type,effective_date,previous_values,new_values,reason,approved_by,created_by) VALUES (${id},'profile_change',current_date,${tx.json(before)},${tx.json(after)},${input.reason},${user.id},${user.id})`;
        await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason) VALUES (${user.id},'employee.update','employee',${id},${before.business_head_id},${tx.json(before)},${tx.json(after)},${input.reason})`;
        changed.push(id);
      }
      return { changed: changed.length, skipped: skipped.length };
    });
    return ok(result);
  } catch (error) { return apiError(error); }
}
