import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";
import { presignObject, storageConfigured } from "@/lib/object-storage";
import { scanObject } from "@/lib/malware-scan";

const MAX_BYTES = 25 * 1024 * 1024;
const CATEGORIES = ["identity", "address_proof", "education", "experience", "contract", "bank", "tax", "health", "background_check", "other"];

// Content type is derived from the file's own header bytes, never from the browser-supplied type.
function sniff(bytes: Uint8Array) {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (ascii(0, 4) === "%PDF") return "application/pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return "application/msword";
  return null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!storageConfigured()) return fail("Document storage is not configured", 503);
    const { id } = await params;
    const sql = db();
    const [owner] = await sql<{ business_head_id: string; department_id: string | null }[]>`SELECT business_head_id,department_id FROM employees WHERE id=${id}`;
    if (!owner) return fail("Employee not found", 404);
    const user = await requireApiUser("documents:write", owner.business_head_id, owner.department_id);
    if (user instanceof Response) return user;
    const form = await request.formData();
    const file = form.get("file");
    const category = String(form.get("category") || "");
    const expiresOn = String(form.get("expiresOn") || "") || null;
    if (!(file instanceof File)) return fail("Choose a file to upload", 422);
    if (!CATEGORIES.includes(category)) return fail("Choose what kind of document this is", 422);
    if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return fail("Expiry date is not valid", 422);
    if (file.size === 0 || file.size > MAX_BYTES) return fail("The file must be smaller than 25 MB", 422);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const contentType = sniff(bytes);
    if (!contentType) return fail("Use a PDF, Word document, JPG, PNG or WebP file", 422);
    const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120) || "document";
    const objectKey = `${owner.business_head_id}/${new Date().getUTCFullYear()}/${crypto.randomUUID()}/${safe}`;
    const stored = await fetch(presignObject("PUT", objectKey, 300), { method: "PUT", headers: { "content-type": contentType }, body: bytes });
    if (!stored.ok) return fail("The file could not be saved to storage", 502);
    const scan = await scanObject(objectKey, file.name, contentType);
    const [document] = await sql.begin(async tx => {
      const rows = await tx`INSERT INTO documents (employee_id,category,file_name,object_key,content_type,size_bytes,expires_on,scan_status,scanned_at,scan_details) VALUES (${id},${category},${file.name.slice(0, 240)},${objectKey},${contentType},${file.size},${expiresOn},${scan.status},${scan.status === "not_configured" ? null : new Date()},${JSON.stringify(scan.details)}::jsonb) RETURNING id,category,file_name,content_type,size_bytes,expires_on,scan_status,created_at`;
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason) VALUES (${user.id},'document.upload','document',${rows[0].id},${owner.business_head_id},${JSON.stringify(rows[0])}::jsonb,${scan.status === "clean" ? "Private object upload scanned clean" : "Private object upload quarantined pending a clean scan"})`;
      return rows;
    });
    return ok(document, { status: 201 });
  } catch (error) { return apiError(error); }
}
