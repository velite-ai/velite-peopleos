import { z } from "zod";
import { fail } from "./api";
import { currentUser } from "./auth";
import { db } from "./database";
import { GIFT_STATUSES, giftTotal, isUnrestrictedSuperAdmin } from "./diwali-gift-rules";
import { openJson, sealJson } from "./encryption";

// Every gift route starts here. Anyone who is not an unrestricted Super Administrator is told the page
// does not exist, so they cannot tell it is there.
export async function requireSuperAdmin() {
  const user = await currentUser();
  if (!user) return fail("Authentication required", 401);
  if (user.mustChangePassword) return fail("Password change required", 403, { code: "PASSWORD_CHANGE_REQUIRED" });
  if (user.mfaEnrollmentRequired) return fail("Multi-factor authentication enrollment is required", 403, { code: "MFA_ENROLLMENT_REQUIRED" });
  if (!isUnrestrictedSuperAdmin(user)) return fail("Not found", 404);
  return user;
}

const text = (max: number) => z.string().trim().max(max);
export const giftShape = {
  recipientType: z.enum(["staff", "other"]),
  employeeId: z.uuid().nullable().optional(),
  recipientName: text(160),
  company: text(120),
  giftItem: text(200).min(1),
  quantity: z.number().int().min(1).max(100000),
  unitValue: z.number().min(0).max(100000000),
  vendor: text(160),
  billNo: text(80),
  givenBy: text(160),
  givenOn: z.iso.date().nullable(),
  notes: text(2000),
};
export const createSchema = z.object({ ...giftShape, year: z.number().int().min(2000).max(2100), status: z.enum(GIFT_STATUSES) });
export const patchSchema = z.object(giftShape).partial().extend({ status: z.enum(GIFT_STATUSES).optional() });

export type GiftDetails = {
  recipientType: "staff" | "other"; employeeId: string | null; recipientName: string; company: string; giftItem: string;
  quantity: number; unitValue: number; totalValue: number; vendor: string; billNo: string; givenBy: string; givenOn: string | null; notes: string;
};

export function sealGift(details: GiftDetails) { return sealJson(details); }
export function openGift(value: Uint8Array) { return openJson<GiftDetails>(value); }
export function withTotal(details: Omit<GiftDetails, "totalValue">): GiftDetails { return { ...details, totalValue: giftTotal(details.quantity, details.unitValue) }; }

export type GiftRow = { id: string; gift_year: number; status: string; details_encrypted: Uint8Array; updated_at: string };
export function toGift(row: GiftRow) {
  return { id: row.id, year: row.gift_year, status: row.status, ...openGift(row.details_encrypted), updatedAt: row.updated_at };
}

// A staff recipient takes their name and company from the Staff record, so the register cannot drift from it.
export async function resolveRecipient(input: { recipientType: "staff" | "other"; employeeId?: string | null; recipientName: string; company: string }) {
  if (input.recipientType === "other") {
    if (!input.recipientName.trim()) return { error: fail("Enter the recipient's name", 422) };
    return { value: { recipientType: "other" as const, employeeId: null, recipientName: input.recipientName.trim(), company: input.company.trim() } };
  }
  if (!input.employeeId) return { error: fail("Choose the staff member", 422) };
  const [employee] = await db()<{ name: string; company: string }[]>`SELECT concat_ws(' ',e.first_name,e.last_name) AS name,b.name AS company FROM employees e JOIN business_heads b ON b.id=e.business_head_id WHERE e.id=${input.employeeId}`;
  if (!employee) return { error: fail("Staff member not found", 422) };
  return { value: { recipientType: "staff" as const, employeeId: input.employeeId, recipientName: employee.name, company: employee.company } };
}
