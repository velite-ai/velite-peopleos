export type PayrollValue = number | string | boolean;
export type PayrollContext = Record<string, PayrollValue>;

export type Expression =
  | number
  | { var: string }
  | { add: Expression[] }
  | { subtract: [Expression, Expression] }
  | { multiply: Expression[] }
  | { divide: [Expression, Expression] }
  | { min: Expression[] }
  | { max: Expression[] }
  | { round: { value: Expression; mode?: "nearest" | "up" | "down"; digits?: number } }
  | { if: { condition: Condition; then: Expression; else: Expression } };

export type Condition =
  | { eq: [Expression | PayrollValue, Expression | PayrollValue] }
  | { gt: [Expression, Expression] }
  | { gte: [Expression, Expression] }
  | { lt: [Expression, Expression] }
  | { lte: [Expression, Expression] }
  | { and: Condition[] }
  | { or: Condition[] }
  | { not: Condition };

export type PayrollRule = {
  code: string;
  name: string;
  category: "calculation" | "earning" | "deduction" | "employer_contribution" | "reimbursement";
  priority: number;
  condition?: Condition;
  formula: Expression;
  rounding?: "none" | "nearest_rupee" | "up" | "down";
};

export type CalculationLine = { code: string; name: string; category: PayrollRule["category"]; amount: number; inputs: string[] };
export type PayrollCalculation = {
  grossEarnings: number;
  deductions: number;
  netPay: number;
  employerContributions: number;
  employerCost: number;
  lines: CalculationLine[];
  context: PayrollContext;
};

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

export function validateExpression(value: unknown, depth = 0, counter = { nodes: 0 }): asserts value is Expression {
  counter.nodes += 1;
  if (counter.nodes > 200 || depth > 20) throw new Error("Payroll formula is too complex");
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new Error("Formula numbers must be finite"); return; }
  assertPlainObject(value, "Payroll expression");
  const keys = Object.keys(value);
  if (keys.length !== 1) throw new Error("Each payroll expression must contain exactly one operator");
  const key = keys[0]; const operand = value[key];
  if (key === "var") { if (typeof operand !== "string" || !/^[A-Z][A-Z0-9_]{0,79}$/.test(operand)) throw new Error("Payroll variables must use uppercase identifiers"); return; }
  if (["add","multiply","min","max"].includes(key)) { if (!Array.isArray(operand) || !operand.length || operand.length > 50) throw new Error(`${key} requires 1 to 50 operands`); operand.forEach(item => validateExpression(item, depth + 1, counter)); return; }
  if (["subtract","divide"].includes(key)) { if (!Array.isArray(operand) || operand.length !== 2) throw new Error(`${key} requires exactly two operands`); operand.forEach(item => validateExpression(item, depth + 1, counter)); return; }
  if (key === "round") { assertPlainObject(operand, "round"); validateExpression(operand.value, depth + 1, counter); if (operand.mode !== undefined && !["nearest","up","down"].includes(String(operand.mode))) throw new Error("Invalid rounding mode"); if (operand.digits !== undefined && (!Number.isInteger(operand.digits) || Number(operand.digits) < 0 || Number(operand.digits) > 4)) throw new Error("Rounding digits must be 0 to 4"); return; }
  if (key === "if") { assertPlainObject(operand, "if"); validateCondition(operand.condition, depth + 1, counter); validateExpression(operand.then, depth + 1, counter); validateExpression(operand.else, depth + 1, counter); return; }
  throw new Error(`Unsupported payroll operator: ${key}`);
}

export function validateCondition(value: unknown, depth = 0, counter = { nodes: 0 }): asserts value is Condition {
  counter.nodes += 1;
  if (counter.nodes > 200 || depth > 20) throw new Error("Payroll condition is too complex");
  assertPlainObject(value, "Payroll condition"); const keys=Object.keys(value); if(keys.length!==1)throw new Error("Each payroll condition must contain exactly one operator");const key=keys[0];const operand=value[key];
  if (["eq","gt","gte","lt","lte"].includes(key)) { if(!Array.isArray(operand)||operand.length!==2)throw new Error(`${key} requires exactly two operands`);for(const item of operand){if(typeof item==='number')continue;if(key==='eq'&&(typeof item==='string'||typeof item==='boolean'))continue;validateExpression(item,depth+1,counter);}return; }
  if (["and","or"].includes(key)) { if(!Array.isArray(operand)||!operand.length||operand.length>50)throw new Error(`${key} requires 1 to 50 conditions`);operand.forEach(item=>validateCondition(item,depth+1,counter));return; }
  if (key === "not") { validateCondition(operand,depth+1,counter);return; }
  throw new Error(`Unsupported payroll condition: ${key}`);
}

export function validatePayrollRule(rule: PayrollRule) {
  if (!/^[A-Z][A-Z0-9_]{1,79}$/.test(rule.code)) throw new Error("Payroll rule codes must use uppercase identifiers");
  if (!["calculation","earning","deduction","employer_contribution","reimbursement"].includes(rule.category)) throw new Error("Invalid payroll rule category");
  validateExpression(rule.formula);
  if (rule.condition) validateCondition(rule.condition);
}

