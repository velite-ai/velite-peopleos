// Pure rules for the Diwali gift register. No imports, so they can be unit tested on their own.

export type GiftRoleAssignment = { code: string; businessHeadId: string | null; departmentId: string | null };

export const GIFT_STATUSES = ["planned", "bought", "handed_over"] as const;

// Only a Super Administrator who is not limited to one company or department, signed in as a person
// (not through an API key). The same strict rule the role-management screens use.
export function isUnrestrictedSuperAdmin(user: { apiKeyId?: string | null; roles?: GiftRoleAssignment[] } | null | undefined) {
  if (!user || user.apiKeyId) return false;
  return Boolean(user.roles?.some(role => role.code === "SUPER_ADMIN" && !role.businessHeadId && !role.departmentId));
}

// The total is always worked out here, never taken from the browser.
export function giftTotal(quantity: number, unitValue: number) {
  return Math.round(quantity * unitValue * 100) / 100;
}

// The register is for named people only. DIWALI_GIFTS_EMAILS (comma separated, set in Coolify) names them;
// without it only velite@velite.in may open it. Being a Super Administrator is still required as well.
export const DEFAULT_GIFT_EMAILS = "velite@velite.in";
export function canUseGiftRegister(user: { email?: string | null; apiKeyId?: string | null; roles?: GiftRoleAssignment[] } | null | undefined, allowed: string | undefined = process.env.DIWALI_GIFTS_EMAILS) {
  if (!isUnrestrictedSuperAdmin(user)) return false;
  const emails = (allowed?.trim() ? allowed : DEFAULT_GIFT_EMAILS).split(",").map(email => email.trim().toLowerCase()).filter(Boolean);
  return emails.includes((user?.email || "").trim().toLowerCase());
}

// ---- Gift items and cash for one person and year ----
export type GiftLine = { item: string; quantity: number; unitValue: number };
export const CASH_MODES = ["", "cash", "upi", "bank"] as const;
export const CASH_MODE_LABELS: Record<string, string> = { cash: "Cash in hand", upi: "UPI", bank: "Bank transfer" };

const money2 = (value: number) => Math.round(value * 100) / 100;

// Value of the gift items (quantity x value each, added up) and of everything including cash. Always worked out here, never taken from the browser.
export function giftTotals(items: GiftLine[], cashAmount: number) {
  const giftValue = money2(items.reduce((sum, line) => sum + line.quantity * line.unitValue, 0));
  const cash = money2(cashAmount || 0);
  return { giftValue, cashAmount: cash, totalValue: money2(giftValue + cash) };
}

// One line of words for lists, search and the comparison: "Dinner set, 2 x Dry fruit box + Cash".
export function giftSummary(items: GiftLine[], cashAmount: number) {
  const names = items.map(line => (line.quantity > 1 ? `${line.quantity} × ${line.item}` : line.item));
  if (cashAmount > 0) names.push("Cash");
  return names.join(" + ") || "—";
}

// Gifts saved before items and cash were kept apart had one item line. "X + Cash" and "Cash" were how the Diwali sheet was loaded:
// the amount was the cash and the items had no price.
export function legacyParts(details: { giftItem: string; quantity: number; unitValue: number; totalValue: number }): { items: GiftLine[]; cashAmount: number } {
  const text = (details.giftItem || "").trim();
  if (text === "Cash") return { items: [], cashAmount: details.totalValue };
  if (text.endsWith(" + Cash")) return { items: [{ item: text.slice(0, -7).trim(), quantity: 1, unitValue: 0 }], cashAmount: details.totalValue };
  return { items: [{ item: text, quantity: details.quantity, unitValue: details.unitValue }], cashAmount: 0 };
}
