import { z } from "zod";

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const DAY_MS = 86_400_000;

const basisSchema = z.enum(["monthly_gross", "monthly_basic"]);
export const finalSettlementRuleSchema = z.object({
  salary: z.object({
    basis: basisSchema.default("monthly_gross"),
    divisor: z.union([z.literal("calendar_days"), z.number().positive().max(366)]).default("calendar_days"),
  }).default({ basis: "monthly_gross", divisor: "calendar_days" }),
  leaveEncashment: z.object({
    basis: basisSchema.default("monthly_basic"),
    divisor: z.union([z.literal("calendar_days"), z.number().positive().max(366)]).default(30),
    maximumDays: z.number().nonnegative().max(365).optional(),
  }).default({ basis: "monthly_basic", divisor: 30 }),
  noticeRecovery: z.object({
    enabled: z.boolean().default(true),
    basis: basisSchema.default("monthly_gross"),
    divisor: z.union([z.literal("calendar_days"), z.number().positive().max(366)]).default(30),
    applicableSeparationTypes: z.array(z.string().min(1)).default(["resignation", "abandonment"]),
  }).default({ enabled: true, basis: "monthly_gross", divisor: 30, applicableSeparationTypes: ["resignation", "abandonment"] }),
  gratuity: z.object({
    enabled: z.boolean().default(false),
    basis: basisSchema.default("monthly_basic"),
    minimumServiceYears: z.number().int().nonnegative().max(50).default(5),
    daysPerCompletedYear: z.number().positive().max(60).default(15),
    divisor: z.number().positive().max(366).default(26),
    maximumAmount: z.number().nonnegative().max(1_000_000_000).optional(),
  }).default({ enabled: false, basis: "monthly_basic", minimumServiceYears: 5, daysPerCompletedYear: 15, divisor: 26 }),
});

export type FinalSettlementRule = z.infer<typeof finalSettlementRuleSchema>;
export type SettlementItem = {
  code: string;
  label: string;
  category: "earning" | "recovery";
  amount: number;
  source: string;
  details?: Record<string, unknown>;
};

type ManualItem = {
  code: string;
  label: string;
  category: "earning" | "recovery";
  amount: number;
  reason: string;
};

function parseDate(value: string) {
  const result = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(result.getTime()) || result.toISOString().slice(0, 10) !== value) throw new Error("INVALID_SETTLEMENT_DATE");
  return result;
}

function completedYears(start: string, end: string) {
  const from = parseDate(start);
  const to = parseDate(end);
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  if (to.getUTCMonth() < from.getUTCMonth() || (to.getUTCMonth() === from.getUTCMonth() && to.getUTCDate() < from.getUTCDate())) years -= 1;
  return Math.max(0, years);
}

function calendarDifference(start: string, end: string) {
  return Math.max(0, Math.floor((parseDate(end).getTime() - parseDate(start).getTime()) / DAY_MS));
}

function basisAmount(basis: "monthly_gross" | "monthly_basic", monthlyGross: number, monthlyBasic: number) {
  return basis === "monthly_basic" ? monthlyBasic : monthlyGross;
}

function divisorValue(value: "calendar_days" | number, calendarDays: number) {
  return value === "calendar_days" ? calendarDays : value;
}

