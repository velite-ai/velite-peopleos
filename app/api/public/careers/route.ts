import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/database";
import { allowedOrigins, originAllowed, parseApplication, safeRedirect } from "@/lib/careers-rules";
import { buildHubTask, hubConfig, sendToHub } from "@/lib/hub-careers.mjs";

// Public address for the careers form on www.velite.in (CLAUDE.md section 45). No login: it is protected by the allowed-website check
// (or a shared form key for a server-side form), hidden trap fields, size limits and a limit per visitor. Everything is saved first;
// the notification and the Hub task follow, and a Hub that cannot be reached is retried by the worker.
const MAX_BODY = 30_000;

function corsHeaders(origin: string | null, list: string[]): Record<string, string> {
  return originAllowed(origin, list)
    ? { "access-control-allow-origin": origin as string, vary: "Origin", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type, x-careers-key", "access-control-max-age": "600" }
    : { vary: "Origin" };
}
const reply = (body: unknown, status: number, headers: Record<string, string>) => NextResponse.json(body, { status, headers });

function formKeyOk(request: Request): boolean {
  const expected = process.env.CAREERS_FORM_KEY || "";
  const given = request.headers.get("x-careers-key") || "";
  if (!expected || !given) return false;
  const a = createHash("sha256").update(expected).digest(); const b = createHash("sha256").update(given).digest();
  return timingSafeEqual(a, b);
}

export async function OPTIONS(request: Request) {
  const list = allowedOrigins(process.env.CAREERS_ALLOWED_ORIGINS);
  const origin = request.headers.get("origin");
  return originAllowed(origin, list) ? new NextResponse(null, { status: 204, headers: corsHeaders(origin, list) }) : new NextResponse(null, { status: 403 });
}

export async function POST(request: Request) {
  const list = allowedOrigins(process.env.CAREERS_ALLOWED_ORIGINS);
  const origin = request.headers.get("origin");
  const cors = corsHeaders(origin, list);
  try {
    if (!originAllowed(origin, list) && !formKeyOk(request)) return reply({ error: { message: "Not allowed" } }, 403, cors);
    if (Number(request.headers.get("content-length") || 0) > MAX_BODY) return reply({ error: { message: "That is too large." } }, 413, cors);

    const type = request.headers.get("content-type") || "";
    let raw: Record<string, unknown> = {};
    if (type.includes("application/json")) raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    else { const form = await request.formData().catch(() => null); if (form) for (const [key, value] of form.entries()) if (typeof value === "string") raw[key] = value; }
    const redirectTo = safeRedirect(raw._redirect, list);
    const done = () => redirectTo ? NextResponse.redirect(redirectTo, { status: 303, headers: cors }) : reply({ data: { received: true } }, 201, cors);

    const parsed = parseApplication(raw);
    if (!parsed.ok && parsed.spam) return done(); // looks like a bot: say thank you, keep nothing
    if (!parsed.ok) return reply({ error: { message: parsed.message } }, 422, cors);
    const app = parsed.value;

    const sql = db();
    const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
    const ipHash = createHash("sha256").update(`${ip}|${process.env.AUTH_SECRET || ""}`).digest("hex");
    const [load] = await sql<{ mine: number; all: number }[]>`SELECT count(*) FILTER (WHERE ip_hash=${ipHash} AND created_at>now()-interval '1 hour')::int AS mine, count(*) FILTER (WHERE created_at>now()-interval '10 minutes')::int AS all FROM career_applications WHERE created_at>now()-interval '1 hour'`;
    if (load.mine >= 5 || load.all >= 60) return reply({ error: { message: "Too many applications right now. Please try again later." } }, 429, { ...cors, "retry-after": "600" });

    const company = process.env.CAREERS_DEFAULT_COMPANY || "Velite Healthcare";
    const [head] = await sql<{ id: string; name: string }[]>`SELECT id,name FROM business_heads WHERE name=${company} AND active=true`;
    if (!head) { console.error("careers: CAREERS_DEFAULT_COMPANY not found:", company); return reply({ error: { message: "The form is not available right now. Please try again later." } }, 503, cors); }

    const config = hubConfig();
    const saved = await sql.begin(async tx => {
      const [candidate] = await tx<{ id: string }[]>`INSERT INTO candidates (business_head_id,full_name,email,phone,position,source,consented_at) VALUES (${head.id},${app.fullName},${app.email},${app.phone},${app.position},'Website',now()) RETURNING id`;
      const notes = `Applied on the careers form.${app.city ? ` City: ${app.city}.` : ""}${app.message ? ` Message: ${app.message.slice(0, 500)}` : ""}`;
      await tx`INSERT INTO candidate_stage_events (candidate_id,to_stage,notes) VALUES (${candidate.id},'applied',${notes})`;
      const [row] = await tx<{ id: string }[]>`INSERT INTO career_applications (full_name,email,phone,position,city,message,consented_at,business_head_id,candidate_id,source_origin,ip_hash,user_agent,hub_status,hub_attempts,hub_lease_owner,hub_leased_until) VALUES (${app.fullName},${app.email},${app.phone},${app.position},${app.city},${app.message},now(),${head.id},${candidate.id},${origin},${ipHash},${(request.headers.get("user-agent") || "").slice(0, 300)},${config ? "sending" : "off"},${config ? 1 : 0},${config ? "web" : null},${config ? new Date(Date.now() + 90_000) : null}) RETURNING id`;
      const title = `New job application: ${app.position}`;
      const body = [app.fullName, app.phone, app.email, app.city].filter(Boolean).join(" · ");
      await tx`INSERT INTO notifications (recipient_user_id,business_head_id,title,body,action_path,deliver_on)
               SELECT DISTINCT u.id,${head.id}::uuid,${title}::text,${body}::text,'/',current_date
               FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
               WHERE u.active=true AND r.code IN ('SUPER_ADMIN','HR_ADMIN','RECRUITER') AND ur.department_id IS NULL AND (ur.business_head_id IS NULL OR ur.business_head_id=${head.id})`;
      await tx`INSERT INTO audit_events (action,entity_type,entity_id,business_head_id,after_data,reason) VALUES ('candidate.website_application','candidate',${candidate.id},${head.id},${tx.json({ applicationId: row.id, position: app.position })},'Application received from the careers form')`;
      return row;
    });

    if (config) {
      try {
        const task = buildHubTask({ full_name: app.fullName, position: app.position, phone: app.phone, email: app.email, city: app.city, message: app.message }, head.name, process.env.APP_URL);
        const taskId = await sendToHub(task, config, 6000);
        await sql`UPDATE career_applications SET hub_status='sent',hub_task_id=${taskId},hub_sent_at=now(),hub_lease_owner=NULL,hub_leased_until=NULL,hub_error=NULL WHERE id=${saved.id}`;
      } catch (error) {
        console.error("careers: Hub task not created yet:", error instanceof Error ? error.message : error);
        await sql`UPDATE career_applications SET hub_status='retrying',hub_lease_owner=NULL,hub_leased_until=NULL,hub_error=${(error instanceof Error ? error.message : "Hub not reachable").slice(0, 200)},hub_next_attempt_at=now()+interval '1 minute' WHERE id=${saved.id}`;
      }
    }
    return done();
  } catch (error) {
    console.error("careers: application failed", error);
    return reply({ error: { message: "Sorry, we could not save your application. Please try again later." } }, 500, cors);
  }
}
