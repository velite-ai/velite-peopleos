import postgres from "postgres";
import { createDecipheriv, createHash, createHmac, randomUUID } from "node:crypto";
import { hostname } from "node:os";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for the worker");

function positiveInteger(name, fallback, minimum = 1) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

const sql = postgres(databaseUrl, {
  max: positiveInteger("WORKER_DB_POOL_SIZE", 5),
  idle_timeout: 20,
  connect_timeout: 10,
});
const workerId = randomUUID();
const workerName = process.env.WORKER_NAME || hostname();
const workerVersion = process.env.APP_VERSION || process.env.SOURCE_COMMIT || null;
const intervalMs = positiveInteger("WORKER_INTERVAL_MS", 300_000, 60_000);
const leaseMs = positiveInteger("WORKER_LEASE_MS", 600_000, 60_000);
const heartbeatMs = positiveInteger("WORKER_HEARTBEAT_MS", 30_000, 10_000);
const maxAttempts = positiveInteger("WORKER_MAX_ATTEMPTS", 8);
const requestTimeoutMs = positiveInteger("WORKER_REQUEST_TIMEOUT_MS", 30_000, 1_000);

function log(level, event, fields = {}) {
  const output = { level, event, at: new Date().toISOString(), workerId, workerName, ...fields };
  (level === "error" ? console.error : console.log)(JSON.stringify(output));
}

function errorMessage(error) {
  return error instanceof Error ? error.message.slice(0, 1_000) : "Unknown error";
}

function retryAt(attempt) {
  const delay = Math.min(6 * 60 * 60 * 1_000, 30_000 * (2 ** Math.max(0, attempt - 1)));
  const jitter = Math.floor(delay * Math.random() * 0.1);
  return new Date(Date.now() + delay + jitter);
}

function leaseUntil() {
  return new Date(Date.now() + leaseMs);
}

async function mapLimit(items, concurrency, handler) {
  const results = new Array(items.length);
  let cursor = 0;
  async function runner() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await handler(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
  return results;
}

function summarize(results, prefix) {
  return results.reduce((summary, result) => {
    const key = `${prefix}${result[0].toUpperCase()}${result.slice(1)}`;
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, {});
}

function decryptSecret(value) {
  const encoded = process.env.DATA_ENCRYPTION_KEY;
  if (!encoded) throw new Error("DATA_ENCRYPTION_KEY is required for webhook delivery");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must decode to 32 bytes");
  const bytes = Buffer.from(value);
  if (bytes[0] !== 1 || bytes.length < 30) throw new Error("Unsupported encrypted webhook secret format");
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(1, 13));
  decipher.setAuthTag(bytes.subarray(13, 29));
  const decoded = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(29)), decipher.final()]).toString("utf8"));
  if (!decoded || typeof decoded.secret !== "string" || !decoded.secret) throw new Error("Webhook signing secret is invalid");
  return decoded.secret;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function storageConfigured() {
  return Boolean(
    process.env.STORAGE_ENDPOINT && process.env.STORAGE_BUCKET &&
    process.env.STORAGE_ACCESS_KEY && process.env.STORAGE_SECRET_KEY,
  );
}

