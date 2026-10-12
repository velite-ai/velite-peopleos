import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculatePayroll, standardMonthlyRules, validatePayrollRule } from "../lib/payroll-engine.ts";
import { payrollApprovalMode } from "../lib/payroll-approval-mode.ts";
import { standardStatutoryRules } from "../lib/payroll-standard-rules.ts";

const withStatutory = options => [...standardMonthlyRules, ...standardStatutoryRules(options)];
const run = ({ basic, allowances = 0, days, advance = 0, month = 31, rules }) => {
  const unpaid = month - days;
  return calculatePayroll({ CALENDAR_DAYS: month, DIVISOR_DAYS: month, UNPAID_DAYS: unpaid, PAYABLE_DAYS: days, MONTHLY_BASIC: basic, MONTHLY_ALLOWANCES: allowances, OVERTIME_HOURS: 0, OVERTIME_RATE: 0, ADVANCE_ADJUSTED: advance, ADVANCE_BALANCE: advance, OTHER_DEDUCTIONS_INPUT: 0 }, rules);
};
const line = (result, code) => result.lines.find(item => item.code === code)?.amount ?? 0;

// August 2026 salary registers (31 days). [name, basic, allowances, days, advance, ESI, PF, net payable] - read straight from the printed sheets.
const healthcare = [
  ["Ambika", 37300, 12700, 31, 0, 0, 0, 49995], ["Shiv Kumar", 22000, 2000, 31, 0, 0, 0, 23995], ["Vanshika Phull", 22000, 2000, 31, 0, 0, 0, 23995],
  ["Aishwerya", 50000, 0, 30.5, 0, 0, 0, 49189], ["Nishtha Dua (left, 0 days)", 20200, 0, 0, 0, 0, 0, 0], ["Rajeev Joshi", 32300, 23700, 31, 0, 0, 0, 55995],
  ["Ramna (left, 0 days)", 25000, 0, 0, 0, 0, 0, 0], ["Lovepreet Kaur", 15000, 0, 28.5, 0, 104, 1655, 12026], ["Meenakshi Verma", 20000, 0, 31, 0, 150, 0, 19845],
  ["Tisha", 18333, 0, 28, 0, 125, 0, 16429], ["Vinod Garg", 20000, 0, 31, 0, 150, 0, 19845], ["Arjun Kumar", 13500, 0, 31, 0, 102, 1620, 11773],
  ["Sarita Devi (ESI on basic only)", 16500, 3000, 31, 0, 124, 0, 19371], ["Sanjay Kumar", 21500, 0, 31, 7500, 0, 0, 13995], ["Dinesh Kumar Pawar", 22000, 1500, 28, 5000, 0, 0, 16221],
  ["Ashok Kumar", 22000, 0, 30, 0, 0, 0, 21285], ["Surbhi Sridhar", 22000, 2000, 28, 0, 0, 0, 21672], ["Charanjit Kaur", 17000, 0, 31, 0, 128, 0, 16867], ["Sunil Kumar", 17500, 0, 30, 0, 128, 0, 16802],
];
const pharma = [
  ["Shiwani Yadav", 23400, 12600, 31, 0, 0, 0, 35995], ["Jaskaran Singh", 25000, 5000, 31, 0, 0, 0, 29995], ["Digvijay Singh", 17500, 0, 29, 0, 123, 0, 16243],
  ["Govind Yadav", 13500, 0, 31, 0, 102, 1620, 11773], ["Piyush Verma", 25000, 0, 31, 0, 0, 0, 24995], ["Satwinder Kaur", 25000, 0, 31, 0, 0, 0, 24995],
  ["Sachin Sakarwal", 27000, 20000, 31, 5000, 0, 0, 41995], ["Divya Bhandari", 19500, 0, 31, 0, 147, 0, 19348], ["Kiran Sharma", 13500, 0, 31, 0, 102, 1620, 11773],
  ["Pavanpreet Kaur", 13500, 0, 26, 0, 85, 1359, 9874], ["Gurmeet Kaur", 13500, 0, 28, 0, 92, 1463, 10634],
];

