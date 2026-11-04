import { apiError, fail, ok } from "@/lib/api";
import { db } from "@/lib/database";
import { listMaster, masterSchema, requireSuperAdmin, sealMaster } from "@/lib/diwali-gifts";
import { masterKey } from "@/lib/diwali-gift-rules";

export async function GET() {
  try {
    const user = await requireSuperAdmin();
    if (user instanceof Response) return user;
    return ok(await listMaster());
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireSuperAdmin();
    if (user instanceof Response) return user;
    const input = masterSchema.parse(await request.json());
    const name = input.name.replace(/\s+/g, " ").trim();
    if ((await listMaster()).some(gift => masterKey(gift.name) === masterKey(name))) return fail("This gift is already in the master", 409);
    const [row] = await db()<{ id: string }[]>`INSERT INTO diwali_gift_master (details_encrypted,created_by,updated_by) VALUES (${sealMaster({ name, unitValue: input.unitValue, note: input.note })},${user.id},${user.id}) RETURNING id`;
    return ok({ id: row.id, name, unitValue: input.unitValue, note: input.note }, { status: 201 });
  } catch (error) { return apiError(error); }
}
