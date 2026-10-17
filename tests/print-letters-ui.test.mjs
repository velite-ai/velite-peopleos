import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the Letters tab has one-click buttons that open the print page for this person", async () => {
  const drawer = await read("components/employee-record-drawer.tsx");
  assert.match(drawer, /title="Print a letter"/);
  for (const label of ["Offer letter", "Acceptance of resignation", "Experience letter"]) assert.match(drawer, new RegExp(label));
  assert.match(drawer, /window\.open\(`\/letters\/print\?type=\$\{type\}&employee=\$\{encodeURIComponent\(person\.id\)\}`, "_blank"\)/);
});

test("the print page leaves room for the company letterhead, opens Print itself, and hides its toolbar on paper", async () => {
  const page = await read("app/letters/print/page.tsx");
  assert.match(page, /window\.print\(\)/);
  assert.match(page, /if \(!letter \|\| letter\.warnings\.length\) return/); // warnings are read before printing
  assert.match(page, /velite_letter_top_cm/); // the space at the top is remembered
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
  assert.match(route, /INSERT INTO printed_letters/);
  assert.match(route, /employee_letter\.print/);
  const migration = await read("database/025_printed_letters.sql");
  assert.match(migration, /UNIQUE \(employee_id, letter_type, letter_date\)/);
  assert.match(migration, /UNIQUE \(business_head_id, letter_date, serial\)/);
});
