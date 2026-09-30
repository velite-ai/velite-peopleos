import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";
import { negativeBalanceLimit } from "@/lib/leave-accounting";

const schema = z.object({ decision: z.enum(["approve", "reject"]), reason: z.string().min(3).max(1000) });
type RecordRow = {
  id: string;
  status: string;
  employee_id: string;
  business_head_id: string;
  department_id: string | null;
  days: number;
  leave_policy_id: string;
  paid: boolean;
  requested_by: string | null;
  start_date: string;
  end_date: string;
  start_day_fraction: number;
  end_day_fraction: number;
  derived_work_dates: string[];
  eligibility: Record<string, unknown>;
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = schema.parse(await request.json());
    const sql = db();
    const [record] = await sql<RecordRow[]>`
      SELECT r.id,r.status,r.employee_id,e.business_head_id,e.department_id,r.days,r.leave_policy_id,r.paid,
        r.requested_by,r.start_date,r.end_date,r.start_day_fraction,r.end_day_fraction,r.derived_work_dates,p.eligibility
      FROM leave_requests r JOIN employees e ON e.id=r.employee_id JOIN leave_policies p ON p.id=r.leave_policy_id
      WHERE r.id=${id}
    `;
    if (!record) return fail("Leave request not found", 404);
    const user = await requireApiUser("leave:write", record.business_head_id, record.department_id);
    if (user instanceof Response) return user;
    if (record.requested_by === user.id) return fail("The leave requester cannot approve or reject the same request", 409);
    if (record.status !== "pending") return fail("Only pending leave can be decided", 409);
    if (!Array.isArray(record.derived_work_dates) || record.derived_work_dates.length === 0) return fail("This legacy leave request has no work-calendar snapshot and must be recreated", 409);
    const next = input.decision === "approve" ? "approved" : "rejected";
    const outcome = await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`leave:${record.employee_id}:${record.leave_policy_id}`}))`;
      const [locked] = await tx<RecordRow[]>`
        SELECT r.id,r.status,r.employee_id,e.business_head_id,e.department_id,r.days,r.leave_policy_id,r.paid,
          r.requested_by,r.start_date,r.end_date,r.start_day_fraction,r.end_day_fraction,r.derived_work_dates,p.eligibility
        FROM leave_requests r JOIN employees e ON e.id=r.employee_id JOIN leave_policies p ON p.id=r.leave_policy_id
        WHERE r.id=${id} FOR UPDATE OF r
      `;
      if (!locked || locked.status !== "pending") return { error: "status" as const };
      if (input.decision === "approve") {
        const [account] = await tx<{ balance: number }[]>`
          SELECT coalesce(sum(quantity),0)::numeric AS balance
          FROM leave_ledger WHERE employee_id=${locked.employee_id} AND leave_policy_id=${locked.leave_policy_id}
        `;
        if (Number(account.balance) + negativeBalanceLimit(locked.eligibility) < Number(locked.days)) {
          return { error: "balance" as const, balance: Number(account.balance) };
        }
        const closedMonths = await tx`
          SELECT period_month,status FROM attendance_months
          WHERE business_head_id=${locked.business_head_id} AND status<>'open'
            AND period_month IN (
              SELECT DISTINCT date_trunc('month',value::date)::date
              FROM jsonb_array_elements_text(${JSON.stringify(locked.derived_work_dates)}::jsonb) dates(value)
            )
        `;
        if (closedMonths.length) return { error: "attendance_month" as const, closedMonths };
        const conflicts = await tx`
          SELECT attendance_date,status,source FROM attendance_days
          WHERE employee_id=${locked.employee_id}
            AND attendance_date IN (SELECT value::date FROM jsonb_array_elements_text(${JSON.stringify(locked.derived_work_dates)}::jsonb) dates(value))
            AND (locked_at IS NOT NULL OR status NOT IN ('absent','unpaid_leave') OR source LIKE 'leave:%')
            AND source<>${`leave:${locked.id}`}
        `;
        if (conflicts.length) return { error: "attendance_conflict" as const, conflicts };
        for (const date of locked.derived_work_dates) {
          const partial = (date === locked.start_date && Number(locked.start_day_fraction) === 0.5) ||
            (date === locked.end_date && Number(locked.end_day_fraction) === 0.5);
          const attendanceStatus = !locked.paid && partial ? "half_day" : locked.paid ? "paid_leave" : "unpaid_leave";
          const rows = await tx`
            INSERT INTO attendance_days (employee_id,attendance_date,status,source,remarks)
            VALUES (${locked.employee_id},${date},${attendanceStatus},${`leave:${locked.id}`},'Created from approved leave request')
            ON CONFLICT (employee_id,attendance_date) DO UPDATE SET
              status=EXCLUDED.status,source=EXCLUDED.source,remarks=EXCLUDED.remarks,version=attendance_days.version+1
            WHERE attendance_days.locked_at IS NULL AND attendance_days.status IN ('absent','unpaid_leave')
            RETURNING id
          `;
          if (!rows.length) return { error: "attendance_conflict" as const, conflicts: [{ attendance_date: date }] };
        }
        await tx`
          INSERT INTO leave_ledger (
            employee_id,leave_policy_id,transaction_date,quantity,transaction_type,reference_type,reference_id,remarks,created_by,idempotency_key
          ) VALUES (
            ${locked.employee_id},${locked.leave_policy_id},${locked.start_date},${-Number(locked.days)},'leave_taken','leave_request',${locked.id},${input.reason},${user.id},${`leave:approve:${locked.id}`}
          )
        `;
      }
      const rows = await tx`
        UPDATE leave_requests SET status=${next},approver_id=${user.id},decided_at=now()
        WHERE id=${locked.id} AND status='pending' RETURNING *
      `;
      if (!rows.length) return { error: "status" as const };
      await tx`
        INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason)
        VALUES (${user.id},${`leave.${input.decision}`},'leave_request',${locked.id},${locked.business_head_id},
          ${JSON.stringify({ status: locked.status })}::jsonb,${JSON.stringify({ status: next, days: locked.days, workDates: locked.derived_work_dates })}::jsonb,${input.reason})
      `;
      return { updated: rows[0] };
    });
    if ("error" in outcome && outcome.error === "status") return fail("Leave status changed; refresh and try again", 409);
    if ("error" in outcome && outcome.error === "balance") return fail("Leave balance is no longer sufficient", 409, { currentBalance: outcome.balance, requestedDays: record.days });
    if ("error" in outcome && outcome.error === "attendance_month") return fail("Attendance is already under review or locked for part of this leave", 409, outcome.closedMonths);
    if ("error" in outcome && outcome.error === "attendance_conflict") return fail("Existing or locked attendance conflicts with this leave request", 409, outcome.conflicts);
    return ok(outcome.updated);
  } catch (error) { return apiError(error); }
}
