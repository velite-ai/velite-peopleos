/*
 * The wording and layout of the Diwali PDF reports (list and gift-wise analysis). Pure: it takes figures that are already worked out.
 * Amounts are written "Rs 1,20,000" because the PDF font has no rupee sign.
 */
import type { PdfBlock } from "./table-pdf";

export const rs = (value: number) => `Rs ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(value))}`;
export const STATUS_TEXT: Record<string, string> = { planned: "Planned", bought: "Bought", handed_over: "Handed over" };

type ListGift = { recipientName: string; company: string; items: { item: string; quantity: number; unitValue: number }[]; giftValue: number; cashAmount: number; totalValue: number; status: string; employeeStatus?: string | null };
const itemsText = (gift: ListGift) => gift.items.map(line => `${line.quantity > 1 ? `${line.quantity} × ` : ""}${line.item}`).join(", ") || "Cash only";

export function listBlocks(year: number, gifts: ListGift[], filterText: string): PdfBlock[] {
  const sum = (pick: (gift: ListGift) => number) => gifts.reduce((total, gift) => total + pick(gift), 0);
  return [
    { kind: "title", text: `Diwali gifts ${year}`, sub: `${filterText} · ${gifts.length} people · Confidential` },
    {
      kind: "table",
      columns: [{ header: "#", weight: 0.5 }, { header: "Recipient", weight: 4 }, { header: "Gift items", weight: 4 }, { header: "Gifts value", weight: 1.4, align: "right" }, { header: "Cash", weight: 1.3, align: "right" }, { header: "Total", weight: 1.4, align: "right" }, { header: "Status", weight: 1.3 }],
      rows: gifts.map((gift, index) => [String(index + 1), `${gift.recipientName}${gift.employeeStatus === "separated" || gift.employeeStatus === "archived" ? " (has left)" : ""}${gift.company ? ` - ${gift.company}` : ""}`, itemsText(gift), gift.giftValue ? rs(gift.giftValue) : "-", gift.cashAmount ? rs(gift.cashAmount) : "-", rs(gift.totalValue), STATUS_TEXT[gift.status] || gift.status]),
      foot: ["", `Total (${gifts.length} people)`, "", rs(sum(gift => gift.giftValue)), rs(sum(gift => gift.cashAmount)), rs(sum(gift => gift.totalValue)), ""],
    },
  ];
}

type Bucket = { people: number; qty: number; value: number };
export type AnalysisInput = {
  year: number;
  status: { key: string; people: number; giftValue: number; cash: number; total: number }[];
  items: { item: string; planned: Bucket; handed: Bucket; people: number; qty: number; value: number; recipients: { name: string; status: string; qty: number; value: number }[] }[];
  firms?: { firm: string; people: number; handed: number; pending: number; giftValue: number; cash: number; total: number }[];
  companyName?: string;
  groups: { group: string; people: number; handed: number; pending: number; giftValue: number; cash: number; total: number }[];
  top: { recipientName: string; totalValue: number; status: string }[];
  change?: { beforeYear: number; now: { people: number; giftValue: number; cash: number; total: number }; before: { people: number; giftValue: number; cash: number; total: number } };
};

