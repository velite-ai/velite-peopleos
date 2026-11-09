import test from "node:test";
import assert from "node:assert/strict";
import { bandsFor, computePaidDays, monthCalendar } from "../lib/paid-days-rules.ts";

const OCT = ["2026-10-02", "2026-10-20"];
const base = { year: 2026, month: 10, joinDate: "2025-01-01", lastWorkingDate: null, presentDays: 0, paidLeaveMarked: 0, paidLeaveInput: 0, holidays: OCT, noSalary: false };
const days = overrides => computePaidDays({ ...base, ...overrides });

test("October 2026: 31 days, 4 Sundays, 2 holidays, 25 working days", () => {
  const c = monthCalendar(2026, 10, OCT);
  assert.equal(c.calendarDays, 31); assert.deepEqual(c.sundays, ["2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25"]);
  assert.equal(c.holidays.length, 2); assert.equal(c.workingDays, 25);
});

test("the October table", () => {
  const bands = bandsFor(monthCalendar(2026, 10, OCT));
  assert.deepEqual(bands.map(b => [b.from, b.sundays, b.holidays]), [[22, 4, 2], [17.5, 3, 2], [13.5, 2, 1], [10, 1, 0], [8, 0, 0]]);
});

test("full-month staff by band (Amardeep 22 -> 28, Gurdeep 17 -> 20, Giraj 24 -> 30)", () => {
  assert.equal(days({ presentDays: 22 }).payableDays, 28);
  assert.equal(days({ presentDays: 17 }).payableDays, 20);
  assert.equal(days({ presentDays: 24 }).payableDays, 30);
  assert.equal(days({ presentDays: 25 }).payableDays, 31);
  assert.equal(days({ presentDays: 21.5 }).payableDays, 26.5);
  assert.equal(days({ presentDays: 13 }).payableDays, 14);
  assert.equal(days({ presentDays: 9.5 }).payableDays, 9.5);
  assert.equal(days({ presentDays: 5 }).payableDays, 5);
});

test("paid leave is added on top and not counted as present (Ritika: 24 present + 4 + 2 + 1 leave = 31)", () => {
  assert.equal(days({ presentDays: 24, paidLeaveInput: 1 }).payableDays, 31);
  assert.equal(days({ presentDays: 24, paidLeaveMarked: 1 }).payableDays, 31);
});

test("paid leave can never push a person over the days employed", () => {
  assert.equal(days({ presentDays: 25, paidLeaveInput: 4 }).payableDays, 31);
  assert.equal(days({ presentDays: 25, paidLeaveInput: 4 }).paidLeave, 0);
});

test("left during the month: working days only (Nirmala 20, Harpreet 14, Sahil 19)", () => {
  assert.equal(days({ presentDays: 20, lastWorkingDate: "2026-10-27" }).payableDays, 20);
  assert.equal(days({ presentDays: 14, lastWorkingDate: "2026-10-17" }).payableDays, 14);
  assert.equal(days({ presentDays: 19, lastWorkingDate: "2026-10-26" }).payableDays, 19);
  assert.equal(days({ presentDays: 20, lastWorkingDate: "2026-10-27" }).eligible, false);
});

test("a last working day on the 31st is a full month", () => {
  const r = days({ presentDays: 24, lastWorkingDate: "2026-10-31" });
  assert.equal(r.eligible, true); assert.equal(r.payableDays, 30);
});

test("joined after the 7th: working days only (Ramandeep joined 12 Oct: 15 present + 2 leave = 17)", () => {
  const r = days({ presentDays: 15, joinDate: "2026-10-12", paidLeaveInput: 2 });
  assert.equal(r.eligible, false); assert.equal(r.payableDays, 17); assert.equal(r.employedDays, 20);
  assert.equal(days({ presentDays: 14, joinDate: "2026-10-10" }).payableDays, 14);
  assert.equal(days({ presentDays: 8, joinDate: "2026-10-22" }).payableDays, 8);
});

test("joined on the 7th counts as the first week; holidays before joining do not count (Tamanna: 19 + 3 + 1 = 23)", () => {
  const r = days({ presentDays: 19, joinDate: "2026-10-07" });
  assert.equal(r.eligible, true); assert.equal(r.sundaysGranted, 3); assert.equal(r.holidaysGranted, 1); assert.equal(r.payableDays, 23);
  assert.equal(days({ presentDays: 19, joinDate: "2026-10-08" }).eligible, false);
});

test("no salary pays nothing", () => {
  const r = days({ presentDays: 25, noSalary: true });
  assert.equal(r.payableDays, 0); assert.equal(r.sundaysGranted, 0);
});

test("a person who joined before the month is eligible", () => {
  assert.equal(days({ presentDays: 22, joinDate: "2026-09-21" }).eligible, true);
});

test("the table scales to another month: November 2026 has 5 Sundays and (say) 1 holiday", () => {
  const c = monthCalendar(2026, 11, ["2026-11-09"]);
  assert.equal(c.calendarDays, 30); assert.equal(c.sundays.length, 5); assert.equal(c.workingDays, 24);
  const bands = bandsFor(c);
  assert.deepEqual(bands.map(b => b.from), [21, 17, 13, 9.5, 7.5]);
  assert.deepEqual(bands.map(b => [b.sundays, b.holidays]), [[5, 1], [4, 1], [3, 0], [2, 0], [0, 0]]);
  const r = computePaidDays({ ...base, year: 2026, month: 11, holidays: ["2026-11-09"], presentDays: 21 });
  assert.equal(r.payableDays, 27);
});

test("a holiday that falls on a Sunday is counted once, as a Sunday", () => {
  const c = monthCalendar(2026, 10, ["2026-10-04", "2026-10-20"]);
  assert.equal(c.holidays.length, 1); assert.equal(c.workingDays, 26);
});
