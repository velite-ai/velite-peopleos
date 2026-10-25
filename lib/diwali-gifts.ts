import { z } from "zod";
import { fail } from "./api";
import { currentUser } from "./auth";
import { db } from "./database";
import { GIFT_STATUSES, canUseGiftRegister, giftTotal } from "./diwali-gift-rules";
import { openJson, sealJson } from "./encryption";

// Every gift route starts here. Anyone who is not an unrestricted Super Administrator on the allowed list is told the page
// does not exist, so they cannot tell it is there.
export async function requireSuperAdmin() {
  const user = await currentUser();
  if (!user) return fail("Authentication required", 401);
  if (user.mustChangePassword) return fail("Password change required", 403, { code: "PASSWORD_CHANGE_REQUIRED" });
  if (user.mfaEnrollmentRequired) return fail("Multi-factor authentication enrollment is required", 403, { code: "MFA_ENROLLMENT_REQUIRED" });
  if (!canUseGiftRegister(user)) return fail("Not found", 404);
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
  group?: string; // which sheet tab the gift came from (Workers / Office); older rows have none
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

type NewGift = { year: number; status: "planned" | "bought" | "handed_over"; details: GiftDetails };

// Adds gifts in one go (all or nothing) with the same change log as adding them one by one.
export async function insertGifts(userId: string, gifts: NewGift[]) {
  if (!gifts.length) return 0;
  await db().begin(async tx => {
    for (const gift of gifts) {
      const [row] = await tx<{ id: string }[]>`INSERT INTO diwali_gifts (gift_year,status,details_encrypted,created_by,updated_by) VALUES (${gift.year},${gift.status},${sealGift(gift.details)},${userId},${userId}) RETURNING id`;
      await tx`INSERT INTO diwali_gift_events (gift_id,action,actor_user_id) VALUES (${row.id},'create',${userId})`;
    }
  });
  return gifts.length;
}

export type PersonRow = { id: string; name: string; status: string; company: string };
// Everyone ever on the Staff list, with their current status (people who left are included so they can be recognised).
export async function allPeople() {
  return db()<PersonRow[]>`SELECT e.id,concat_ws(' ',e.first_name,e.last_name) AS name,e.status,b.name AS company FROM employees e JOIN business_heads b ON b.id=e.business_head_id`;
}

export async function giftsOfYear(year: number) {
  const rows = await db()<GiftRow[]>`SELECT id,gift_year,status,details_encrypted,updated_at FROM diwali_gifts WHERE gift_year=${year} AND deleted_at IS NULL ORDER BY created_at`;
  return rows.map(toGift);
}
