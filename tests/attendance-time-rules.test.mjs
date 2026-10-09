import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { defaultWorkedMinutes, earlyMinutes, formatClock, isTimeStatus, istMinutes, istMoment, lateMinutes, parseClock } from "../lib/attendance-time-rules.ts";

const at = clock => parseClock(clock);

test("arrival is late only after the 15-minute grace, counted from 09:00", () => {
  assert.equal(lateMinutes(at("08:45")), 0);
  assert.equal(lateMinutes(at("09:00")), 0);
  assert.equal(lateMinutes(at("09:15")), 0);
  assert.equal(lateMinutes(at("09:16")), 16);
  assert.equal(lateMinutes(at("09:25")), 25);
  assert.equal(lateMinutes(at("11:00")), 120);
});

test("leaving is early only before 17:45, counted back from 18:00", () => {
  assert.equal(earlyMinutes(at("18:00")), 0);
  assert.equal(earlyMinutes(at("19:30")), 0);
  assert.equal(earlyMinutes(at("17:45")), 0);
  assert.equal(earlyMinutes(at("17:44")), 16);
  assert.equal(earlyMinutes(at("17:00")), 60);
  assert.equal(earlyMinutes(at("13:00")), 300);
});

test("clock text is read strictly", () => {
  assert.equal(parseClock("09:05"), 545);
  assert.equal(parseClock("23:59"), 1439);
  for (const bad of ["9:05", "24:00", "09:60", "09:5", "", null, undefined, "ab:cd", "09:05:00"]) assert.equal(parseClock(bad), null, String(bad));
  assert.equal(formatClock(545), "09:05");
});

test("India wall-clock times convert exactly, in both directions", () => {
  const moment = istMoment("2026-10-09", at("09:45"));
  assert.equal(moment.toISOString(), "2026-10-09T04:15:00.000Z");
  assert.equal(istMinutes(moment), at("09:45"));
  assert.equal(istMinutes(istMoment("2026-10-09", at("00:10"))), at("00:10"));
  assert.equal(istMinutes(istMoment("2026-10-09", at("23:50"))), at("23:50"));
});

test("times apply only to days the person worked", () => {
  for (const status of ["present", "half_day", "work_from_home", "on_duty"]) assert.equal(isTimeStatus(status), true, status);
  for (const status of ["absent", "paid_leave", "unpaid_leave", "weekly_off", "holiday", "not_employed", "missing"]) assert.equal(isTimeStatus(status), false, status);
  assert.equal(defaultWorkedMinutes("present"), 480);
  assert.equal(defaultWorkedMinutes("half_day"), 240);
  assert.equal(defaultWorkedMinutes("absent"), 0);
});

test("the screens and routes use the shared rules", async () => {
  const [route, page, summary] = await Promise.all([
    readFile(new URL("../app/api/attendance/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/attendance/months/summary/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /from "@\/lib\/attendance-time-rules"/);
  assert.match(route, /The leaving time must be after the arrival time/);
  assert.match(page, /function TimeEntryModal/);
  assert.match(page, /Time came and left/);
  assert.doesNotMatch(page, /workedMinutes:attMinutes/);
  assert.match(summary, /late_days/);
  assert.match(summary, /early_minutes/);
});
