// Rules for company items given to staff (laptop, mobile phone, SIM, lab coat, slippers, ...). Pure functions, unit tested.

export const ITEM_STATUSES = ["with_staff", "returned", "lost", "damaged"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export type ItemAction = "returned" | "lost" | "damaged" | "reopen";
export const ITEM_ACTIONS: ItemAction[] = ["returned", "lost", "damaged", "reopen"];

export const STATUS_LABEL: Record<ItemStatus, string> = { with_staff: "With staff", returned: "Returned", lost: "Lost", damaged: "Damaged" };
export const EVENT_LABEL: Record<string, string> = { given: "Given", returned: "Returned", lost: "Marked lost", damaged: "Marked damaged", reopened: "Put back with staff", edited: "Details changed" };

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
export const cleanLine = (value: unknown, max: number) => String(value ?? "").replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, max);
const isoDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const isUuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

type Problem = { ok: false; message: string };

/** Which statuses an item can move to. Returned / lost / damaged can be put back "with staff" to fix a mistake. */
export function nextStatus(current: ItemStatus, action: ItemAction): ItemStatus | null {
  const table: Record<ItemStatus, Partial<Record<ItemAction, ItemStatus>>> = {
    with_staff: { returned: "returned", lost: "lost", damaged: "damaged" },
    damaged: { returned: "returned", lost: "lost", reopen: "with_staff" },
    lost: { returned: "returned", reopen: "with_staff" },
    returned: { reopen: "with_staff" },
  };
  return table[current]?.[action] ?? null;
}

export type IssueInput = { itemTypeId: string; details: string | null; quantity: number; issuedOn: string; note: string | null };
export function parseIssue(input: Record<string, unknown>, today: string): { ok: true; value: IssueInput } | Problem {
  if (!isUuid(input.itemTypeId)) return { ok: false, message: "Choose what kind of item this is." };
  const quantity = Number(input.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) return { ok: false, message: "Quantity must be a whole number from 1 to 999." };
  if (!isoDate(input.issuedOn)) return { ok: false, message: "Enter the date the item was given." };
  if ((input.issuedOn as string) > today) return { ok: false, message: "The date given cannot be in the future." };
  if ((input.issuedOn as string) < "2000-01-01") return { ok: false, message: "Please check the date given." };
  return { ok: true, value: { itemTypeId: input.itemTypeId as string, details: cleanLine(input.details, 300) || null, quantity, issuedOn: input.issuedOn as string, note: cleanLine(input.note, 500) || null } };
}

export type StatusChange = { action: ItemAction; on: string; note: string | null };
export function parseStatusChange(input: Record<string, unknown>, current: ItemStatus, today: string, issuedOn?: string): { ok: true; value: StatusChange; to: ItemStatus } | Problem {
  const action = input.action as ItemAction;
  if (!ITEM_ACTIONS.includes(action)) return { ok: false, message: "Choose what happened to the item." };
  const to = nextStatus(current, action);
  if (!to) return { ok: false, message: `This item is already "${STATUS_LABEL[current]}", so that cannot be recorded now.` };
  const on = input.on === undefined || input.on === null || input.on === "" ? today : input.on;
  if (!isoDate(on)) return { ok: false, message: "Enter a valid date." };
  if ((on as string) > today) return { ok: false, message: "The date cannot be in the future." };
  if (issuedOn && (on as string) < issuedOn && action !== "reopen") return { ok: false, message: "The date cannot be before the item was given." };
  const note = cleanLine(input.note, 500);
  if ((action === "lost" || action === "damaged") && note.length < 3) return { ok: false, message: `Please write a short note about how the item was ${action === "lost" ? "lost" : "damaged"}.` };
  return { ok: true, value: { action, on: on as string, note: note || null }, to };
}

export type EditInput = { details: string | null; quantity: number; issuedOn: string; note: string | null };
export function parseEdit(input: Record<string, unknown>, today: string): { ok: true; value: EditInput } | Problem {
  const parsed = parseIssue({ ...input, itemTypeId: "00000000-0000-4000-8000-000000000000" }, today);
  if (!parsed.ok) return parsed;
  const { details, quantity, issuedOn, note } = parsed.value;
  return { ok: true, value: { details, quantity, issuedOn, note } };
}

