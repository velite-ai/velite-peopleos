import { apiError, fail, ok } from "@/lib/api";
import { db } from "@/lib/database";
import { GiftRow, openGift, patchSchema, requireSuperAdmin, resolveRecipient, sealGift, toGift, withTotal } from "@/lib/diwali-gifts";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSuperAdmin();
    if (user instanceof Response) return user;
    const { id } = await params;
    const input = patchSchema.parse(await request.json());
    const sql = db();
    const [current] = await sql<GiftRow[]>`SELECT id,gift_year,status,details_encrypted,updated_at FROM diwali_gifts WHERE id=${id} AND deleted_at IS NULL`;
    if (!current) return fail("Not found", 404);
    const { status, ...changes } = input;
    const merged = { ...openGift(current.details_encrypted), ...Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)) } as ReturnType<typeof openGift>;
    const recipient = await resolveRecipient(merged);
    if (recipient.error) return recipient.error;
    const details = withTotal({ ...merged, ...recipient.value });
    const [row] = await sql.begin(async tx => {
      const rows = await tx<GiftRow[]>`UPDATE diwali_gifts SET details_encrypted=${sealGift(details)},status=${status ?? current.status},updated_by=${user.id},updated_at=now() WHERE id=${id} AND deleted_at IS NULL RETURNING id,gift_year,status,details_encrypted,updated_at`;
      if (rows[0]) await tx`INSERT INTO diwali_gift_events (gift_id,action,actor_user_id) VALUES (${id},'update',${user.id})`;
      return rows;
    });
    if (!row) return fail("Not found", 404);
    return ok(toGift(row));
  } catch (error) { return apiError(error); }
}

// Removing a gift only marks it removed; the record stays in the database.
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSuperAdmin();
    if (user instanceof Response) return user;
    const { id } = await params;
    const sql = db();
    const removed = await sql.begin(async tx => {
      const rows = await tx`UPDATE diwali_gifts SET deleted_at=now(),deleted_by=${user.id} WHERE id=${id} AND deleted_at IS NULL RETURNING id`;
      if (rows[0]) await tx`INSERT INTO diwali_gift_events (gift_id,action,actor_user_id) VALUES (${id},'delete',${user.id})`;
      return rows[0];
    });
    if (!removed) return fail("Not found", 404);
    return ok({ removed: true });
  } catch (error) { return apiError(error); }
}
