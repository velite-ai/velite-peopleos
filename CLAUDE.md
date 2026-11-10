# Velite PeopleOS — Handover Notes

Context for anyone (human or Claude) picking up work on this codebase.
Written 26 July 2026 after a long debugging and configuration session.

---

## 1. What this is

An HR management system ("PeopleOS") for Velite, covering the full employee
lifecycle: recruitment, onboarding, attendance, leave, payroll, performance,
engagement, learning, helpdesk, separation, reports and administration.

**Stack**

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.6 (App Router, Turbopack, `output: "standalone"`) |
| Language | TypeScript, React 19.2 |
| Database | PostgreSQL 17 (`postgres` npm driver, tagged template SQL — no ORM) |
| Cache / queue | Redis 7 |
| Object storage | MinIO (S3-compatible), added 26 July 2026 |
| Auth | Custom — argon2id via `@node-rs/argon2`, JWT sessions via `jose` |
| Validation | Zod |
| Styling | Tailwind 4 |

The UI is a **single-page app**: almost the entire interface lives in
`app/page.tsx`, which switches between modules client-side. Larger modules are
extracted into `components/*-workspace.tsx`.

---

## 2. Deployment

**Host:** Hetzner VPS, `46.225.81.186`, hostname `velite-main`
**Platform:** Coolify v4.1.2 at `http://46.225.81.186:8000`
**Public URLs:** `https://hr.velite.in` (app), `https://storage.velite.in` (MinIO)

**Compose services:** `postgres`, `redis`, `minio`, `migrate` (one-shot),
`web`, `worker`.

### ✅ Source of truth: GitHub (since 30 Sep 2026)

Code lives in the private repo **github.com/velite-ai/velite-peopleos** (branch `main`).
See section 11 for the update workflow. The notes below describe the old tarball-only
setup and are kept for history.

### (Historical) The source-of-truth problem

The application source currently exists **only** as `/opt/velite-deploy/runtime.tgz`
on the server. There is no version control. The Dockerfile copies the tarball into
the image, runs `pnpm install` and `pnpm build`.

Editing the code today means: extract tarball → edit → repack → deploy. No diffs,
no history, no rollback beyond manual `.bak` copies.

**First task for any new work: move this into a Git repository and point Coolify
at it instead of the tarball.** Everything below is easier once that's done.

Backups made during the 26 July session:
- `/opt/velite-deploy/runtime.tgz.bak-simplify`
- `/opt/velite-deploy/runtime.tgz.bak-origin-fix`

---

## 3. Secrets

Not recorded here deliberately. All live values are in the Coolify compose file
(Configuration → Edit Compose File): `DATABASE_URL`, `AUTH_SECRET`,
`DATA_ENCRYPTION_KEY`, `SETUP_KEY`, `STORAGE_*`, `MINIO_ROOT_*`.

If this repo ever becomes public, or these are pasted anywhere shared, rotate them.

Admin account: `velite@velite.in` (super administrator). Password was set directly
in the database, bypassing the 12-character rule in the setup form.

---

## 4. Workarounds currently in place

These are load-bearing. Understand them before changing the compose file.

### 4.1 Turbopack mangles the native argon2 module

Turbopack emits `require("@node-rs/argon2-cab5f917f164e3dd")` — a hashed name
that doesn't exist. Every password operation throws, so **login and setup both
return HTTP 500** with no useful error in the response body.

Adding `serverExternalPackages: ["@node-rs/argon2"]` to `next.config.ts` **did not
fix it** (tried and verified — the mangled name still appears after a rebuild).
The declaration was left in place as documentation of intent.

The live fix is in the `web` service's `command:` in docker-compose. On every
container start it greps the built chunks for `@node-rs/argon2-<16 hex>`, and
creates an alias package under `node_modules` that re-exports the real module.
Hash-agnostic, so it survives rebuilds. If Turbopack is ever fixed upstream, the
grep finds nothing and the loop is a harmless no-op.

**Symptom if this breaks: login returns 500.** Check container logs for
`Failed to load external module @node-rs/argon2-…`.

### 4.2 Standalone build doesn't ship static assets

`.next/static` and `public/` are not copied into `.next/standalone/`, so the app
renders as unstyled HTML with no working JavaScript. The same `command:` copies
them before starting the server.

**Symptom: page loads as plain text, client-side data never populates.**

### 4.3 Coolify wouldn't generate Traefik labels for MinIO

Neither the `SERVICE_FQDN_MINIO_9000` magic variable nor setting the domain via
the UI pencil produced Traefik labels — the container came up with only
`coolify.*` labels and the domain returned 503.

Traefik labels for MinIO are therefore **written by hand** in the compose file
(routers `minio-http` / `minio-https`, service `minio-svc`, port 9000). If MinIO
ever returns 503, check those labels survived a redeploy.

### 4.4 Compose editing is fragile

Coolify's compose editor auto-indents on paste and **silently drops services**
whose indentation is wrong — a mis-indented `web:` key once reduced the deployed
file to just `postgres:`, taking the whole stack down. It validates YAML on save
but not semantics.

After any compose edit, verify:

```bash
cd /data/coolify/services/t12xccwccugnf8hnjzfabydb
docker compose config --services   # must list all six
```

---

## 5. Schema notes

Migrations live in `database/NNN_*.sql`, applied by `scripts/migrate.mjs`, tracked
in the `schema_migrations` table with checksums. Migrations 001–020 shipped with
the app; **021 was added 26 July**.

### 021_attendance_early_minutes.sql

`attendance_days` was missing an `early_minutes` column that
`/api/attendance` selects. The result: attendance returned 500, which
**silently blanked the entire People directory** — the page loads employees,
attendance and calendar in a single `Promise.all`, and only the calendar call has
a fallback. One failing endpoint took out an unrelated screen.

Worth remembering as a debugging pattern: an empty list on one screen may be
caused by a different endpoint entirely.

### Scoping

Most list endpoints filter by `businessHeadId` and `departmentId`. The sidebar
**BUSINESS HEAD selector filters everything** — People, Attendance, Payroll,
Reports. An empty screen is very often just the wrong selection, not missing data.
There is an "All Velite" option.

`hasRoleForScope()` in `lib/auth.ts` short-circuits to `true` for `SUPER_ADMIN`.

---

## 6. Changes made 26 July 2026

**Login simplified** (`app/login/page.tsx`)
- Removed the "Authenticator code" field and the "Create the first administrator" link.

**Session length** (`lib/auth.ts`)
- `const SESSION_HOURS = Number(process.env.SESSION_HOURS ?? 720)` — was hardcoded 10.

**MFA made optional** (`lib/auth.ts`, ~line 121)
- `mfaEnrollmentRequired` now gated on `process.env.REQUIRE_MFA === 'true'`.
- Previously any privileged role without an active authenticator was force-redirected
  to `/security`, with no way past it.
- **Set `REQUIRE_MFA=true` in Coolify to restore enforcement.** Worth doing —
  this account can see everyone's salary and personal data.

**Departments made manageable** (`app/api/organisation/masters/route.ts`,
`components/administration-workspace.tsx`)
- Added a `department` variant to the discriminated union schema, an insert branch
  in POST, a departments query in GET, plus the dropdown option, payload branch,
  `MasterList` card and master count entry in the frontend.
- Departments previously could not be created at all through the UI, despite
  `employees.department_id` and department filters existing throughout.

**Data seeded directly**
- 17 departments × 6 business heads = 102 rows.
- Both employees moved from `probation` to `active`.

**Storage configured**
- MinIO container, `minio_data` volume, bucket `velite-hr`.
- `STORAGE_*` variables on `web` and `worker`.
- CORS restricted to `https://hr.velite.in`.

---

## 7. Not built yet

### File upload UI — the notable gap

The backend document pipeline is complete and well-built: upload intents,
presigned S3 PUT URLs (`lib/object-storage.ts`, SigV4, path-style), malware-scan
hooks, document categories, permission scoping, audit events.

**No frontend uses any of it.** Verified — there is not a single
`<input type="file">` or call to `/api/documents/upload-intents` anywhere in
`app/` or `components/`.

