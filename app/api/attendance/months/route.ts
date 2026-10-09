import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";

type AttendanceMonthSummaryRow={id:string;employee_code:string;employee_name:string;recorded_days:number;expected_days:number;missing_days:number;present_days:number;unpaid_days:number;half_days:number;overtime_minutes:number};

const schema = z.object({
  businessHeadId: z.uuid(),
  periodMonth: z.iso.date().refine(value => value.endsWith("-01"), "Period month must be the first day of a month"),
  action: z.enum(["summarize", "review", "lock", "reopen"]),
  reason: z.string().min(3).max(1000),
});

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const head = params.get("businessHeadId");
    const month = params.get("periodMonth");
    const user = await requireApiUser("attendance:read", head);
    if (user instanceof Response) return user;
    return ok(await db()`SELECT m.*,b.name AS business_head,u.full_name AS locked_by_name FROM attendance_months m JOIN business_heads b ON b.id=m.business_head_id LEFT JOIN users u ON u.id=m.locked_by WHERE (${head}::uuid IS NULL OR m.business_head_id=${head}::uuid) AND (${month}::date IS NULL OR m.period_month=${month}::date) ORDER BY m.period_month DESC,b.name`);
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const user = await requireApiUser("attendance:write", input.businessHeadId);
    if (user instanceof Response) return user;
    const sql = db();
    const [existing] = await sql<{id:string;status:string;reviewed_by:string|null;reviewed_at:string|null;employee_count:number;exception_count:number;summary:{employees?:AttendanceMonthSummaryRow[]}}[]>`SELECT id,status,reviewed_by,reviewed_at,employee_count,exception_count,summary FROM attendance_months WHERE business_head_id=${input.businessHeadId} AND period_month=${input.periodMonth}`;
    if (input.action === "reopen" && !user.roles.some(role => role.code === "SUPER_ADMIN" || role.code === "HR_ADMIN")) return fail("Only HR administrators can reopen a month", 403);
    if (input.action === "reopen") {
      if (!existing || !["review", "locked"].includes(existing.status)) return fail("Only a month that is under review or locked can be reopened", 409);
      const wasLocked = existing.status === "locked";
      const [finalPayroll]=await sql`SELECT id,status FROM payroll_periods WHERE business_head_id=${input.businessHeadId} AND period_month=${input.periodMonth} AND status IN ('locked','paid') LIMIT 1`;
      if(finalPayroll)return fail('Attendance consumed by locked or paid payroll cannot be reopened; use a post-lock adjustment',409,{payrollPeriodId:finalPayroll.id,payrollStatus:finalPayroll.status});
      const [row] = await sql.begin(async tx => {
        const rows = await tx`UPDATE attendance_months SET status='open',reviewed_at=NULL,reviewed_by=NULL,locked_at=NULL,locked_by=NULL,reopened_at=now(),reopened_by=${user.id},reopen_reason=${input.reason},updated_at=now() WHERE id=${existing.id} RETURNING *`;
        // Only a locked month had its days locked by the month lock; a month under review has no such locks to clear.
        if (wasLocked) await tx`UPDATE attendance_days a SET locked_at=NULL,locked_by=NULL FROM employees e WHERE e.id=a.employee_id AND e.business_head_id=${input.businessHeadId} AND a.attendance_date>=${input.periodMonth}::date AND a.attendance_date<${input.periodMonth}::date+interval '1 month'`;
        await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason) VALUES (${user.id},'attendance_month.reopen','attendance_month',${existing.id},${input.businessHeadId},${JSON.stringify(existing)}::jsonb,${JSON.stringify(rows[0])}::jsonb,${input.reason})`;
        return rows;
      });
      return ok(row);
    }
    if (existing?.status === "locked") return fail("This attendance month is locked", 409);
    if (input.action === "lock") {
      if (!existing || existing.status !== "review" || !existing.reviewed_by) return fail("Attendance must be reviewed by a maker before it can be locked", 409);
      if (existing.reviewed_by === user.id) return fail("The attendance reviewer and locker must be different people", 409);
      const [pending] = await sql<{count:number}[]>`SELECT count(*)::int AS count FROM attendance_corrections c JOIN attendance_days a ON a.id=c.attendance_day_id JOIN employees e ON e.id=a.employee_id WHERE e.business_head_id=${input.businessHeadId} AND a.attendance_date>=${input.periodMonth}::date AND a.attendance_date<${input.periodMonth}::date+interval '1 month' AND c.status='pending'`;
      if (pending.count > 0) return fail("Resolve all pending attendance corrections before locking the month", 409, { pendingCorrections: pending.count });
    }
    const summary = input.action === "lock" ? (existing?.summary?.employees || []) : await sql`SELECT e.id,e.employee_code,concat_ws(' ',e.first_name,e.last_name) AS employee_name,count(a.id)::int AS recorded_days,(least((${input.periodMonth}::date+interval '1 month - 1 day')::date,coalesce(e.last_working_date,(${input.periodMonth}::date+interval '1 month - 1 day')::date))-greatest(${input.periodMonth}::date,e.date_joined)+1)::int AS expected_days,greatest(0,(least((${input.periodMonth}::date+interval '1 month - 1 day')::date,coalesce(e.last_working_date,(${input.periodMonth}::date+interval '1 month - 1 day')::date))-greatest(${input.periodMonth}::date,e.date_joined)+1)::int-count(a.id)::int)::int AS missing_days,count(*) FILTER (WHERE a.status='present')::int AS present_days,count(*) FILTER (WHERE a.status IN ('absent','unpaid_leave'))::numeric+count(*) FILTER (WHERE a.status='half_day')::numeric/2 AS unpaid_days,count(*) FILTER (WHERE a.status='half_day')::int AS half_days,coalesce(sum(a.overtime_minutes),0)::int AS overtime_minutes FROM employees e LEFT JOIN attendance_days a ON a.employee_id=e.id AND a.attendance_date>=${input.periodMonth}::date AND a.attendance_date<${input.periodMonth}::date+interval '1 month' WHERE e.business_head_id=${input.businessHeadId} AND e.date_joined<${input.periodMonth}::date+interval '1 month' AND (e.last_working_date IS NULL OR e.last_working_date>=${input.periodMonth}::date) AND e.status NOT IN ('candidate','preboarding','archived') GROUP BY e.id ORDER BY e.employee_code`;
    const exceptions = input.action === "lock" ? Number(existing?.exception_count || 0) : summary.filter(row => Number(row.missing_days) > 0).length;
    if(input.action==='lock'&&exceptions>0)return fail('Attendance has missing daily records and cannot be locked',409,{employeesWithMissingDays:exceptions});
    const nextStatus = input.action === "lock" ? "locked" : input.action === "review" ? "review" : "open";
    const [saved] = await sql.begin(async tx => {
      const reviewedAt=input.action==='review'?new Date():input.action==='lock'&&existing?.reviewed_at?new Date(existing.reviewed_at):null;
      const reviewedBy=input.action==='review'?user.id:input.action==='lock'?existing?.reviewed_by||null:null;
      const rows = await tx`INSERT INTO attendance_months (business_head_id,period_month,status,employee_count,exception_count,summary,reviewed_at,reviewed_by,locked_at,locked_by) VALUES (${input.businessHeadId},${input.periodMonth},${nextStatus},${summary.length},${exceptions},${JSON.stringify({employees:summary})}::jsonb,${reviewedAt},${reviewedBy},${input.action==='lock'?new Date():null},${input.action==='lock'?user.id:null}) ON CONFLICT (business_head_id,period_month) DO UPDATE SET status=EXCLUDED.status,employee_count=EXCLUDED.employee_count,exception_count=EXCLUDED.exception_count,summary=EXCLUDED.summary,reviewed_at=EXCLUDED.reviewed_at,reviewed_by=EXCLUDED.reviewed_by,locked_at=EXCLUDED.locked_at,locked_by=EXCLUDED.locked_by,updated_at=now() RETURNING *`;
      if (input.action === "lock") await tx`UPDATE attendance_days a SET locked_at=coalesce(a.locked_at,now()),locked_by=coalesce(a.locked_by,${user.id}) FROM employees e WHERE e.id=a.employee_id AND e.business_head_id=${input.businessHeadId} AND a.attendance_date>=${input.periodMonth}::date AND a.attendance_date<${input.periodMonth}::date+interval '1 month'`;
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason) VALUES (${user.id},${`attendance_month.${input.action}`},'attendance_month',${rows[0].id},${input.businessHeadId},${JSON.stringify({employeeCount:summary.length,exceptionCount:exceptions,status:rows[0].status})}::jsonb,${input.reason})`;
      return rows;
    });
    return ok(saved);
  } catch (error) { return apiError(error); }
}
