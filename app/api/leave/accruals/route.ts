import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { hasRoleForScope } from "@/lib/auth";
import { db } from "@/lib/database";
import { accrualPeriod, proratedAccrual } from "@/lib/leave-accounting";

const schema = z.object({
  action: z.enum(["accrual", "year_end_rollover"]),
  leavePolicyId: z.uuid(),
  businessHeadId: z.uuid(),
  periodStart: z.iso.date(),
  reason: z.string().min(5).max(1000),
});

function previousDay(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  try {
    const head = new URL(request.url).searchParams.get("businessHeadId");
    const user = await requireApiUser("leave:read", head);
    if (user instanceof Response) return user;
    return ok(await db()`
      SELECT r.*,p.code AS leave_code,p.name AS leave_name,u.full_name AS run_by_name
      FROM leave_accrual_runs r JOIN leave_policies p ON p.id=r.leave_policy_id JOIN users u ON u.id=r.run_by
      WHERE (${head}::uuid IS NULL OR r.business_head_id=${head}::uuid)
      ORDER BY r.created_at DESC
    `);
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const user = await requireApiUser("leave:write", input.businessHeadId);
    if (user instanceof Response) return user;
    if (!hasRoleForScope(user, ["HR_ADMIN", "HR_OPERATIONS"], input.businessHeadId)) return fail("Only HR administrators or HR operations can run leave accounting", 403);
    const sql = db();
    const [policy] = await sql<{
      id: string;
      business_head_id: string | null;
      code: string;
      annual_entitlement: number;
      accrual_frequency: string;
      carry_forward_limit: number;
      eligibility: Record<string, unknown>;
      effective_from: string;
      effective_to: string | null;
    }[]>`
      SELECT id,business_head_id,code,annual_entitlement,accrual_frequency,carry_forward_limit,eligibility,effective_from,effective_to
      FROM leave_policies
      WHERE id=${input.leavePolicyId} AND active=true AND status='approved'
        AND (business_head_id IS NULL OR business_head_id=${input.businessHeadId})
    `;
    if (!policy) return fail("Approved leave policy not found for this business head", 404);
    let period: { start: string; end: string; months: number };
    try {
      if (input.action === "accrual") period = accrualPeriod(policy.accrual_frequency, input.periodStart);
      else {
        if (!input.periodStart.endsWith("-01-01")) return fail("A year-end rollover must target 1 January", 422);
        period = { start: input.periodStart, end: input.periodStart, months: 0 };
      }
    } catch (error) {
      if (error instanceof Error && error.message === "POLICY_DOES_NOT_ACCRUE") return fail("This policy does not accrue", 409);
      if (error instanceof Error && error.message === "ACCRUAL_PERIOD_MUST_START_ON_FIRST") return fail("Accrual periods must begin on the first day of a month", 422);
      if (error instanceof Error && error.message === "ACCRUAL_PERIOD_MUST_START_ON_QUARTER") return fail("Quarterly accruals must begin in January, April, July, or October", 422);
      if (error instanceof Error && error.message === "ACCRUAL_PERIOD_MUST_START_ON_YEAR") return fail("Annual accruals must begin on 1 January", 422);
      throw error;
    }
    if (policy.effective_from > period.end || (policy.effective_to && policy.effective_to < period.start)) return fail("The policy is not effective during this accounting period", 409);
    const runKey = `${input.action}:${input.businessHeadId}:${input.leavePolicyId}:${input.periodStart}`;
    const employees = await sql<{
      id: string;
      employment_type: string;
      date_joined: string;
      last_working_date: string | null;
    }[]>`
      SELECT id,employment_type,date_joined,last_working_date FROM employees
      WHERE business_head_id=${input.businessHeadId} AND date_joined<=${period.end}::date
        AND (last_working_date IS NULL OR last_working_date>=${input.action === "year_end_rollover" ? input.periodStart : period.start}::date)
        AND status NOT IN ('candidate','preboarding','archived') ORDER BY employee_code
    `;
    const result = await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${runKey}))`;
      const [existing] = await tx`SELECT * FROM leave_accrual_runs WHERE run_key=${runKey}`;
      if (existing) return { run: existing, idempotent: true };
      let entriesCreated = 0;
      let employeesProcessed = 0;
      let totalQuantity = 0;
      const employmentTypes = Array.isArray(policy.eligibility?.employmentTypes) ? policy.eligibility.employmentTypes : null;
      const minimumServiceDays = typeof policy.eligibility?.minimumServiceDays === "number" ? policy.eligibility.minimumServiceDays : 0;
      for (const employee of employees) {
        if (employmentTypes && !employmentTypes.includes(employee.employment_type)) continue;
        const serviceAsOf = Math.floor((new Date(`${period.end}T00:00:00Z`).getTime() - new Date(`${employee.date_joined}T00:00:00Z`).getTime()) / 86_400_000);
        if (serviceAsOf < minimumServiceDays) continue;
        employeesProcessed += 1;
        if (input.action === "accrual") {
          const employmentStart = employee.date_joined > policy.effective_from ? employee.date_joined : policy.effective_from;
          const employmentEndCandidates = [employee.last_working_date, policy.effective_to].filter((value): value is string => Boolean(value));
          const employmentEnd = employmentEndCandidates.sort()[0] || null;
          const quantity = proratedAccrual({
            annualEntitlement: Number(policy.annual_entitlement),
            periodStart: period.start,
            periodEnd: period.end,
            employmentStart,
            employmentEnd,
            frequencyMonths: period.months,
          });
          if (quantity <= 0) continue;
          const inserted = await tx`
            INSERT INTO leave_ledger (
              employee_id,leave_policy_id,transaction_date,quantity,transaction_type,reference_type,remarks,created_by,idempotency_key
            ) VALUES (
              ${employee.id},${policy.id},${period.end},${quantity},'accrual','leave_accrual_run',${input.reason},${user.id},
              ${`accrual:${policy.id}:${employee.id}:${period.start}`}
            ) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id
          `;
          entriesCreated += inserted.length;
          if (inserted.length) totalQuantity += quantity;
        } else {
          const cutoff = previousDay(input.periodStart);
          const [account] = await tx<{ balance: number }[]>`
            SELECT coalesce(sum(quantity),0)::numeric AS balance FROM leave_ledger
            WHERE employee_id=${employee.id} AND leave_policy_id=${policy.id} AND transaction_date<=${cutoff}::date
          `;
          const balance = Math.max(0, Number(account.balance));
          if (balance <= 0) continue;
          const carry = Math.min(balance, Number(policy.carry_forward_limit));
          const expired = await tx`
            INSERT INTO leave_ledger (
              employee_id,leave_policy_id,transaction_date,quantity,transaction_type,reference_type,remarks,created_by,idempotency_key
            ) VALUES (
              ${employee.id},${policy.id},${input.periodStart},${-balance},'year_end_expiry','leave_accrual_run',${input.reason},${user.id},
              ${`rollover-expiry:${policy.id}:${employee.id}:${input.periodStart}`}
            ) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id
          `;
          entriesCreated += expired.length;
          if (expired.length) totalQuantity -= balance;
          if (carry > 0) {
            const carried = await tx`
              INSERT INTO leave_ledger (
                employee_id,leave_policy_id,transaction_date,quantity,transaction_type,reference_type,remarks,created_by,idempotency_key
              ) VALUES (
                ${employee.id},${policy.id},${input.periodStart},${carry},'carry_forward','leave_accrual_run',${input.reason},${user.id},
                ${`rollover-carry:${policy.id}:${employee.id}:${input.periodStart}`}
              ) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id
            `;
            entriesCreated += carried.length;
            if (carried.length) totalQuantity += carry;
          }
        }
      }
      const summary = { employeesConsidered: employees.length, employeesProcessed, entriesCreated, totalQuantity: Math.round(totalQuantity * 100) / 100 };
      const [run] = await tx`
        INSERT INTO leave_accrual_runs (run_key,leave_policy_id,business_head_id,action,period_start,period_end,summary,run_by)
        VALUES (${runKey},${policy.id},${input.businessHeadId},${input.action},${period.start},${period.end},${JSON.stringify(summary)}::jsonb,${user.id}) RETURNING *
      `;
      await tx`
        INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason)
        VALUES (${user.id},${`leave.${input.action}`},'leave_accrual_run',${run.id},${input.businessHeadId},${JSON.stringify({ ...run, summary })}::jsonb,${input.reason})
      `;
      return { run, idempotent: false };
    });
    return ok(result, { status: result.idempotent ? 200 : 201 });
  } catch (error) { return apiError(error); }
}
