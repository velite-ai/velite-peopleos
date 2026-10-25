import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/employees/[id]/compensation/[revisionId]/route.ts", import.meta.url), "utf8");
const drawer = readFileSync(new URL("../components/employee-record-drawer.tsx", import.meta.url), "utf8");

test("correcting a pay rate needs payroll write access and is written to the audit trail and history", () => {
  assert.match(route, /requireApiUser\("payroll:write"/);
  assert.match(route, /compensation\.edit/);
  assert.match(route, /compensation_revision/);
});

test("a pay rate already used by a salary month under review, approved, locked or paid cannot be changed", () => {
  assert.match(route, /'review','approved','locked','paid'/);
  assert.match(route, /Add a new revision instead/);
});

test("a corrected start date stays between its neighbours and the earlier entry follows it", () => {
  assert.match(route, /must be after the earlier entry's start/);
  assert.match(route, /must be before the next entry's start/);
  assert.match(route, /effective_to=\$\{input\.effectiveFrom\}::date-1/);
});

test("each entry in the compensation history has an Edit button that opens the form filled in", () => {
  assert.match(drawer, /className="pay-edit"/);
  assert.match(drawer, /compensation: revision \? "Edit pay rate"/);
  assert.match(drawer, /method = "PATCH"; payload = \{ effectiveFrom/);
});
