import assert from "node:assert/strict";
import test from "node:test";
import { buildTablePdf, wrapText } from "../lib/table-pdf.ts";

const text = bytes => Buffer.from(bytes).toString("latin1");

test("a table report becomes a real PDF with the title, rows, totals and page numbers", () => {
  const rows = Array.from({ length: 120 }, (_, i) => [`Party ${i + 1}`, "Blanket, 2 x Dry Fruit", "₹1,000"]);
  const pdf = buildTablePdf([
    { kind: "title", text: "Diwali gifts 2026", sub: "Handed over · all groups" },
    { kind: "table", columns: [{ header: "Name", weight: 3 }, { header: "Gift", weight: 4 }, { header: "Value", weight: 1, align: "right" }], rows, foot: ["Total", "", "₹1,20,000"] },
  ], "Diwali gifts 2026");
  const out = text(pdf);
  assert.ok(out.startsWith("%PDF-1.4"));
  assert.ok(out.trimEnd().endsWith("%%EOF"));
  assert.match(out, /Diwali gifts 2026/);
  assert.match(out, /Party 120/);
  const pages = (out.match(/\/Type \/Page /g) || []).length;
  assert.ok(pages >= 3, `expected several pages, got ${pages}`);
  assert.match(out, new RegExp(`page ${pages} of ${pages}`));
  assert.equal((out.match(/\(Name\)/g) || []).length, pages, "the header row is repeated on every page");
  assert.match(out, /\(Total\)/);
});

test("long text wraps inside the cell and very long words are cut", () => {
  const lines = wrapText("SHANVI MEDICO, TIKAMGARH/ ANSHIKA MEDICAL AND SURGICAL AGENCY", 90);
  assert.ok(lines.length >= 3);
  assert.ok(wrapText("x".repeat(200), 60).every(part => part.length < 200));
});

test("the Diwali list and analysis reports turn into a PDF", async () => {
  const { listBlocks, analysisBlocks, rs } = await import("../lib/diwali-report.ts");
  assert.equal(rs(120000), "Rs 1,20,000");
  const gift = { recipientName: "N K AGENCY", company: "Franchisee / party", items: [{ item: "Comforter Set", quantity: 2, unitValue: 500 }], giftValue: 1000, cashAmount: 500, totalValue: 1500, status: "handed_over" };
  const list = text(buildTablePdf(listBlocks(2026, [gift], "Handed over"), "Diwali gifts 2026"));
  assert.match(list, /N K AGENCY/);
  assert.match(list, /Rs 1,500/);
  const bucket = (people, qty, value) => ({ people, qty, value });
  const report = text(buildTablePdf(analysisBlocks({
    year: 2026,
    status: [{ key: "planned", people: 1, giftValue: 0, cash: 0, total: 0 }, { key: "handed_over", people: 1, giftValue: 1000, cash: 500, total: 1500 }],
    items: [{ item: "Comforter Set", planned: bucket(0, 0, 0), handed: bucket(1, 2, 1000), people: 1, qty: 2, value: 1000, recipients: [{ name: "N K AGENCY", status: "handed_over", qty: 2, value: 1000 }] }],
    groups: [{ group: "Parties", people: 2, handed: 1, pending: 1, giftValue: 1000, cash: 500, total: 1500 }],
    top: [{ recipientName: "N K AGENCY", totalValue: 1500, status: "handed_over" }],
    change: { beforeYear: 2025, now: { people: 2, giftValue: 1000, cash: 500, total: 1500 }, before: { people: 1, giftValue: 0, cash: 100, total: 100 } },
  }), "Diwali gifts 2026 - analysis"));
  assert.match(report, /Who gets which gift/);
  assert.match(report, /Comforter Set: 1 people, 2 pieces/);
  assert.match(report, /Compared with 2025/);
});