**Employee photos** don't exist at any layer: no column, no endpoint, no UI. The
People directory and employee record show coloured initials as placeholders.

Two pieces of work:

1. **Employee photos** — ✅ DONE (Sep 2026, migration 022, `/api/employees/[id]/photo`; uploads go via the app server, not browser→MinIO, because CSP is `connect-src 'self'`; JPG/PNG/WebP ≤2 MB, magic-byte checked). Original plan: add a column to `employees` (an object key, following the
   `documents` pattern), an upload endpoint, and display in the record header and
   directory. Self-contained.
2. **Documents tab** — a tab in the employee record wired to the existing intent
   flow: request intent → PUT to presigned URL → register document. UI work
   against an API that already works.

Storage is ready for both as of 26 July.

### Other gaps

- Administration `MasterList` for departments shows the code twice
  (`ACCOUNTS_FINANCE · ACCOUNTS_FINANCE`) — `secondary` should probably be the
  business head name, which is more useful in "All Velite" view.
- New business heads don't get departments automatically.
- `MALWARE_SCAN_URL` / `MALWARE_SCAN_TOKEN` are read by the code but not
  configured (no antivirus scanner). Since 22 Oct 2026 files get the built-in basic checks instead — see section 15.

---

## 8. Useful commands

Coolify's server terminal (sidebar → Terminal → localhost) gives root on the host.
Node is **not** installed there — run scripts inside the container.

```bash
# Container status
docker ps --format '{{.Names}}\t{{.Status}}' | grep t12xcc

# Run a script against the database
docker exec -i web-t12xccwccugnf8hnjzfabydb sh -c 'cat > /app/q.mjs && node /app/q.mjs' <<'EOF'
import p from 'postgres';
const sql = p(process.env.DATABASE_URL);
console.log(await sql`SELECT count(*)::int n FROM employees`);
process.exit(0);
EOF

# Application logs (500s appear here with an error reference id)
docker logs web-t12xccwccugnf8hnjzfabydb --tail 50

# Verify MinIO is publicly reachable
curl -s -o /dev/null -w "%{http_code}\n" https://storage.velite.in/minio/health/live
```

API routes can be inspected directly in a logged-in browser tab — e.g.
`https://hr.velite.in/api/employees` — which is the fastest way to tell a backend
problem from a frontend one.

---

## 9. Debugging lessons from this session

- **A 500 with a generic message has a real stack trace in the container logs**,
  keyed by the error reference id shown in the response.
- **An empty screen is usually a filter or a failed sibling request**, not missing
  data. Check the API directly before assuming.
- **Truncating output hides things.** A `.slice(0, 900)` on a JSON dump led to a
  false conclusion that 14 migrations hadn't run. They had.
- **Verify assumptions against the running system**, not against what the code
  appears to say — `serverExternalPackages` looked like the correct fix for the
  argon2 bug and did nothing.

---

## 10. Simple-UI redesign — 29/30 Sep 2026 (live)

Goal: usable by non-technical staff. Changes (11 files, backend untouched except two SELECTs):
- `app/globals.css`: all text scaled up (min ~13px, body 16px), darker greys, no forced capitals,
  "Readability layer" + home-screen styles appended at the end of the file.
- `app/page.tsx`: plain menu (Home, Staff, Attendance, Leave & shifts, Salary, Reports; rest under "More"),
  SVG icons, new `HomeView` that computes "Needs your attention" items from live data
  (overdue probation = probation_end_date, else joined + 6 months; bad joining dates; staff without a
  real department; attendance not marked; salary month not started; pending leave; open help desk;
  duplicate staff code within a company). Staff screen gained filters matching each item.
  Loading uses Promise.allSettled so one failing endpoint cannot blank another screen.
  Fake Helpdesk badge "3" replaced with real counts.
- Wording made plain across operations/payroll/administration/engagement/calendar/performance/record drawer.
- API: `/api/employees` now returns `probation_end_date`; masters GET returns departments with business_head_name.

Rollback: `cp /opt/velite-deploy/runtime.tgz.pre-simple-ui /opt/velite-deploy/runtime.tgz`, then redeploy.
Working copy with history: Claude outputs folder `velite-src` (bare git repo was in the session sandbox only).

Deploy route that worked (no Git yet): tarball of changed files → presigned PUT to MinIO bucket
`velite-hr/ops/` (uploaded from the PC with `curl.exe -T` in PowerShell) → Coolify terminal downloads,
overlays onto extracted runtime.tgz, repacks → Coolify Advanced → redeploy (plain Restart does NOT rebuild).
Note: the `minio/mc` image can no longer be pulled on the server; use curl with presigned URLs instead.

---

## 11. Git workflow — since 30 Sep 2026

- Repo: `github.com/velite-ai/velite-peopleos` (private). First commit = exact live code on 30 Sep 2026.
- `deploy/Dockerfile` in the repo is a copy of `/opt/velite-deploy/Dockerfile` (the build still reads
  `runtime.tgz`). The compose file is NOT in the repo because it contains secrets.
- Server checkout: `/opt/velite-deploy/src`, pushing/pulling with a read/write **deploy key**
  (`~/.ssh/velite_peopleos_deploy`, set via `git config core.sshCommand`). GitHub shows it as "velite-main server".

**To ship a change:**
1. Commit to `main` on GitHub (web editor, GitHub Desktop, or Claude Code).
2. In the Coolify terminal: `/opt/velite-deploy/update-from-github.sh`
   (git pull → rebuilds `runtime.tgz` via `git archive`; previous copy kept as `runtime.tgz.prev`).
3. Coolify → velite-peopleos → Advanced → Redeploy. (Plain Restart does not rebuild.)

**Rollback:** `cp /opt/velite-deploy/runtime.tgz.prev /opt/velite-deploy/runtime.tgz` then Redeploy,
or `git revert` the bad commit on GitHub and repeat the three steps.

Do not edit files in `/opt/velite-deploy/src` directly on the server — `git pull --ff-only` will refuse
to run if they diverge from GitHub.

**Warning (30 Sep 2026):** Coolify's "Pull latest images" redeploy option FAILS — `minio/minio:latest`
can no longer be pulled from Docker Hub ("pull access denied"). The pull error aborts the deploy before
anything restarts (app stays up). Use the redeploy option that rebuilds without pulling. Proper fix, when
next touching the compose file: switch MinIO to a maintained image (or pin a locally tagged copy of the
current image) so a pull can never break deploys.

---

## 12. Diwali gift register — Super Admin only (Oct 2026)

- Menu: **More → Diwali gifts**, shown only to an unrestricted `SUPER_ADMIN` (no company/department limit). Every route under
  `app/api/diwali-gifts/` starts with `requireSuperAdmin()` (`lib/diwali-gifts.ts`); anyone else gets **404**, API keys included.
  The rule itself is `isUnrestrictedSuperAdmin` in `lib/diwali-gift-rules.ts` (unit tested).
- Table `diwali_gifts` (migration 023): only `gift_year` and `status` are readable. Recipient, item, quantity, values, vendor, bill no.,
  notes etc. are sealed JSON in `details_encrypted` (AES-256-GCM, `DATA_ENCRYPTION_KEY`).
  **If `DATA_ENCRYPTION_KEY` is lost or rotated the gift records cannot be read again — keep a separate copy of it.**
- Changes are logged in `diwali_gift_events`, deliberately **not** in `audit_events` (which HR admins and auditors can read).
- Removing a gift is a soft delete (`deleted_at`). Not built yet: "add all staff" in one click, tax-limit warnings
  (employee gifts in kind ≈ ₹5,000/yr, 194R ≈ ₹20,000/yr for business contacts — confirm with the CA).

---

## 13. Salary calculation — Oct 2026

Checked against the Aug 2026 salary registers of Healthcare and Pharmaceuticals (`tests/payroll-statutory.test.mjs` replays
every row: ESI, PF, welfare fund and net pay all match, and so do the printed ESIC / EPF / LWF totals).

