import { z } from "zod";
import { apiError, ok } from "@/lib/api";
import { db } from "@/lib/database";
import { allPeople, giftsOfYear, insertGifts, requireSuperAdmin, sealGift, withTotal } from "@/lib/diwali-gifts";
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
    const keyOf = (gift: { recipientName: string; giftItem: string; unitValue: number }) => `${nameKey(gift.recipientName)}|${gift.giftItem}|${gift.unitValue}`;
    const existing = new Map<number, Map<string, Awaited<ReturnType<typeof giftsOfYear>>[number]>>();
    for (const year of new Set(gifts.map(gift => gift.year))) existing.set(year, new Map((await giftsOfYear(year)).map(gift => [keyOf(gift), gift])));
    const fresh = gifts.filter(gift => !existing.get(gift.year)!.has(keyOf(gift)));
    // Rows loaded before the Workers / Office label existed get it now (nothing else about them changes).
    const unlabelled = gifts.flatMap(gift => { const found = existing.get(gift.year)!.get(keyOf(gift)); return found && !found.group ? [{ found, group: gift.group }] : []; });
    const summary = {
      rows: gifts.length, toAdd: fresh.length, alreadyThere: gifts.length - fresh.length, toLabel: unlabelled.length,
      byYear: [...new Set(fresh.map(gift => gift.year))].map(year => ({ year, gifts: fresh.filter(gift => gift.year === year).length, value: fresh.filter(gift => gift.year === year).reduce((sum, gift) => sum + gift.unitValue, 0) })),
      linked: fresh.filter(gift => gift.employeeId).length, notLinked: fresh.filter(gift => !gift.employeeId).length,
      partial: fresh.filter(gift => gift.match === "partial").map(gift => gift.recipientName),
      left: fresh.filter(gift => gift.employeeId && LEFT.includes(status.get(gift.employeeId) || "")).map(gift => gift.recipientName),
      unclear: fresh.filter(gift => gift.match === "unclear").map(gift => gift.recipientName),
    };
    if (input.dryRun) return ok({ ...summary, added: 0 });
    if (unlabelled.length) await db().begin(async tx => {
      for (const { found, group } of unlabelled) {
        const { id, year: _year, status: _status, updatedAt: _updated, ...details } = found;
        await tx`UPDATE diwali_gifts SET details_encrypted=${sealGift({ ...details, group })},updated_by=${user.id},updated_at=now() WHERE id=${id} AND deleted_at IS NULL`;
        await tx`INSERT INTO diwali_gift_events (gift_id,action,actor_user_id) VALUES (${id},'update',${user.id})`;
      }
    });
    const added = await insertGifts(user.id, fresh.map(gift => ({
      year: gift.year, status: gift.status,
      details: withTotal({ recipientType: gift.recipientType, employeeId: gift.employeeId, recipientName: gift.recipientName, company: gift.company, giftItem: gift.giftItem, quantity: gift.quantity, unitValue: gift.unitValue, vendor: "", billNo: "", givenBy: "", givenOn: null, notes: gift.notes, group: gift.group }),
    })));
    return ok({ ...summary, added });
  } catch (error) { return apiError(error); }
}
