import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { hasPermissionForScope } from "@/lib/auth";
import { db } from "@/lib/database";

const schema = z.object({
  date: z.iso.date(),
  status: z.enum(["present", "weekly_off", "holiday"]),
  employeeIds: z.array(z.uuid()).min(1).max(1000),
});

type Candidate = { id: string; business_head_id: string; department_id: string | null; leave_paid: boolean | null; half_day_leave: boolean };

// Marks the staff who have no attendance yet for the day. It never overwrites a record that already exists.
// A "present" run puts anyone with an approved full-day leave on that date on leave instead, and leaves
// anyone on an approved half-day leave unmarked for a person to decide.
export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const user = await requireApiUser();
    if (user instanceof Response) return user;
    const sql = db();
    const candidates = await sql<Candidate[]>`
      SELECT e.id,e.business_head_id,e.department_id,
        (SELECT lr.paid FROM leave_requests lr
          WHERE lr.employee_id=e.id AND lr.status='approved'
            AND lr.derived_work_dates @> to_jsonb(${input.date}::text)
            AND NOT (${input.date}::date=lr.start_date AND lr.start_day_fraction<1)
            AND NOT (${input.date}::date=lr.end_date AND lr.end_day_fraction<1)
          ORDER BY lr.created_at DESC LIMIT 1) AS leave_paid,
        EXISTS (SELECT 1 FROM leave_requests lr
          WHERE lr.employee_id=e.id AND lr.status='approved'
            AND lr.derived_work_dates @> to_jsonb(${input.date}::text)
            AND ((${input.date}::date=lr.start_date AND lr.start_day_fraction<1) OR (${input.date}::date=lr.end_date AND lr.end_day_fraction<1))) AS half_day_leave
      FROM employees e
      LEFT JOIN attendance_months m ON m.business_head_id=e.business_head_id AND m.period_month=date_trunc('month',${input.date}::date)::date
      WHERE e.id=ANY(${input.employeeIds}::uuid[])
        AND e.status NOT IN ('candidate','preboarding','archived')
        AND e.date_joined<=${input.date}::date
        AND (e.last_working_date IS NULL OR e.last_working_date>=${input.date}::date)
        AND (m.status IS NULL OR m.status='open')
        AND NOT EXISTS (SELECT 1 FROM attendance_days a WHERE a.employee_id=e.id AND a.attendance_date=${input.date}::date)
    `;
    const permitted = candidates.filter(row => hasPermissionForScope(user, "attendance:write", row.business_head_id, row.department_id));
    if (candidates.length && !permitted.length) return fail("You do not have permission to mark attendance for these staff", 403);
    const halfDay = input.status === "present" ? permitted.filter(row => row.half_day_leave).length : 0;
    const allowed = input.status === "present" ? permitted.filter(row => !row.half_day_leave) : permitted;
    if (!allowed.length) return ok({ marked: 0, onLeave: 0, halfDayLeft: halfDay });
    const heads = [...new Set(allowed.map(row => row.business_head_id))];
    const [locked] = await sql`SELECT 1 FROM attendance_days a JOIN employees e ON e.id=a.employee_id WHERE a.attendance_date=${input.date}::date AND a.locked_at IS NOT NULL AND e.business_head_id=ANY(${heads}::uuid[]) LIMIT 1`;
    if (locked) return fail("This day is locked", 409);
    const values = allowed.map(row => {
      const onLeave = input.status === "present" && row.leave_paid !== null;
      const status = onLeave ? (row.leave_paid ? "paid_leave" : "unpaid_leave") : input.status;
      return { employee_id: row.id, attendance_date: input.date, status, worked_minutes: status === "present" ? 480 : 0, source: "hrms" };
    });
    const result = await sql.begin(async tx => {
      const inserted = await tx`INSERT INTO attendance_days ${tx(values, "employee_id", "attendance_date", "status", "worked_minutes", "source")} ON CONFLICT (employee_id,attendance_date) DO NOTHING RETURNING employee_id,status`;
      for (const head of heads) {
        const ofHead = new Set(allowed.filter(row => row.business_head_id === head).map(row => row.id));
        const rows = inserted.filter(row => ofHead.has(row.employee_id));
        if (!rows.length) continue;
        await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason) VALUES (${user.id},'attendance.bulk_mark','attendance_day',${rows[0].employee_id},${head},${tx.json({ date: input.date, requested: input.status, count: rows.length, onLeave: rows.filter(row => row.status !== input.status).length, employeeIds: rows.map(row => row.employee_id) })},${`Marked ${rows.length} unmarked staff for ${input.date}`})`;
      }
      return inserted;
    });
    return ok({ marked: result.length, onLeave: result.filter(row => row.status !== input.status).length, halfDayLeft: halfDay });
  } catch (error) { return apiError(error); }
}