export function analysisBlocks(input: AnalysisInput): PdfBlock[] {
  const blocks: PdfBlock[] = [{ kind: "title", text: `Diwali gifts ${input.year} - analysis${input.companyName ? ` - ${input.companyName}` : ""}`, sub: "Planned = planned or bought, not yet handed over · Confidential" }];
  blocks.push({ kind: "heading", text: "1. By status" });
  blocks.push({ kind: "table", columns: [{ header: "Status", weight: 3 }, { header: "People", weight: 1, align: "right" }, { header: "Gifts value", weight: 2, align: "right" }, { header: "Cash", weight: 2, align: "right" }, { header: "Total", weight: 2, align: "right" }], rows: input.status.map(row => [STATUS_TEXT[row.key] || row.key, String(row.people), rs(row.giftValue), rs(row.cash), rs(row.total)]), foot: ["All", String(input.status.reduce((s, r) => s + r.people, 0)), rs(input.status.reduce((s, r) => s + r.giftValue, 0)), rs(input.status.reduce((s, r) => s + r.cash, 0)), rs(input.status.reduce((s, r) => s + r.total, 0))] });
  blocks.push({ kind: "heading", text: "2. Gift-wise: planned and handed over" });
  blocks.push({ kind: "table", columns: [{ header: "Gift", weight: 3 }, { header: "Planned: people", weight: 1.3, align: "right" }, { header: "Planned: pieces", weight: 1.3, align: "right" }, { header: "Handed over: people", weight: 1.5, align: "right" }, { header: "Handed over: pieces", weight: 1.5, align: "right" }, { header: "All: people", weight: 1.2, align: "right" }, { header: "All: pieces", weight: 1.2, align: "right" }, { header: "Value", weight: 1.6, align: "right" }], rows: input.items.map(row => [row.item, String(row.planned.people), String(row.planned.qty), String(row.handed.people), String(row.handed.qty), String(row.people), String(row.qty), row.value ? rs(row.value) : "-"]) });
  if (input.firms?.length) {
    blocks.push({ kind: "heading", text: "3. By company" });
    blocks.push({ kind: "table", columns: [{ header: "Company", weight: 3 }, { header: "People", weight: 1, align: "right" }, { header: "Handed over", weight: 1.3, align: "right" }, { header: "Still to hand over", weight: 1.5, align: "right" }, { header: "Gifts value", weight: 2, align: "right" }, { header: "Cash", weight: 2, align: "right" }, { header: "Total", weight: 2, align: "right" }], rows: input.firms.map(row => [row.firm, String(row.people), String(row.handed), String(row.pending), rs(row.giftValue), rs(row.cash), rs(row.total)]), foot: ["All", String(input.firms.reduce((s, r) => s + r.people, 0)), String(input.firms.reduce((s, r) => s + r.handed, 0)), String(input.firms.reduce((s, r) => s + r.pending, 0)), rs(input.firms.reduce((s, r) => s + r.giftValue, 0)), rs(input.firms.reduce((s, r) => s + r.cash, 0)), rs(input.firms.reduce((s, r) => s + r.total, 0))] });
  }
  blocks.push({ kind: "heading", text: input.firms?.length ? "4. By group" : "3. By group" });
  blocks.push({ kind: "table", columns: [{ header: "Group", weight: 3 }, { header: "People", weight: 1, align: "right" }, { header: "Handed over", weight: 1.3, align: "right" }, { header: "Still to hand over", weight: 1.5, align: "right" }, { header: "Gifts value", weight: 2, align: "right" }, { header: "Cash", weight: 2, align: "right" }, { header: "Total", weight: 2, align: "right" }], rows: input.groups.map(row => [row.group, String(row.people), String(row.handed), String(row.pending), rs(row.giftValue), rs(row.cash), rs(row.total)]) });
  if (input.change) {
    const { now, before, beforeYear } = input.change;
    blocks.push({ kind: "heading", text: `${input.firms?.length ? 5 : 4}. Compared with ${beforeYear}` });
    blocks.push({ kind: "table", columns: [{ header: "", weight: 3 }, { header: String(beforeYear), weight: 2, align: "right" }, { header: String(input.year), weight: 2, align: "right" }, { header: "Change", weight: 2, align: "right" }], rows: [["People", String(before.people), String(now.people), String(now.people - before.people)], ["Gifts value", rs(before.giftValue), rs(now.giftValue), rs(now.giftValue - before.giftValue)], ["Cash", rs(before.cash), rs(now.cash), rs(now.cash - before.cash)], ["Total", rs(before.total), rs(now.total), rs(now.total - before.total)]] });
  }
  if (input.top.length) {
    blocks.push({ kind: "heading", text: "Highest total value" });
    blocks.push({ kind: "table", columns: [{ header: "#", weight: 0.5 }, { header: "Recipient", weight: 5 }, { header: "Total", weight: 2, align: "right" }, { header: "Status", weight: 2 }], rows: input.top.map((row, index) => [String(index + 1), row.recipientName, rs(row.totalValue), STATUS_TEXT[row.status] || row.status]) });
  }
  blocks.push({ kind: "heading", text: "Who gets which gift" });
  for (const row of input.items) {
    blocks.push({ kind: "text", text: `${row.item}: ${row.people} people, ${row.qty} ${row.item === "Cash" ? "payments" : "pieces"} (planned ${row.planned.people}, handed over ${row.handed.people})` });
    blocks.push({ kind: "table", columns: [{ header: "Recipient", weight: 6 }, { header: "Status", weight: 2 }, { header: row.item === "Cash" ? "Amount" : "Pieces", weight: 1.5, align: "right" }, { header: "Value", weight: 2, align: "right" }], rows: row.recipients.map(person => [person.name, STATUS_TEXT[person.status] || person.status, row.item === "Cash" ? "-" : String(person.qty), person.value ? rs(person.value) : "-"]) });
  }
  return blocks;
}
