import { z } from "zod";
import { apiError, fail, ok, requireEmployeeIdentity } from "@/lib/api";
import { db } from "@/lib/database";
import { calculateEmployeeLeaveCalendar, leaveEligibilityIssue, negativeBalanceLimit } from "@/lib/leave-accounting";

const schema = z.object({
  leavePolicyId: z.uuid(),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  startDayFraction: z.enum(["full", "half"]).default("full"),
  endDayFraction: z.enum(["full", "half"]).default("full"),
  days: z.number().positive().max(366).optional(),
  reason: z.string().min(3).max(1000),
}).refine(value => value.endDate >= value.startDate, { message: "End date must not precede start date" });

export async function GET() {
  try {
    const identity = await requireEmployeeIdentity();
    if (identity instanceof Response) return identity;
    return ok(await db()`
      SELECT r.id,r.start_date,r.end_date,r.days,r.start_day_fraction,r.end_day_fraction,
        r.status,r.reason,r.created_at,r.decided_at,p.code,p.name,p.paid
      FROM leave_requests r JOIN leave_policies p ON p.id=r.leave_policy_id
      WHERE r.employee_id=${identity.employee.id}
      ORDER BY r.created_at DESC
    `);
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const identity = await requireEmployeeIdentity();
    if (identity instanceof Response) return identity;
    const sql = db();
    let calendar;
    try {
      calendar = await calculateEmployeeLeaveCalendar(sql, { employeeId: identity.employee.id, ...input });
    } catch (error) {
      if (error instanceof Error && error.message === "LEAVE_BEFORE_JOINING") return fail("Leave cannot start before your joining date", 422);
      if (error instanceof Error && error.message === "LEAVE_AFTER_LAST_WORKING_DATE") return fail("Leave cannot extend beyond your last working date", 422);
      if (error instanceof Error && error.message === "DATE_RANGE_TOO_LARGE") return fail("A leave request cannot span more than 366 calendar days", 422);
      throw error;
    }
    const [policy] = await sql<{ name: string; paid: boolean; eligibility: Record<string, unknown> }[]>`
      SELECT name,paid,eligibility FROM leave_policies
      WHERE id=${input.leavePolicyId} AND active=true AND status='approved'
        AND effective_from<=${input.startDate}::date AND (effective_to IS NULL OR effective_to>=${input.endDate}::date)
        AND (business_head_id IS NULL OR business_head_id=${identity.employee.businessHeadId})
    `;
    if (!policy) return fail("No approved leave policy applies to the requested dates", 404);
    if (calendar.days <= 0) return fail("The selected dates contain no working days", 422);
    if (input.days !== undefined && Math.abs(input.days - calendar.days) > 0.001) {
      return fail("Leave days are calculated by your work calendar and do not match the supplied value", 422, { calculatedDays: calendar.days });
    }
    const eligibilityIssue = leaveEligibilityIssue(policy.eligibility, calendar.employee, input.startDate, calendar.days);
    if (eligibilityIssue) return fail(eligibilityIssue, 409);
    const result = await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`leave:${identity.employee.id}:${input.leavePolicyId}`}))`;
      const overlap = await tx`
        SELECT 1 FROM leave_requests
        WHERE employee_id=${identity.employee.id} AND status IN ('pending','approved')
          AND daterange(start_date,end_date,'[]') && daterange(${input.startDate}::date,${input.endDate}::date,'[]')
        LIMIT 1
      `;
      if (overlap.length) return { error: "overlap" as const };
      const [account] = await tx<{ balance: number; reserved: number }[]>`
        SELECT
          coalesce((SELECT sum(quantity) FROM leave_ledger WHERE employee_id=${identity.employee.id} AND leave_policy_id=${input.leavePolicyId}),0)::numeric AS balance,
          coalesce((SELECT sum(days) FROM leave_requests WHERE employee_id=${identity.employee.id} AND leave_policy_id=${input.leavePolicyId} AND status='pending'),0)::numeric AS reserved
      `;
      const available = Number(account.balance) - Number(account.reserved);
      if (available + negativeBalanceLimit(policy.eligibility) < calendar.days) return { error: "balance" as const, available };
      const [created] = await tx`
        INSERT INTO leave_requests (
          employee_id,leave_policy_id,leave_type,start_date,end_date,days,paid,reason,requested_by,
          start_day_fraction,end_day_fraction,derived_work_dates,calendar_snapshot
        ) VALUES (
          ${identity.employee.id},${input.leavePolicyId},${policy.name},${input.startDate},${input.endDate},${calendar.days},${policy.paid},${input.reason},${identity.user.id},
          ${input.startDayFraction === "half" ? 0.5 : 1},${input.endDayFraction === "half" ? 0.5 : 1},
          ${JSON.stringify(calendar.workDates)}::jsonb,${JSON.stringify(calendar.snapshot)}::jsonb
        ) RETURNING *
      `;
      await tx`
        INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason)
        VALUES (${identity.user.id},'self.leave_request','leave_request',${created.id},${identity.employee.businessHeadId},${JSON.stringify(created)}::jsonb,${input.reason})
      `;
      return { created };
    });
    if ("error" in result && result.error === "overlap") return fail("Leave dates overlap an existing pending or approved request", 409);
    if ("error" in result && result.error === "balance") return fail("Insufficient available leave balance after pending requests", 409, { availableBalance: result.available, calculatedDays: calendar.days });
    return ok(result.created, { status: 201 });
  } catch (error) { return apiError(error); }
}