export function calculateFinalSettlement(input: {
  rules: FinalSettlementRule;
  separationType: string;
  submittedDate: string;
  lastWorkingDate: string;
  dateJoined: string;
  noticeDays: number;
  monthlyGross: number;
  monthlyBasic: number;
  calendarDays: number;
  payableDays: number;
  salaryAlreadyInPayroll: boolean;
  leaveBalances: Array<{ policyId: string; code: string; name: string; balance: number; encashable: boolean }>;
  loanBalance: number;
  manualItems?: ManualItem[];
}) {
  const rules = finalSettlementRuleSchema.parse(input.rules);
  const items: SettlementItem[] = [];
  if (!input.salaryAlreadyInPayroll && input.payableDays > 0) {
    const divisor = divisorValue(rules.salary.divisor, input.calendarDays);
    const amount = money(basisAmount(rules.salary.basis, input.monthlyGross, input.monthlyBasic) / divisor * input.payableDays);
    if (amount > 0) items.push({
      code: "SALARY_DUE",
      label: "Salary payable through last working date",
      category: "earning",
      amount,
      source: "locked_attendance",
      details: { payableDays: input.payableDays, divisor, basis: rules.salary.basis },
    });
  }
  for (const leave of input.leaveBalances.filter(item => item.encashable && item.balance > 0)) {
    const cappedDays = Math.min(leave.balance, rules.leaveEncashment.maximumDays ?? leave.balance);
    const divisor = divisorValue(rules.leaveEncashment.divisor, input.calendarDays);
    const amount = money(basisAmount(rules.leaveEncashment.basis, input.monthlyGross, input.monthlyBasic) / divisor * cappedDays);
    if (amount > 0) items.push({
      code: `LEAVE_ENCASHMENT_${leave.code}`,
      label: `${leave.name} encashment`,
      category: "earning",
      amount,
      source: "leave_ledger",
      details: { policyId: leave.policyId, days: cappedDays, ledgerBalance: leave.balance, divisor, basis: rules.leaveEncashment.basis },
    });
  }
  if (rules.noticeRecovery.enabled && rules.noticeRecovery.applicableSeparationTypes.includes(input.separationType)) {
    const servedDays = calendarDifference(input.submittedDate, input.lastWorkingDate);
    const shortfallDays = Math.max(0, input.noticeDays - servedDays);
    const divisor = divisorValue(rules.noticeRecovery.divisor, input.calendarDays);
    const amount = money(basisAmount(rules.noticeRecovery.basis, input.monthlyGross, input.monthlyBasic) / divisor * shortfallDays);
    if (amount > 0) items.push({
      code: "NOTICE_RECOVERY",
      label: "Notice-period recovery",
      category: "recovery",
      amount,
      source: "separation",
      details: { requiredDays: input.noticeDays, servedDays, shortfallDays, divisor, basis: rules.noticeRecovery.basis },
    });
  }
  const serviceYears = completedYears(input.dateJoined, input.lastWorkingDate);
  if (rules.gratuity.enabled && serviceYears >= rules.gratuity.minimumServiceYears) {
    const uncapped = basisAmount(rules.gratuity.basis, input.monthlyGross, input.monthlyBasic) / rules.gratuity.divisor * rules.gratuity.daysPerCompletedYear * serviceYears;
    const amount = money(Math.min(uncapped, rules.gratuity.maximumAmount ?? uncapped));
    if (amount > 0) items.push({
      code: "GRATUITY",
      label: "Gratuity",
      category: "earning",
      amount,
      source: "approved_statutory_rule",
      details: { serviceYears, divisor: rules.gratuity.divisor, daysPerCompletedYear: rules.gratuity.daysPerCompletedYear, basis: rules.gratuity.basis },
    });
  }
  if (input.loanBalance > 0) items.push({
    code: "LOAN_ADVANCE_RECOVERY",
    label: "Outstanding loan and advance recovery",
    category: "recovery",
    amount: money(input.loanBalance),
    source: "loan_ledger",
  });
  for (const item of input.manualItems || []) items.push({
    code: item.code,
    label: item.label,
    category: item.category,
    amount: money(item.amount),
    source: "maker_input",
    details: { reason: item.reason },
  });
  const grossPayable = money(items.filter(item => item.category === "earning").reduce((sum, item) => sum + item.amount, 0));
  const recoveries = money(items.filter(item => item.category === "recovery").reduce((sum, item) => sum + item.amount, 0));
  return {
    items,
    grossPayable,
    recoveries,
    netPayable: money(grossPayable - recoveries),
    serviceYears,
  };
}
