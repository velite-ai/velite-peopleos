/*
 * Rules for loading an earlier year's Diwali sheet into the gift register, and for planning the next year from it.
 * No imports, so they can be unit tested on their own and used by the API and the screen.
 *
 * Sheet layout (the same on the Workers and Office tabs): B name, C village, G gift given, H cash paid, L next year's planned cash, M next year's planned gift.
 * It works whether the copy starts at column A or at column B.
 * Everything else (older columns, bonus / leave-with-wages) is ignored on purpose.
 */

export type SheetRow = { name: string; place: string; gift: string; cash: number; nextCash: number; nextGift: string; note: string };
export type Candidate = { id: string; name: string; status: string; company?: string };
export type ImportGift = {
  recipientType: "staff" | "other"; employeeId: string | null; recipientName: string; company: string; giftItem: string; gift: string; cash: number;
  quantity: number; unitValue: number; notes: string; status: "handed_over" | "planned"; year: number; group: string; match: "exact" | "partial" | "none" | "unclear";
};

export const WORKING = ["active", "probation", "notice_period"];
export const LEFT = ["separated", "archived"];

export const squash = (value: string) => value.replace(/\s+/g, " ").trim();
export const nameKey = (value: string) => squash(value.toLowerCase().replace(/[^a-z\s]/g, " "));
const amount = (value: string | undefined) => { const n = Number(String(value ?? "").replace(/[₹,\s]/g, "")); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };

// Reads text copied from the sheet (tab separated). Rows without a name, the heading row and the total row are skipped.
export function parseSheet(text: string): SheetRow[] {
  const lines = text.split(/\r?\n/).map(line => line.split("\t").map(cell => squash(cell.replace(/^"|"$/g, ""))));
  // Copied from column A (SR. NO. first) the name is the second cell; copied from column B it is the first.
  const shift = lines.some(cells => /^sr\.?\s*no/i.test(cells[0] || "") || /^name$/i.test(cells[1] || "")) ? 1 : 0;
  const rows: SheetRow[] = [];
  for (const cells of lines) {
    const rawName = cells[shift] || "";
    if (!rawName || /^name$/i.test(rawName) || /^\d+$/.test(rawName)) continue;
    const notes: string[] = [];
    if (/\([^)]*\)/.test(rawName)) notes.push(`Written in the sheet as “${rawName}”`);
    const name = squash(rawName.replace(/\([^)]*\)/g, " "));
    const gift = cells[5 + shift] || "";
    const cash = amount(cells[6 + shift]);
    const nextCash = amount(cells[10 + shift]);
    const nextGift = /^\d+$/.test(cells[11 + shift] || "") ? "" : cells[11 + shift] || "";
    if (!gift && !cash && !nextCash && !nextGift) continue;
    rows.push({ name, place: cells[1 + shift] || "", gift, cash, nextCash, nextGift, note: notes.join(". ") });
  }
  return rows;
}

// Finds the staff record for a sheet name. Only a full name is trusted: exactly one person with that name, or, if several,
// exactly one still working. A one-word name (very common among workers) is never linked automatically.
export function matchPerson(name: string, people: Candidate[]): { person: Candidate | null; match: ImportGift["match"] } {
  const key = nameKey(name);
  if (!key) return { person: null, match: "none" };
  const exact = people.filter(person => nameKey(person.name) === key);
  const pick = (found: Candidate[]) => {
    if (found.length === 1) return found[0];
    const working = found.filter(person => WORKING.includes(person.status));
    return working.length === 1 ? working[0] : null;
  };
  if (exact.length) { const person = pick(exact); return { person, match: person ? "exact" : "unclear" }; }
  const tokens = key.split(" ");
  if (tokens.length < 2) return { person: null, match: "none" };
  const partial = people.filter(person => { const own = nameKey(person.name).split(" "); return tokens.every(token => own.includes(token)); });
  if (partial.length) { const person = pick(partial); return { person, match: person ? "partial" : "unclear" }; }
  return { person: null, match: "none" };
}

export function buildGifts(rows: SheetRow[], year: number, sheetLabel: string, people: Candidate[]): ImportGift[] {
  const out: ImportGift[] = [];
  for (const row of rows) {
    const { person, match } = matchPerson(row.name, people);
    const where = row.place ? ` (${row.place})` : "";
    const base = {
      recipientType: person ? "staff" as const : "other" as const, employeeId: person?.id ?? null,
      recipientName: person ? squash(person.name) : row.name, company: person ? person.company || "" : `${sheetLabel}${where}`, group: sheetLabel, match,
    };
    const notes = [row.note, row.place ? `Village / place: ${row.place}` : "", match === "unclear" ? "Several staff share this name; not linked" : "", match === "none" ? "Not linked to a staff record" : "", match === "partial" ? "Linked by part of the name; please check" : ""].filter(Boolean);
    if (row.cash || row.gift) {
      const item = row.gift && row.cash ? `${row.gift} + Cash` : row.gift || "Cash";
      out.push({ ...base, giftItem: item, gift: row.gift, cash: row.cash, quantity: 1, unitValue: row.cash, status: "handed_over", year,
        notes: [...notes, row.gift ? "Value is the cash only; the price of the gift items was not in the sheet" : ""].filter(Boolean).join(". "), });
    }
    if (row.nextCash || row.nextGift) out.push({ ...base, giftItem: row.nextGift && row.nextCash ? `${row.nextGift} + Cash` : row.nextGift || "Cash", gift: row.nextGift, cash: row.nextCash, quantity: 1, unitValue: row.nextCash, status: "planned", year: year + 1, notes: [...notes, "Planned in the sheet, not yet given"].join(". ") });
  }
  return out;
}

// Next year's plan from last year's gifts: the same gift and amount for everyone still with Velite.
// People who have left are skipped, and anyone who already has a gift next year is left alone.
export function planNextYear<T extends { recipientName: string; employeeId: string | null; recipientType: string; giftItem: string; employeeStatus?: string | null }>(
  last: T[], existingNext: { recipientName: string; employeeId: string | null }[],
) {
  const taken = new Set(existingNext.map(gift => gift.employeeId || nameKey(gift.recipientName)));
  const copy: T[] = [], left: T[] = [], already: T[] = [];
  for (const gift of last) {
    const key = gift.employeeId || nameKey(gift.recipientName);
    if (gift.employeeStatus && LEFT.includes(gift.employeeStatus)) left.push(gift);
    else if (taken.has(key)) already.push(gift);
    else copy.push(gift);
  }
  return { copy, left, already };
}
