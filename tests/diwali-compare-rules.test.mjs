import assert from "node:assert/strict";
import test from "node:test";
import { change, compareYears } from "../lib/diwali-compare-rules.ts";

const gift = (year, name, value, extra = {}) => ({ year, status: "handed_over", recipientType: "staff", employeeId: null, recipientName: name, company: "", giftItem: "Cash", quantity: 1, totalValue: value, ...extra });

test("each person gets one row with a cell per year, and totals per year", () => {
  const view = compareYears([gift(2024, "Sarita Devi", 20000), gift(2025, "SARITA  DEVI ", 21000), gift(2025, "Reena", 3100), gift(2026, "Sarita Devi", 23000, { status: "planned" })]);
  assert.deepEqual(view.years, [2024, 2025, 2026]);
  assert.equal(view.rows.length, 2);
  assert.equal(view.totals[2025], 24100);
  assert.equal(view.people[2024], 1);
  const sarita = view.rows.find(row => row.cells[2024]);
  assert.equal(change(sarita, 2025, 2026), 2000);
  assert.equal(change(view.rows.find(row => row.name === "Reena"), 2025, 2026), null);
});

test("linked people are matched by their staff record, and the same name from two places stays apart", () => {
  const view = compareYears([
    gift(2025, "Baljit Kaur", 5100, { company: "Workers (MULLANPUR)" }),
    gift(2025, "Baljit Kaur", 5100, { company: "Workers (KAILPUR)" }),
    gift(2025, "A. Kaur", 100, { employeeId: "e1", employeeStatus: "separated" }),
    gift(2026, "Anita Kaur", 200, { employeeId: "e1" }),
  ]);
  assert.equal(view.rows.length, 3);
  const linked = view.rows.find(row => row.key === "e1");
  assert.equal(linked.left, true);
  assert.equal(linked.cells[2025].value, 100);
  assert.equal(linked.cells[2026].value, 200);
});

test("two gifts to one person in a year are added together", () => {
  const view = compareYears([gift(2025, "Pawan", 500), gift(2025, "Pawan", 1000, { giftItem: "Bottle Set", quantity: 2 })]);
  assert.equal(view.rows[0].cells[2025].value, 1500);
  assert.deepEqual(view.rows[0].cells[2025].items, ["Cash", "2 × Bottle Set"]);
});
