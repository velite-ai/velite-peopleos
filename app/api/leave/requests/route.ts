import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { hasRoleForScope } from "@/lib/auth";
import { db } from "@/lib/database";
import { calculateEmployeeLeaveCalendar, leaveEligibilityIssue, negativeBalanceLimit } from "@/lib/leave-accounting";

const schema = z.object({
  employeeId: z.uuid(),
  leavePolicyId: z.uuid(),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  startDayFraction: z.enum(["full", "half"]).default("full"),
  endDayFraction: z.enum(["full", "half"]).default("full"),
  days: z.number().positive().max(366).optional(),
  reason: z.string().min(3).max(1000),
}).refine(value => value.endDate >= value.startDate, { message: "End date must not precede start date" });

function calendarFailure(error: unknown) {
  if (!(error instanceof Error)) return null;
  const messages: Record<string, string> = {
    EMPLOYEE_NOT_FOUND: "Employee not found or not eligible to request leave",
    LEAVE_BEFORE_JOINING: "Leave cannot start before the employee's joining date",
    LEAVE_AFTER_LAST_WORKING_DATE: "Leave cannot extend beyond the employee's last working date",
    DATE_RANGE_TOO_LARGE: "A leave request cannot span more than 366 calendar days",
  };
  return messages[error.message] || null;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const head = url.searchParams.get("businessHeadId");
    const department = url.searchParams.get("departmentId");
    const status = url.searchParams.get("status");
    const user = await requireApiUser("leave:read", head, department);
    if (user instanceof Response) return user;
    const broad = hasRoleForScope(user, ["HR_ADMIN", "HR_OPERATIONS", "PAYROLL_ADMIN", "AUDITOR"], head, department);
    const [actorEmployee] = broad ? [] : await db()< { id: string }[]>`SELECT id FROM employees WHERE user_id=${user.id}`;
    return ok(await db()`
      SELECT r.*,p.name AS leave_type,p.code AS leave_code,p.paid,e.employee_code,
        concat_ws(' ',e.first_name,e.last_name) AS employee_name,e.business_head_id,e.department_id,
        requester.full_name AS requested_by_name,approver.full_name AS approver_name
      FROM leave_requests r
      JOIN leave_policies p ON p.id=r.leave_policy_id
      JOIN employees e ON e.id=r.employee_id
      LEFT JOIN users requester ON requester.id=r.requested_by
      LEFT JOIN users approver ON approver.id=r.approver_id
      WHERE (${head}::uuid IS NULL OR e.business_head_id=${head}::uuid)
        AND (${department}::uuid IS NULL OR e.department_id=${department}::uuid)
        AND (${status}::text IS NULL OR r.status::text=${status})
        AND (${broad} OR e.id=${actorEmployee?.id || null}::uuid OR e.reporting_manager_id=${actorEmployee?.id || null}::uuid)
      ORDER BY r.created_at DESC
    `);
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const sql = db();
    let calendar;
    try {
      calendar = await calculateEmployeeLeaveCalendar(sql, input);
    } catch (error) {
      const message = calendarFailure(error);
      if (message) return fail(message, 422);
      throw error;
    }
    const user = await requireApiUser("leave:write", calendar.employee.businessHeadId, calendar.employee.departmentId);
    if (user instanceof Response) return user;
    const [policy] = await sql<{ name: string; paid: boolean; eligibility: Record<string, unknown> }[]>`
      SELECT name,paid,eligibility FROM leave_policies
      WHERE id=${input.leavePolicyId} AND active=true AND status='approved'
        AND effective_from<=${input.startDate}::date AND (effective_to IS NULL OR effective_to>=${input.endDate}::date)
        AND (business_head_id IS NULL OR business_head_id=${calendar.employee.businessHeadId})
    `;
    if (!policy) return fail("No approved leave policy applies to the employee and requested dates", 404);
    if (calendar.days <= 0) return fail("The selected dates contain no working days", 422);
    if (input.days !== undefined && Math.abs(input.days - calendar.days) > 0.001) {
      return fail("Leave days are calculated by the work calendar and do not match the supplied value", 422, { calculatedDays: calendar.days });
    }
    const eligibilityIssue = leaveEligibilityIssue(policy.eligibility, calendar.employee, input.startDate, calendar.days);
    if (eligibilityIssue) return fail(eligibilityIssue, 409);
    const result = await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`leave:${input.employeeId}:${input.leavePolicyId}`}))`;
      const overlap = await tx`
        SELECT 1 FROM leave_requests
        WHERE employee_id=${input.employeeId} AND status IN ('pending','approved')
          AND daterange(start_date,end_date,'[]') && daterange(${input.startDate}::date,${input.endDate}::date,'[]')
        LIMIT 1
      `;
      if (overlap.length) return { error: "overlap" as const };
      const [account] = await tx<{ balance: number; reserved: number }[]>`
        SELECT
          coalesce((SELECT sum(quantity) FROM leave_ledger WHERE employee_id=${input.employeeId} AND leave_policy_id=${input.leavePolicyId}),0)::numeric AS balance,
          coalesce((SELECT sum(days) FROM leave_requests WHERE employee_id=${input.employeeId} AND leave_policy_id=${input.leavePolicyId} AND status='pending'),0)::numeric AS reserved
      `;
      const available = Number(account.balance) - Number(account.reserved);
      if (available + negativeBalanceLimit(policy.eligibility) < calendar.days) return { error: "balance" as const, available };
      const [created] = await tx`
        INSERT INTO leave_requests (
          employee_id,leave_policy_id,leave_type,start_date,end_date,days,paid,reason,requested_by,
          start_day_fraction,end_day_fraction,derived_work_dates,calendar_snapshot
        ) VALUES (
          ${input.employeeId},${input.leavePolicyId},${policy.name},${input.startDate},${input.endDate},${calendar.days},${policy.paid},${input.reason},${user.id},
          ${input.startDayFraction === "half" ? 0.5 : 1},${input.endDayFraction === "half" ? 0.5 : 1},
          ${JSON.stringify(calendar.workDates)}::jsonb,${JSON.stringify(calendar.snapshot)}::jsonb
        ) RETURNING *
      `;
      await tx`
        INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason)
        VALUES (${user.id},'leave.request','leave_request',${created.id},${calendar.employee.businessHeadId},${JSON.stringify(created)}::jsonb,${input.reason})
      `;
      return { created };
    });
    if (result.error === "overlap") return fail("Leave dates overlap an existing pending or approved request", 409);
    if (result.error === "balance") return fail("Insufficient available leave balance after pending requests", 409, { availableBalance: result.available, calculatedDays: calendar.days });
    return ok(result.created, { status: 201 });
  } catch (error) { return apiError(error); }
}
