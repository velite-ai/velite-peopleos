import { z } from "zod";
import { apiError, ok, requireApiUser } from "@/lib/api";
import { hasRoleForScope } from "@/lib/auth";
import { db } from "@/lib/database";

const schema = z.object({
  businessHeadId: z.uuid().nullable(),
  periodMonth: z.iso.date().refine(value => value.endsWith("-01"), "Period month must be the first day of a month"),
});

// Live per-person view of a month, worked out from the daily records (not the saved month snapshot).
// "missing" = days up to today with no record; "coming" = later days in the month with no record yet.
// Together they match the "to check" count used when the month is sent for checking or finalised.
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const input = schema.parse({ businessHeadId: params.get("businessHeadId") || null, periodMonth: params.get("periodMonth") });
    const user = await requireApiUser("attendance:read", input.businessHeadId);
    if (user instanceof Response) return user;
    const sql = db();
    const broad = hasRoleForScope(user, ["HR_ADMIN", "HR_OPERATIONS", "PAYROLL_ADMIN", "AUDITOR"], input.businessHeadId, null);
    const [actor] = broad ? [] : await sql<{ id: string }[]>`SELECT id FROM employees WHERE user_id=${user.id}`;
    const rows = await sql`
      SELECT e.id AS employee_id,e.employee_code,concat_ws(' ',e.first_name,e.last_name) AS employee_name,d.name AS department,
        c.missing_days,c.coming_days,c.marked_days,c.missing_dates,c.present_days,c.half_days,c.absent_days,c.paid_leave_days,c.unpaid_leave_days,c.off_days,c.overtime_minutes
      FROM employees e
      LEFT JOIN departments d ON d.id=e.department_id
      CROSS JOIN LATERAL (
        SELECT greatest(${input.periodMonth}::date,e.date_joined) AS first_day,
               least((${input.periodMonth}::date+interval '1 month - 1 day')::date,coalesce(e.last_working_date,(${input.periodMonth}::date+interval '1 month - 1 day')::date)) AS last_day,
               (now() AT TIME ZONE 'Asia/Kolkata')::date AS today
      ) b
      CROSS JOIN LATERAL (
        SELECT
          count(*) FILTER (WHERE a.id IS NULL AND g.day<=b.today)::int AS missing_days,
          count(*) FILTER (WHERE a.id IS NULL AND g.day>b.today)::int AS coming_days,
          count(a.id)::int AS marked_days,
          coalesce(array_agg(to_char(g.day,'YYYY-MM-DD') ORDER BY g.day) FILTER (WHERE a.id IS NULL AND g.day<=b.today),'{}') AS missing_dates,
          count(*) FILTER (WHERE a.status IN ('present','work_from_home','on_duty'))::int AS present_days,
          count(*) FILTER (WHERE a.status='half_day')::int AS half_days,
          count(*) FILTER (WHERE a.status='absent')::int AS absent_days,
          count(*) FILTER (WHERE a.status='paid_leave')::int AS paid_leave_days,
          count(*) FILTER (WHERE a.status='unpaid_leave')::int AS unpaid_leave_days,
          count(*) FILTER (WHERE a.status IN ('weekly_off','holiday'))::int AS off_days,
          coalesce(sum(a.overtime_minutes),0)::int AS overtime_minutes
        FROM (SELECT (b.first_day+n)::date AS day FROM generate_series(0,b.last_day-b.first_day) n) g
        LEFT JOIN attendance_days a ON a.employee_id=e.id AND a.attendance_date=g.day
      ) c
      WHERE e.date_joined<${input.periodMonth}::date+interval '1 month'
        AND (e.last_working_date IS NULL OR e.last_working_date>=${input.periodMonth}::date)
        AND e.status NOT IN ('candidate','preboarding','archived')
        AND (${input.businessHeadId}::uuid IS NULL OR e.business_head_id=${input.businessHeadId}::uuid)
        AND (${broad} OR e.id=${actor?.id || null}::uuid OR e.reporting_manager_id=${actor?.id || null}::uuid)
      ORDER BY e.employee_code`;
    return ok(rows);
  } catch (error) { return apiError(error); }
}
