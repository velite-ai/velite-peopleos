import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("a month under review can be returned to open, and nothing is skipped silently", async () => {
  const [months, bulk, single, page] = await Promise.all([
    readFile(new URL("../app/api/attendance/months/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/attendance/bulk/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/attendance/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(months, /\["review", "locked"\]\.includes\(existing\.status\)/);
  assert.match(months, /if \(wasLocked\) await tx`UPDATE attendance_days/);
  assert.match(months, /role\.code === "SUPER_ADMIN" \|\| role\.code === "HR_ADMIN"/);
  assert.match(bulk, /month_status/);
  assert.match(bulk, /blocked/);
  assert.doesNotMatch(bulk, /m\.status='open'\)/);
  assert.match(single, /Return month to open/);
  assert.match(page, /Return month to open/);
  assert.match(page, /NOBODY can mark or change attendance/);
  assert.match(page, /NOT marked because the month is not open/);
});
