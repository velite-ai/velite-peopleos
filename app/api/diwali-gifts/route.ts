import { apiError, ok } from "@/lib/api";
import { db } from "@/lib/database";
import { GiftRow, createSchema, requireSuperAdmin, resolveRecipient, sealGift, toGift, withTotal } from "@/lib/diwali-gifts";

export async function GET(request: Request) {
  try {
    const user = await requireSuperAdmin();
    if (user instanceof Response) return user;
    const requested = Number(new URL(request.url).searchParams.get("year"));
    const year = Number.isInteger(requested) && requested >= 2000 && requested <= 2100 ? requested : new Date().getFullYear();
    const sql = db();
    const [rows, years] = await Promise.all([
      sql<GiftRow[]>`SELECT id,gift_year,status,details_encrypted,updated_at FROM diwali_gifts WHERE gift_year=${year} AND deleted_at IS NULL ORDER BY created_at`,
      sql<{ gift_year: number }[]>`SELECT DISTINCT gift_year FROM diwali_gifts WHERE deleted_at IS NULL ORDER BY gift_year DESC`,
    ]);
    return ok({ year, years: years.map(row => row.gift_year), gifts: rows.map(toGift) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireSuperAdmin();
    if (user instanceof Response) return user;
    const input = createSchema.parse(await request.json());
    const recipient = await resolveRecipient(input);
    if (recipient.error) return recipient.error;
    const { year, status } = input;
    const details = withTotal({ ...recipient.value, giftItem: input.giftItem, quantity: input.quantity, unitValue: input.unitValue, vendor: input.vendor, billNo: input.billNo, givenBy: input.givenBy, givenOn: input.givenOn, notes: input.notes });
    const sql = db();
    const [row] = await sql.begin(async tx => {
      const rows = await tx<GiftRow[]>`INSERT INTO diwali_gifts (gift_year,status,details_encrypted,created_by,updated_by) VALUES (${year},${status},${sealGift(details)},${user.id},${user.id}) RETURNING id,gift_year,status,details_encrypted,updated_at`;
      await tx`INSERT INTO diwali_gift_events (gift_id,action,actor_user_id) VALUES (${rows[0].id},'create',${user.id})`;
      return rows;
    });
    return ok(toGift(row), { status: 201 });
  } catch (error) { return apiError(error); }
}
