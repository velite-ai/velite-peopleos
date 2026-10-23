import assert from "node:assert/strict";
import test from "node:test";
import { addMonths, csvRow, isPlaceholderDepartment, missingItems } from "../lib/data-cleanup-rules.ts";

const complete = { departmentName: "Workshop", workEmail: "a@velite.in", phone: "98", hasPhoto: true, hasManager: true, hasSalary: true, documentCount: 3 };

test("a complete record has nothing missing", () => assert.deepEqual(missingItems(complete), []));

test("each gap is reported", () => {
  assert.deepEqual(missingItems({ ...complete, departmentName: null }), ["department"]);
  assert.deepEqual(missingItems({ ...complete, workEmail: " " }), ["workEmail"]);
  assert.deepEqual(missingItems({ ...complete, phone: null }), ["phone"]);
  assert.deepEqual(missingItems({ ...complete, hasPhoto: false }), ["photo"]);
  assert.deepEqual(missingItems({ ...complete, hasManager: false }), ["manager"]);
  assert.deepEqual(missingItems({ ...complete, hasSalary: false }), ["salary"]);
  assert.deepEqual(missingItems({ ...complete, documentCount: 0 }), ["documents"]);
});

test("the Misc. catch-all department counts as no department", () => {
  for (const name of ["Misc.", "misc", " MISC. ", "", null, undefined]) assert.equal(isPlaceholderDepartment(name), true, String(name));
  for (const name of ["Workshop", "Miscellaneous Sales", "Office"]) assert.equal(isPlaceholderDepartment(name), false, name);
});

test("a login that cannot see pay is not told salary records are missing", () => assert.deepEqual(missingItems({ ...complete, hasSalary: null }), []));

test("probation end dates: months are added, and a day that does not exist moves to the month end", () => {
  assert.equal(addMonths("2026-04-01", 6), "2026-10-01");
  assert.equal(addMonths("2026-08-31", 6), "2027-02-28");
  assert.equal(addMonths("2024-08-31", 6), "2025-02-28");
  assert.equal(addMonths("2023-08-31", 6), "2024-02-29");
  assert.equal(addMonths("2026-09-15", 3), "2026-12-15");
  assert.equal(addMonths("2026-11-30", 3), "2027-02-28");
  assert.equal(addMonths("2026-10-22", 12), "2027-10-22");
});

test("CSV rows quote what needs it and defuse spreadsheet formulas", () => {
  assert.equal(csvRow(["a", "b,c", 'say "hi"', null, 5]), 'a,"b,c","say ""hi""",,5');
  assert.equal(csvRow(["=SUM(A1)", "+91 98", "-5", "@x"]), "'=SUM(A1),'+91 98,-5,'@x");
  assert.equal(csvRow(["line\nbreak"]), '"line\nbreak"');
});
