import { z } from "zod";
import { apiError, ok } from "@/lib/api";
import { allPeople, giftsOfYear, insertGifts, requireSuperAdmin, withTotal } from "@/lib/diwali-gifts";
import { buildGifts, LEFT, nameKey, parseSheet } from "@/lib/diwali-import-rules";

const schema = z.object({ text: z.string().min(1).max(500000), year: z.number().int().min(2000).max(2100), sheet: z.string().trim().min(1).max(60), dryRun: z.boolean() });

// Loads one tab of an earlier year's Diwali sheet (pasted from Google Sheets). dryRun only reports what would be added.
export async function POST(request: Request) {
  try {
    const user = await requireSuperAdmin();
    if (user instanceof Response) return user;
    const input = schema.parse(await request.json());
    const people = await allPeople();
    const status = new Map(people.map(person => [person.id, person.status]));
    const gifts = buildGifts(parseSheet(input.text), input.year, input.sheet, people);
    const existing = new Map<number, Set<string>>();
    for (const year of new Set(gifts.map(gift => gift.year))) existing.set(year, new Set((await giftsOfYear(year)).map(gift => `${nameKey(gift.recipientName)}|${gift.giftItem}|${gift.unitValue}`)));
    const fresh = gifts.filter(gift => !existing.get(gift.year)!.has(`${nameKey(gift.recipientName)}|${gift.giftItem}|${gift.unitValue}`));
    const summary = {
      rows: gifts.length, toAdd: fresh.length, alreadyThere: gifts.length - fresh.length,
      byYear: [...new Set(fresh.map(gift => gift.year))].map(year => ({ year, gifts: fresh.filter(gift => gift.year === year).length, value: fresh.filter(gift => gift.year === year).reduce((sum, gift) => sum + gift.unitValue, 0) })),
      linked: fresh.filter(gift => gift.employeeId).length, notLinked: fresh.filter(gift => !gift.employeeId).length,
      partial: fresh.filter(gift => gift.match === "partial").map(gift => gift.recipientName),
      left: fresh.filter(gift => gift.employeeId && LEFT.includes(status.get(gift.employeeId) || "")).map(gift => gift.recipientName),
      unclear: fresh.filter(gift => gift.match === "unclear").map(gift => gift.recipientName),
    };
    if (input.dryRun) return ok({ ...summary, added: 0 });
    const added = await insertGifts(user.id, fresh.map(gift => ({
      year: gift.year, status: gift.status,
      details: withTotal({ recipientType: gift.recipientType, employeeId: gift.employeeId, recipientName: gift.recipientName, company: gift.company, giftItem: gift.giftItem, quantity: gift.quantity, unitValue: gift.unitValue, vendor: "", billNo: "", givenBy: "", givenOn: null, notes: gift.notes }),
    })));
    return ok({ ...summary, added });
  } catch (error) { return apiError(error); }
}