/** The event written to the history for a status change. */
export const eventFor = (action: ItemAction): string => (action === "reopen" ? "reopened" : action);

export function parseTypeName(value: unknown): { ok: true; name: string } | Problem {
  const name = cleanLine(value, 60);
  if (name.length < 2) return { ok: false, message: "Type the name of the item, for example Tablet or Apron." };
  return { ok: true, name };
}

type ItemLike = { status: string; type_name?: string | null; type?: string | null; details?: string | null; quantity?: number | string | null };
/** Items a person still holds. */
export const itemsStillWithStaff = <T extends ItemLike>(items: T[]) => items.filter(item => item.status === "with_staff");
/** "Laptop (Dell Latitude), SIM card x2" */
export function describeItems(items: ItemLike[]): string {
  return items.map(item => {
    const name = item.type_name || item.type || "Item";
    const quantity = Number(item.quantity || 1);
    const details = item.details ? ` (${item.details})` : "";
    return `${name}${details}${quantity > 1 ? ` x${quantity}` : ""}`;
  }).join(", ");
}

// One CSV row; values with commas, quotes or line breaks are quoted. Values that start like a formula are made safe for Excel.
function csvRow(values: (string | number | null | undefined)[]): string {
  return values.map(value => {
    let text = value === null || value === undefined ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(",");
}

export type ListRow = { employee_code?: string | null; employee_name?: string | null; business_head?: string | null; type_name?: string | null; details?: string | null; quantity?: number | string | null; issued_on?: string | null; status?: string | null; status_on?: string | null; note?: string | null };
export const CSV_HEADER = ["Staff code", "Name", "Company", "Item", "Details", "Quantity", "Given on", "Status", "Status date", "Note"];
export function itemsCsv(rows: ListRow[]): string {
  const lines = [csvRow(CSV_HEADER)];
  for (const row of rows) lines.push(csvRow([row.employee_code, row.employee_name, row.business_head, row.type_name, row.details, row.quantity, String(row.issued_on || "").slice(0, 10), STATUS_LABEL[row.status as ItemStatus] || row.status, String(row.status_on || "").slice(0, 10), row.note]));
  return "﻿" + lines.join("\r\n");
}

/** Stock of one item type in one company. Returned items are back in stock; lost and damaged ones are counted out. */
export type StockNumbers = { added: number; removed: number; withStaff: number; lost: number; damaged: number };
export const inStock = (n: StockNumbers) => n.added - n.removed - n.withStaff - n.lost - n.damaged;

export type StockEntryInput = { entryType: "added" | "removed"; quantity: number; entryOn: string; note: string | null };
export function parseStockEntry(input: Record<string, unknown>, today: string): { ok: true; value: StockEntryInput } | Problem {
  if (input.entryType !== "added" && input.entryType !== "removed") return { ok: false, message: "Choose whether stock was added or taken out." };
  const quantity = Number(input.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) return { ok: false, message: "Quantity must be a whole number, 1 or more." };
  if (!isoDate(input.entryOn)) return { ok: false, message: "Enter the date." };
  if ((input.entryOn as string) > today) return { ok: false, message: "The date cannot be in the future." };
  if ((input.entryOn as string) < "2000-01-01") return { ok: false, message: "Please check the date." };
  const note = cleanLine(input.note, 500);
  if (input.entryType === "removed" && note.length < 3) return { ok: false, message: "Please write why the stock was taken out (sold, scrapped, given away...)." };
  return { ok: true, value: { entryType: input.entryType, quantity, entryOn: input.entryOn as string, note: note || null } };
}

export type StockRow = StockNumbers & { business_head: string; type_name: string };
export const STOCK_CSV_HEADER = ["Company", "Item", "Bought / received", "Taken out of stock", "With staff", "Lost", "Damaged", "In stock"];
export function stockCsv(rows: StockRow[]): string {
  const lines = [csvRow(STOCK_CSV_HEADER)];
  for (const row of rows) lines.push(csvRow([row.business_head, row.type_name, row.added, row.removed, row.withStaff, row.lost, row.damaged, inStock(row)]));
  return "\ufeff" + lines.join("\r\n");
}
