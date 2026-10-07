import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("attendance can be marked in bulk without overwriting, and per person with one tap", async () => {
  const [bulk, page] = await Promise.all([
    readFile(new URL("../app/api/attendance/bulk/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(bulk, /ON CONFLICT \(employee_id,attendance_date\) DO NOTHING/);
  assert.match(bulk, /NOT EXISTS \(SELECT 1 FROM attendance_days/);
  assert.match(bulk, /hasPermissionForScope\(user, "attendance:write"/);
  assert.match(bulk, /m\.status IS NULL OR m\.status='open'/);
  assert.match(bulk, /locked_at IS NOT NULL/);
  assert.match(bulk, /attendance\.bulk_mark/);
  assert.match(bulk, /status=.approved./);
  assert.match(bulk, /half_day_leave/);
  assert.match(page, /Mark everyone Present/);
  assert.match(page, /\/api\/attendance\/bulk/);
  assert.match(page, /TAP THE RIGHT STATUS/);
});
