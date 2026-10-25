import { z } from "zod";
import { apiError, ok } from "@/lib/api";
import { allPeople, giftsOfYear, insertGifts, requireSuperAdmin, withTotal } from "@/lib/diwali-gifts";
import { planNextYear } from "@/lib/diwali-import-rules";

const schema = z.object({ fromYear: z.number().int().min(2000).max(2099), dryRun: z.boolean() });

// Starts next year's plan from this year's gifts: same gift and amount for everyone still with Velite, marked Planned.
export async function POST(request: Request) {
  try {
    const user = await requireSuperAdmin();
    if (user instanceof Response) return user;
    const input = schema.parse(await request.json());
    const [last, next, people] = await Promise.all([giftsOfYear(input.fromYear), giftsOfYear(input.fromYear + 1), allPeople()]);
    const status = new Map(people.map(person => [person.id, person.status]));
    const withStatus = last.map(gift => ({ ...gift, employeeStatus: gift.employeeId ? status.get(gift.employeeId) ?? null : null }));
    const { copy, left, already } = planNextYear(withStatus, next);
    const result = { toYear: input.fromYear + 1, copied: copy.length, value: copy.reduce((sum, gift) => sum + gift.totalValue, 0), left: left.length, leftValue: left.reduce((sum, gift) => sum + gift.totalValue, 0), alreadyPlanned: already.length, added: 0 };
    if (input.dryRun) return ok(result);
    result.added = await insertGifts(user.id, copy.map(gift => ({
      year: input.fromYear + 1, status: "planned" as const,
      details: withTotal({ recipientType: gift.recipientType, employeeId: gift.employeeId, recipientName: gift.recipientName, company: gift.company, giftItem: gift.giftItem, quantity: gift.quantity, unitValue: gift.unitValue, vendor: "", billNo: "", givenBy: "", givenOn: null, group: gift.group, notes: `Copied from Diwali ${input.fromYear}${gift.notes ? `. ${gift.notes}` : ""}` }),
    })));
    return ok(result);
  } catch (error) { return apiError(error); }
}
