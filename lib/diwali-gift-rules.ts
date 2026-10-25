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
