import { apiError, ok } from "@/lib/api";
import { db } from "@/lib/database";
import { GiftRow, allPeople, requireSuperAdmin, toGift } from "@/lib/diwali-gifts";

// Every year's gifts in one list, for the year-by-year comparison.
export async function GET() {
  try {
    const user = await requireSuperAdmin();
    if (user instanceof Response) return user;
    const [rows, people] = await Promise.all([
      db()<GiftRow[]>`SELECT id,gift_year,status,details_encrypted,updated_at FROM diwali_gifts WHERE deleted_at IS NULL ORDER BY gift_year,created_at`,
      allPeople(),
    ]);
    const status = new Map(people.map(person => [person.id, person.status]));
    return ok({ gifts: rows.map(row => { const gift = toGift(row); return { year: gift.year, status: gift.status, recipientType: gift.recipientType, employeeId: gift.employeeId, recipientName: gift.recipientName, company: gift.company, group: gift.group ?? null, giftItem: gift.giftItem, quantity: 1, totalValue: gift.totalValue, giftValue: gift.giftValue, cashAmount: gift.cashAmount, employeeStatus: gift.employeeId ? status.get(gift.employeeId) ?? null : null }; }) });
  } catch (error) { return apiError(error); }
}
