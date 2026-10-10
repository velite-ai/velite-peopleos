import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MOVES_WITH_PERSON, countLabel, friendlyTable, monthBlockers, splitFootprint } from "../lib/company-correction-rules.ts";

test("only a person's own records move; anything tied to a company blocks the move", () => {
  const { moves, blockers } = splitFootprint({ attendance_days: 10, employee_compensation: 1, employee_events: 1, leave_requests: 2, payroll_results: 0, shift_rosters: 3, documents: 0 });
  assert.deepEqual(moves.map(item => item.table).sort(), ["attendance_days", "employee_compensation", "employee_events"]);
  assert.deepEqual(blockers.map(item => item.table).sort(), ["leave_requests", "shift_rosters"]);
  assert.equal(blockers.find(item => item.table === "leave_requests").label, "leave requests");
  assert.deepEqual(splitFootprint({ attendance_days: 0 }), { moves: [], blockers: [] });
  // A table nobody has classified is treated as company-bound, never moved silently.
  assert.equal(splitFootprint({ some_new_table: 4 }).blockers.length, 1);
  for (const table of ["payroll_results", "salary_register_lines", "leave_ledger", "leave_requests", "shift_rosters", "performance_reviews", "helpdesk_cases", "asset_transactions"]) assert.ok(!(table in MOVES_WITH_PERSON), table);
  assert.equal(friendlyTable("attendance_days"), "attendance days");
  assert.equal(friendlyTable("something_unknown"), "something unknown");
});

test("a month that is not open blocks the move, and says which", () => {
  const blocked = monthBlockers([{ company: "Others 1", period: "September 2026", status: "review" }, { company: "Velite India", period: "August 2026", status: "locked" }, { company: "Others 1", period: "October 2026", status: "open" }]);
  assert.deepEqual(blocked, ["September 2026 is under checking for Others 1", "August 2026 is locked for Velite India"]);
});

test("counts read naturally", () => {
  assert.equal(countLabel(1, "attendance days"), "1 attendance day");
  assert.equal(countLabel(10, "attendance days"), "10 attendance days");
  assert.equal(countLabel(1, "history entries"), "1 history entry");
  assert.equal(countLabel(3, "history entries"), "3 history entries");
  assert.equal(countLabel(1, "documents"), "1 document");
});

test("the routes are limited to administrators and record what they do", async () => {
  const [company, unlock, page, drawer] = await Promise.all([
    readFile(new URL("../app/api/employees/[id]/company/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/attendance/unlock/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/employee-record-drawer.tsx", import.meta.url), "utf8"),
  ]);
  for (const route of [company, unlock]) assert.match(route, /role\.code === "SUPER_ADMIN" \|\| role\.code === "HR_ADMIN"/);
  assert.match(company, /hasPermissionForScope\(user, "people:write", input\.businessHeadId\)/);
  assert.match(company, /FOR UPDATE/);
  assert.match(company, /employee\.company_correct/);
  assert.match(company, /company_corrected/);
  assert.match(company, /dryRun/);
  assert.match(unlock, /attendance\.unlock/);
  assert.match(unlock, /Reopen month/);
  assert.match(unlock, /Return month to open/);
  assert.match(page, /Nobody can change a locked day/);
  assert.match(page, /canUnlock=\{canAdmin\}/);
  assert.match(page, /canChangeCompany=\{canAdmin\}/);
  assert.match(drawer, /Change company/);
});
