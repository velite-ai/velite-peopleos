import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { hasPermissionForScope } from "@/lib/auth";
import { db } from "@/lib/database";
import { exitDateProblem } from "@/lib/data-cleanup-rules";

// People removed from the Staff list who have no exit recorded yet, with what is on file for each. Used to record the real leavers.
export async function GET(request: Request) {
  try {
    const head = new URL(request.url).searchParams.get("businessHeadId") || null;
    const user = await requireApiUser("separation:write", head);
    if (user instanceof Response) return user;
    const rows = await db()<{
      id: string; employee_code: string; name: string; position: string | null; business_head_id: string; department_id: string | null; company: string; joined: string;
      last_attendance: string | null; attendance_this_month: number; has_pay: boolean; documents: number; removed_on: string | null;
      twin_id: string | null; twin_code: string | null; twin_company: string | null; twin_has_pay: boolean | null;
    }[]>`
      SELECT e.id,e.employee_code,btrim(regexp_replace(concat_ws(' ',e.first_name,e.last_name),'\\s+',' ','g')) AS name,e.position,e.business_head_id,e.department_id,b.name AS company,e.date_joined::text AS joined,
        (SELECT max(a.attendance_date)::text FROM attendance_days a WHERE a.employee_id=e.id) AS last_attendance,
        (SELECT count(*)::int FROM attendance_days a WHERE a.employee_id=e.id AND a.attendance_date>=date_trunc('month',current_date)) AS attendance_this_month,
        EXISTS (SELECT 1 FROM employee_compensation c WHERE c.employee_id=e.id) AS has_pay,
        (SELECT count(*)::int FROM documents d WHERE d.employee_id=e.id) AS documents,
        (SELECT max(au.occurred_at)::date::text FROM audit_events au WHERE au.entity_id=e.id::text AND au.action='employee.remove_from_people') AS removed_on,
        twin.id AS twin_id,twin.employee_code AS twin_code,tb.name AS twin_company,
        CASE WHEN twin.id IS NULL THEN NULL ELSE EXISTS (SELECT 1 FROM employee_compensation c WHERE c.employee_id=twin.id) END AS twin_has_pay
      FROM employees e JOIN business_heads b ON b.id=e.business_head_id
      LEFT JOIN LATERAL (SELECT w.id,w.employee_code,w.business_head_id FROM employees w WHERE w.id<>e.id AND w.status NOT IN ('archived','separated')
        AND lower(regexp_replace(concat_ws(' ',w.first_name,w.last_name),'\\s+',' ','g'))=lower(btrim(regexp_replace(concat_ws(' ',e.first_name,e.last_name),'\\s+',' ','g'))) ORDER BY w.date_joined LIMIT 1) twin ON true
      LEFT JOIN business_heads tb ON tb.id=twin.business_head_id
      WHERE e.status='archived' AND (${head}::uuid IS NULL OR e.business_head_id=${head}::uuid)
        AND NOT EXISTS (SELECT 1 FROM separations s WHERE s.employee_id=e.id)
        AND NOT EXISTS (SELECT 1 FROM audit_events m WHERE m.entity_id=e.id::text AND m.action='employee.marked_duplicate')
      ORDER BY b.name,e.employee_code`;
    const canSeePay = (row: { business_head_id: string; department_id: string | null }) => hasPermissionForScope(user, "payroll:read", row.business_head_id, row.department_id);
    return ok(rows.filter(row => hasPermissionForScope(user, "separation:write", row.business_head_id, row.department_id)).map(row => ({
      id: row.id, code: row.employee_code, name: row.name, position: row.position, company: row.company, joined: row.joined,
      lastAttendance: row.last_attendance, attendanceThisMonth: row.attendance_this_month, removedOn: row.removed_on,
      hasPay: canSeePay(row) ? row.has_pay : null, documents: row.documents,
      twin: row.twin_id ? { id: row.twin_id, code: row.twin_code, company: row.twin_company, hasPay: canSeePay(row) ? row.twin_has_pay : null } : null,
    })));
  } catch (error) { return apiError(error); }
}

const schema = z.object({
  items: z.array(z.discriminatedUnion("kind", [
    z.object({ id: z.uuid(), kind: z.enum(["resignation", "termination", "contract_completion", "retirement", "abandonment"]), lastWorkingDay: z.iso.date() }),
    z.object({ id: z.uuid(), kind: z.literal("duplicate") }),
  ])).min(1).max(100),
  note: z.string().trim().max(300).optional(),
});

