import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/employees/[id]/compensation/route.ts", import.meta.url), "utf8");
const drawer = readFileSync(new URL("../components/employee-record-drawer.tsx", import.meta.url), "utf8");

test("adding an earlier pay rate reads the next rate's start date as text (the driver returns dates as objects, which crashed the save)", () => {
  assert.match(route, /SELECT effective_from::text AS effective_from FROM employee_compensation/);
});

test("a blank 'next salary revision' on the pay form keeps the date already on the record instead of clearing it", () => {
  assert.match(drawer, /nextSalaryRevisionDate: data\.get\("nextSalaryRevisionDate"\) \|\| undefined/);
  assert.doesNotMatch(drawer, /nextSalaryRevisionDate: data\.get\("nextSalaryRevisionDate"\) \|\| null/);
  assert.match(route, /input\.nextSalaryRevisionDate!==undefined/);
});
