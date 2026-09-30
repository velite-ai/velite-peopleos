import { createHash } from "node:crypto";
import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";
import { calculateFinalSettlement, finalSettlementRuleSchema } from "@/lib/final-settlement";

const manualItemSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,49}$/),
  label: z.string().min(2).max(160),
  category: z.enum(["earning", "recovery"]),
  amount: z.number().positive().max(1_000_000_000),
  reason: z.string().min(5).max(1000),
}).strict();

const calculateSchema = z.object({
  separationId: z.uuid(),
  statutoryRuleSetId: z.uuid().optional(),
  manualItems: z.array(manualItemSchema).max(100).default([]),
  reason: z.string().min(5).max(2000),
}).strict().superRefine((value, context) => {
  const codes = value.manualItems.map(item => item.code);
  if (new Set(codes).size !== codes.length) context.addIssue({ code: "custom", path: ["manualItems"], message: "Manual settlement item codes must be unique" });
});

type SeparationScope = {
  id: string; status: string; separation_type: string; submitted_date: string; notice_days: number;
  approved_last_working_date: string | null; proposed_last_working_date: string;
  employee_id: string; employee_code: string; employee_name: string; date_joined: string;
  business_head_id: string; department_id: string | null;
};

type AttendanceEmployee = { id: string; expected_days: number; unpaid_days: number; missing_days: number; recorded_days: number };

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const head = params.get("businessHeadId");
    const status = params.get("status");
    const actor = await requireApiUser("payroll:read", head);
    if (actor instanceof Response) return actor;
    return ok(await db()`
      SELECT f.id,f.separation_id,f.gross_payable,f.recoveries,f.net_payable,f.status,
        f.calculation_version,f.calculation_checksum,f.calculated_at,f.submitted_at,f.approved_at,
        f.paid_at,f.payment_reference,f.document_id,f.updated_at,
        s.separation_type,s.approved_last_working_date,s.proposed_last_working_date,
        e.id AS employee_id,e.employee_code,concat_ws(' ',e.first_name,e.last_name) AS employee_name,
        e.position,e.business_head_id,b.name AS business_head,
        maker.full_name AS calculated_by_name,submitter.full_name AS submitted_by_name,
        approver.full_name AS approved_by_name,payer.full_name AS paid_by_name,
        rs.code AS rule_code,rs.version AS rule_version,
        j.status AS generation_status,j.error_message AS generation_error
      FROM final_settlements f
      JOIN separations s ON s.id=f.separation_id
      JOIN employees e ON e.id=s.employee_id
      JOIN business_heads b ON b.id=e.business_head_id
      LEFT JOIN users maker ON maker.id=f.calculated_by
      LEFT JOIN users submitter ON submitter.id=f.submitted_by
      LEFT JOIN users approver ON approver.id=f.approved_by
      LEFT JOIN users payer ON payer.id=f.paid_by
      LEFT JOIN statutory_rule_sets rs ON rs.id=f.statutory_rule_set_id
      LEFT JOIN document_generation_jobs j ON j.job_type='final_settlement' AND j.source_record_id=f.id
      WHERE (${head}::uuid IS NULL OR e.business_head_id=${head}::uuid)
        AND (${status}::text IS NULL OR f.status::text=${status})
      ORDER BY coalesce(s.approved_last_working_date,s.proposed_last_working_date) DESC
      LIMIT 500
    `);
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const input = calculateSchema.parse(await request.json());
    const sql = db();
    const [separation] = await sql<SeparationScope[]>`
      SELECT s.id,s.status,s.separation_type,s.submitted_date,s.notice_days,
        s.approved_last_working_date,s.proposed_last_working_date,
        e.id AS employee_id,e.employee_code,concat_ws(' ',e.first_name,e.last_name) AS employee_name,
        e.date_joined,e.business_head_id,e.department_id
      FROM separations s JOIN employees e ON e.id=s.employee_id WHERE s.id=${input.separationId}
    `;
    if (!separation) return fail("Separation not found", 404);
    const actor = await requireApiUser("payroll:write", separation.business_head_id, separation.department_id);
    if (actor instanceof Response) return actor;
    if (!["approved", "completed"].includes(separation.status)) return fail("Final settlement can be calculated only after the separation is approved", 409);
    const lastWorkingDate = separation.approved_last_working_date || separation.proposed_last_working_date;
    const periodMonth = `${lastWorkingDate.slice(0, 7)}-01`;
    const [ruleSet] = await sql<{ id: string; code: string; version: number; configuration: Record<string, unknown>; approved_by: string }[]>`
      SELECT id,code,version,configuration,approved_by FROM statutory_rule_sets
      WHERE code='FINAL_SETTLEMENT' AND status='approved'
        AND (${input.statutoryRuleSetId || null}::uuid IS NULL OR id=${input.statutoryRuleSetId || null}::uuid)
        AND (business_head_id IS NULL OR business_head_id=${separation.business_head_id})
        AND effective_from<=${lastWorkingDate}::date AND (effective_to IS NULL OR effective_to>=${lastWorkingDate}::date)
      ORDER BY business_head_id NULLS LAST,version DESC LIMIT 1
    `;
    if (!ruleSet) return fail("No approved FINAL_SETTLEMENT rule set applies on the last working date", 409);
    const configuredRules = ruleSet.configuration?.finalSettlement;
    const parsedRules = finalSettlementRuleSchema.safeParse(configuredRules);
    if (!parsedRules.success) return fail("The approved FINAL_SETTLEMENT rule set is not configured correctly", 409, parsedRules.error.flatten());

    const [compensation] = await sql<{ id: string; monthly_gross: number; structure: Record<string, unknown> }[]>`
      SELECT id,monthly_gross,structure FROM employee_compensation
      WHERE employee_id=${separation.employee_id} AND effective_from<=${lastWorkingDate}::date
        AND (effective_to IS NULL OR effective_to>=${lastWorkingDate}::date)
      ORDER BY effective_from DESC LIMIT 1
    `;
    if (!compensation) return fail("No approved effective compensation exists on the last working date", 409);
    const [payroll] = await sql<{ id: string; status: string; payroll_result_id: string | null }[]>`
      SELECT p.id,p.status,r.id AS payroll_result_id FROM payroll_periods p
      LEFT JOIN payroll_results r ON r.payroll_period_id=p.id AND r.employee_id=${separation.employee_id}
      WHERE p.business_head_id=${separation.business_head_id} AND p.period_month=${periodMonth}::date AND p.status<>'cancelled'
      LIMIT 1
    `;
    if (payroll && !["locked", "paid"].includes(payroll.status)) {
      return fail("The last-working-month payroll must be locked, paid, or cancelled before final settlement", 409, { payrollPeriodId: payroll.id, payrollStatus: payroll.status });
    }
    const salaryAlreadyInPayroll = Boolean(payroll?.payroll_result_id && ["locked", "paid"].includes(payroll.status));
    const [attendanceMonth] = await sql<{ id: string; status: string; summary: { employees?: AttendanceEmployee[] } }[]>`
      SELECT id,status,summary FROM attendance_months
      WHERE business_head_id=${separation.business_head_id} AND period_month=${periodMonth}::date
    `;
    if (!attendanceMonth || attendanceMonth.status !== "locked") return fail("Lock the last-working-month attendance before final settlement calculation", 409);
    const attendance = attendanceMonth.summary?.employees?.find(row => row.id === separation.employee_id);
    if (!attendance || Number(attendance.missing_days) > 0 || Number(attendance.recorded_days) !== Number(attendance.expected_days)) {
      return fail("The locked attendance snapshot is incomplete for this employee", 409);
    }
    const leaveBalances = await sql<{ policy_id: string; code: string; name: string; encashable: boolean; balance: number }[]>`
      SELECT p.id AS policy_id,p.code,p.name,p.encashable,coalesce(sum(l.quantity),0)::numeric AS balance
      FROM leave_policies p LEFT JOIN leave_ledger l ON l.leave_policy_id=p.id
        AND l.employee_id=${separation.employee_id} AND l.transaction_date<=${lastWorkingDate}::date
      WHERE p.status='approved' AND p.active=true AND (p.business_head_id IS NULL OR p.business_head_id=${separation.business_head_id})
      GROUP BY p.id ORDER BY p.code
    `;
    const [loans] = await sql<{ balance: number }[]>`
      SELECT coalesce(sum(outstanding),0)::numeric AS balance FROM employee_loans
      WHERE employee_id=${separation.employee_id} AND status='active' AND outstanding>0
    `;
    const [year, month] = periodMonth.split("-").map(Number);
    const calendarDays = new Date(year, month, 0).getDate();
    const payableDays = Math.max(0, Number(attendance.expected_days) - Number(attendance.unpaid_days || 0));
    const attendanceSummaryChecksum = createHash("sha256").update(JSON.stringify(attendanceMonth.summary)).digest("hex");
    const monthlyGross = Number(compensation.monthly_gross);
    const monthlyBasic = Number(compensation.structure?.basic ?? monthlyGross);
    const calculationOutput = calculateFinalSettlement({
      rules: parsedRules.data,
      separationType: separation.separation_type,
      submittedDate: separation.submitted_date,
      lastWorkingDate,
      dateJoined: separation.date_joined,
      noticeDays: Number(separation.notice_days),
      monthlyGross,
      monthlyBasic,
      calendarDays,
      payableDays,
      salaryAlreadyInPayroll,
      leaveBalances: leaveBalances.map(row => ({ policyId: row.policy_id, code: row.code, name: row.name, balance: Number(row.balance), encashable: row.encashable })),
      loanBalance: Number(loans?.balance || 0),
      manualItems: input.manualItems,
    });
    const snapshot = {
      version: 1,
      employee: { id: separation.employee_id, employeeCode: separation.employee_code, name: separation.employee_name, dateJoined: separation.date_joined },
      separation: { id: separation.id, type: separation.separation_type, submittedDate: separation.submitted_date, lastWorkingDate, noticeDays: separation.notice_days },
      ruleSet: { id: ruleSet.id, code: ruleSet.code, version: ruleSet.version, approvedBy: ruleSet.approved_by, rules: parsedRules.data },
      compensation: { id: compensation.id, monthlyGross, monthlyBasic },
      attendance: { monthId: attendanceMonth.id, periodMonth, summaryChecksum: attendanceSummaryChecksum, ...attendance, payableDays, salaryAlreadyInPayroll },
      payroll: payroll ? { periodId: payroll.id, status: payroll.status, resultId: payroll.payroll_result_id } : null,
      leaveBalances: leaveBalances.map(row => ({ ...row, balance: Number(row.balance) })),
      loanBalance: Number(loans?.balance || 0),
      manualItems: input.manualItems,
      result: calculationOutput,
      calculatedAt: new Date().toISOString(),
    };
    const checksum = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
    const result = await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`final-settlement:${separation.id}`}))`;
      const [existing] = await tx<{ id: string; status: string; calculation_version: number }[]>`SELECT id,status,calculation_version FROM final_settlements WHERE separation_id=${separation.id} FOR UPDATE`;
      if (existing && !["draft", "rejected"].includes(existing.status)) return { error: "state" as const, status: existing.status };
      const [settlement] = await tx`
        INSERT INTO final_settlements (
          separation_id,calculation,gross_payable,recoveries,net_payable,status,calculation_version,
          calculation_checksum,statutory_rule_set_id,attendance_month_id,compensation_id,source_payroll_period_id,
          calculated_by,calculated_at,submitted_by,submitted_at,approved_by,approved_at,paid_by,paid_at,payment_reference,updated_at
        ) VALUES (
          ${separation.id},${JSON.stringify(snapshot)}::jsonb,${calculationOutput.grossPayable},${calculationOutput.recoveries},${calculationOutput.netPayable},'draft',1,
          ${checksum},${ruleSet.id},${attendanceMonth.id},${compensation.id},${payroll?.id || null},
          ${actor.id},now(),NULL,NULL,NULL,NULL,NULL,NULL,NULL,now()
        ) ON CONFLICT (separation_id) DO UPDATE SET
          calculation=EXCLUDED.calculation,gross_payable=EXCLUDED.gross_payable,recoveries=EXCLUDED.recoveries,
          net_payable=EXCLUDED.net_payable,status='draft',calculation_version=final_settlements.calculation_version+1,
          calculation_checksum=EXCLUDED.calculation_checksum,statutory_rule_set_id=EXCLUDED.statutory_rule_set_id,
          attendance_month_id=EXCLUDED.attendance_month_id,compensation_id=EXCLUDED.compensation_id,
          source_payroll_period_id=EXCLUDED.source_payroll_period_id,calculated_by=EXCLUDED.calculated_by,
          calculated_at=now(),submitted_by=NULL,submitted_at=NULL,approved_by=NULL,approved_at=NULL,
          paid_by=NULL,paid_at=NULL,payment_reference=NULL,document_id=NULL,updated_at=now()
        RETURNING *
      `;
      await tx`
        INSERT INTO final_settlement_actions (final_settlement_id,action,actor_user_id,reason,snapshot)
        VALUES (${settlement.id},'calculate',${actor.id},${input.reason},${JSON.stringify({ calculationVersion: settlement.calculation_version, checksum, totals: calculationOutput })}::jsonb)
      `;
      await tx`
        INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason)
        VALUES (${actor.id},'final_settlement.calculate','final_settlement',${settlement.id},${separation.business_head_id},
          ${JSON.stringify({ separationId: separation.id, calculationVersion: settlement.calculation_version, checksum, grossPayable: calculationOutput.grossPayable, recoveries: calculationOutput.recoveries, netPayable: calculationOutput.netPayable, sourceIds: { ruleSetId: ruleSet.id, attendanceMonthId: attendanceMonth.id, compensationId: compensation.id, payrollPeriodId: payroll?.id || null } })}::jsonb,${input.reason})
      `;
      return { settlement };
    });
    if (result.error === "state") return fail(`A ${result.status} final settlement cannot be recalculated; return it first`, 409);
    return ok(result.settlement, { status: 201 });
  } catch (error) { return apiError(error); }
}
