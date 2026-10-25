/*
 * One row per person with a column per Diwali year, for the "Compare years" view of the gift register.
 * No imports, so it can be unit tested on its own.
 */
const nameKey = (value: string) => value.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();

export type CompareGift = { year: number; status: string; recipientType: string; employeeId: string | null; recipientName: string; company: string; giftItem: string; quantity: number; totalValue: number; employeeStatus?: string | null };
export type YearCell = { items: string[]; value: number; status: string };
export type CompareRow = { key: string; name: string; company: string; left: boolean; cells: Record<number, YearCell> };

const LEFT = ["separated", "archived"];

// People linked to a staff record are matched by that record; others by name and place (so two "Baljit Kaur" from different villages stay apart).
export const personKey = (gift: Pick<CompareGift, "employeeId" | "recipientName" | "company">) => gift.employeeId || `${nameKey(gift.recipientName)}|${nameKey(gift.company)}`;

export function compareYears(gifts: CompareGift[]) {
  const rows = new Map<string, CompareRow>();
  for (const gift of gifts) {
    const key = personKey(gift);
    const row = rows.get(key) || { key, name: gift.recipientName, company: gift.company, left: false, cells: {} };
    if (gift.employeeStatus && LEFT.includes(gift.employeeStatus)) row.left = true;
    const cell = row.cells[gift.year] || { items: [], value: 0, status: gift.status };
    cell.items.push(gift.quantity > 1 ? `${gift.quantity} × ${gift.giftItem}` : gift.giftItem);
    cell.value += gift.totalValue;
    if (cell.status !== gift.status) cell.status = "mixed";
    row.cells[gift.year] = cell;
    rows.set(key, row);
  }
  const years = [...new Set(gifts.map(gift => gift.year))].sort((a, b) => a - b);
  const sorted = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  const totals = Object.fromEntries(years.map(year => [year, sorted.reduce((sum, row) => sum + (row.cells[year]?.value || 0), 0)])) as Record<number, number>;
  const people = Object.fromEntries(years.map(year => [year, sorted.filter(row => row.cells[year]).length])) as Record<number, number>;
  return { years, rows: sorted, totals, people };
}

// Change from the earlier year to the later one, in rupees (null when the person has no gift in one of them).
export function change(row: CompareRow, from: number, to: number) {
  const a = row.cells[from], b = row.cells[to];
  return a && b ? b.value - a.value : null;
}
