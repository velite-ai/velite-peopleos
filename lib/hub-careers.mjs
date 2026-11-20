// Sends one careers application to Velite Hub as a task, through the Supabase function hub_careers_task (supabase/careers_task.sql in velite-hub).
// Plain JS so the web app and scripts/worker.mjs share it. The Hub builds HTML emails from the task title and details WITHOUT escaping them,
// so every text sent there is stripped of < and > and control characters first.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function hubText(value, max) {
  return String(value ?? "").replace(/[<>]/g, " ").replace(CONTROL, " ").replace(/[ \t]+/g, " ").trim().slice(0, max);
}

// The Hub's firm codes: Velite Pharmaceuticals VP, Healthcare VH, India VI, Sciences VS. Others 1 / Others 2 have none.
export function firmCode(companyName) {
  const name = String(companyName || "").toLowerCase();
  if (name.includes("pharmaceutical")) return "VP";
  if (name.includes("healthcare")) return "VH";
  if (name.includes("india")) return "VI";
  if (name.includes("sciences")) return "VS";
  return null;
}

export function buildHubTask(app, company, appUrl) {
  const title = hubText(`New job application: ${app.position} - ${app.full_name}`, 200).replace(/\s+/g, " ");
  const lines = [
    `Applicant: ${hubText(app.full_name, 120)}`,
    `Position: ${hubText(app.position, 120)}`,
    app.phone ? `Phone: ${hubText(app.phone, 40)}` : null,
    app.email ? `Email: ${hubText(app.email, 160)}` : null,
    app.city ? `City: ${hubText(app.city, 80)}` : null,
    `Company: ${hubText(company, 80)}`,
    app.message ? `Message: ${hubText(app.message, 1200)}` : null,
    app.resume_url ? `Resume link (open only if you trust it): ${hubText(app.resume_url, 500)}` : null,
    `Open in PeopleOS: ${String(appUrl || "https://hr.velite.in").replace(/\/$/, "")} (Hiring, then Candidate pipeline)`,
  ].filter(Boolean);
  return { title, description: lines.join("\n").slice(0, 3800), firm: firmCode(company) };
}

export function hubConfig(env = process.env) {
  const url = String(env.HUB_SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = String(env.HUB_SUPABASE_ANON_KEY || "").trim();
  const secret = String(env.HUB_CAREERS_SECRET || "").trim();
  if (!url || !key || !secret || !/^https:\/\//.test(url)) return null;
  return { url, key, secret };
}

/** Creates the Hub task and returns its id. Throws on any failure (the caller records it and the worker retries). */
export async function sendToHub(task, config, timeoutMs = 8000) {
  const response = await fetch(`${config.url}/rest/v1/rpc/hub_careers_task`, {
    method: "POST",
    // A classic anon key is a JWT and is also sent as the bearer token. The newer "publishable" keys (sb_publishable_...) are not JWTs and go in `apikey` only.
    headers: { "content-type": "application/json", apikey: config.key, ...(config.key.startsWith("eyJ") ? { authorization: `Bearer ${config.key}` } : {}) },
    body: JSON.stringify({ p_secret: config.secret, p_title: task.title, p_description: task.description, p_firm: task.firm, p_due_days: 3 }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`The Hub answered ${response.status}`);
  const body = await response.json().catch(() => null);
  return typeof body === "string" ? body : null;
}