function encodeAws(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function hmac(key, value) {
  return createHmac("sha256", key).update(value).digest();
}

function awsStamp(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function presignObject(method, objectKey, expires = 600) {
  const endpoint = new URL(required("STORAGE_ENDPOINT"));
  const bucket = required("STORAGE_BUCKET");
  const access = required("STORAGE_ACCESS_KEY");
  const secret = required("STORAGE_SECRET_KEY");
  const region = process.env.STORAGE_REGION || "us-east-1";
  const now = new Date();
  const amzDate = awsStamp(now);
  const date = amzDate.slice(0, 8);
  const credentialScope = `${date}/${region}/s3/aws4_request`;
  const path = [endpoint.pathname.replace(/\/$/, ""), bucket, ...objectKey.split("/")]
    .filter(Boolean)
    .map((part, index) => index === 0 && part.startsWith("/") ? part : encodeAws(part))
    .join("/");
  const canonicalUri = path.startsWith("/") ? path : `/${path}`;
  const params = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${access}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(Math.min(900, expires)),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeAws(key)}=${encodeAws(value)}`)
    .join("&");
  const canonicalRequest = [method, canonicalUri, canonicalQuery, `host:${endpoint.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  return `${endpoint.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

function ascii(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapLine(value, width = 88) {
  const words = ascii(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (!current) current = word;
    else if (`${current} ${word}`.length <= width) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function createPdf(lines) {
  const printable = lines.flatMap((line) => wrapLine(line)).slice(0, 45);
  const operations = ["BT", "/F1 16 Tf", "1 0 0 1 50 790 Tm"];
  printable.forEach((line, index) => {
    if (index === 1) operations.push("/F1 10 Tf");
    operations.push(`(${line}) Tj`, `0 -${index === 0 ? 28 : 16} Td`);
  });
  operations.push("ET");
  const stream = operations.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let document = "%PDF-1.4\n%Velite\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    document += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document, "ascii");
}

function money(value) {
  const amount = Number(value || 0);
  return `INR ${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
}

function payslipLines(source) {
  const snapshot = source.snapshot || {};
  const employee = snapshot.employee || {};
  const attendance = snapshot.attendance || {};
  const totals = snapshot.totals || {};
  return [
    "VELITE - PAYSLIP",
    `Salary period: ${snapshot.periodMonth || source.period_month || ""}`,
    `Pay date: ${snapshot.payDate || source.pay_date || ""}`,
    "",
    `Employee: ${employee.name || source.employee_name}`,
    `Employee code: ${employee.employeeCode || source.employee_code}`,
    `Position: ${employee.position || source.position || ""}`,
    "",
    `Calendar days: ${attendance.calendarDays ?? ""}`,
    `Payable days: ${attendance.payableDays ?? ""}`,
    `Absent days: ${attendance.absentDays ?? ""}`,
    "",
    `Gross earnings: ${money(totals.grossEarnings)}`,
    `Deductions: ${money(totals.deductions)}`,
    `Net pay: ${money(totals.netPay)}`,
    `Employer cost: ${money(totals.employerCost)}`,
    "",
    "This document was generated from the locked payroll snapshot.",
  ];
}

function letterLines(source) {
  const snapshot = source.snapshot || {};
  const details = Object.entries(snapshot)
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 28)
    .map(([key, value]) => `${key.replace(/([A-Z])/g, " $1")}: ${value}`);
  return [
    `VELITE - ${String(source.letter_type || "EMPLOYEE LETTER").replaceAll("_", " ").toUpperCase()}`,
    `Effective date: ${source.effective_date || ""}`,
    `Employee: ${source.employee_name}`,
    `Employee code: ${source.employee_code}`,
    "",
    ...details,
    "",
    "This letter was generated from an approved, versioned HR snapshot.",
  ];
}

function finalSettlementLines(source) {
  const snapshot = source.snapshot || {};
  const result = snapshot.result || {};
  const separation = snapshot.separation || {};
  const attendance = snapshot.attendance || {};
  const lines = Array.isArray(result.items) ? result.items : [];
  return [
    "VELITE - FULL AND FINAL SETTLEMENT",
    `Employee: ${source.employee_name}`,
    `Employee code: ${source.employee_code}`,
    `Position: ${source.position || ""}`,
    `Last working date: ${separation.lastWorkingDate || source.last_working_date || ""}`,
    `Settlement status: ${String(source.status || "").replaceAll("_", " ")}`,
    "",
    `Calendar days: ${attendance.expected_days ?? attendance.expectedDays ?? ""}`,
    `Payable days: ${attendance.payableDays ?? ""}`,
    ...lines.slice(0, 20).map((line) => `${line.label || line.code || "Settlement item"}: ${money(line.amount)}`),
    "",
    `Gross payable: ${money(source.gross_payable)}`,
    `Recoveries: ${money(source.recoveries)}`,
    `Net payable: ${money(source.net_payable)}`,
    `Payment / collection reference: ${source.payment_reference || ""}`,
    "",
    "This statement was generated from the approved immutable final-settlement snapshot.",
  ];
}

async function claimWebhooks() {
  return sql.begin(async (transaction) => transaction`
    WITH candidates AS (
      SELECT d.id
      FROM webhook_deliveries d
      JOIN outbound_webhooks w ON w.id=d.webhook_id AND w.active=true
      WHERE d.attempts < ${maxAttempts}
        AND (
          (d.status IN ('pending','retrying') AND d.next_attempt_at<=now()) OR
          (d.status='processing' AND (d.leased_until IS NULL OR d.leased_until<now()))
        )
      ORDER BY d.next_attempt_at,d.created_at
      FOR UPDATE OF d SKIP LOCKED
      LIMIT 25
    )
    UPDATE webhook_deliveries d
    SET status='processing',attempts=d.attempts+1,last_attempt_at=now(),
        lease_owner=${workerId},leased_until=${leaseUntil()},last_error=NULL
    FROM candidates c,outbound_webhooks w
    WHERE d.id=c.id AND w.id=d.webhook_id
    RETURNING d.id,d.event_type,d.event_id,d.payload,d.attempts,
      w.endpoint_url,w.signing_secret_encrypted
  `);
}

async function finishWebhook(item, values) {
  return sql`
    UPDATE webhook_deliveries
    SET status=${values.status},lease_owner=NULL,leased_until=NULL,
        response_status=${values.responseStatus},response_excerpt=${values.excerpt},
        last_error=${values.error},next_attempt_at=${values.nextAttempt}
    WHERE id=${item.id} AND status='processing' AND lease_owner=${workerId}
    RETURNING id
  `;
}

async function processWebhook(item) {
  try {
    const body = JSON.stringify(item.payload);
    const signature = createHmac("sha256", decryptSecret(item.signing_secret_encrypted)).update(body).digest("hex");
    const response = await fetch(item.endpoint_url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": item.id,
        "x-velite-event": item.event_type,
        "x-velite-delivery": item.id,
        "x-velite-signature": `sha256=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    const excerpt = (await response.text()).slice(0, 500);
    const terminal = Number(item.attempts) >= maxAttempts;
    const [updated] = await finishWebhook(item, response.ok ? {
      status: "delivered", responseStatus: response.status, excerpt, error: null, nextAttempt: new Date(),
    } : {
      status: terminal ? "failed" : "retrying",
      responseStatus: response.status,
      excerpt,
      error: `Endpoint returned ${response.status}`,
      nextAttempt: retryAt(Number(item.attempts)),
    });
    return updated ? (response.ok ? "delivered" : "failed") : "leaseLost";
  } catch (error) {
    const terminal = Number(item.attempts) >= maxAttempts;
    const [updated] = await finishWebhook(item, {
      status: terminal ? "failed" : "retrying",
      responseStatus: null,
      excerpt: null,
      error: errorMessage(error),
      nextAttempt: retryAt(Number(item.attempts)),
    });
    return updated ? "failed" : "leaseLost";
  }
}

async function deliverWebhooks() {
  const items = await claimWebhooks();
  if (!items.length) return { webhooksClaimed: 0 };
  const results = await mapLimit(items, 5, processWebhook);
  return { webhooksClaimed: items.length, ...summarize(results, "webhooks") };
}

async function claimEmails() {
  return sql.begin(async (transaction) => transaction`
    WITH candidates AS (
      SELECT n.id
      FROM notifications n
      JOIN users u ON u.id=n.recipient_user_id AND u.active=true
      WHERE n.deliver_on<=current_date AND n.email_attempts<${maxAttempts}
        AND (
          (n.email_status IN ('pending','retrying') AND n.email_next_attempt_at<=now()) OR
          (n.email_status='sending' AND (n.email_leased_until IS NULL OR n.email_leased_until<now()))
        )
      ORDER BY n.email_next_attempt_at,n.created_at
      FOR UPDATE OF n SKIP LOCKED
      LIMIT 50
    )
    UPDATE notifications n
    SET email_status='sending',email_attempts=n.email_attempts+1,email_last_attempt_at=now(),
        email_lease_owner=${workerId},email_leased_until=${leaseUntil()},email_error=NULL
    FROM candidates c,users u
    WHERE n.id=c.id AND u.id=n.recipient_user_id
    RETURNING n.id,n.title,n.body,n.action_path,n.email_attempts,u.email,u.full_name
  `);
}

async function finishEmail(item, values) {
  return sql`
    UPDATE notifications
    SET email_status=${values.status},email_lease_owner=NULL,email_leased_until=NULL,
        email_delivered_at=${values.deliveredAt},email_error=${values.error},
        email_next_attempt_at=${values.nextAttempt}
    WHERE id=${item.id} AND email_status='sending' AND email_lease_owner=${workerId}
    RETURNING id
  `;
}

async function processEmail(item, endpoint) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": item.id,
        "x-velite-notification": item.id,
        ...(process.env.EMAIL_DELIVERY_TOKEN ? { authorization: `Bearer ${process.env.EMAIL_DELIVERY_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        to: item.email,
        recipientName: item.full_name,
        subject: item.title,
        text: item.body || item.title,
        actionUrl: item.action_path
          ? new URL(item.action_path, process.env.APP_URL || "https://hr.velite.in").toString()
          : null,
      }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    await response.arrayBuffer().catch(() => new ArrayBuffer(0));
    const terminal = Number(item.email_attempts) >= maxAttempts;
    const [updated] = await finishEmail(item, response.ok ? {
      status: "delivered", deliveredAt: new Date(), error: null, nextAttempt: new Date(),
    } : {
      status: terminal ? "failed" : "retrying",
      deliveredAt: null,
      error: `Delivery service returned ${response.status}`,
      nextAttempt: retryAt(Number(item.email_attempts)),
    });
    return updated ? (response.ok ? "delivered" : "failed") : "leaseLost";
  } catch (error) {
    const terminal = Number(item.email_attempts) >= maxAttempts;
    const [updated] = await finishEmail(item, {
      status: terminal ? "failed" : "retrying",
      deliveredAt: null,
      error: errorMessage(error),
      nextAttempt: retryAt(Number(item.email_attempts)),
    });
    return updated ? "failed" : "leaseLost";
  }
}

async function deliverEmailNotifications() {
  const endpoint = process.env.EMAIL_DELIVERY_URL;
  if (!endpoint) return { emailsSkipped: "not_configured" };
  const items = await claimEmails();
  if (!items.length) return { emailsClaimed: 0 };
  const results = await mapLimit(items, 10, (item) => processEmail(item, endpoint));
  return { emailsClaimed: items.length, ...summarize(results, "emails") };
}

async function claimScans() {
  return sql.begin(async (transaction) => transaction`
    WITH candidates AS (
      SELECT id
      FROM documents
      WHERE scan_attempts<${maxAttempts}
        AND (
          (scan_status IN ('pending','error','not_configured') AND scan_next_attempt_at<=now()) OR
          (scan_status='scanning' AND (scan_leased_until IS NULL OR scan_leased_until<now()))
        )
      ORDER BY scan_next_attempt_at,created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 12
    )
    UPDATE documents d
    SET scan_status='scanning',scan_attempts=d.scan_attempts+1,
        scan_lease_owner=${workerId},scan_leased_until=${leaseUntil()}
    FROM candidates c
    WHERE d.id=c.id
    RETURNING d.id,d.object_key,d.file_name,d.content_type,d.scan_attempts
  `);
}

async function processScan(item, endpoint) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `scan-${item.id}-${item.scan_attempts}`,
        ...(process.env.MALWARE_SCAN_TOKEN ? { authorization: `Bearer ${process.env.MALWARE_SCAN_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        objectUrl: presignObject("GET", item.object_key, 300),
        fileName: item.file_name,
        contentType: item.content_type,
      }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Malware scanner returned ${response.status}`);
    if (result.clean !== true && result.clean !== false) throw new Error("Malware scanner returned no clean verdict");
    const status = result.clean ? "clean" : "infected";
    const [updated] = await sql`
      UPDATE documents
      SET scan_status=${status},scanned_at=now(),
          scan_details=${JSON.stringify({
            engine: result.engine || "configured-scanner",
            signature: result.signature || (result.clean ? null : "detected"),
            attempt: Number(item.scan_attempts),
          })}::jsonb,
          scan_lease_owner=NULL,scan_leased_until=NULL
      WHERE id=${item.id} AND scan_status='scanning' AND scan_lease_owner=${workerId}
      RETURNING id
    `;
    return updated ? status : "leaseLost";
  } catch (error) {
    const terminal = Number(item.scan_attempts) >= maxAttempts;
    const [updated] = await sql`
      UPDATE documents
      SET scan_status='error',scanned_at=now(),
          scan_details=${JSON.stringify({ error: errorMessage(error), terminal, attempt: Number(item.scan_attempts) })}::jsonb,
          scan_next_attempt_at=${retryAt(Number(item.scan_attempts))},
          scan_lease_owner=NULL,scan_leased_until=NULL
      WHERE id=${item.id} AND scan_status='scanning' AND scan_lease_owner=${workerId}
      RETURNING id
    `;
    return updated ? "failed" : "leaseLost";
  }
}

async function scanDocuments() {
  const endpoint = process.env.MALWARE_SCAN_URL;
  if (!endpoint) return { scansSkipped: "scanner_not_configured" };
  if (!storageConfigured()) return { scansSkipped: "storage_not_configured" };
  const items = await claimScans();
  if (!items.length) return { scansClaimed: 0 };
  const results = await mapLimit(items, 3, (item) => processScan(item, endpoint));
  return { scansClaimed: items.length, ...summarize(results, "scans") };
}

async function claimDocumentJobs() {
  return sql.begin(async (transaction) => transaction`
    WITH candidates AS (
      SELECT id
      FROM document_generation_jobs
      WHERE attempts<${maxAttempts}
        AND (
          (status IN ('pending','failed') AND next_attempt_at<=now()) OR
          (status='processing' AND (leased_until IS NULL OR leased_until<now()))
        )
      ORDER BY next_attempt_at,created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 10
    )
    UPDATE document_generation_jobs j
    SET status='processing',attempts=j.attempts+1,last_attempt_at=now(),
        lease_owner=${workerId},leased_until=${leaseUntil()},error_message=NULL
    FROM candidates c
    WHERE j.id=c.id
    RETURNING j.id,j.job_type,j.source_record_id,j.requested_by,j.attempts
  `);
}

async function loadDocumentSource(job) {
  if (job.job_type === "payslip") {
    const [source] = await sql`
      SELECT p.id,p.snapshot,r.employee_id,e.business_head_id,e.employee_code,e.position,
        concat_ws(' ',e.first_name,e.last_name) AS employee_name,
        pp.period_month,pp.pay_date
      FROM payslips p
      JOIN payroll_results r ON r.id=p.payroll_result_id
      JOIN payroll_periods pp ON pp.id=r.payroll_period_id
      JOIN employees e ON e.id=r.employee_id
      WHERE p.id=${job.source_record_id}
    `;
    return source || null;
  }
  if (job.job_type === "letter") {
    const [source] = await sql`
      SELECT l.id,l.snapshot,l.letter_type,l.effective_date,l.employee_id,
        e.business_head_id,e.employee_code,e.position,
        concat_ws(' ',e.first_name,e.last_name) AS employee_name
      FROM generated_letters l
      JOIN employees e ON e.id=l.employee_id
      WHERE l.id=${job.source_record_id}
    `;
    return source || null;
  }
  if (job.job_type === "final_settlement") {
    const [source] = await sql`
      SELECT f.id,f.calculation AS snapshot,f.status,f.gross_payable,f.recoveries,f.net_payable,
        f.payment_reference,s.approved_last_working_date AS last_working_date,s.employee_id,
        e.business_head_id,e.employee_code,e.position,
        concat_ws(' ',e.first_name,e.last_name) AS employee_name
      FROM final_settlements f
      JOIN separations s ON s.id=f.separation_id
      JOIN employees e ON e.id=s.employee_id
      WHERE f.id=${job.source_record_id} AND f.status='completed'
    `;
    return source || null;
  }
  return null;
}

async function uploadGeneratedDocument(job, source) {
  const safeCode = String(source.employee_code || "employee").replace(/[^a-zA-Z0-9_-]/g, "-");
  const suffix = job.job_type === "payslip"
    ? String(source.period_month || "period").slice(0, 7)
    : job.job_type === "final_settlement"
      ? String(source.last_working_date || "settlement").slice(0, 10)
      : String(source.letter_type || "letter").replace(/[^a-zA-Z0-9_-]/g, "-");
  const fileName = `${job.job_type}-${safeCode}-${suffix}.pdf`;
  const objectKey = `generated/${job.job_type}/${source.business_head_id}/${source.employee_id}/${job.source_record_id}.pdf`;
  const file = createPdf(job.job_type === "payslip" ? payslipLines(source) : job.job_type === "final_settlement" ? finalSettlementLines(source) : letterLines(source));
  const response = await fetch(presignObject("PUT", objectKey, 300), {
    method: "PUT",
    headers: { "content-type": "application/pdf" },
    body: file,
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!response.ok) throw new Error(`Document storage returned ${response.status}`);
  await response.arrayBuffer().catch(() => new ArrayBuffer(0));
  return { file, fileName, objectKey };
}

async function processDocumentJob(job) {
  try {
    const source = await loadDocumentSource(job);
    if (!source) {
      const [updated] = await sql`
        UPDATE document_generation_jobs
        SET status='failed',attempts=${maxAttempts},error_message='Source record was not found',
            lease_owner=NULL,leased_until=NULL,next_attempt_at=now()
        WHERE id=${job.id} AND status='processing' AND lease_owner=${workerId}
        RETURNING id
      `;
      return updated ? "failed" : "leaseLost";
    }
    const generated = await uploadGeneratedDocument(job, source);
    const completed = await sql.begin(async (transaction) => {
      const [document] = await transaction`
        INSERT INTO documents (
          employee_id,category,file_name,object_key,content_type,size_bytes,
          scan_status,scan_next_attempt_at,scan_details
        ) VALUES (
          ${source.employee_id},${job.job_type === "payslip" ? "payslip" : job.job_type === "final_settlement" ? "final_settlement" : "letter"},
          ${generated.fileName},${generated.objectKey},'application/pdf',${generated.file.length},
          'pending',now(),'{}'::jsonb
        )
        ON CONFLICT (object_key) DO UPDATE SET
          file_name=EXCLUDED.file_name,content_type=EXCLUDED.content_type,size_bytes=EXCLUDED.size_bytes
        RETURNING id
      `;
      if (job.job_type === "payslip") {
        await transaction`UPDATE payslips SET document_id=${document.id} WHERE id=${job.source_record_id}`;
      } else if (job.job_type === "letter") {
        await transaction`UPDATE generated_letters SET document_id=${document.id} WHERE id=${job.source_record_id}`;
      } else {
        await transaction`UPDATE final_settlements SET document_id=${document.id},updated_at=now() WHERE id=${job.source_record_id}`;
      }
      const rows = await transaction`
        UPDATE document_generation_jobs
        SET status='completed',document_id=${document.id},completed_at=now(),error_message=NULL,
            lease_owner=NULL,leased_until=NULL
        WHERE id=${job.id} AND status='processing' AND lease_owner=${workerId}
        RETURNING id
      `;
      if (!rows.length) throw new Error("Document generation lease expired before commit");
      await transaction`
        INSERT INTO audit_events (
          actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason
        ) VALUES (
          ${job.requested_by},'document.generated','document',${document.id},${source.business_head_id},
          ${JSON.stringify({ jobId: job.id, jobType: job.job_type, sourceRecordId: job.source_record_id })}::jsonb,
          'Background worker generated a private document from an immutable snapshot'
        )
      `;
      return rows.length;
    });
    return completed ? "completed" : "leaseLost";
  } catch (error) {
    const terminal = Number(job.attempts) >= maxAttempts;
    const [updated] = await sql`
      UPDATE document_generation_jobs
      SET status='failed',error_message=${errorMessage(error)},next_attempt_at=${retryAt(Number(job.attempts))},
          lease_owner=NULL,leased_until=NULL
      WHERE id=${job.id} AND status='processing' AND lease_owner=${workerId}
      RETURNING id
    `;
    if (terminal) log("error", "worker.document_terminal_failure", { jobId: job.id, jobType: job.job_type });
    return updated ? "failed" : "leaseLost";
  }
}

async function generateDocuments() {
  if (!storageConfigured()) return { documentsSkipped: "storage_not_configured" };
  const jobs = await claimDocumentJobs();
  if (!jobs.length) return { documentsClaimed: 0 };
  const results = await mapLimit(jobs, 3, processDocumentJob);
  return { documentsClaimed: jobs.length, ...summarize(results, "documents") };
}

async function ensureLifecycleEvents() {
  return sql.begin(async (transaction) => {
    const [lock] = await transaction`SELECT pg_try_advisory_xact_lock(8642026) AS acquired`;
    if (!lock?.acquired) return { lifecycleSkipped: "another_worker" };

    const probation = await transaction`
      INSERT INTO hr_calendar_events (
        business_head_id,employee_id,event_type,title,event_date,
        source_record_type,source_record_id,reminder_rules
      )
      SELECT e.business_head_id,e.id,'probation_review',
        'Probation review: '||concat_ws(' ',e.first_name,e.last_name),e.probation_end_date-15,
        'employee',e.id,'[{"daysBefore":7,"roles":["MANAGER","HR_OPERATIONS"]}]'::jsonb
      FROM employees e
      WHERE e.status='probation' AND e.probation_end_date IS NOT NULL
      ON CONFLICT (source_record_type,source_record_id,event_type) WHERE source_record_id IS NOT NULL
      DO UPDATE SET business_head_id=EXCLUDED.business_head_id,employee_id=EXCLUDED.employee_id,
        title=EXCLUDED.title,event_date=EXCLUDED.event_date,reminder_rules=EXCLUDED.reminder_rules,status='upcoming'
      RETURNING id
    `;
    const confirmation = await transaction`
      INSERT INTO hr_calendar_events (
        business_head_id,employee_id,event_type,title,event_date,
        source_record_type,source_record_id,reminder_rules
      )
      SELECT e.business_head_id,e.id,'confirmation_due',
        'Confirmation due: '||concat_ws(' ',e.first_name,e.last_name),e.probation_end_date,
        'employee',e.id,'[{"daysBefore":15,"roles":["MANAGER","HR_OPERATIONS"]}]'::jsonb
      FROM employees e
      WHERE e.status='probation' AND e.probation_end_date IS NOT NULL
      ON CONFLICT (source_record_type,source_record_id,event_type) WHERE source_record_id IS NOT NULL
      DO UPDATE SET business_head_id=EXCLUDED.business_head_id,employee_id=EXCLUDED.employee_id,
        title=EXCLUDED.title,event_date=EXCLUDED.event_date,reminder_rules=EXCLUDED.reminder_rules,status='upcoming'
      RETURNING id
    `;
    const revisions = await transaction`
      INSERT INTO hr_calendar_events (
        business_head_id,employee_id,event_type,title,event_date,
        source_record_type,source_record_id,reminder_rules
      )
      SELECT e.business_head_id,e.id,'salary_revision',
        'Salary revision eligibility: '||concat_ws(' ',e.first_name,e.last_name),e.next_salary_revision_date,
        'employee',e.id,'[{"daysBefore":30,"roles":["HR_ADMIN"]}]'::jsonb
      FROM employees e
      WHERE e.status IN ('probation','active') AND e.next_salary_revision_date IS NOT NULL
      ON CONFLICT (source_record_type,source_record_id,event_type) WHERE source_record_id IS NOT NULL
      DO UPDATE SET business_head_id=EXCLUDED.business_head_id,employee_id=EXCLUDED.employee_id,
        title=EXCLUDED.title,event_date=EXCLUDED.event_date,reminder_rules=EXCLUDED.reminder_rules,status='upcoming'
      RETURNING id
    `;
    const separations = await transaction`
      INSERT INTO hr_calendar_events (
        business_head_id,employee_id,event_type,title,event_date,
        source_record_type,source_record_id,reminder_rules
      )
      SELECT e.business_head_id,e.id,'last_working_day',
        'Last working day: '||concat_ws(' ',e.first_name,e.last_name),
        coalesce(s.approved_last_working_date,s.proposed_last_working_date),
        'separation',s.id,'[{"daysBefore":15,"roles":["MANAGER","HR_OPERATIONS","HR_ADMIN"]},{"daysBefore":3,"roles":["HR_OPERATIONS"]}]'::jsonb
      FROM separations s JOIN employees e ON e.id=s.employee_id
      WHERE s.status IN ('pending','approved')
      ON CONFLICT (source_record_type,source_record_id,event_type) WHERE source_record_id IS NOT NULL
      DO UPDATE SET business_head_id=EXCLUDED.business_head_id,employee_id=EXCLUDED.employee_id,
        title=EXCLUDED.title,event_date=EXCLUDED.event_date,reminder_rules=EXCLUDED.reminder_rules,status='upcoming'
      RETURNING id
    `;

    const notifications = await transaction`
      WITH expanded AS (
        SELECT e.id AS event_id,e.business_head_id,e.employee_id,e.title,e.event_date,
          (rule->>'daysBefore')::integer AS days_before,role_code.code AS role_code
        FROM hr_calendar_events e
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(e.reminder_rules)='array' THEN e.reminder_rules ELSE '[]'::jsonb END
        ) rule
        CROSS JOIN LATERAL jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(rule->'roles')='array' THEN rule->'roles' ELSE '[]'::jsonb END
        ) role_code(code)
        WHERE e.status='upcoming' AND e.event_date>=current_date
          AND coalesce(rule->>'daysBefore','') ~ '^[0-9]+$'
          AND e.event_date-(rule->>'daysBefore')::integer<=current_date
      ), recipients AS (
        SELECT DISTINCT expanded.event_id,expanded.business_head_id,expanded.title,
          expanded.event_date,expanded.days_before,ur.user_id
        FROM expanded
        JOIN roles r ON r.code=expanded.role_code
        JOIN user_roles ur ON ur.role_id=r.id
        JOIN users u ON u.id=ur.user_id AND u.active=true
        LEFT JOIN employees subject ON subject.id=expanded.employee_id
        WHERE (
            (expanded.business_head_id IS NULL AND ur.business_head_id IS NULL) OR
            (expanded.business_head_id IS NOT NULL AND (ur.business_head_id IS NULL OR ur.business_head_id=expanded.business_head_id))
          )
          AND (ur.department_id IS NULL OR ur.department_id=subject.department_id)
          AND (
            r.code<>'MANAGER' OR (
              subject.reporting_manager_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM employees manager
                WHERE manager.id=subject.reporting_manager_id AND manager.user_id=ur.user_id
              )
            )
          )
      ), removed_stale AS (
        DELETE FROM notifications notification
        WHERE notification.calendar_event_id IS NOT NULL
          AND notification.read_at IS NULL
          AND notification.email_status IN ('pending','retrying','failed','not_configured')
          AND NOT EXISTS (
            SELECT 1 FROM recipients desired
            WHERE desired.event_id=notification.calendar_event_id
              AND desired.user_id=notification.recipient_user_id
              AND desired.event_date-desired.days_before=notification.deliver_on
          )
        RETURNING notification.id
      )
      INSERT INTO notifications (
        recipient_user_id,business_head_id,calendar_event_id,title,body,action_path,deliver_on
      )
      SELECT user_id,business_head_id,event_id,title,
        'Due '||to_char(event_date,'DD Mon YYYY'),'/calendar?eventId='||event_id,
        event_date-days_before
      FROM recipients
      ON CONFLICT DO NOTHING RETURNING id
    `;
    const [overdue] = await transaction`
      SELECT count(*)::int AS count FROM workflow_tasks WHERE status='pending' AND due_at<now()
    `;
    await transaction`DELETE FROM worker_heartbeats WHERE last_heartbeat_at<now()-interval '30 days'`;
    return {
      probationEvents: probation.length,
      confirmationEvents: confirmation.length,
      revisionEvents: revisions.length,
      separationEvents: separations.length,
      lifecycleNotifications: notifications.length,
      overdueWorkflowTasks: overdue?.count || 0,
    };
  });
}

async function initializeHeartbeat() {
  await sql`
    INSERT INTO worker_heartbeats (worker_id,worker_name,version,state)
    VALUES (${workerId},${workerName},${workerVersion},'running')
    ON CONFLICT (worker_id) DO UPDATE SET
      worker_name=EXCLUDED.worker_name,version=EXCLUDED.version,state='running',
      started_at=now(),last_heartbeat_at=now(),stopped_at=NULL
  `;
}

async function touchHeartbeat() {
  await sql`
    UPDATE worker_heartbeats SET last_heartbeat_at=now()
    WHERE worker_id=${workerId} AND state IN ('running','stopping')
  `;
}

async function markCycleStarted() {
  await sql`
    UPDATE worker_heartbeats
    SET state='running',last_heartbeat_at=now(),last_cycle_started_at=now()
    WHERE worker_id=${workerId}
  `;
}

async function markCycleFinished(result, errors) {
  await sql`
    UPDATE worker_heartbeats SET
      last_heartbeat_at=now(),last_cycle_completed_at=now(),last_result=${JSON.stringify(result)}::jsonb,
      last_success_at=CASE WHEN ${errors.length}=0 THEN now() ELSE last_success_at END,
      last_error_at=CASE WHEN ${errors.length}>0 THEN now() ELSE last_error_at END,
      last_error=CASE WHEN ${errors.length}>0 THEN ${errors.join("; ").slice(0, 2_000)} ELSE NULL END,
      consecutive_failures=CASE WHEN ${errors.length}>0 THEN consecutive_failures+1 ELSE 0 END
    WHERE worker_id=${workerId}
  `;
}

async function runStage(name, handler, result, errors) {
  try {
    Object.assign(result, await handler());
  } catch (error) {
    const message = `${name}: ${errorMessage(error)}`;
    errors.push(message);
    result[`${name}Error`] = errorMessage(error);
    log("error", "worker.stage_failure", { stage: name, message: errorMessage(error) });
  }
}

async function cycle() {
  const started = Date.now();
  const result = {};
  const errors = [];
  await markCycleStarted();
  await runStage("lifecycle", ensureLifecycleEvents, result, errors);
  await runStage("documents", generateDocuments, result, errors);
  await runStage("scans", scanDocuments, result, errors);
  await runStage("webhooks", deliverWebhooks, result, errors);
  await runStage("emails", deliverEmailNotifications, result, errors);
  result.durationMs = Date.now() - started;
  await markCycleFinished(result, errors);
  log(errors.length ? "error" : "info", errors.length ? "worker.cycle_degraded" : "worker.cycle", {
    ...result,
    errorCount: errors.length,
  });
}

let stopping = false;
let nextCycleTimer;
let heartbeatInFlight = false;
let currentCycle = Promise.resolve();

function scheduleNextCycle() {
  if (stopping) return;
  nextCycleTimer = setTimeout(() => {
    if (stopping) return;
    currentCycle = cycle().catch((error) => {
      log("error", "worker.cycle_unhandled", { message: errorMessage(error) });
    }).finally(scheduleNextCycle);
  }, intervalMs);
}

const heartbeatTimer = setInterval(() => {
  if (heartbeatInFlight || stopping) return;
  heartbeatInFlight = true;
  touchHeartbeat()
    .catch((error) => log("error", "worker.heartbeat_failure", { message: errorMessage(error) }))
    .finally(() => { heartbeatInFlight = false; });
}, heartbeatMs);
heartbeatTimer.unref();

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  stopping = true;
  clearTimeout(nextCycleTimer);
  clearInterval(heartbeatTimer);
  log("info", "worker.shutdown_started", { signal });
  try {
    await sql`UPDATE worker_heartbeats SET state='stopping',last_heartbeat_at=now() WHERE worker_id=${workerId}`;
    await Promise.race([
      currentCycle,
      new Promise((resolve) => setTimeout(resolve, 20_000)),
    ]);
    await sql`
      UPDATE worker_heartbeats
      SET state='stopped',stopped_at=now(),last_heartbeat_at=now()
      WHERE worker_id=${workerId}
    `;
  } catch (error) {
    log("error", "worker.shutdown_failure", { message: errorMessage(error) });
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(0);
  }
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => { void shutdown(signal); });
}

await initializeHeartbeat();
log("info", "worker.started", { intervalMs, heartbeatMs, leaseMs, maxAttempts });
currentCycle = cycle().catch((error) => {
  log("error", "worker.cycle_unhandled", { message: errorMessage(error) });
});
await currentCycle;
scheduleNextCycle();
