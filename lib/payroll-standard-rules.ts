import type { Condition, Expression, PayrollRule } from "./payroll-engine";

/*
 * PF, ESI and Labour Welfare Fund rules for Velite Healthcare and Velite Pharmaceuticals.
 * They are only ever created for one company at a time (never "global"), so Others 1, Others 2,
 * Velite India and Velite Sciences keep the plain salary rules with no PF / ESI.
 * Worked out from the August 2026 salary registers (every ESI, PF and net figure there is reproduced by tests).
 *
 *   PF   12% of earned basic when the monthly basic is within the ceiling (₹25,000 from 17 Sep 2026, ₹15,000 before)
 *   ESI  0.75% of earned basic, rounded up, when the monthly gross (basic + allowances) is ₹21,000 or less
 *   LWF  ₹5 from the employee, ₹20 from the employer, for anyone who worked that month
 *
 * Percentages are written as whole-number fractions (75 / 10000) so that figures such as 20,000 x 0.75%
 * come out as exactly 150 and not 150.00000000000003, which a round-up would push to 151.
 */

export const PF_CEILING_FROM_17_SEP_2026 = 25000;
export const PF_CEILING_BEFORE_17_SEP_2026 = 15000;
export const ESI_GROSS_LIMIT = 21000;

export type StandardRuleDefinition = Omit<PayrollRule, "condition"> & { condition: Condition; componentName: string };

const variable = (name: string): Expression => ({ var: name });
const percent = (name: string, numerator: number, denominator: number): Expression => ({ divide: [{ multiply: [variable(name), numerator] }, denominator] });
const worked: Condition = { gt: [variable("PAYABLE_DAYS"), 0] };

export function standardStatutoryRules(options: { pfCeiling?: number } = {}): StandardRuleDefinition[] {
  const pfCeiling = options.pfCeiling ?? PF_CEILING_FROM_17_SEP_2026;
  const pfApplies: Condition = { and: [{ lte: [variable("MONTHLY_BASIC"), pfCeiling] }, worked] };
  const esiApplies: Condition = { and: [{ lte: [{ add: [variable("MONTHLY_BASIC"), variable("MONTHLY_ALLOWANCES")] }, ESI_GROSS_LIMIT] }, worked] };
  return [
    { code: "PF_EMPLOYEE", name: "Provident fund (employee 12%)", componentName: "Provident fund - employee", category: "deduction", priority: 120, condition: pfApplies, formula: percent("EARNED_BASIC", 12, 100), rounding: "nearest_rupee" },
    { code: "ESI_EMPLOYEE", name: "ESI (employee 0.75%)", componentName: "ESI - employee", category: "deduction", priority: 130, condition: esiApplies, formula: percent("EARNED_BASIC", 75, 10000), rounding: "up" },
    { code: "LWF_EMPLOYEE", name: "Labour welfare fund (employee)", componentName: "Labour welfare fund - employee", category: "deduction", priority: 140, condition: worked, formula: 5, rounding: "nearest_rupee" },
    { code: "PF_EMPLOYER_EPS", name: "Pension share of employer PF (8.33%)", componentName: "Employer PF - pension (EPS)", category: "employer_contribution", priority: 150, condition: pfApplies, formula: percent("EARNED_BASIC", 833, 10000), rounding: "nearest_rupee" },
    { code: "PF_EMPLOYER_EPF", name: "Provident fund share of employer PF (3.67%)", componentName: "Employer PF - provident fund", category: "employer_contribution", priority: 160, condition: pfApplies, formula: { subtract: [variable("PF_EMPLOYEE"), variable("PF_EMPLOYER_EPS")] }, rounding: "nearest_rupee" },
    { code: "ESI_EMPLOYER", name: "ESI (employer 3.25%)", componentName: "ESI - employer", category: "employer_contribution", priority: 170, condition: esiApplies, formula: percent("EARNED_BASIC", 325, 10000), rounding: "nearest_rupee" },
    { code: "LWF_EMPLOYER", name: "Labour welfare fund (employer)", componentName: "Labour welfare fund - employer", category: "employer_contribution", priority: 180, condition: worked, formula: 20, rounding: "nearest_rupee" },
  ];
}
