import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { allowedOrigins, cleanBlock, cleanLine, originAllowed, parseApplication, safeRedirect } from "../lib/careers-rules.ts";
import { buildHubTask, firmCode, hubConfig, hubText } from "../lib/hub-careers.mjs";

const good = { fullName: "Anita  Sharma", email: "Anita@Example.com", phone: "+91 98765-43210", position: "QA Chemist", city: "Ludhiana", message: "I have 3 years of experience.", consent: "on" };

test("a good application is cleaned", () => {
  const r = parseApplication(good);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { fullName: "Anita Sharma", email: "anita@example.com", phone: "+919876543210", position: "QA Chemist", city: "Ludhiana", message: "I have 3 years of experience.", resumeUrl: null });
});

test("name, position, a way to reach the person and consent are required", () => {
  assert.match(parseApplication({ ...good, fullName: "A" }).message, /name/i);
  assert.match(parseApplication({ ...good, position: "" }).message, /position/i);
  assert.match(parseApplication({ ...good, email: "", phone: "" }).message, /email or a phone/i);
  assert.match(parseApplication({ ...good, email: "not-an-email" }).message, /email/i);
  assert.match(parseApplication({ ...good, phone: "12" }).message, /phone/i);
  assert.match(parseApplication({ ...good, consent: "" }).message, /tick the box/i);
  assert.equal(parseApplication({ ...good, email: "" }).ok, true);   // phone alone is enough
  assert.equal(parseApplication({ ...good, phone: "" }).ok, true);   // email alone is enough
});

test("bots are dropped silently: filled trap field or a link-stuffed message", () => {
  assert.deepEqual(parseApplication({ ...good, website: "http://spam.example" }), { ok: false, spam: true });
  assert.deepEqual(parseApplication({ ...good, message: "http://a.com http://b.com http://c.com http://d.com" }), { ok: false, spam: true });
});

test("text is cleaned and limited", () => {
  assert.equal(cleanLine("  a\u0000  b\n c ", 10), "a b c");
  assert.equal(cleanLine("x".repeat(300), 120).length, 120);
  assert.equal(cleanBlock("a\r\n\r\n\r\n\r\nb", 50), "a\n\nb");
});

test("only the company's own websites may post, and redirects stay on them", () => {
  const list = allowedOrigins(undefined);
  assert.deepEqual(list, ["https://www.velite.in", "https://velite.in"]);
  assert.equal(originAllowed("https://www.velite.in", list), true);
  assert.equal(originAllowed("https://www.velite.in.evil.com", list), false);
  assert.equal(originAllowed("http://www.velite.in", list), false);
  assert.equal(originAllowed(null, list), false);
  assert.equal(safeRedirect("https://www.velite.in/careers/thanks", list), "https://www.velite.in/careers/thanks");
  assert.equal(safeRedirect("https://evil.com/x", list), null);
  assert.equal(safeRedirect("javascript:alert(1)", list), null);
});

test("Hub text has no < or > (the Hub builds HTML emails from it) and the firm code follows the company", () => {
  assert.equal(hubText("<script>alert(1)</script> Hi", 100), "script alert(1) /script Hi");
  const task = buildHubTask({ full_name: "A <b>B</b>", position: "QA", phone: "+91999", email: "a@b.co", city: "Ludhiana", message: "hi <img src=x>" }, "Velite Healthcare", "https://hr.velite.in");
  assert.doesNotMatch(task.title + task.description, /[<>]/);
  assert.equal(task.firm, "VH");
  assert.match(task.title, /^New job application: QA - /);
  assert.match(task.description, /Open in PeopleOS: https:\/\/hr\.velite\.in/);
  assert.equal(firmCode("Velite Pharmaceuticals"), "VP");
  assert.equal(firmCode("Velite India"), "VI");
  assert.equal(firmCode("Velite Sciences Pvt Ltd."), "VS");
  assert.equal(firmCode("Others 1"), null);
});

test("the Hub is only used when all three settings are present and it is https", () => {
  assert.equal(hubConfig({}), null);
  assert.equal(hubConfig({ HUB_SUPABASE_URL: "https://x.supabase.co", HUB_SUPABASE_ANON_KEY: "k" }), null);
  assert.equal(hubConfig({ HUB_SUPABASE_URL: "http://x.supabase.co", HUB_SUPABASE_ANON_KEY: "k", HUB_CAREERS_SECRET: "s" }), null);
  assert.deepEqual(hubConfig({ HUB_SUPABASE_URL: "https://x.supabase.co/", HUB_SUPABASE_ANON_KEY: "k", HUB_CAREERS_SECRET: "s" }), { url: "https://x.supabase.co", key: "k", secret: "s" });
});