for (const [company, rows] of [["Velite Healthcare", healthcare], ["Velite Pharmaceuticals", pharma]]) {
  test(`${company}: every August 2026 ESI, PF and net-payable figure is reproduced (old Rs 15,000 PF ceiling)`, () => {
    const rules = withStatutory({ pfCeiling: 15000 });
    for (const [name, basic, allowances, days, advance, esi, pf, net] of rows) {
      const result = run({ basic, allowances, days, advance, rules });
      assert.equal(line(result, "ESI_EMPLOYEE"), esi, `${name} ESI`);
      assert.equal(line(result, "PF_EMPLOYEE"), pf, `${name} PF`);
      assert.equal(result.netPay, net, `${name} net payable`);
    }
  });
}

test("August register totals match the printed ESIC, EPF and labour welfare fund summaries", () => {
  const totals = rows => {
    const sum = { esi: 0, esiEr: 0, pf: 0, eps: 0, epf: 0, lwf: 0, lwfEr: 0 };
    for (const [, basic, allowances, days, advance] of rows) {
      const r = run({ basic, allowances, days, advance, rules: withStatutory({ pfCeiling: 15000 }) });
      sum.esi += line(r, "ESI_EMPLOYEE"); sum.esiEr += line(r, "ESI_EMPLOYER"); sum.pf += line(r, "PF_EMPLOYEE"); sum.eps += line(r, "PF_EMPLOYER_EPS"); sum.epf += line(r, "PF_EMPLOYER_EPF");
      sum.lwf += line(r, "LWF_EMPLOYEE"); sum.lwfEr += line(r, "LWF_EMPLOYER");
    }
    return sum;
  };
  // Employer ESI is shown on the printed challan as one rounded-up total, so person-by-person it can differ by a rupee or two.
  const near = (actual, printed) => assert.ok(Math.abs(actual - printed) <= 3, `employer ESI ${actual} vs printed ${printed}`);
  const { esiEr: hcEsiEr, ...hc } = totals(healthcare);
  assert.deepEqual(hc, { esi: 1011, pf: 3275, eps: 2274, epf: 1001, lwf: 85, lwfEr: 340 });
  near(hcEsiEr, 4365);
  const { esiEr: phEsiEr, ...ph } = totals(pharma);
  assert.deepEqual(ph, { esi: 651, pf: 6062, eps: 4209, epf: 1853, lwf: 55, lwfEr: 220 });
  near(phEsiEr, 2808);
});

test("from 17 Sep 2026 PF applies on earned basic up to Rs 25,000 (25,000 itself included)", () => {
  const rules = withStatutory();
  const pf = (basic, allowances = 0, days = 31) => line(run({ basic, allowances, days, rules }), "PF_EMPLOYEE");
  assert.equal(pf(25000), 3000);
  assert.equal(pf(25000, 5000), 3000); // allowances are not PF wages
  assert.equal(pf(25001), 0);
  assert.equal(pf(27000, 20000), 0);
  assert.equal(pf(17500, 0, 29), 1965); // 16,371 earned x 12% = 1,964.52, nearest rupee
  assert.equal(pf(13500), 1620);
  const split = run({ basic: 25000, days: 31, rules });
  assert.equal(line(split, "PF_EMPLOYER_EPS") + line(split, "PF_EMPLOYER_EPF"), 3000);
});

test("ESI applies only when monthly gross is Rs 21,000 or less, and is taken on basic only, rounded up", () => {
  const rules = withStatutory();
  assert.equal(line(run({ basic: 20000, days: 31, rules }), "ESI_EMPLOYEE"), 150); // exact, not 151
  assert.equal(line(run({ basic: 21000, days: 31, rules }), "ESI_EMPLOYEE"), 158); // 157.5 up
  assert.equal(line(run({ basic: 21001, days: 31, rules }), "ESI_EMPLOYEE"), 0);
  assert.equal(line(run({ basic: 16500, allowances: 4600, days: 31, rules }), "ESI_EMPLOYEE"), 0); // gross 21,100
  assert.equal(line(run({ basic: 16500, allowances: 4500, days: 31, rules }), "ESI_EMPLOYEE"), 124); // gross 21,000, on 16,500
});

