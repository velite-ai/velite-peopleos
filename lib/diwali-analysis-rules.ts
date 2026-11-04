/*
 * Totals and breakdowns for one year of the Diwali register: by status, by gift, by group, top recipients.
 * No imports, so it can be unit tested on its own and used by the screen and the PDF.
 */

export type AnalysisGift = {
  id: string; status: string; recipientType?: string; recipientName: string; company: string; group?: string | null; firm?: string | null;
  items: { item: string; quantity: number; unitValue: number }[]; giftValue: number; cashAmount: number; totalValue: number; employeeStatus?: string | null;
};
export const STATUS_ORDER = ["planned", "bought", "handed_over"] as const;
export const NO_GIFT_KEY = "__no_items";
export const CASH_KEY = "__cash";

const squash = (value: string) => value.replace(/\s+/g, " ").trim();
export const itemKey = (value: string) => squash(value).toLowerCase();
export const groupLabel = (gift: Pick<AnalysisGift, "group" | "company">) => {
  if (gift.group) return gift.group;
  const match = /^(workers|office)\b/i.exec(gift.company.trim());
  return match ? match[1][0].toUpperCase() + match[1].slice(1).toLowerCase() : "Not labelled";
};

export const NO_FIRM = "Company not set";
// The Velite company that gives the gift: the one chosen on the gift, else a staff member's own company.
export const firmLabel = (gift: Pick<AnalysisGift, "firm" | "recipientType" | "company">) => (gift.firm && gift.firm.trim()) || (gift.recipientType === "staff" && gift.company.trim() ? gift.company.trim() : NO_FIRM);

export const totalsOf = (gifts: AnalysisGift[]) => ({
  people: gifts.length,
  giftValue: gifts.reduce((sum, gift) => sum + gift.giftValue, 0),
  cash: gifts.reduce((sum, gift) => sum + gift.cashAmount, 0),
  total: gifts.reduce((sum, gift) => sum + gift.totalValue, 0),
});

// "Planned" here means not handed over yet (planned or bought).
export const isDone = (gift: Pick<AnalysisGift, "status">) => gift.status === "handed_over";

export function statusSummary(gifts: AnalysisGift[]) {
  return Object.fromEntries(STATUS_ORDER.map(status => [status, totalsOf(gifts.filter(gift => gift.status === status))])) as Record<(typeof STATUS_ORDER)[number], ReturnType<typeof totalsOf>>;
}

type Bucket = { people: number; qty: number; value: number };
const empty = (): Bucket => ({ people: 0, qty: 0, value: 0 });
export type ItemRow = {
  key: string; item: string; planned: Bucket; handed: Bucket; people: number; qty: number; value: number;
  recipients: { name: string; status: string; qty: number; value: number }[];
};

// One row per gift name: who is to get it, who has got it, how many pieces, what they are worth.
// "Planned" counts planned and bought. Cash is its own row, and a person with no gift items and no cash is not counted.
export function itemSummary(gifts: AnalysisGift[]): ItemRow[] {
  const rows = new Map<string, ItemRow>();
  const touch = (key: string, name: string) => { let row = rows.get(key); if (!row) { row = { key, item: name, planned: empty(), handed: empty(), people: 0, qty: 0, value: 0, recipients: [] }; rows.set(key, row); } return row; };
  const add = (row: ItemRow, gift: AnalysisGift, qty: number, value: number) => {
    const bucket = isDone(gift) ? row.handed : row.planned;
    bucket.people += 1; bucket.qty += qty; bucket.value += value;
    row.people += 1; row.qty += qty; row.value += value;
    row.recipients.push({ name: gift.recipientName, status: gift.status, qty, value });
  };
  for (const gift of gifts) {
    const perItem = new Map<string, { name: string; qty: number; value: number }>();
    for (const line of gift.items) {
      const key = itemKey(line.item); if (!key) continue;
      const current = perItem.get(key) || { name: squash(line.item), qty: 0, value: 0 };
      current.qty += line.quantity; current.value += line.quantity * line.unitValue; perItem.set(key, current);
    }
    for (const [key, entry] of perItem) add(touch(key, entry.name), gift, entry.qty, entry.value);
    if (gift.cashAmount > 0) add(touch(CASH_KEY, "Cash"), gift, 1, gift.cashAmount);
  }
  return [...rows.values()].sort((a, b) => (a.key === CASH_KEY ? 1 : b.key === CASH_KEY ? -1 : b.people - a.people || a.item.localeCompare(b.item)));
}

export function groupSummary(gifts: AnalysisGift[]) {
  const groups = [...new Set(gifts.map(groupLabel))].sort();
  return groups.map(group => {
    const own = gifts.filter(gift => groupLabel(gift) === group);
    return { group, ...totalsOf(own), handed: own.filter(isDone).length, pending: own.filter(gift => !isDone(gift)).length };
  });
}

export const topRecipients = (gifts: AnalysisGift[], count = 10) => [...gifts].sort((a, b) => b.totalValue - a.totalValue || a.recipientName.localeCompare(b.recipientName)).slice(0, count);

export type Filters = { status: string; item: string; group: string; search: string; firm?: string };
export function filterGifts(gifts: AnalysisGift[], filters: Filters) {
  const needle = filters.search.trim().toLowerCase();
  return gifts.filter(gift => {
    if (filters.status !== "all" && gift.status !== filters.status) return false;
    if (filters.group !== "all" && groupLabel(gift) !== filters.group) return false;
    if (filters.firm && filters.firm !== "all" && firmLabel(gift) !== filters.firm) return false;
    if (filters.item !== "all") {
      const has = filters.item === CASH_KEY ? gift.cashAmount > 0 : filters.item === NO_GIFT_KEY ? gift.items.length === 0 : gift.items.some(line => itemKey(line.item) === filters.item);
      if (!has) return false;
    }
    return !needle || `${gift.recipientName} ${gift.company} ${gift.items.map(line => line.item).join(" ")}`.toLowerCase().includes(needle);
  });
}

export const itemOptions = (gifts: AnalysisGift[]) => itemSummary(gifts).map(row => ({ key: row.key, label: row.item }));

// Compare this year with the year before: people, gifts value, cash, total.
export function yearChange(now: AnalysisGift[], before: AnalysisGift[]) {
  const a = totalsOf(now), b = totalsOf(before);
  return { now: a, before: b, diff: { people: a.people - b.people, giftValue: a.giftValue - b.giftValue, cash: a.cash - b.cash, total: a.total - b.total } };
}

// Company-wise totals: people, handed over, still to go, gifts value, cash, total.
export function firmSummary(gifts: AnalysisGift[], order: string[] = []) {
  const names = [...new Set([...order.filter(name => gifts.some(gift => firmLabel(gift) === name)), ...gifts.map(firmLabel)])];
  return names.map(firm => {
    const own = gifts.filter(gift => firmLabel(gift) === firm);
    return { firm, ...totalsOf(own), handed: own.filter(isDone).length, pending: own.filter(gift => !isDone(gift)).length };
  });
}