test("the careers address is public, saves the candidate and notifies HR, and the worker retries the Hub", async () => {
  assert.match(await readFile("proxy.ts", "utf8"), /"\/api\/public\/careers"/);
  const route = await readFile("app/api/public/careers/route.ts", "utf8");
  assert.match(route, /INSERT INTO candidates/);
  assert.match(route, /INSERT INTO notifications/);
  assert.match(route, /INSERT INTO career_applications/);
  assert.match(route, /originAllowed/);
  assert.match(await readFile("scripts/worker.mjs", "utf8"), /deliverHubTasks/);
});

test("the Hub call sends a classic anon key as bearer too, but a publishable key only as apikey", async () => {
  const { sendToHub } = await import("../lib/hub-careers.mjs");
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => { seen.push({ url, headers: init.headers }); return new Response(JSON.stringify("11111111-2222-3333-4444-555555555555"), { status: 200 }); };
  try {
    const task = { title: "t", description: "d", firm: "VH" };
    await sendToHub(task, { url: "https://x.supabase.co", key: "eyJhbGciOi.payload.sig", secret: "s" });
    await sendToHub(task, { url: "https://x.supabase.co", key: "sb_publishable_abc", secret: "s" });
  } finally { globalThis.fetch = original; }
  assert.equal(seen[0].headers.authorization, "Bearer eyJhbGciOi.payload.sig");
  assert.equal(seen[1].headers.apikey, "sb_publishable_abc");
  assert.equal(seen[1].headers.authorization, undefined);
  assert.match(seen[1].url, /\/rest\/v1\/rpc\/hub_careers_task$/);
});

test("a notification link opens the right area: ?module=Name, or the old calendar links", async () => {
  const { notificationModule } = await import("../lib/notification-links.ts");
  const known = ["Overview", "Recruitment", "HR Calendar"];
  assert.equal(notificationModule("/?module=Recruitment", known), "Recruitment");
  assert.equal(notificationModule("/calendar?eventId=abc", known), "HR Calendar");
  assert.equal(notificationModule("/?module=Nonsense", known), null);
  assert.equal(notificationModule("/", known), null);
  assert.equal(notificationModule(null, known), null);
  assert.equal(notificationModule("https://evil.example/?module=Recruitment", known), "Recruitment"); // only the area name is used, never the address
});

test("the bell opens a list instead of jumping to the calendar", async () => {
  const page = await readFile("app/page.tsx", "utf8");
  assert.match(page, /notice-menu/);
  assert.match(page, /Mark all as read/);
  assert.doesNotMatch(page, /function openNotifications/);
  assert.match(await readFile("app/api/public/careers/route.ts", "utf8"), /\?module=Recruitment/);
});

test("the Wix form: first and last name, department as the position, a nested body and a resume link", () => {
  const wix = { data: { firstName: "Anita", lastName: "Sharma", email: "a@b.co", phone: "9876543210", department: "Production", resumeUrl: "https://example.filesusr.com/ugd/resume.pdf", consent: true } };
  const r = parseApplication(wix);
  assert.equal(r.ok, true);
  assert.equal(r.value.fullName, "Anita Sharma");
  assert.equal(r.value.position, "Production");
  assert.equal(r.value.resumeUrl, "https://example.filesusr.com/ugd/resume.pdf");
  assert.equal(parseApplication({ ...wix.data, resumeUrl: "javascript:alert(1)" }).value.resumeUrl, null);
  assert.equal(parseApplication({ ...wix.data, resumeUrl: "http://plain.example/x.pdf" }).value.resumeUrl, null);
  assert.equal(parseApplication({ ...wix.data, resumeUrl: "https://a.example/x y" }).value.resumeUrl, null);
});

test("the form key can come as a header or as ?key= and a keyed form is not limited per visitor", async () => {
  const route = await readFile("app/api/public/careers/route.ts", "utf8");
  assert.match(route, /searchParams\.get\("key"\)/);
  assert.match(route, /!viaKey && load\.mine >= 5/);
  assert.match(await readFile("database/033_career_resume_url.sql", "utf8"), /resume_url/);
});