test("labour welfare fund is Rs 5 + Rs 20 only for people who worked", () => {
  const rules = withStatutory();
  const worked = run({ basic: 30000, days: 31, rules });
  assert.equal(line(worked, "LWF_EMPLOYEE"), 5); assert.equal(line(worked, "LWF_EMPLOYER"), 20);
  const absent = run({ basic: 30000, days: 0, rules });
  assert.equal(line(absent, "LWF_EMPLOYEE"), 0); assert.equal(absent.netPay, 0);
});

test("companies without the statutory rules get the plain salary: no PF, ESI or welfare fund", () => {
  const r = run({ basic: 15000, days: 28.5, rules: standardMonthlyRules });
  assert.equal(r.grossEarnings, 13790); assert.equal(r.deductions, 0); assert.equal(r.netPay, 13790);
});

test("pay is divided by the days in the month, so every month pays exactly the agreed salary", () => {
  for (const month of [28, 29, 30, 31]) assert.equal(run({ basic: 10000, allowances: 4000, days: month, month, rules: standardMonthlyRules }).grossEarnings, 14000, `${month}-day month`);
  assert.equal(run({ basic: 10000, allowances: 4000, days: 29, month: 31, rules: standardMonthlyRules }).grossEarnings, 13097); // 14,000 / 31 x 29
});

test("every standard rule is a valid engine rule and is created for one company, never global", async () => {
  for (const rule of standardStatutoryRules()) validatePayrollRule(rule);
  const route = await readFile(new URL("../app/api/payroll/rules/standard/route.ts", import.meta.url), "utf8");
  assert.match(route, /business_head_id,/);
  assert.match(route, /\$\{head\.id\}/);
  assert.doesNotMatch(route, /business_head_id\s*IS\s*NULL/i);
  assert.match(route, /cannot approve them/);
});

test("approval mode is simple unless PAYROLL_APPROVAL_MODE=strict", () => {
  assert.equal(payrollApprovalMode(undefined), "simple");
  assert.equal(payrollApprovalMode("simple"), "simple");
  assert.equal(payrollApprovalMode("strict"), "strict");
  assert.equal(payrollApprovalMode(" Strict "), "strict");
});

test("the salary run reads dates as text (a date object made every calculation fail with a server error)", async () => {
  const route = await readFile(new URL("../app/api/payroll/run/route.ts", import.meta.url), "utf8");
  assert.match(route, /period_month::text AS period_month/);
  assert.match(route, /e\.date_joined::text AS date_joined/);
});

test("JSON is stored as JSON, not as a text string inside the column", async () => {
  const { serializeJson, parseJson } = await import("../lib/postgres-json.ts");
  const text = JSON.stringify({ a: 1 });
  assert.equal(serializeJson(text), text); // already JSON: stored as it is (it used to be encoded a second time)
  assert.equal(serializeJson({ a: 1 }), text);
  assert.deepEqual(parseJson(text), { a: 1 });
  assert.deepEqual(parseJson(JSON.stringify(text)), { a: 1 }); // a row saved the old way still reads as an object
  assert.deepEqual(parseJson(JSON.stringify(JSON.stringify(text))), { a: 1 });
  assert.equal(parseJson(JSON.stringify("plain words")), "plain words");
  assert.equal(parseJson("5"), 5);
  const database = await readFile(new URL("../lib/database.ts", import.meta.url), "utf8");
  assert.match(database, /types: jsonTypes/);
  const worker = await readFile(new URL("../scripts/worker.mjs", import.meta.url), "utf8");
  assert.match(worker, /typeof value === "string" \? value : JSON.stringify\(value\)/);
});

test("overtime is read from the real overtime_requests columns", async () => {
  const route = await readFile(new URL("../app/api/payroll/run/route.ts", import.meta.url), "utf8");
  assert.match(route, /sum\(coalesce\(approved_minutes,requested_minutes\)\)/);
  assert.match(route, /attendance_date>=\$\{monthStart\}::date AND attendance_date<=\$\{monthEnd\}::date AND status='approved'/);
  assert.doesNotMatch(route, /sum\(minutes\)|work_date/);
});
