import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("month summary shows every person's days, the unmarked days, and can be downloaded", async () => {
  const [route, page] = await Promise.all([
    readFile(new URL("../app/api/attendance/months/summary/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /requireApiUser\("attendance:read"/);
  assert.match(route, /missing_days/);
  assert.match(route, /coming_days/);
  assert.match(route, /Asia\/Kolkata/);
  assert.match(route, /e\.status NOT IN \('candidate','preboarding','archived'\)/);
  assert.match(page, /function MonthSummaryModal/);
  assert.match(page, /\/api\/attendance\/months\/summary/);
  assert.match(page, /Only people with missing days/);
  assert.match(page, /Download this list/);
});
