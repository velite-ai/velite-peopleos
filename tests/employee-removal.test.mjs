import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("employee removal is confirmed, scoped, audited and non-destructive", async () => {
  const [detailRoute, listRoute, drawer] = await Promise.all([
    readFile(new URL("../app/api/employees/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/employees/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/employee-record-drawer.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(detailRoute, /export async function DELETE/);
  assert.match(detailRoute, /confirmationCode !== record\.employee_code/);
  assert.match(detailRoute, /requireApiUser\("people:write"/);
  assert.match(detailRoute, /employee\.remove_from_people/);
  assert.match(detailRoute, /historicalRecordsPreserved: true/);
  assert.doesNotMatch(detailRoute, /DELETE FROM employees/i);
  // The normal staff list leaves out removed (archived) people and people who have left (separated); each has its own list (?archived=1, ?left=1).
  assert.match(listRoute, /e\.status NOT IN \('archived','separated'\)/);
  assert.match(listRoute, /e\.status='archived'/);
  assert.match(listRoute, /e\.status='separated'/);
  assert.match(drawer, /Delete employee from People/);
  assert.match(drawer, /Payroll, attendance, salary registers and audit history will remain preserved/);
});