**Method (unchanged from the registers):** monthly rate ÷ **days in the month** × days paid (weekly offs and holidays count as paid, half
day = 0.5). The run now always divides by the days in the month; the old "salary divisor days" in the pay form is ignored (it defaulted to 30).

**Statutory rules — Healthcare and Pharmaceuticals only** (`lib/payroll-standard-rules.ts`, Salary → Salary rules, pick ONE company in the left menu):
1. "Add PF, ESI & welfare fund rules" (by the PAYROLL_ADMIN login) creates 7 rules for that company, effective from a date you enter.
2. "Approve waiting PF/ESI rules" (by a different login with approve rights) approves them. Never create these as "Global".
- PF: 12% of earned **basic** when monthly **basic** ≤ ₹25,000 (ceiling from 17 Sep 2026; was ₹15,000). Employer: 8.33% pension + balance to PF.
- ESI: 0.75% of earned **basic**, rounded **up**, when monthly **gross** (basic + allowances) ≤ ₹21,000. Employer 3.25%.
- Labour welfare fund: ₹5 employee + ₹20 employer for anyone who worked that month. Not applied to the other four companies.
- Others 1, Others 2, Velite India, Velite Sciences keep the plain salary rules: no PF, ESI or welfare fund.
- Not computed per person: PF admin charge (min ₹500) and EDLI, which the registers treat as one figure for the whole company.
  Employer ESI is per person, so it can differ by a rupee or two from the challan total. Confirm rates and "wages" with the CA (new labour codes).
- Not built yet: bonus and leave-with-wages for leavers, ESIC / EPF challan files, professional tax, TDS.

**Approval (`lib/payroll-approval-mode.ts`):** default is "simple" — one login prepares (PAYROLL_ADMIN), a different login reviews
(HR_ADMIN or Super Admin; the preparer can never review their own month), then the month is locked and paid. Set `PAYROLL_APPROVAL_MODE=strict`
in Coolify to get the older prepare → HR review → finance approval → separate final lock once there are enough logins.

**Bugs found and fixed by running a full salary month end to end (none of this had ever worked, `salary_months` was 0):**
- JSON was saved as a text string inside jsonb columns (`${JSON.stringify(x)}::jsonb` is encoded twice by the postgres driver).
  Monthly attendance lock recorded 0 staff, and salary rules/pay structures were unreadable. Fixed in `lib/database.ts` +
  `lib/postgres-json.ts` (also the worker); migration `024_repair_json_stored_as_text.sql` unwraps existing rows (audit trail is
  append-only so it is left; the reader unwraps it).
- Calculating a salary month crashed (date returned as an object); overtime query used columns that don't exist.

---

## 14. Printable letters with preview and PDF download — Oct 2026

Staff record → **Letters** tab → **Print a letter**: eight letters in three groups — Joining (Offer, Appointment), During service (Confirmation,
Salary revision, Employment verification), Leaving (Acceptance of resignation, Relieving, Experience). Clicking one opens
`/letters/print?type=…&employee=…` in a new tab with a **preview** of the letter (A4, blank space at the top for the company's pre-printed
letterhead — adjustable, remembered). Nothing prints until **Print** is pressed. **Download PDF** saves a file to share; it has no letterhead,
so it carries the company name at the top (tick box in the toolbar).

- Wording and logic: `lib/letter-rules.ts` (`buildLetter`, unit tested). The offer letter follows the company's sample (`Offer_letter_45.pdf`:
  reference, address, probation, salary, checklist page, "Accepted & Agreed By"); the other letters are drafts in the same style — HR should
  read them once (the experience and relieving letters state satisfactory conduct / completed exit formalities).
- PDF file: `lib/letter-pdf.ts`, a small dependency-free writer (A4, Helvetica, justified text) that runs in the browser from the same content as
  the preview. Glyph widths are the real Helvetica widths. Characters outside Windows-1252 print as "?" (names in other scripts).
- Data: `app/api/employees/[id]/print-letter` (HR only, `people:write`): name, title from gender (Mr./Ms. or none), address and gender from the
  encrypted personal details, mobile, position, department, joining date, probation months (from probation end, else 6), pay (only if the login has
  `payroll:read`, else blank with a warning; offer/appointment = pay at joining, salary revision = latest pay and its start date), confirmation date
  (else probation end date), resignation date / last working day / notice from the open or completed exit.
- Acceptance, relieving and experience letters need the last working day: use **Record resignation** first (Lifecycle dates card, Employment tab).
- Reference number `VH/2026-27/05/13/1` = company initials / financial year / month / day / serial of the company's letters that day.
  Table `printed_letters` (migration 025) keeps one row per person, letter type and day, so printing again the same day reuses the number.
  Every opening of a letter is in `audit_events` (`employee_letter.print`).
- The older approval-based letters ("Request letter" on the same tab, worker-made PDF) are unchanged.
- **Offer letter from Hiring** (Oct 2026): Hiring screen → **Make offer letter** (candidate, title, position, joining date, monthly salary during
  probation, probation months, address) saves a `candidate_offers` row (details in `terms`: title, address, probationMonths, monthlySalary) and
  opens the preview; the **Offer letters** list on the same screen has **Preview & print** for any offer (`/letters/print?type=offer&offer=<id>`,
  API `app/api/recruitment/offers/[id]/print-letter`, needs `recruitment:write`). Candidates have no address column, so it is entered in the form.
  The register (`printed_letters`, migration 026) now holds either an employee or an offer (`offer_id`); numbering is shared per company per day
  (`lib/letter-register.ts`).
- **Trainee experience certificate**: Letters tab → Leaving → *Experience certificate (trainee)* (type `trainee_certificate`: "has undergone training as … from … to …").
  It can be printed at once: if no last working day is recorded, today's date stands in for the end of the training and the preview warns;
  set it first with Edit dates (Last working day) for a fixed date.
- **Company letterheads (Oct 2026):** Velite Healthcare, Pharmaceuticals, Sciences and India have their pad scanned in `public/letterheads/*.jpg`
  (1240 px wide ≈ 150 dpi, 50–70 KB each; the printed "DATE : 25-MARCH-2026" on the Sciences scan was blanked out). `lib/letterheads.ts` maps the company name to its
  picture and holds the top/bottom text margins that keep the letter clear of each design's header and footer (tune `topPt` / `bottomPt` there if a pad is reprinted).
  **Download PDF** puts the picture behind every page (stored once in the file); the preview shows it as the sheet background; **Print never includes it** (your paper is in the
  printer). A tick box in the toolbar turns it off, and then the company name is used at the top as before. Others 1 / Others 2 have no letterhead and keep the plain layout.
  To change a letterhead, replace the JPEG (keep 1240 px wide) and adjust the margins; Velite India's pad is not A4 shaped, so it is placed at the top with its own proportions.
- Not built: saving a copy of the letter in Documents.

---

## 15. Document safety check — 22 Oct 2026

**Problem found:** with no antivirus scanner configured every uploaded document stayed at "Awaiting check" for ever, and the download route
refuses anything that is not `clean` (HTTP 423), so no document could be opened.

**Fix:** `lib/document-checks.mjs` (plain JS so the app *and* `scripts/worker.mjs` share it). When `MALWARE_SCAN_URL` is not set:
- at upload (`lib/malware-scan.ts` → `basicChecks`) the file is checked at once; the worker (`processBasicScan`) checks anything still waiting,
  including files uploaded before this change (first worker cycle after deploy, then every 5 minutes);
- the checks: really a PDF / JPG / PNG / WebP / Word file; the EICAR antivirus test string; PDFs with `/JavaScript`, `/Launch`,
  `/EmbeddedFile`, `/RichMedia`, `/XFA`; Word files (.docx) with macros (`vbaProject.bin`), program files inside, or that are another kind of zip;
  old .doc files with macros (`_VBA_PROJECT`); pictures with `<?php` / `<script`.
- result is `clean` or `infected` (shown as Checked / Blocked, hover shows the reason); `scan_details.engine = "velite-basic-checks"`.
- **This is not an antivirus.** It cannot see inside compressed PDF streams or detect known malware. If `MALWARE_SCAN_URL` is set
  later (the existing contract: POST `{objectUrl,fileName,contentType}` → `{clean,engine,signature}`), the real scanner is used instead.
