import test from "node:test";
import assert from "node:assert/strict";
import { applySalaryInputs, cleanInput, NO_INPUT } from "../lib/payroll-input-rules.ts";

const facts = { expectedDays: 31, unpaidDays: 2, approvedOvertimeHours: 0, overtimeRate: 0, monthlyBasic: 9000, calendarDays: 31 };

test("no input changes nothing", () => {
  const r = applySalaryInputs(facts, NO_INPUT);
  assert.equal(r.payableDays, 29); assert.equal(r.unpaidDays, 2); assert.equal(r.paidLeaveApplied, 0);
});

test("paid leave turns unpaid days into paid days", () => {
  const r = applySalaryInputs(facts, { ...NO_INPUT, paidLeaveDays: 1 });
  assert.equal(r.payableDays, 30); assert.equal(r.unpaidDays, 1); assert.equal(r.paidLeaveApplied, 1);
});

test("paid leave can never be more than the unpaid days (Ritika: 30 paid + 1 leave = 31)", () => {
  const r = applySalaryInputs({ ...facts, unpaidDays: 1 }, { ...NO_INPUT, paidLeaveDays: 5 });
  assert.equal(r.payableDays, 31); assert.equal(r.paidLeaveApplied, 1);
});

test("a part-month person: 20 employed days, 5 unpaid, 2 paid leave -> 17 paid days (Ramandeep)", () => {
  const r = applySalaryInputs({ ...facts, expectedDays: 20, unpaidDays: 5 }, { ...NO_INPUT, paidLeaveDays: 2 });
  assert.equal(r.payableDays, 17);
});

test("half days of paid leave work", () => {
  const r = applySalaryInputs(facts, { ...NO_INPUT, paidLeaveDays: 0.5 });
  assert.equal(r.payableDays, 29.5);
});

test("no salary pays nothing, whatever else is typed", () => {
  const r = applySalaryInputs({ ...facts, approvedOvertimeHours: 4 }, { paidLeaveDays: 2, overtimeHours: 3, advanceDeducted: 500, noSalary: true });
  assert.equal(r.payableDays, 0); assert.equal(r.overtimeHours, 0); assert.equal(r.advanceFromInput, 0); assert.equal(r.paidLeaveApplied, 0); assert.equal(r.noSalary, true);
});

test("overtime adds to approved hours and uses basic / days / 8 when no rate is set", () => {
  const r = applySalaryInputs({ ...facts, approvedOvertimeHours: 2 }, { ...NO_INPUT, overtimeHours: 3 });
  assert.equal(r.overtimeHours, 5); assert.equal(r.overtimeRate, 36.29);
  assert.equal(applySalaryInputs({ ...facts, overtimeRate: 50 }, NO_INPUT).overtimeRate, 50);
});

test("cleanInput removes negatives, rounds leave to half days and reads text flags", () => {
  assert.deepEqual(cleanInput({ paidLeaveDays: "1.3", overtimeHours: -2, advanceDeducted: "500", noSalary: "true" }), { paidLeaveDays: 1.5, extraUnpaidDays: 0, overtimeHours: 0, advanceDeducted: 500, noSalary: true });
  assert.deepEqual(cleanInput({}), NO_INPUT);
  assert.equal(cleanInput({ paidLeaveDays: "abc" }).paidLeaveDays, 0);
});

test("extra unpaid days take days off on top of attendance (Aishwerya: 31 paid by attendance, sheet pays 28)", () => {
  const r = applySalaryInputs({ ...facts, unpaidDays: 0 }, { ...NO_INPUT, extraUnpaidDays: 3 });
  assert.equal(r.payableDays, 28); assert.equal(r.unpaidDays, 3); assert.equal(r.extraUnpaidApplied, 3);
});

test("extra unpaid days add to the attendance's unpaid days and work in half days", () => {
  const r = applySalaryInputs(facts, { ...NO_INPUT, extraUnpaidDays: 1.5 });
  assert.equal(r.unpaidDays, 3.5); assert.equal(r.payableDays, 27.5);
});

test("extra unpaid days can never take more than the days still paid", () => {
  const r = applySalaryInputs({ ...facts, expectedDays: 10, unpaidDays: 4 }, { ...NO_INPUT, extraUnpaidDays: 30 });
  assert.equal(r.payableDays, 0); assert.equal(r.extraUnpaidApplied, 6);
});

test("paid leave is applied first, then the extra unpaid days", () => {
  const r = applySalaryInputs(facts, { ...NO_INPUT, paidLeaveDays: 2, extraUnpaidDays: 1 });
  assert.equal(r.unpaidDays, 1); assert.equal(r.payableDays, 30);
});

test("cleanInput keeps extra unpaid days in half days and never negative", () => {
  assert.equal(cleanInput({ extraUnpaidDays: "2.3" }).extraUnpaidDays, 2.5);
  assert.equal(cleanInput({ extraUnpaidDays: -4 }).extraUnpaidDays, 0);
});
