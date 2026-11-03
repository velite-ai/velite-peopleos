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

test("a copy that starts at column B (name first) reads the same as one that starts at column A", () => {
  const fromB = [
    line(["SHIWANI YADAV", "LUDHIANA", "Dry Fruit (1000)", "26000", "", "Dinner Set+Dry Fruit (400g) + Biscuit ", "30000"]),
    line(["BINDIYA", "LUDHIANA", "Dry Fruit (1000)", "1100", "", "Dinner Set+Dry Fruit (400g) + Biscuit ", ""]),
    line(["Hemant", "", "", "", "", "Dinner Set+Dry Fruit (400g) + Biscuit ", "2100"]),
    line(["", "", "", "", "", "", "216500"]),
  ].join("\n");
  const rows = parseSheet(fromB);
  assert.deepEqual(rows.map(row => [row.name, row.cash]), [["SHIWANI YADAV", 30000], ["BINDIYA", 0], ["Hemant", 2100]]);
  assert.equal(rows[1].gift, "Dinner Set+Dry Fruit (400g) + Biscuit");
});

test("column M is next year's planned gift; a planned gift with no cash is kept, a zero with no gift is not", () => {
  const row = (name, cash25, cash26, gift26) => line(["SR. NO. 1", name, "HAMBRAN", "Suit", "100", "", "Casserole Set", cash25, "", "", "", cash26, gift26]);
  const text = [row("SARITA DEVI", "21000", "23000", "Blanket"), row("PARMINDER KAUR", "", "", "Blanket"), row("KULWANT KAUR", "3100", "0", ""), row("PRIYA", "", "0", "")].join("\n");
  const gifts = buildGifts(parseSheet(text), 2025, "Workers", []).filter(gift => gift.year === 2026);
  assert.deepEqual(gifts.map(gift => [gift.recipientName, gift.giftItem, gift.unitValue]), [["SARITA DEVI", "Blanket + Cash", 23000], ["PARMINDER KAUR", "Blanket", 0]]);
  assert.equal(gifts[0].status, "planned");
});

test("a parties list keeps the party and gift, takes the status from the third column and leaves out 'no gift'", async () => {
  const { parseParties, buildPartyGifts } = await import("../lib/diwali-import-rules.ts");
  const text = ["Party name\tGift\tStatus\tNotes", "N K AGENCY, HANUMANGARH\tCOMFORTER SET\tHanded over\tBOX NO:- 14", "NEO NEEDS, BANGLORE\tDRY FRUIT\tPlanned\t", "KMR PHARMA, NELLORE\tNO GIFT\tHanded over\tNO GIFT", "WINGS PHARMA, ALIGARH\t\tPlanned\t", "GLOW PHARMA, JAIPUR\tdry fruit\t\t"].join("\n");
  const { rows, skipped } = parseParties(text);
  assert.deepEqual(rows.map(row => [row.name, row.gift, row.status]), [["N K AGENCY, HANUMANGARH", "Comforter Set", "handed_over"], ["NEO NEEDS, BANGLORE", "Dry Fruit", "planned"], ["GLOW PHARMA, JAIPUR", "Dry Fruit", "planned"]]);
  assert.deepEqual(skipped, ["KMR PHARMA, NELLORE", "WINGS PHARMA, ALIGARH"]);
  const gifts = buildPartyGifts(rows, 2026, "Parties");
  assert.equal(gifts[0].recipientType, "other");
  assert.equal(gifts[0].year, 2026);
  assert.equal(gifts[0].group, "Parties");
  assert.equal(gifts[0].cash, 0);
});

test("a parties list pasted with | signs instead of tabs reads the same", async () => {
  const { parseParties } = await import("../lib/diwali-import-rules.ts");
  const { rows, skipped } = parseParties("Party name | Gift | Status | Notes\nN K AGENCY, HANUMANGARH | COMFORTER SET | Handed over | BOX NO:- 14\nNEO NEEDS, BANGLORE | NO GIFT | Planned |");
  assert.deepEqual(rows.map(row => [row.name, row.gift, row.status, row.note]), [["N K AGENCY, HANUMANGARH", "Comforter Set", "handed_over", "BOX NO:- 14"]]);
  assert.deepEqual(skipped, ["NEO NEEDS, BANGLORE"]);
});

test("a party's gift can be several items with quantities", async () => {
  const { partyItems, parseParties, buildPartyGifts } = await import("../lib/diwali-import-rules.ts");
  assert.deepEqual(partyItems("2 Comforter + 2 Dry Fruit Box"), [{ item: "Comforter", quantity: 2, unitValue: 0 }, { item: "Dry Fruit Box", quantity: 2, unitValue: 0 }]);
  assert.deepEqual(partyItems("Dry Fruit"), [{ item: "Dry Fruit", quantity: 1, unitValue: 0 }]);
  const { rows } = parseParties("RA-VASH WELLNESS PVT. LTD | 2 comforter + 2 dry fruit box | Handed over | ");
  const [gift] = buildPartyGifts(rows, 2026, "Parties");
  assert.equal(gift.items.length, 2);
  assert.equal(gift.items[0].quantity, 2);
});