- A false positive stays Blocked; upload a clean copy.
- The worker takes batches of 12 repeatedly for up to four minutes per cycle (`SCAN_TIME_BUDGET_MS`), so a large backlog clears in one run
  (428 imported documents were waiting on 22 Oct 2026; a test run cleared 430 in about a second). A file whose object is missing from
  storage ends in `error` (retried with back-off, then left) and stays "Awaiting check".

---

## 16. Reporting manager across companies — Oct 2026

A reporting manager can work in **any** Velite company (before, only the same company was allowed).
- Staff record → Employment → Edit employment: the **Reporting manager** box lists everyone currently working (probation / active / notice period), grouped by company.
  List comes from `GET /api/employees/[id]/manager-options` (needs `people:write` on that person). It leaves out the person and everyone who reports to them
  (directly or through others), so a reporting loop cannot be created; the save in `PATCH /api/employees/[id]` checks the same and refuses people who have left.
- The record shows the manager's company when it differs from the person's own.
- **Change company** (correcting a wrong company) now **keeps** the person's manager and the people reporting to them; the preview says so under "Stays as it is".
  Before, both were cleared.
- Access is unchanged: a manager only sees leave / attendance of their reports when their own login already has access to that company
  (a login limited to one company does not get into another company's data just by being someone's manager; the worker's MANAGER notifications follow the same rule).
- The Employment tab has a **People who report to this person** card: direct reports from any company (name, code, position, company when different), only people currently working,
  and only those whose own company the viewer may read (`directReports` in `GET /api/employees/[id]`). To add someone, set the manager in *their* record.

---

## 17. Data health report — Oct 2026

`scripts/data-health.mjs` prints a read-only summary of the live data (counts only, no names or individual salaries): staff by company, gaps in records, odd dates,
duplicate codes, attendance coverage, leave, pay on file, documents, hiring, exits, which parts of the app hold data, and who used the app. Nothing is changed
(the connection is read-only). After `update-from-github.sh` has pulled the repo, run it in the Coolify terminal (no rebuild needed):

```bash
docker exec -i web-t12xccwccugnf8hnjzfabydb sh -c 'cat > /app/q.mjs && node /app/q.mjs' < /opt/velite-deploy/src/scripts/data-health.mjs
```

---

## 18. Data check screen — Oct 2026

**More → Data check** (HR / Super Admin). Built from the first data-health report (79 people working; 52% in "Misc." or no department, 72% without a work email,
nobody marked as on probation although 26 joined in the last six months).
1. **Details missing from staff records** (`GET /api/data-cleanup/fix-list`): for people currently working, lists what is missing — department (empty or "Misc."), work email, phone, photo,
   reporting manager, salary record (only checked if the login can see pay) and documents. Filter chips per gap; **Download for Excel** gives a CSV (with BOM, formulas defused) of the current filter.
   Rules and CSV helpers are in `lib/data-cleanup-rules.ts` (unit tested).
2. **Put recent joiners on probation** (`/api/data-cleanup/probation`): Active people who joined in the last N months (default 6) with a suggested probation end (joining date + 6 months, editable per person).
   People whose probation would already be over are left unticked. Applying sets status to Probation and the end date, optionally clears the confirmation date (ticked by default — they are not confirmed yet),
   and writes the same history (`employee_events`) and audit entries as an edit from the record. Only people still Active are changed. Probation status drives the HR-calendar probation reviews; payroll and attendance treat Probation like Active.
- **Grade is hidden** from the staff record (display, edit form, "record complete" score). The column and API field remain; nothing else was removed.

---

## 19. Two-step sign-in (authenticator code) and server checks — Oct 2026

- The login page shows an **Authenticator code** box only when the account needs one (the server answers `MFA_REQUIRED`), so ordinary logins are unchanged.
- **Anyone who has set up an authenticator is now asked for its code at sign-in**, whether or not `users.mfa_required` is set (`app/api/auth/login/route.ts`). Setting it up under
  *Password & security* also flags the account as `mfa_required` (existing behaviour). A login flagged `mfa_required` that never set one up is still refused (unchanged).
- Codes are 30-second TOTP codes; a code can only be used once. There is no QR code on the setup page: type the shown key into the authenticator app ("enter a setup key").
- **To enforce it for all privileged logins:** set `REQUIRE_MFA=true` in Coolify (section 6). Until each of them has set up an authenticator they can do nothing but open *Password & security*.
  Do it in this order: set up your own authenticator → sign in again in a private window with the code → only then set `REQUIRE_MFA=true`.
- **Recovery (lost phone):** `scripts/reset-mfa.mjs` removes one login's authenticator (and clears its flag) so they can sign in with the password and set up a new one. Logged as `auth.mfa_reset_on_server`.
  ```bash
  docker exec -i -e TARGET_EMAIL=person@velite.in web-t12xccwccugnf8hnjzfabydb sh -c 'cat > /app/q.mjs && node /app/q.mjs' < /opt/velite-deploy/src/scripts/reset-mfa.mjs
  ```
- `scripts/server-check.sh` is a read-only look at the server (containers, volumes and their size, disk space, existing backups and cron jobs, which settings are set — names only). Used to plan backups:
  `bash /opt/velite-deploy/src/scripts/server-check.sh`
- Backups are **not** yet set up by us: check Coolify's database backup setting and the Hetzner snapshots, and keep a separate copy of `DATA_ENCRYPTION_KEY` (without it encrypted data cannot be read).

---

## 20. Backups — found on the server 23 Oct 2026

A nightly backup was already set up on the server (not by this repo; the script lives only on the server). What it does, from `/usr/local/bin/pg-backup.sh` and `/var/log/pg-backup.log`:
- **cron, 02:00 every day**, log in `/var/log/pg-backup.log` (`tail -15 /var/log/pg-backup.log` shows the last runs; each night should say `OK postgres-t12xcc…`).
- Dumps every Postgres container with `pg_dumpall` (the Velite database `postgres-t12xcc…`, a different app `bom-postgres`, and Coolify's own `coolify-db`), gzips them and uploads them with **rclone to Backblaze B2**
  (`b2:velite/pg-backups`). Copies older than 14 days are deleted locally (`/var/backups/pg`) and in B2. The line `SKIP/FAIL coolify` is normal (the Coolify app container has no database).
- **MinIO (documents and photos)** is mirrored nightly with `rclone sync` to `b2:velite/minio-data`. It is a mirror, so a file deleted in the app is also removed from the mirror; the history depends on the
  B2 bucket keeping old versions (check the bucket's lifecycle setting in the Backblaze console).
- Last runs on 21, 22 and 23 Oct 2026 all succeeded (Velite database dump 1.4–2.0 MB, MinIO 172–192 MB). Coolify's own backup folder (`/data/coolify/backups`) is empty (Coolify backups are not used).
- **Not in any backup:** `DATA_ENCRYPTION_KEY` and `AUTH_SECRET` (they live in the Coolify compose file). Keep a separate copy of the encryption key; without it the encrypted columns cannot be read from a restored database.
- A manual backup before a risky step (e.g. locking a salary month): `/usr/local/bin/pg-backup.sh`.
- **Prove a restore works:** `bash /opt/velite-deploy/src/scripts/backup-restore-test.sh` downloads the newest Velite dump from B2, restores it into a throw-away `postgres:17-alpine` container, prints counts of people,
  documents, attendance days, pay records and audit entries, then removes the container. The live database is never touched. Repeat it after changing the backup setup, and now and then.
- Not set up: an alert when a night fails (someone has to read the log), and longer retention (only 14 days of history; a monthly copy kept for a year would cost almost nothing at this size).

---

## 21. Adding, renaming and deleting departments — Oct 2026

**Settings → Company setup → Departments** (HR / Super Admin; needs `people:write` for the company). Departments are listed per company with how many people work in each.
- **Add:** choose the company (fixed when one company is selected in the left menu), type the name. The short code is made from the name (`lib/department-rules.ts`, `QUALITY_ASSURANCE`, `_2` if it clashes).
  The same name (any case or spacing) in the same company is refused. Adding a name that was deleted earlier **brings the old department back** (same record, so history stays joined up).
- **Rename:** changes the name everywhere (staff records show the department by reference).
- **Delete** is a soft delete (`departments.active=false`): the name stays on past records and in the history, but the department disappears from lists and dropdowns (`/api/departments`, Settings, Data check).
  If people (including former staff) or hiring records / cost centres / job positions / job requisitions are in it, the dialog makes you choose another department of the same company to move them to
  (or "No department" for people; open job requisitions need a department). Each moved person gets a history entry. **Blocked** while a login is limited to that department, appraisal cycles exist for it, or it has sub-departments.
- API: `GET/POST /api/organisation/departments`, `PATCH/DELETE /api/organisation/departments/[id]` (DELETE with `{dryRun:true}` previews). Everything is written to `audit_events` (`department.create|rename|delete`).
- The older "Add department, location or job" form in Settings still works and is unchanged; its Departments list now shows only active departments.

---

## 22. Removed people report — Oct 2026

`scripts/removed-staff.mjs` is a read-only list of people removed from the Staff list (status `archived`) with what is on file for each: last attendance day, attendance this month, pay record, documents,
the date they were removed, and whether someone with the same name is still working (probable duplicate entry). Used to plan recording real exits. Run it after `update-from-github.sh` (no rebuild):
```bash
docker exec -i web-t12xccwccugnf8hnjzfabydb sh -c 'cat > /app/q.mjs && node /app/q.mjs' < /opt/velite-deploy/src/scripts/removed-staff.mjs
```
Why it matters: payroll skips `archived` people entirely, so someone who left during the month being paid must be **separated** (with a last working day), not archived, or their final salary is missed.

---

## 23. Recording exits of removed staff — Oct 2026

**More → Data check → 3. Record exits of removed staff** (HR / Super Admin; needs `separation:write`). Lists people with status `archived` who have no exit and are not marked as duplicates, with what is on file
(last attendance day, days marked this month, date removed, and a same-name person still working). Per person choose: *Resigned* (default), *Dismissed*, *Contract ended*, *Retired*, *Stopped coming*,
*Duplicate entry (keep removed)* (preselected when the same name is still working) or *Decide later*, and type the **last working day** (never prefilled; must be after joining and not in the future).
- A **real exit** (`POST /api/data-cleanup/past-exits`) writes a completed `separations` row (type, last working day, no exit-checklist tasks), sets the employee to **`separated`** with `last_working_date`,
  and writes `employee_events` (`separation`) and `audit_events` (`employee.exit_recorded`). All or nothing.
- A **duplicate** is only marked (`audit_events` `employee.marked_duplicate` + a history entry) and stays `archived`. The screen warns when a duplicate has a pay record that the working copy lacks.
- **Why:** payroll skips `archived` people; `separated` people with a last working day in or after the month are still in that month's run (final salary), attendance/leave honour the last working day,
  attrition counts them, and relieving / experience letters need the last working day.
- **Staff list change:** `GET /api/employees` now leaves out `separated` as well as `archived` people by default (they used to be counted as staff). New filter `?left=1` lists the people who left;
  Staff has a **Left the company** tab (next to *Removed staff*). Home / Staff totals count only people still working.
- For people who left part-way through a month, **mark their attendance for the days they worked** (Attendance screen) before running that month's salary; the exit does not create attendance.

---

## 24. Finishing an exit from the staff record — Oct 2026

Before, an exit started with **Record resignation** (status `notice_period`, five exit steps created) could never be finished from the app: completing it needs every step ticked and nothing in the UI ticked them.
Now the **exit card** on the Employment tab of the record (HR login with `separation:write`) shows the steps as tick boxes ("3 of 5 exit steps done") and a **Finish exit** button.
- Ticking calls `POST /api/separations/tasks/[id]` (complete / reopen); `GET /api/employees/[id]` returns `separation.tasks`.
- **Finish exit** (`POST /api/separations/[id]/finish`) approves the exit if it was still waiting, requires every step ticked and the **last working day to be today or earlier**, then completes it:
  status `separated` with the last working day, `employee_events` (`separation`) and `audit_events` (`separation.complete`). The person moves to **Staff → Left the company**.
- The older route (Leaving screen: approve, then complete) still exists and does the same in two clicks.
- The steps are: final settlement, no-dues and assets, knowledge transfer, exit interview and letters, revoke accounts. Ticking them is the HR user's own confirmation; nothing is checked automatically.

---

## 25. Who is absent / on leave, by name — Oct 2026

- **Home** and **Attendance** show a **Who is away** panel with the names of people marked *Absent*, *On leave* (with Paid / Unpaid leave) and *Half day* for the day (`AwayToday` in `app/page.tsx`).
- **Attendance** has filter chips (Everyone, Present, Absent, On leave, Not marked, Off / holiday) with counts; the day sheet can be narrowed to one of them.
- People who were **not employed that day** (left on or before the day before, or joining later) are no longer counted or listed: "Present today … of 95 staff" used to include everyone who had left. They still show,
  marked "Not employed on this day", if searched by name on the Attendance sheet. The API (`GET /api/attendance`) is unchanged; the screens filter on status `not_employed`.

---

## 26. Adding earlier pay rates — Oct 2026

Staff record → **Pay, PF & bank** → **Compensation history** → **Add revision** can be used for pay periods in the past (any *Effective from* date). The history stays in order: the earlier rate ends the day before the next one starts.
- **Bug fixed:** inserting a revision *before* an existing later one failed with a server error (`Invalid time value`: the next rate's start date came back as a date object and was turned into text wrongly). `app/api/employees/[id]/compensation/route.ts` now reads it as text.
- **Bug fixed:** leaving *Next salary revision* blank on that form used to clear the employee's existing next-revision date. Blank now means "keep the current date" (`undefined` in the payload); a typed date still sets it.
- Previous months' *actual* salary sheets (registers) are separate: they are imported with `scripts/import-salary-register.mjs` and shown under *Imported salary registers* on the same tab.

---

## 27. Editing an entry in the compensation history — Oct 2026

Staff record → **Pay, PF & bank** → **Compensation history**: every entry has an **Edit** button (HR / payroll login with `payroll:write`) to correct its start date, annual CTC, monthly gross, basic, allowances and overtime rate, with a required reason.
`PATCH /api/employees/[id]/compensation/[revisionId]`:
- the new start date must stay **after the earlier entry's start and before the next entry's start**; the earlier entry's end date is moved to the day before the new start, so periods never overlap or leave a gap;
- **blocked** when a salary month that used this rate is approved, locked or paid (a month still in Review can be edited; press Calculate again afterwards, Nov 2026) (the message names the months): add a new revision instead, or reopen that month first. A month that is only *calculated* can still be edited;
- writes `employee_events` (`compensation_revision`, before / after, `corrected: true`) and `audit_events` (`compensation.edit`); the employee's next salary revision date is not touched.
- Not built: deleting an entry (two identical consecutive entries are harmless; edit one to fix it).

---

## 28. Loading earlier Diwali years and planning the next — Oct 2026

**More → Diwali gifts** (Super Admin only, as in section 12) gained two buttons:
- **Load an earlier year**: paste a tab of the Google Sheet (Ctrl+A, Ctrl+C). Only column G (gift given), H (cash paid), L (next year's planned cash) and M (next year's planned gift, e.g. Blanket) are read; older-year columns and Bonus/LWW are ignored (`lib/diwali-import-rules.ts`, unit tested).
  One register row per person: item = gift text + "Cash", value = the cash (the sheet has no price for gift items); status Handed over; columns L / M become a Planned row for the following year ("Blanket + Cash"; a planned gift with no cash is kept at ₹0, a 0 with no gift is skipped).
  **Check first** (dry run) shows counts, who has since left, and name matches that need checking; **Add to register** inserts everything in one transaction through the normal sealing and `diwali_gift_events`.
  Running it again skips rows already there (same name, gift, amount). API: `POST /api/diwali-gifts/import`.
- **Plan next year from this year**: copies last year's gifts as Planned, skipping people with status `separated` / `archived`, and anyone already planned. API: `POST /api/diwali-gifts/plan`.
- Matching to Staff: full name only (case/spacing ignored); several people with one name → the one still working, else not linked. One-word names (common among workers) are never linked automatically; those rows are saved by name as "Someone else" with the village in the company field.
  `GET /api/diwali-gifts` now returns `employeeStatus` and the list shows "Has left" beside linked people who left.
- The sheet's data is never stored in the repository: it is pasted at run time and saved encrypted.

---

## 29. Diwali register limited to named logins — Oct 2026

Being a Super Administrator is no longer enough. `canUseGiftRegister` (`lib/diwali-gift-rules.ts`) also requires the login's email to be in `DIWALI_GIFTS_EMAILS` (comma separated, set in Coolify; **default `velite@velite.in`** when unset or empty).
`requireSuperAdmin()` uses it, so every gift route answers 404 to everyone else (e.g. `operations@velite.in`). `GET /api/auth/me` returns `giftRegister: true|false`, which decides whether **Diwali gifts** shows in the menu.
Data already in the register is unchanged. To add a person later: set `DIWALI_GIFTS_EMAILS=velite@velite.in,other@velite.in` and redeploy.

---

## 30. Year-by-year comparison of Diwali gifts — Oct 2026

**More → Diwali gifts → Compare years**: one row per person, one column per year (cash and gift items), the change between the last two years, and totals / head-count per year (`lib/diwali-compare-rules.ts`, unit tested; `GET /api/diwali-gifts/compare`, same Super Admin / named-login rule as the rest).
People linked to a staff record are matched by that record; others by name + place, so two "Baljit Kaur" from different villages stay separate. Filters: still with Velite, has left, got a gift last year but none this year, new this year. **Download for Excel** gives a CSV of the current filter.
Planned years show "planned" under the amount. Values are the cash only (gift item prices are not in the sheet).

**Counts by group (Oct 2026):** each gift now carries `group` (the sheet tab it was loaded from, e.g. Workers / Office) inside the sealed details. Compare years shows a head-count and cash table per group and year (people, how many have since left, cash) and a Workers / Office filter.
Gifts loaded before this have no label: re-paste the same tabs in **Load an earlier year** (tab name `Workers` / `Office`); matching rows are not duplicated, they just get labelled ("get the label" line in the check). Until then they are grouped by the "Workers (village)" / "Office" text in the company field, else "Not labelled".

---

## 31. Gift items and cash kept apart, with a total — Oct 2026

One register record per person and year now holds **several gift items plus cash**: `items` (each with name, quantity, value of one), `cashAmount`, `cashMode` (cash / UPI / bank, optional) and `cashPaidOn` (optional), with **one status** for the whole record.
`giftValue` (items added up), `totalValue` (gifts + cash) and the one-line `giftItem` summary are worked out on the server (`makeDetails` in `lib/diwali-gifts.ts`, rules in `lib/diwali-gift-rules.ts`, unit tested); `quantity` is kept at 1 and `unitValue` = total for older code.
- **Older records need no migration:** `openGift` reads the old single-line shape as items + cash (`legacyParts`): "Cash" → cash only; "X + Cash" (how the sheet was loaded) → item X at ₹0 plus the cash; anything else → one item line. Saving an old record in the form stores the new shape.
- **Screen:** *Add / Edit gift* has a list of gift lines (＋ Add another gift), the gifts total, a cash block (amount, paid by, paid on) and the total value. The list shows items and "Gifts ₹a + Cash ₹b" per person; the top cards show people, total value, gifts value and cash. CSV has separate gift-value, cash, paid-by, paid-on and total columns.
- A record needs at least one gift item or a cash amount (API 422 otherwise). Import and *Plan next year* write the same shape (plan copies items and cash, not the paid-on date). Compare years shows total with "Gifts + Cash" under it.
- Gift prices are still not in the sheet, so imported items are at ₹0 until someone edits them.

---

## 32. Colour layer, Home tiles and a simpler Attendance screen — Nov 2026

- **Colour per area:** `areaSlug()` in `app/page.tsx` puts `data-mod` on each menu button and `data-area` on `<main>`; the "Colour layer" at the end of `app/globals.css` sets `--c` per area (Attendance blue, Leave orange, Salary purple, Staff indigo, Reports cyan, Hiring pink, Joining teal, Leaving rose, Diwali saffron, …). The menu icon chip, active menu row, page heading banner, main button, top-card border and table header all use `--c`. To recolour an area change one line there; new areas default to green.
- **Home** has five big tiles (Mark attendance, Leave requests, Add a staff member, Salary, Reports) with a live line each (still to mark, waiting, staff count, month state).
- **Attendance:** date has ◀ ▶ and a day name (a Today button appears off today); the "Import from machine" button (it only showed a message) is gone; month actions (Month summary, send for checking / finalise, return to open, unlock day) are under **Month & more ▾**; **Lock this day** stays visible. Filter chips and the five status buttons are colour-coded; each row has an initials circle and a coloured left edge for its status (not marked = amber). **Who is away** now sits below the list.
- Checked in a browser against made-up data (Home, Attendance, Salary). No logic or API changes.

---

## 33. Loading parties (franchisees, distributors, clients) into the Diwali register — Nov 2026

**Load an earlier year** has a first choice, *What are you loading?*: **Staff and workers** (the Google Sheet tab, §28) or **Parties**. Parties are pasted as four columns separated by a tab or a `|` sign: **Party name, Gift, Status (Handed over / Planned), Notes** (`parseParties` / `buildPartyGifts` in `lib/diwali-import-rules.ts`, `kind: "parties"` on `POST /api/diwali-gifts/import`). Colours do not survive copy and paste, so the status is written out (green rows in the Diwali 2026 sheet = Handed over, the rest = Planned).
Each party becomes a "Someone else" record (company "Franchisee / party", group = the label, default *Parties*) with the gift as one item at ₹0 (no prices in the sheet) and no cash. Rows with "NO GIFT" or no gift are **not** added; the check lists them. Not matched to staff. Re-running skips rows already there.
A party's gift may list several items with quantities, joined by `+` (`partyItems`): "2 Comforter + 2 Dry Fruit Box" becomes two items, two of each.

---

## 34. Diwali gifts: status chips, gift filter, totals, print/PDF and a gift-wise analysis — Nov 2026

**More → Diwali gifts** now has three tabs: **List**, **By gift & analysis**, **Compare years** (§30), and the year box beside them.
- **List:** status chips (All / Planned / Bought / Handed over, with counts), a **gift** filter (Blanket, Dry Fruit, … or cash), a **group** filter (Workers / Office / Parties) and a search. Columns: Gifts value, Cash, Total, Status; the footer adds up what is shown. Tick people and use **Mark as Handed over / Bought / Planned** to change many at once (one PATCH per person). **Print** (browser print, A4 landscape; menus and buttons are hidden by the print CSS at the end of `app/globals.css`), **PDF** and **Excel** all follow the current filters.
- **By gift & analysis** (`components/diwali-items.tsx`, rules in `lib/diwali-analysis-rules.ts`, unit tested): cards and a progress bar (handed over vs still to go), the **gift-wise table** (planned / handed over / all: people and pieces, value; click a gift to list the people, planned vs handed over; cash is its own row), **by status**, **by group**, **compared with last year** and the **ten highest totals**. "Planned" there means planned or bought (not handed over). Print and **Download PDF** give the whole analysis, including every gift's list of people.
- **PDF writer:** `lib/table-pdf.ts` (dependency-free, A4 landscape, header row on every page, page numbers; same Helvetica widths as `lib/letter-pdf.ts`) and the wording in `lib/diwali-report.ts`. The PDF font has no rupee sign, so amounts are written "Rs 1,20,000".
- No API or data changes. Values still count only prices that were entered (imported gifts are ₹0 until edited).

---

## 35. Gift master — Nov 2026

**More → Diwali gifts → Gift master**: the list of gifts Velite gives (Comforter Set, Dry Fruit, …) with a standard price each. Table `diwali_gift_master` (migration 027): name, price and note are sealed JSON like the register; routes `GET/POST /api/diwali-gifts/master`, `PATCH/DELETE /api/diwali-gifts/master/[id]` (delete = soft), `POST /api/diwali-gifts/master/apply`; all behind the same Super Admin / named-login rule (`components/diwali-master.tsx`).
- **Add / Edit gift:** each gift line is a drop-down of the master ("Comforter Set · ₹900"); choosing one fills the price, quantity × price is the line value, and the price can still be changed for one person. "Other (type the name)" allows a gift that is not in the master.
- **Gifts already stored keep their own name and price** (a snapshot): changing the master never changes past gifts by itself.
- **Fill prices into a year:** the master tab has *Check what would change* / *Apply to Diwali {year}*. It puts the master price on every gift line that has no price (or, with the second check, replaces entered prices too) and recalculates each person's gifts value and total (logged in `diwali_gift_events`). Names are matched ignoring case and extra spaces.
- **New loads pick up master prices:** Load an earlier year (staff and parties) gives items the master price when the name matches.
- The master tab also offers *Add them to the master* for gift names used in the year but not yet in the master (price 0 until entered).

---

## 36. Company-wise Diwali data — Nov 2026

Every gift now has a **Velite company** (`firm` in the sealed details): Velite Healthcare, Velite India, Velite Pharmaceuticals, Velite Sciences Pvt Ltd, Others 1, Others 2 (the active business heads, in that order; `orderCompanies` in the workspace).
- **Staff** gifts count under the staff member's own company (the `company` of the linked record); **parties** (franchisees, distributors, clients) need the company chosen: in *Add / Edit gift* ("Velite company giving this gift"), in bulk (tick people in the List, **Set company…**), or in a 5th column when loading parties (`Party | Gift | Status | Notes | Company`). Gifts with none show as **Company not set**.
- `firmLabel` / `firmSummary` in `lib/diwali-analysis-rules.ts` (unit tested). The **company box** beside the year box filters the List and the **By gift & analysis** tab (cards, gift-wise table, status, group, print and PDF all follow it); the analysis also has a **By company** table (people, handed over, to go, gifts, cash, total) and it is section 3 of the PDF.
- Not done: Compare years is not split by company.
- **Outside parties (Nov 2026):** besides the six Velite companies, the company drop-down (Add / Edit gift, **Set company…**, the company filter) also offers **Franchisee Party** and **Third-Party Client** (`PARTY_TYPES` in `components/diwali-gifts-workspace.tsx`). They are stored in the same `firm` field and appear as their own rows in **By company** (and the PDF), so franchisee and third-party gifts can be totalled apart from Velite's own companies.
- **Alphabetical order (Nov 2026):** the Diwali List (and its Print / PDF / Excel) is always sorted A to Z by recipient name, whichever company, status or gift is chosen; the names listed under each gift in the analysis are sorted the same way.
- **Edit-gift staff drop-down (Nov 2026):** the chosen staff member is kept in state (`employeeId` in `GiftForm`) and the person's own record is always offered as an option (also for people who have left, who are not in `/api/employees`). Before, an uncontrolled drop-down fell back to the first name (e.g. AISHWERYA) when the staff list loaded after the form opened or did not contain the person, and saving moved the gift to that person.

---

## 37. One-person attendance lock — Nov 2026

Locking a month's attendance (**Attendance → Month & more → Finalise month for salary**) used to need a different login from the one that sent the month for checking. A **Super Administrator may now do both steps** (`app/api/attendance/months/route.ts`); every other role still needs a second person. When the same person does both, the audit entry `attendance_month.lock` carries `reviewedAndLockedBySamePerson: true`.
Payroll is unchanged: the person who calculates a salary month still cannot review it (§13).

---

## 38. Attendance month counts only days inside employment — Nov 2026

The monthly summary (`app/api/attendance/months/route.ts`, the snapshot salary reads) counted **every** attendance mark in the month, including marks on days after a person's last working day or before their joining date (e.g. from "Mark everyone Present"). Two effects found on October 2026 (Others 1, seven people who left mid-month): salary refused to calculate ("Locked attendance is incomplete", recorded days ≠ expected days), and extra *Absent* marks outside employment were counted as unpaid days, lowering pay (Nirmala 4 unpaid instead of 2).
The join now keeps only days from the joining date to the last working day. Marks outside that window stay stored but are ignored.
**A month locked before this change keeps its old snapshot:** reopen it (Month & more → Reopen month, Super Admin / HR), then prepare, send for checking and finalise again so the summary is rebuilt.

---

## 39. Salary inputs and the salary-day rules decided by Velite — Nov 2026

**Salary inputs (built, step 1).** Salary → pick a salary month → **Salary inputs** panel (above the register): per person *Paid leave*, *Overtime (hrs)*, *Advance (₹)*, *Pay nothing* and a note. Save, then **Calculate payroll**.
Why: paid leave is decided by the accountant **while working out the salary**, after attendance is locked, so it cannot be an attendance mark. Table `payroll_inputs` (migration 028, one row per month and person); `GET/PUT /api/payroll/inputs` (read needs `payroll:read`, save `payroll:write`; editable until the month is approved; every change is an audit event `payroll.inputs` with a reason); rules in `lib/payroll-input-rules.ts` (unit tested); applied in `app/api/payroll/run/route.ts`; screen `components/payroll-inputs.tsx`.
- **Paid leave** turns unpaid days (absent, unpaid leave) into paid days; it can never exceed the unpaid days, so nobody is paid for more than the days they were employed. Half days allowed. It is **not** counted as a day present.
- **Overtime hours** are added to approved overtime requests. Rate = the pay record's overtime rate, else **basic ÷ days in the month ÷ 8** (the accountant's "salary per hour").
- **Advance deducted** is taken in this month's pay and shows in the register's Advance column. It is *not* a loan: marking the month paid does not reduce `employee_loans` for it (`ADVANCE_FROM_INPUT` in the trace). The sheet's "advance in hand" is not tracked yet.
- **Pay nothing** (no days, overtime, advance, extras): the rule below. It is pre-ticked when the person's exit type is *Stopped coming* (`abandonment`).
- The trace keeps what was used (`provenance.salaryInputs`, `PAID_LEAVE_APPLIED`, `NO_SALARY`).

**Rules decided by Velite (built as step 2, §40).** Where the accountant's October sheet differs, these rules win.
1. Pay = monthly basic ÷ days in the month × paid days. Paid days = days present (half day 0.5) + Sundays granted + national holidays granted + paid leave granted.
2. **Sundays and holidays granted** come from days present (October 2026 table, 31 days, 25 working days, 4 Sundays, 2 holidays):
   22–25 → 4 Sundays + 2 holidays · 17.5–21.5 → 3 + 2 · 13.5–17 → 2 + 1 · 10–13 → 1 + 0 · 8–9.5 → 0 + 0 (below 8 assumed 0 + 0). Paid leave does not count toward the row. How the ranges are set for other months is **not yet known**.
3. **Joined after the 7th of the month:** paid for working days only (no Sundays / holidays). **Joined in the first 7 days:** eligible for Sundays and holidays by the table.
4. **Left during the salary month:** paid for working days only.
5. **Stopped coming without informing the company: no salary at all** (the employee signs an undertaking when joining). Use *Pay nothing* in Salary inputs.
Answered 9 Nov 2026: joining on the 7th **is** the first week; holidays before a joining date do **not** count; a last working day on the 31st **is** a full month; the table's cut-offs scale with the month's working days. October's sheet gave Sundays and holidays to three leavers (Nirmala, Harpreet, Sahil) — under these rules they get working days only (20, 14, 19).

---

## 40. Velite's paid-days table, built into the salary run — Nov 2026

For companies with `business_heads.paid_days_rule = 'velite_table'` (migration 029; **Others 1 only**) the salary run no longer pays whatever is marked Off. `lib/paid-days-rules.ts` (unit tested, `tests/paid-days-rules.test.mjs`) works out each person's paid days:
- **Present** = present + work from home + on duty + half days at 0.5, counted only inside the person's employment (joining date to last working day). **Off / weekly off / holiday marks are ignored**: Sundays and holidays are granted by the table instead, so attendance only needs present / half day / absent / leave.
- **Table** (cut-offs = 88%, 70%, 54%, 40%, 32% of the month's working days, rounded to the half day; working days = days in the month − Sundays − national holidays that are not Sundays). October 2026 (25 working days): 22+ → 4 Sundays + 2 holidays · 17.5+ → 3 + 2 · 13.5+ → 2 + 1 · 10+ → 1 + 0 · 8+ → 0 + 0. For other months: Sundays = all in the top band, one fewer per lower band, none in the lowest; holidays = all in the top two bands, one fewer in the third, none below.
- Only Sundays and holidays **inside the person's employment** count (a holiday before joining does not).
- **Joined after the 7th** (joining on the 7th is still the first week) or **left before the end of the month** (a last day on the last day of the month is a full month): working days only, no Sundays or holidays.
- **Paid leave** = days marked paid leave in attendance + paid leave typed in Salary inputs, added on top, never beyond the days employed. **Pay nothing** pays 0.
- **Paid days** = present + Sundays + holidays + paid leave, capped at the days employed. The trace keeps the working (`provenance.paidDays`: band, Sundays, holidays, reason).
- **Holidays of the month** are typed in the Salary inputs panel (`payroll_periods.national_holidays`, saved with the inputs and audited as `payroll.holidays`); the panel offers the HR holiday calendar's dates as a suggestion. With no holidays added, Sundays are granted but no holidays.
- The panel shows Present / Sundays / Holidays / Paid leave / Paid days per person, live as you type. The salary run reads the **locked attendance days** directly, so a month locked before this change does not need re-locking.
- Other companies keep `'marked'` (the original method, §13). To switch one: `UPDATE business_heads SET paid_days_rule='velite_table' WHERE name='Others 2';` (check the company's attendance practice first).

**Recalculating a month in review (Nov 2026):** once calculated, a month is in *Review* and its main button is "Review and approve". Changed the Salary inputs or the holidays afterwards? Press **Calculate again** (next to it; same `POST /api/payroll/run` calculate, allowed while the month is in review and not yet approved) and the register is rebuilt. Before this button there was no way to recalculate from the screen once a month reached Review.

**One-person salary approval (Nov 2026).** In the default *simple* approval mode a **Super Administrator may approve and lock a salary month they calculated themselves** (`app/api/payroll/approve/route.ts`, `app/api/payroll/run/route.ts`); every other role still needs a second person, and *strict* mode (`PAYROLL_APPROVAL_MODE=strict`) is unchanged. The audit entry `payroll.reviewer_approve` carries `calculatedAndApprovedBySamePerson: true` when one person did both. This changes the sentence in §13 about the preparer never reviewing their own month: it now holds for everyone except a Super Administrator in simple mode.

**Leave marks ignored for the paid-days table (Nov 2026).** For companies on `velite_table`, days marked *Leave* in attendance are **not** counted as paid leave (workers are not entitled to it). Paid leave comes only from the *Paid leave* box in Salary inputs, typed by the accountant for office staff (e.g. Anjali). The panel and the salary run both ignore the attendance Leave marks.

---

## 41. Importing a company's monthly salary register (accountant's sheet) — Nov 2026

`scripts/import-register-month.mjs` loads the accountant's **salary register + wages register** of one company and month (used for October 2026 Velite Healthcare and Velite Pharmaceuticals) into *Imported salary registers* on each staff record (`salary_register_imports` / `salary_register_lines`, one `salary` or `wages` row per person) and brings each person's pay rate in line with the sheet. **The data is never committed**: it is piped in on stdin as JSON (row layout in the script's header comment), built from the PDF and checked against every printed column total.
- `--validate` (no database): the rows must add up to the printed register and grand totals, else it stops.
- no flag: **read-only** look at the live database: each staff code is matched (also with leading zeros, e.g. `35` = `035`); people not found are listed as NEW; a code that exists under a **different name** is flagged and blocks `--apply`.
- `--apply`: one transaction. Existing people keep their record (guardian, department, position and statutory numbers are only filled in where empty); new people are created as active with the sheet's joining date (**1st of the month, marked estimated**, when the sheet has none, e.g. Pharmaceuticals). Pay rate: a new compensation revision starting on the 1st of the month is added **only if basic / allowances differ** from what is in force; the earlier open revision is ended the day before. ESI no., UAN and PF account are stored sealed with the other statutory details. The same sheet (SHA-256) cannot be imported twice. Every person and the import itself are in `audit_events`.
- Login used: `velite@velite.in` unless `IMPORT_ACTOR_EMAIL` is set. Needs `DATABASE_URL` and `DATA_ENCRYPTION_KEY` (both set inside the web container).
- The sheet's earned wages are **not recalculated**: they are stored exactly as printed. Fields not on the sheet (Pharmaceuticals has no joining date, designation or department) stay empty.
- **Same person under a different spelling / removed record:** add `"confirmedSamePerson": ["63"]` (staff codes) to the JSON. The dry run then says *CONFIRMED SAME PERSON*; `--apply` renames the record to the sheet's name, makes an archived record Active again, and writes an `employee_events` row (`salary_register_identity_confirmed`). Without the key a name mismatch still blocks `--apply`. Used for Healthcare code 63 (Shiv Sharma, archived as "Shiv Kumar"), Nov 2026.

---

## 42. People left out of salary calculation — Nov 2026

`employees.payroll_excluded` (migration 030, default false) leaves a person on the staff list but out of the **attendance month summary and lock** (`app/api/attendance/months/route.ts`, `.../months/summary/route.ts`), the **Salary inputs** panel and the **salary calculation** (`app/api/payroll/inputs|run`). Their missing attendance days no longer block locking the month, and they get no salary line. Nothing else about the record changes (they still show in Staff and the daily Attendance sheet).
Set or clear it with `scripts/set-payroll-exclusion.mjs` (preview first, then `--apply`; writes `employee_events` `payroll_exclusion` and `audit_events` `employee.payroll_excluded|included`):
```bash
docker exec -i -e TARGET_COMPANY="Velite Healthcare" -e TARGET_CODES=001,053 web-t12xccwccugnf8hnjzfabydb sh -c 'cat > /app/x.mjs && node /app/x.mjs' < /opt/velite-deploy/src/scripts/set-payroll-exclusion.mjs
# add --apply (after x.mjs) to write; add -e EXCLUDE=false to put them back
```
A month whose attendance is already locked keeps its old list: reopen it, then lock and calculate again. Used for Healthcare codes 001 (Sanjiv Kumar Verma) and 053 (Sangeeta Verma): nothing is paid to them. Not built: a button for this in the staff record.

---

## 43. Combining two records of the same person — Nov 2026

`scripts/merge-duplicate-staff.mjs` (preview by default, `--apply` writes; env `TARGET_COMPANY`, `KEEP_CODE`, `DROP_CODE`). Keeps one record and, in one transaction: moves the imported salary-sheet rows (`salary_register_lines`) to it, adds the sheet's pay rate (only rates created by the register import, and only if they differ from what the kept record has), fills empty statutory numbers and parent / spouse name, then sets the other record to `archived` with a `profile_change` history entry and audit entries `employee.marked_duplicate` / `employee.records_combined`. Nothing is deleted.
**Refused** if the record to remove has its own attendance, documents, leave, salary results or loans. Used for Healthcare: `VEL-110` Shiv Kumar (kept: attendance, 10 documents) and `63` Shiv Sharma (created by the Oct 2026 register import), Nov 2026.
```bash
docker exec -i -e TARGET_COMPANY="Velite Healthcare" -e KEEP_CODE=VEL-110 -e DROP_CODE=63 web-t12xccwccugnf8hnjzfabydb sh -c 'cat > /app/m.mjs && node /app/m.mjs' < /opt/velite-deploy/src/scripts/merge-duplicate-staff.mjs
# add --apply after m.mjs to write
```
