import assert from "node:assert/strict";
import test from "node:test";
import { buildGifts, matchPerson, parseSheet, planNextYear } from "../lib/diwali-import-rules.ts";

const line = cells => cells.join("\t");
const sheet = [
  line(["", "NAME", "VILLAGE", "Gift", "Cash", "", "2025", "", "Bonus/LWW", "", "", "2026"]),
  line(["SR. NO. 1", "SARITA DEVI", "HAMBRAN", "Suit (500)+Ladoo", "21000", "TT", "Casserole Set + Sweet Box", "21000", "10895+7500", "18395", "", "24000"]),
  line(["SR. NO. 3", "PARMINDER KAUR", "MULLANPUR", "Suit (500)+Ladoo", "3100", "", "", "", "", "", "", ""]),
  line(["SR. NO. 2", "BALVEER KAUR (H)", "HAMBRAN", "x", "5100", "Cash", "Casserole Set", "5100", "", "", "", ""]),
  line(["", "Pooja", "", "", "", "", "", "500", "Returned", "", "", ""]),
  line(["", "", "", "", "", "", "", "161300", "", "", "", ""]),
].join("\n");

test("only the 2025 gift, 2025 cash and 2026 cash columns are read", () => {
  const rows = parseSheet(sheet);
  assert.deepEqual(rows.map(row => row.name), ["SARITA DEVI", "BALVEER KAUR", "Pooja"]);
  assert.equal(rows[0].gift, "Casserole Set + Sweet Box");
  assert.equal(rows[0].cash, 21000);
  assert.equal(rows[0].nextCash, 24000);
  assert.equal(rows[2].cash, 500);
  assert.match(rows[1].note, /BALVEER KAUR \(H\)/);
});

const people = [
  { id: "1", name: "SARITA  DEVI ", status: "active", company: "Healthcare" },
  { id: "2", name: "Balveer Kaur", status: "separated", company: "Healthcare" },
  { id: "3", name: "Reena Rani", status: "active", company: "Pharma" },
  { id: "4", name: "Baljit Kaur", status: "separated", company: "A" },
  { id: "5", name: "Baljit Kaur", status: "active", company: "B" },
  { id: "6", name: "Sunil Happy Singh", status: "active", company: "A" },
];

test("names are matched on the full name only", () => {
  assert.equal(matchPerson("Sarita Devi", people).person.id, "1");
  assert.equal(matchPerson("BALJIT KAUR", people).person.id, "5");
  assert.equal(matchPerson("Reena", people).person, null);
  assert.equal(matchPerson("Sunil Happy", people).match, "partial");
  assert.equal(matchPerson("Nobody Here", people).match, "none");
  assert.equal(matchPerson("Baljit Kaur", [people[3], { ...people[3], id: "9" }]).match, "unclear");
});

test("gift rows are built for the year and the planned cash for the next year", () => {
  const gifts = buildGifts(parseSheet(sheet), 2025, "Workers", people);
  const sarita = gifts.filter(gift => gift.recipientName === "SARITA DEVI".replace("  ", " ") || gift.employeeId === "1");
  assert.equal(sarita.length, 2);
  assert.equal(sarita[0].giftItem, "Casserole Set + Sweet Box + Cash");
  assert.equal(sarita[0].unitValue, 21000);
  assert.equal(sarita[0].status, "handed_over");
  assert.equal(sarita[1].year, 2026);
  assert.equal(sarita[1].status, "planned");
  const pooja = gifts.find(gift => gift.recipientName === "Pooja");
  assert.equal(pooja.giftItem, "Cash");
  assert.equal(pooja.employeeId, null);
});

test("planning skips people who have left and people already planned", () => {
  const last = [
    { recipientName: "A", employeeId: "1", recipientType: "staff", giftItem: "x", employeeStatus: "active" },
    { recipientName: "B", employeeId: "2", recipientType: "staff", giftItem: "x", employeeStatus: "separated" },
    { recipientName: "C", employeeId: "3", recipientType: "staff", giftItem: "x", employeeStatus: "active" },
    { recipientName: "Bus Driver", employeeId: null, recipientType: "other", giftItem: "x" },
  ];
  const plan = planNextYear(last, [{ recipientName: "C", employeeId: "3" }]);
  assert.deepEqual(plan.copy.map(g => g.recipientName), ["A", "Bus Driver"]);
  assert.equal(plan.left.length, 1);
  assert.equal(plan.already.length, 1);
});
