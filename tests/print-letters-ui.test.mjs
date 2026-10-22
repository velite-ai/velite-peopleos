import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the Letters tab lists every letter by group and opens the preview for this person", async () => {
  const drawer = await read("components/employee-record-drawer.tsx");
  assert.match(drawer, /title="Print a letter"/);
  assert.match(drawer, /LETTER_GROUPS\.map/);
  assert.match(drawer, /window\.open\(`\/letters\/print\?type=\$\{type\}&employee=\$\{encodeURIComponent\(person\.id\)\}`, "_blank"\)/);
  assert.match(drawer, /Record resignation/);
});

test("the letter page is a preview first: nothing prints on its own, and the PDF can be downloaded", async () => {
  const page = await read("app/letters/print/page.tsx");
  assert.doesNotMatch(page, /setTimeout\(\(\) => window\.print\(\)/); // no automatic printing any more
  assert.match(page, /onClick=\{\(\) => window\.print\(\)\}>Print</);
  assert.match(page, /onClick=\{download\}>Download PDF</);
  assert.match(page, /buildLetterPdf\(letter/);
  assert.match(page, /download = `\$\{name\}\.pdf`/);
  assert.match(page, /velite_letter_top_cm/); // the letterhead space is remembered
  assert.match(page, /Space for the company letterhead/);
});

test("the paper layout leaves room for the company letterhead and hides the toolbar when printing", async () => {
  const css = await read("app/globals.css");
  assert.match(css, /\.letter-sheet\{--letter-top:4\.5cm/);
  assert.match(css, /@page\{size:A4;margin:0\}/);
  assert.match(css, /\.no-print\{display:none!important\}/);
  assert.match(css, /\.letter-second\{break-before:page\}/);
});

test("printing is for HR only, never draws salary for logins that cannot see it, and is registered", async () => {
  const route = await read("app/api/employees/[id]/print-letter/route.ts");
  assert.match(route, /requireApiUser\("people:write"/);
  assert.match(route, /hasPermissionForScope\(user, "payroll:read"/);
  assert.match(route, /registerLetter\(/);
  assert.match(await read("lib/letter-register.ts"), /INSERT INTO printed_letters/);
  assert.match(route, /employee_letter\.print/);
  assert.match(route, /NEEDS_LAST_WORKING_DAY\.includes\(type\)/);
  const migration = await read("database/025_printed_letters.sql");
  assert.match(migration, /UNIQUE \(employee_id, letter_type, letter_date\)/);
  assert.match(migration, /UNIQUE \(business_head_id, letter_date, serial\)/);
  for (const type of ["offer", "appointment", "confirmation", "salary_revision", "employment_verification", "acceptance", "relieving", "experience"]) assert.match(migration, new RegExp(`'${type}'`));
});

test("offer letters can be printed from the Hiring screen, for a candidate's offer, and trainees have their own certificate", async () => {
  const hiring = await read("components/operations-workspace.tsx");
  assert.match(hiring, /Make offer letter/);
  assert.match(hiring, /<h2>Offer letters<\/h2>/);
  assert.match(hiring, /\/letters\/print\?type=offer&offer=/);
  assert.match(hiring, /fetch\("\/api\/recruitment\/offers"/);
  const route = await read("app/api/recruitment/offers/[id]/print-letter/route.ts");
  assert.match(route, /requireApiUser\("recruitment:write"/);
  assert.match(route, /registerLetter\(/);
  const page = await read("app/letters/print/page.tsx");
  assert.match(page, /\/api\/recruitment\/offers\/\$\{encodeURIComponent\(offer\)\}\/print-letter/);
  const migration = await read("database/026_letters_for_offers_and_trainees.sql");
  assert.match(migration, /offer_id uuid REFERENCES candidate_offers\(id\)/);
  assert.match(migration, /'trainee_certificate'/);
  const employeeRoute = await read("app/api/employees/[id]/print-letter/route.ts");
  assert.match(employeeRoute, /endDateAssumed/);
});
