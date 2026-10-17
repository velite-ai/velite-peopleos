import assert from "node:assert/strict";
import test from "node:test";
import { buildLetter, companyLetterCode, financialYear, longDate, probationMonths, referenceNumber, titleFor } from "../lib/letter-rules.ts";

const base = {
  type: "offer", company: "Velite Healthcare", reference: "VH/2026-27/05/13/1", date: "2026-05-13", name: "Tisha", title: "Ms.",
  addressLines: ["BXII 886, Shahpura Road", "Ludhiana"], mobile: "7901710703", employeeCode: "84", position: "Executive - F & D", department: "Office",
  joinedDate: "2026-06-01", probationMonths: 6, monthlySalary: 18333, resignationDate: null, lastWorkingDay: null, noticeDays: null,
};

test("reference number: company, financial year, month, day and the day's serial (as in the sample offer letter)", () => {
  assert.equal(referenceNumber("Velite Healthcare", "2026-05-13", 1), "VH/2026-27/05/13/1");
  assert.equal(referenceNumber("Velite Healthcare", "2027-02-01", 12), "VH/2026-27/02/01/12");
  assert.equal(financialYear("2026-04-01"), "2026-27");
  assert.equal(financialYear("2026-03-31"), "2025-26");
  assert.equal(companyLetterCode("Velite Pharmaceuticals"), "VP");
  assert.equal(companyLetterCode("Velite Sciences Pvt Ltd."), "VS");
  assert.equal(companyLetterCode("Velite India"), "VI");
  assert.equal(companyLetterCode("Others 1"), "O1");
});

test("titles, dates and probation come from the record", () => {
  assert.equal(titleFor("Female"), "Ms."); assert.equal(titleFor("male"), "Mr."); assert.equal(titleFor("Other"), ""); assert.equal(titleFor(null), "");
  assert.equal(longDate("2026-06-01"), "1 June 2026"); assert.equal(longDate(null), "__________");
  assert.equal(probationMonths("2026-06-01", "2026-12-01"), 6); assert.equal(probationMonths("2026-06-01", "2027-06-01"), 12); assert.equal(probationMonths("2026-06-01", null), 6);
});

test("offer letter follows the company sample, with a checklist and an acceptance block", () => {
  const letter = buildLetter(base);
  assert.equal(letter.reference, "VH/2026-27/05/13/1");
  assert.equal(letter.dateText, "13 May 2026");
  assert.deepEqual(letter.addressee, ["Ms. Tisha,", "BXII 886, Shahpura Road,", "Ludhiana,", "Mobile - 7901710703"]);
  assert.equal(letter.salutation, "Dear Ms. Tisha,");
  assert.equal(letter.subject, "Offer Letter for Employment");
  assert.match(letter.paragraphs[0], /pleased to offer you an appointment as Executive - F & D in our organisation\. You will report to duty on 1 June 2026\./);
  assert.match(letter.paragraphs[1], /probation for a period of 6 months from the date of appointment/);
  assert.match(letter.paragraphs[1], /maximum of One year/);
  assert.equal(letter.paragraphs[2], "Your salary will be fixed as discussed and agreed @ Rs. 18333/- per month during probation.");
  assert.equal(letter.signedFor, "For Velite Healthcare,");
  assert.equal(letter.signatory, "Authorized Signatory");
  assert.equal(letter.cc, "cc: Employee file");
  assert.equal(letter.checklist.length, 4);
  assert.deepEqual(letter.warnings, []);
});

test("missing details become blanks with a warning instead of wrong text", () => {
  const letter = buildLetter({ ...base, addressLines: [], mobile: null, monthlySalary: null });
  assert.match(letter.paragraphs[2], /Rs\. __________\/-/);
  assert.equal(letter.warnings.length, 3);
  assert.deepEqual(letter.addressee, ["Ms. Tisha,"]);
  assert.equal(buildLetter({ ...base, title: "" }).salutation, "Dear Tisha,");
});

const exit = { ...base, type: "acceptance", title: "", name: "Surbhi Sridhar", position: "Technical Executive", department: "Workshop", employeeCode: "72", joinedDate: "2024-12-18", resignationDate: "2026-10-17", lastWorkingDay: "2026-11-10", noticeDays: 24 };

test("acceptance of resignation names the resignation date, last working day and notice", () => {
  const letter = buildLetter(exit);
  assert.equal(letter.subject, "Acceptance of Resignation");
  assert.equal(letter.salutation, "Dear Surbhi Sridhar,");
  assert.deepEqual(letter.addressee, ["Surbhi Sridhar,", "Technical Executive, Workshop,", "Employee Code: 72"]);
  assert.match(letter.paragraphs[0], /resignation letter dated 17 October 2026 from the position of Technical Executive in Velite Healthcare\. We hereby accept your resignation\./);
  assert.match(letter.paragraphs[1], /last working day with the organisation will be 10 November 2026, in accordance with the notice period of 24 days/);
  assert.match(letter.paragraphs[2], /no-dues clearance/);
  assert.match(letter.paragraphs[2], /full and final settlement/);
  assert.equal(letter.checklist, null);
  assert.deepEqual(letter.warnings, []);
  assert.doesNotMatch(buildLetter({ ...exit, noticeDays: null }).paragraphs[1], /notice period/);
  assert.equal(buildLetter({ ...exit, lastWorkingDay: null }).warnings.length, 1);
});

test("experience letter states the period of service", () => {
  const letter = buildLetter({ ...exit, type: "experience" });
  assert.equal(letter.heading, "TO WHOM IT MAY CONCERN");
  assert.equal(letter.subject, "Experience Letter");
  assert.deepEqual(letter.addressee, []);
  assert.equal(letter.salutation, null);
  assert.match(letter.paragraphs[0], /This is to certify that Surbhi Sridhar \(Employee Code 72\) was employed with Velite Healthcare as Technical Executive in the Workshop department from 18 December 2024 to 10 November 2026\./);
  assert.match(letter.paragraphs[1], /conduct and performance of Surbhi Sridhar were found to be satisfactory/);
  assert.equal(letter.cc, null);
  assert.deepEqual(letter.warnings, []);
});
