import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";
import { presignObject, storageConfigured } from "@/lib/object-storage";

const MAX_BYTES = 2 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function sniff(bytes: Uint8Array) {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

type Owner = { business_head_id: string; department_id: string | null; photo_object_key: string | null; photo_content_type: string | null };
async function owner(id: string) {
  const [row] = await db()<Owner[]>`SELECT business_head_id,department_id,photo_object_key,photo_content_type FROM employees WHERE id=${id}`;
  return row;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const record = await owner(id);
    if (!record) return fail("Employee not found", 404);
    const user = await requireApiUser("people:read", record.business_head_id, record.department_id);
    if (user instanceof Response) return user;
    if (!record.photo_object_key || !storageConfigured()) return fail("No photo", 404);
    const stored = await fetch(presignObject("GET", record.photo_object_key, 60));
    if (!stored.ok || !stored.body) return fail("Photo is unavailable", 404);
    return new Response(stored.body, { headers: { "content-type": record.photo_content_type || "image/jpeg", "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!storageConfigured()) return fail("Document storage is not configured", 503);
    const { id } = await params;
    const record = await owner(id);
    if (!record) return fail("Employee not found", 404);
    const user = await requireApiUser("people:write", record.business_head_id, record.department_id);
    if (user instanceof Response) return user;
    const file = (await request.formData()).get("photo");
    if (!(file instanceof File)) return fail("Choose a photo to upload", 422);
    if (file.size === 0 || file.size > MAX_BYTES) return fail("The photo must be smaller than 2 MB", 422);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const contentType = sniff(bytes);
    if (!contentType) return fail("Use a JPG, PNG or WebP photo", 422);
    const objectKey = `${record.business_head_id}/photos/${id}/${crypto.randomUUID()}.${EXTENSIONS[contentType]}`;
    const stored = await fetch(presignObject("PUT", objectKey, 120), { method: "PUT", headers: { "content-type": contentType }, body: bytes });
    if (!stored.ok) return fail("The photo could not be saved to storage", 502);
    const sql = db();
    const [updated] = await sql.begin(async tx => {
      const rows = await tx`UPDATE employees SET photo_object_key=${objectKey},photo_content_type=${contentType},photo_updated_at=now() WHERE id=${id} RETURNING photo_updated_at`;
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason) VALUES (${user.id},'employee.photo_update','employee',${id},${record.business_head_id},${JSON.stringify({ contentType, sizeBytes: file.size })}::jsonb,'Employee photo uploaded')`;
      return rows;
    });
    return ok({ photoUpdatedAt: updated.photo_updated_at }, { status: 201 });
  } catch (error) { return apiError(error); }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const record = await owner(id);
    if (!record) return fail("Employee not found", 404);
    const user = await requireApiUser("people:write", record.business_head_id, record.department_id);
    if (user instanceof Response) return user;
    if (!record.photo_object_key) return ok({ removed: false });
    await db().begin(async tx => {
      await tx`UPDATE employees SET photo_object_key=NULL,photo_content_type=NULL,photo_updated_at=NULL WHERE id=${id}`;
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,reason) VALUES (${user.id},'employee.photo_remove','employee',${id},${record.business_head_id},'Employee photo removed')`;
    });
    return ok({ removed: true });
  } catch (error) { return apiError(error); }
}
