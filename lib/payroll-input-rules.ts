// Salary inputs: how paid leave, extra overtime hours, an advance deducted this month and "no salary" change one person's month.
// Pure functions (unit tested); the salary run in app/api/payroll/run/route.ts calls applySalaryInputs.

export type SalaryInput = { paidLeaveDays: number; extraUnpaidDays: number; overtimeHours: number; advanceDeducted: number; noSalary: boolean };
export const NO_INPUT: SalaryInput = { paidLeaveDays: 0, extraUnpaidDays: 0, overtimeHours: 0, advanceDeducted: 0, noSalary: false };

const num = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
const half = (value: number) => Math.round(value * 2) / 2;
const money = (value: number) => Math.round(value * 100) / 100;

/** Cleans a row typed on the screen or sent to the API: no negatives, paid leave in half days, text flags as booleans. */
export function cleanInput(raw: Partial<Record<keyof SalaryInput, unknown>>): SalaryInput {
  return {
    paidLeaveDays: half(Math.max(0, num(raw.paidLeaveDays))),
    extraUnpaidDays: half(Math.max(0, num(raw.extraUnpaidDays))),
    overtimeHours: money(Math.max(0, num(raw.overtimeHours))),
    advanceDeducted: money(Math.max(0, num(raw.advanceDeducted))),
    noSalary: raw.noSalary === true || raw.noSalary === "true",
  };
}

export type InputFacts = {
  expectedDays: number;        // days the person was employed in the month (from the locked attendance)
  unpaidDays: number;          // absent, unpaid leave and half of each half day (from the locked attendance)
  approvedOvertimeHours: number;
  overtimeRate: number;        // per hour from the pay record, 0 when none is set
  monthlyBasic: number;
  calendarDays: number;
};

export type InputResult = {
  unpaidDays: number; payableDays: number; paidLeaveApplied: number; extraUnpaidApplied: number;
  overtimeHours: number; overtimeRate: number; advanceFromInput: number; noSalary: boolean;
};

/**
 * Paid leave turns unpaid days into paid days (it can never be more than the unpaid days, so a person is never paid for more than the days employed).
 * Extra unpaid days take whole or half days off the pay on top of the attendance (never more than the days still paid), e.g. when the accountant's sheet pays fewer days than the marks.
 * "No salary" (stopped coming without informing the company) pays nothing at all: no days, overtime, advance deduction or extras.
 * Overtime uses the pay record's hourly rate; when none is set it is basic ÷ days in the month ÷ 8.
 */
export function applySalaryInputs(facts: InputFacts, input: SalaryInput): InputResult {
  const rate = facts.overtimeRate > 0 ? facts.overtimeRate : (facts.calendarDays > 0 ? money(facts.monthlyBasic / facts.calendarDays / 8) : 0);
  if (input.noSalary) return { unpaidDays: facts.expectedDays, payableDays: 0, paidLeaveApplied: 0, extraUnpaidApplied: 0, overtimeHours: 0, overtimeRate: rate, advanceFromInput: 0, noSalary: true };
  const paidLeaveApplied = Math.min(half(input.paidLeaveDays), Math.max(0, facts.unpaidDays));
  const afterLeave = Math.max(0, facts.unpaidDays - paidLeaveApplied);
  const extraUnpaidApplied = Math.min(half(input.extraUnpaidDays), Math.max(0, facts.expectedDays - afterLeave));
  const unpaidDays = afterLeave + extraUnpaidApplied;
  return {
    unpaidDays,
    payableDays: Math.max(0, facts.expectedDays - unpaidDays),
    paidLeaveApplied,
    extraUnpaidApplied,
    overtimeHours: facts.approvedOvertimeHours + input.overtimeHours,
    overtimeRate: rate,
    advanceFromInput: input.advanceDeducted,
    noSalary: false,
  };
}
