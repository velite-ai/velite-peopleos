import { z } from "zod";
import { apiError, ok } from "@/lib/api";
import { db } from "@/lib/database";
import { GiftRow, listMaster, makeDetails, masterPrices, openGift, requireSuperAdmin, sealGift } from "@/lib/diwali-gifts";
import { applyMasterPrices } from "@/lib/diwali-gift-rules";

const schema = z.object({ year: z.number().int().min(2000).max(2100), overwrite: z.boolean(), dryRun: z.boolean() });

// Puts the master price on a year's gift lines (only lines with no price yet, unless overwrite is set) and recalculates each person's totals.
export async function POST(request: Request) {
  try {
    const user = await requireSuperAdmin();
    if (user instanceof Response) return user;
    const input = schema.parse(await request.json());
    const prices = masterPrices(await listMaster());
    const rows = await db()<GiftRow[]>`SELECT id,gift_year,status,details_encrypted,updated_at FROM diwali_gifts WHERE gift_year=${input.year} AND deleted_at IS NULL`;
    const updates = rows.flatMap(row => {
      const details = openGift(row.details_encrypted);
      const { items, changed } = applyMasterPrices(details.items, prices, input.overwrite);
      if (!changed) return [];
      const { giftItem: _a, quantity: _b, unitValue: _c, totalValue: _d, giftValue: _e, ...parts } = details;
      const next = makeDetails({ ...parts, items });
      return [{ id: row.id, next, before: details.totalValue, lines: changed }];
    });
    const summary = { people: updates.length, lines: updates.reduce((sum, update) => sum + update.lines, 0), valueAdded: Math.round(updates.reduce((sum, update) => sum + update.next.totalValue - update.before, 0) * 100) / 100, applied: 0 };
    if (input.dryRun || !updates.length) return ok(summary);
    await db().begin(async tx => {
      for (const update of updates) {
        await tx`UPDATE diwali_gifts SET details_encrypted=${sealGift(update.next)},updated_by=${user.id},updated_at=now() WHERE id=${update.id} AND deleted_at IS NULL`;
        await tx`INSERT INTO diwali_gift_events (gift_id,action,actor_user_id) VALUES (${update.id},'update',${user.id})`;
      }
    });
    return ok({ ...summary, applied: updates.length });
  } catch (error) { return apiError(error); }
}
