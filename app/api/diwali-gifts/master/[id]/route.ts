import { apiError, fail, ok } from "@/lib/api";
import { db } from "@/lib/database";
import { listMaster, masterSchema, requireSuperAdmin, sealMaster } from "@/lib/diwali-gifts";
import { masterKey } from "@/lib/diwali-gift-rules";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSuperAdmin();
    if (user instanceof Response) return user;
    const { id } = await params;
    const input = masterSchema.parse(await request.json());
    const name = input.name.replace(/\s+/g, " ").trim();
    const all = await listMaster();
    if (!all.some(gift => gift.id === id)) return fail("Not found", 404);
    if (all.some(gift => gift.id !== id && masterKey(gift.name) === masterKey(name))) return fail("Another gift in the master has this name", 409);
    await db()`UPDATE diwali_gift_master SET details_encrypted=${sealMaster({ name, unitValue: input.unitValue, note: input.note })},updated_by=${user.id},updated_at=now() WHERE id=${id} AND deleted_at IS NULL`;
    return ok({ id, name, unitValue: input.unitValue, note: input.note });
  } catch (error) { return apiError(error); }
}

// Gifts already given keep their name and price; removing a master entry only stops it being offered.
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSuperAdmin();
    if (user instanceof Response) return user;
    const { id } = await params;
    const rows = await db()`UPDATE diwali_gift_master SET deleted_at=now(),updated_by=${user.id} WHERE id=${id} AND deleted_at IS NULL RETURNING id`;
    if (!rows[0]) return fail("Not found", 404);
    return ok({ removed: true });
  } catch (error) { return apiError(error); }
}
