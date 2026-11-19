// Rules for an application sent from the careers form on www.velite.in (POST /api/public/careers). Pure functions, unit tested.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export type Application = { fullName: string; email: string | null; phone: string | null; position: string; city: string | null; message: string | null };
export type Parsed = { ok: true; value: Application } | { ok: false; spam: true } | { ok: false; spam?: false; message: string };

export function cleanLine(value: unknown, max: number): string { return String(value ?? "").replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, max); }
export function cleanBlock(value: unknown, max: number): string {
  return String(value ?? "").replace(CONTROL, " ").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}
const yes = (value: unknown) => value === true || ["true", "on", "yes", "1"].includes(String(value ?? "").trim().toLowerCase());

/** Cleans and checks the form. `spam` = silently drop (hidden trap field filled, or link-stuffed message). */
export function parseApplication(raw: Record<string, unknown>): Parsed {
  if (cleanLine(raw.website, 200) || cleanLine(raw.company_url, 200)) return { ok: false, spam: true }; // hidden trap fields real visitors never see
  const fullName = cleanLine(raw.fullName ?? raw.name, 120);
  const email = cleanLine(raw.email, 160).toLowerCase();
  const phoneRaw = cleanLine(raw.phone ?? raw.mobile, 40);
  const phone = phoneRaw.replace(/[^\d+]/g, "");
  const position = cleanLine(raw.position ?? raw.role ?? raw.job, 120);
  const city = cleanLine(raw.city, 80);
  const message = cleanBlock(raw.message, 2000);
  if (fullName.length < 2) return { ok: false, message: "Please enter your name." };
  if (position.length < 2) return { ok: false, message: "Please enter the position you are applying for." };
  if (!email && !phoneRaw) return { ok: false, message: "Please enter an email or a phone number so we can reach you." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, message: "Please check your email address." };
  if (phoneRaw && !/^\+?\d{8,15}$/.test(phone)) return { ok: false, message: "Please check your phone number." };
  if (!yes(raw.consent)) return { ok: false, message: "Please tick the box to allow Velite to keep your details for hiring." };
  if ((message.match(/https?:\/\//gi) || []).length > 3) return { ok: false, spam: true };
  return { ok: true, value: { fullName, email: email || null, phone: phoneRaw ? phone : null, position, city: city || null, message: message || null } };
}

export function allowedOrigins(env: string | undefined): string[] {
  return (env || "https://www.velite.in,https://velite.in").split(",").map(item => { try { return new URL(item.trim()).origin; } catch { return ""; } }).filter(Boolean);
}
export function originAllowed(origin: string | null | undefined, list: string[]): boolean {
  if (!origin) return false;
  try { return list.includes(new URL(origin).origin); } catch { return false; }
}
/** After a plain HTML form post: only go back to a page on an allowed site. */
export function safeRedirect(target: unknown, list: string[]): string | null {
  try { const url = new URL(String(target)); return list.includes(url.origin) ? url.toString() : null; } catch { return null; }
}