function numeric(value: PayrollValue | undefined, label = "value") {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be numeric`);
  return number;
}

function variables(expression: Expression, found = new Set<string>()): Set<string> {
  if (typeof expression === "number") return found;
  if ("var" in expression) found.add(expression.var);
  else if ("add" in expression) expression.add.forEach(e => variables(e, found));
  else if ("subtract" in expression) expression.subtract.forEach(e => variables(e, found));
  else if ("multiply" in expression) expression.multiply.forEach(e => variables(e, found));
  else if ("divide" in expression) expression.divide.forEach(e => variables(e, found));
  else if ("min" in expression) expression.min.forEach(e => variables(e, found));
  else if ("max" in expression) expression.max.forEach(e => variables(e, found));
  else if ("round" in expression) variables(expression.round.value, found);
  else if ("if" in expression) { variables(expression.if.then, found); variables(expression.if.else, found); }
  return found;
}

export function evaluate(expression: Expression, context: PayrollContext): number {
  if (typeof expression === "number") return expression;
  if ("var" in expression) return numeric(context[expression.var], expression.var);
  if ("add" in expression) return expression.add.reduce<number>((sum, value) => sum + evaluate(value, context), 0);
  if ("subtract" in expression) return evaluate(expression.subtract[0], context) - evaluate(expression.subtract[1], context);
  if ("multiply" in expression) return expression.multiply.reduce<number>((total, value) => total * evaluate(value, context), 1);
  if ("divide" in expression) { const divisor = evaluate(expression.divide[1], context); if (divisor === 0) throw new Error("Payroll formula attempted division by zero"); return evaluate(expression.divide[0], context) / divisor; }
  if ("min" in expression) return Math.min(...expression.min.map(value => evaluate(value, context)));
  if ("max" in expression) return Math.max(...expression.max.map(value => evaluate(value, context)));
  if ("round" in expression) { const factor = 10 ** (expression.round.digits || 0); const value = evaluate(expression.round.value, context) * factor; const mode = expression.round.mode || "nearest"; return (mode === "up" ? Math.ceil(value) : mode === "down" ? Math.floor(value) : Math.round(value)) / factor; }
  if ("if" in expression) return matches(expression.if.condition, context) ? evaluate(expression.if.then, context) : evaluate(expression.if.else, context);
  throw new Error("Unsupported payroll expression");
}

function comparable(value: Expression | PayrollValue, context: PayrollContext): PayrollValue {
  if (typeof value === "object") return evaluate(value as Expression, context);
  return value;
}

export function matches(condition: Condition, context: PayrollContext): boolean {
  if ("eq" in condition) return comparable(condition.eq[0], context) === comparable(condition.eq[1], context);
  if ("gt" in condition) return evaluate(condition.gt[0], context) > evaluate(condition.gt[1], context);
  if ("gte" in condition) return evaluate(condition.gte[0], context) >= evaluate(condition.gte[1], context);
  if ("lt" in condition) return evaluate(condition.lt[0], context) < evaluate(condition.lt[1], context);
  if ("lte" in condition) return evaluate(condition.lte[0], context) <= evaluate(condition.lte[1], context);
  if ("and" in condition) return condition.and.every(item => matches(item, context));
  if ("or" in condition) return condition.or.some(item => matches(item, context));
  if ("not" in condition) return !matches(condition.not, context);
  return false;
}

function roundAmount(value: number, method: PayrollRule["rounding"] = "nearest_rupee") {
  if (method === "none") return Math.round(value * 100) / 100;
  if (method === "up") return Math.ceil(value);
  if (method === "down") return Math.floor(value);
  return Math.round(value);
}

export function calculatePayroll(initialContext: PayrollContext, rules: PayrollRule[]): PayrollCalculation {
  const context: PayrollContext = { ...initialContext };
  const lines: CalculationLine[] = [];
  for (const rule of [...rules].sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code))) {
    validatePayrollRule(rule);
    if (rule.condition && !matches(rule.condition, context)) continue;
    const amount = Math.max(0, roundAmount(evaluate(rule.formula, context), rule.rounding));
    context[rule.code] = amount;
    lines.push({ code: rule.code, name: rule.name, category: rule.category, amount, inputs: [...variables(rule.formula)] });
  }
  const total = (category: PayrollRule["category"]) => lines.filter(line => line.category === category).reduce((sum, line) => sum + line.amount, 0);
  const grossEarnings = total("earning") + total("reimbursement");
  const deductions = total("deduction");
  const employerContributions = total("employer_contribution");
  return { grossEarnings, deductions, netPay: Math.max(0, grossEarnings - deductions), employerContributions, employerCost: grossEarnings + employerContributions, lines, context };
}

export const standardMonthlyRules: PayrollRule[] = [
  { code: "PAYABLE_DAYS", name: "Payable days", category: "calculation", priority: 10, formula: { max: [0, { subtract: [{ var: "CALENDAR_DAYS" }, { var: "UNPAID_DAYS" }] }] }, rounding: "none" },
  { code: "EARNED_BASIC", name: "Earned basic", category: "earning", priority: 20, formula: { multiply: [{ divide: [{ var: "MONTHLY_BASIC" }, { var: "DIVISOR_DAYS" }] }, { var: "PAYABLE_DAYS" }] } },
  { code: "EARNED_ALLOWANCES", name: "Earned allowances", category: "earning", priority: 30, formula: { multiply: [{ divide: [{ var: "MONTHLY_ALLOWANCES" }, { var: "DIVISOR_DAYS" }] }, { var: "PAYABLE_DAYS" }] } },
  { code: "OVERTIME_PAY", name: "Overtime pay", category: "earning", priority: 40, formula: { multiply: [{ var: "OVERTIME_HOURS" }, { var: "OVERTIME_RATE" }] } },
  { code: "ADVANCE_RECOVERY", name: "Advance adjusted", category: "deduction", priority: 100, formula: { min: [{ var: "ADVANCE_ADJUSTED" }, { var: "ADVANCE_BALANCE" }] } },
  { code: "OTHER_DEDUCTIONS", name: "Other deductions", category: "deduction", priority: 110, formula: { var: "OTHER_DEDUCTIONS_INPUT" } },
];