const TEXT: Record<string, string> = { resignation: "resigned", termination: "was dismissed", contract_completion: "finished a contract", retirement: "retired", abandonment: "stopped coming" };

// Records the exits afterwards: a real leaver gets a completed exit and the status "separated" with the last working day (so the final salary can be run and the
// relieving / experience letters can be printed). A duplicate entry is only marked and stays removed. All or nothing.
export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const sql = db();
    const ids = [...new Set(input.items.map(item => item.id))];
    if (ids.length !== input.items.length) return fail("The same person is listed twice.", 422);
    const found = await sql<{ id: string; business_head_id: string; department_id: string | null; status: string; date_joined: string; employee_code: string; name: string }[]>`SELECT id,business_head_id,department_id,status::text AS status,date_joined::text AS date_joined,employee_code,concat_ws(' ',first_name,last_name) AS name FROM employees WHERE id=ANY(${ids}::uuid[])`;
    if (found.length !== ids.length) return fail("Someone in the list was not found. Reload the page and try again.", 404);
    const user = await requireApiUser("separation:write", found[0].business_head_id, found[0].department_id);
    if (user instanceof Response) return user;
    for (const row of found) if (!hasPermissionForScope(user, "separation:write", row.business_head_id, row.department_id)) return fail("You do not have permission for everyone in this list.", 403);
    const today = (await sql<{ d: string }[]>`SELECT current_date::text AS d`)[0].d;
    const byId = new Map(found.map(row => [row.id, row]));
    for (const item of input.items) {
      const row = byId.get(item.id)!;
      if (row.status !== "archived") return fail(`${row.name.replace(/\s+/g, " ").trim()} is not in the removed list any more. Reload the page.`, 409);
      if (item.kind !== "duplicate") { const problem = exitDateProblem(item.lastWorkingDay, row.date_joined, today); if (problem) return fail(`${row.name.replace(/\s+/g, " ").trim()}: ${problem}`, 422); }
    }
    const result = await sql.begin(async tx => {
      let exits = 0, duplicates = 0;
      for (const item of input.items) {
        const [before] = await tx`SELECT * FROM employees WHERE id=${item.id} FOR UPDATE`;
        if (before.status !== "archived") throw new Error("Someone was changed by another user. Reload the page and try again.");
        const clean = String(before.first_name + " " + (before.last_name ?? "")).replace(/\s+/g, " ").trim();
        if (item.kind === "duplicate") {
          await tx`INSERT INTO employee_events (employee_id,event_type,effective_date,new_values,reason,approved_by,created_by) VALUES (${item.id},'profile_change',current_date,${tx.json({ duplicateEntry: true })},${input.note || "Entered twice by mistake; kept removed"},${user.id},${user.id})`;
          await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason) VALUES (${user.id},'employee.marked_duplicate','employee',${item.id},${before.business_head_id},${tx.json({ employeeCode: before.employee_code })},${input.note || "Entered twice by mistake; kept removed"})`;
          duplicates++; continue;
        }
        const reason = `Recorded afterwards from the removed staff list: ${clean} ${TEXT[item.kind]}.${input.note ? ` ${input.note}` : ""}`;
        const [sep] = await tx`INSERT INTO separations (employee_id,separation_type,submitted_date,proposed_last_working_date,approved_last_working_date,reason,notice_days,status,approved_by,created_by) VALUES (${item.id},${item.kind},${item.lastWorkingDay}::date,${item.lastWorkingDay}::date,${item.lastWorkingDay}::date,${reason},0,'completed',${user.id},${user.id}) RETURNING id`;
        const [after] = await tx`UPDATE employees SET status='separated',last_working_date=${item.lastWorkingDay}::date,updated_at=now() WHERE id=${item.id} RETURNING *`;
        await tx`INSERT INTO employee_events (employee_id,event_type,effective_date,previous_values,new_values,reason,approved_by,created_by) VALUES (${item.id},'separation',${item.lastWorkingDay}::date,${tx.json({ status: "archived" })},${tx.json({ status: "separated", lastWorkingDate: item.lastWorkingDay, separationType: item.kind })},${reason},${user.id},${user.id})`;
        await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason) VALUES (${user.id},'employee.exit_recorded','employee',${item.id},${before.business_head_id},${tx.json({ status: before.status })},${tx.json({ status: after.status, lastWorkingDate: item.lastWorkingDay, separationId: sep.id })},${reason})`;
        exits++;
      }
      return { exits, duplicates };
    });
    return ok(result);
  } catch (error) { return apiError(error); }
}
