import assert from "node:assert/strict";
import test from "node:test";
import { CASH_KEY, filterGifts, groupSummary, itemSummary, statusSummary, topRecipients, totalsOf, yearChange } from "../lib/diwali-analysis-rules.ts";

const g = (id, name, status, items, cash = 0, extra = {}) => {
  const giftValue = items.reduce((sum, line) => sum + line.quantity * line.unitValue, 0);
  return { id, status, recipientName: name, company: "", group: "Parties", items, giftValue, cashAmount: cash, totalValue: giftValue + cash, ...extra };
};
const blanket = (qty = 1, unitValue = 500) => ({ item: "Blanket", quantity: qty, unitValue });
const dry = (qty = 1, unitValue = 300) => ({ item: "Dry Fruit", quantity: qty, unitValue });
const data = [
  g("1", "A", "handed_over", [blanket(2)], 1000),
  g("2", "B", "planned", [blanket(1), dry(1)]),
  g("3", "C", "handed_over", [dry(3)]),
  g("4", "D", "planned", [], 500, { group: "Workers" }),
  g("5", "E", "bought", [{ item: " blanket ", quantity: 1, unitValue: 500 }]),
];

test("totals and status split add up: gifts value, cash and total", () => {
  assert.deepEqual(totalsOf(data), { people: 5, giftValue: 1000 + 800 + 900 + 0 + 500, cash: 1500, total: 3200 + 1500 - 0 });
  const status = statusSummary(data);
  assert.equal(status.handed_over.people, 2);
  assert.equal(status.planned.total, 800 + 500);
  assert.equal(status.bought.giftValue, 500);
});

test("item-wise summary separates planned from handed over and counts pieces and value", () => {
  const rows = itemSummary(data);
  const b = rows.find(row => row.item === "Blanket");
  assert.deepEqual([b.people, b.qty, b.value], [3, 4, 2000]);
  assert.deepEqual([b.handed.people, b.handed.qty, b.handed.value], [1, 2, 1000]);
  assert.deepEqual([b.planned.people, b.planned.qty], [2, 2]);
  assert.deepEqual(b.recipients.map(r => r.name), ["A", "B", "E"]);
  const d = rows.find(row => row.item === "Dry Fruit");
  assert.deepEqual([d.people, d.qty, d.handed.qty], [2, 4, 3]);
  const cash = rows[rows.length - 1];
  assert.equal(cash.key, CASH_KEY);
  assert.deepEqual([cash.people, cash.value, cash.handed.value, cash.planned.value], [2, 1500, 1000, 500]);
});

test("filters by status, gift name, group and search", () => {
  const f = (over) => filterGifts(data, { status: "all", item: "all", group: "all", search: "", ...over }).map(x => x.id);
  assert.deepEqual(f({ status: "planned" }), ["2", "4"]);
  assert.deepEqual(f({ item: "blanket" }), ["1", "2", "5"]);
  assert.deepEqual(f({ item: CASH_KEY }), ["1", "4"]);
  assert.deepEqual(f({ group: "Workers" }), ["4"]);
  assert.deepEqual(f({ search: "dry" }), ["2", "3"]);
});

test("group summary, top recipients and the change from last year", () => {
  const groups = groupSummary(data);
  assert.deepEqual(groups.map(x => [x.group, x.people, x.handed, x.pending]), [["Parties", 4, 2, 2], ["Workers", 1, 0, 1]]);
  assert.deepEqual(topRecipients(data, 2).map(x => x.recipientName), ["A", "C"]);
  const change = yearChange(data, data.slice(0, 2));
  assert.equal(change.diff.people, 3);
  assert.equal(change.before.people, 2);
});
