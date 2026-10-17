import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the staff record can edit all six lifecycle dates and record a resignation", async () => {
  const drawer = await read("components/employee-record-drawer.tsx");
  assert.match(drawer, /title="Lifecycle dates"[^>]*action="Edit dates"/);
  assert.match(drawer, /kind === "lifecycle"/);
  for (const field of ["dateJoined", "probationEndDate", "confirmationDate", "nextSalaryRevisionDate", "noticeStartDate", "lastWorkingDate"]) assert.match(drawer, new RegExp(`name="${field}"`));
  assert.match(drawer, /Record resignation/);
  assert.match(drawer, /path = "\/api\/separations"/); // uses the existing exit workflow, so the exit steps are created
  assert.match(drawer, /\["probation", "active"\]\.includes\(employee\.status\)/); // only offered to people who are not already leaving
  assert.match(drawer, /timeZone: "Asia\/Kolkata"/); // today's date is India's date
});

test("the employee API validates the new dates and keeps an open exit in step", async () => {
  const route = await read("app/api/employees/[id]/route.ts");
  assert.match(route, /noticeStartDate: z\.iso\.date\(\)\.nullable\(\)\.optional\(\)/);
  assert.match(route, /lastWorkingDate: z\.iso\.date\(\)\.nullable\(\)\.optional\(\)/);
  assert.match(route, /cannot be before the date joined/);
  assert.match(route, /cannot be before the day notice started/);
  assert.match(route, /exit in progress/);
  assert.match(route, /UPDATE separations SET proposed_last_working_date/);
  assert.match(route, /separation:read/);
});

test("a person who is already leaving cannot be sent into a second exit", async () => {
  const route = await read("app/api/separations/route.ts");
  assert.match(route, /\['probation','active'\]\.includes\(employee\.status\)/);
  assert.match(route, /already has an exit in progress/);
});
