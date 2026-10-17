import assert from "node:assert/strict";
import test from "node:test";
import { buildLetter, LETTER_GROUPS, LETTER_LABELS, LETTER_TYPES, NEEDS_LAST_WORKING_DAY, companyLetterCode, financialYear, longDate, probationMonths, referenceNumber, titleFor } from "../lib/letter-rules.ts";

const base = {
  type: "offer", company: "Velite Healthcare", reference: "VH/2026-27/05/13/1", date: "2026-05-13", name: "Tisha", title: "Ms.",
  addressLines: ["BXII 886, Shahpura Road", "Ludhiana"], mobile: "7901710703", employeeCode: "84", position: "Executive - F & D", department: "Office",
  joinedDate: "2026-06-01", probationMonths: 6, monthlySalary: 18333, resignationDate: null, lastWorkingDay: null, noticeDays: null,
  confirmationDate: null, salaryEffectiveDate: "2026-06-01", employmentEnded: false,
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

test("every letter type has a label, sits in one group on the Letters tab, and builds without errors", () => {
  assert.equal(LETTER_TYPES.length, 8);
  assert.deepEqual(LETTER_GROUPS.flatMap(group => group.types).sort(), [...LETTER_TYPES].sort());
  for (const type of LETTER_TYPES) {
    assert.ok(LETTER_LABELS[type]);
    const letter = buildLetter({ ...base, type, title: "", name: "Surbhi Sridhar", resignationDate: "2026-10-17", lastWorkingDay: "2026-11-10", noticeDays: 24, confirmationDate: "2026-12-01", salaryEffectiveDate: "2027-04-01" });
    assert.ok(letter.subject && letter.paragraphs.length >= 2, type);
    assert.equal(letter.signedFor, "For Velite Healthcare,");
    assert.ok(letter.paragraphs.every(paragraph => !paragraph.includes("undefined") && !paragraph.includes("null")), type);
  }
  assert.deepEqual([...NEEDS_LAST_WORKING_DAY].sort(), ["acceptance", "experience", "relieving"]);
});

test("appointment letter confirms the post, probation and salary, and asks for a signed copy", () => {
  const letter = buildLetter({ ...base, type: "appointment" });
  assert.equal(letter.subject, "Appointment Letter");
  assert.match(letter.paragraphs[0], /pleased to appoint you as Executive - F & D in the Office department in our organisation with effect from 1 June 2026/);
  assert.match(letter.paragraphs[1], /probation for a period of 6 months/);
  assert.equal(letter.paragraphs[2], "Your salary is fixed @ Rs. 18333/- per month.");
  assert.match(letter.paragraphs[3], /sign the duplicate copy/);
  assert.equal(letter.acceptInline, true); assert.equal(letter.checklist, null);
  assert.equal(buildLetter({ ...base, type: "appointment", monthlySalary: null, mobile: null }).warnings.length, 2);
});

test("confirmation letter uses the confirmation date, or the probation end date, and warns when neither exists", () => {
  const letter = buildLetter({ ...base, type: "confirmation", confirmationDate: "2026-12-01" });
  assert.equal(letter.subject, "Confirmation of Services");
  assert.match(letter.paragraphs[0], /you have been confirmed in the services of Velite Healthcare as Executive - F & D with effect from 1 December 2026/);
  assert.deepEqual(letter.addressee, ["Ms. Tisha,", "Executive - F & D, Office,", "Employee Code: 84"]);
  assert.equal(letter.warnings.length, 0);
  assert.equal(buildLetter({ ...base, type: "confirmation" }).warnings.length, 1);
});

test("salary revision letter shows the new pay and its start date, and warns when there is no revision", () => {
  const ok = buildLetter({ ...base, type: "salary_revision", monthlySalary: 21000, salaryEffectiveDate: "2027-04-01" });
  assert.equal(ok.subject, "Revision of Salary");
  assert.match(ok.paragraphs[0], /your salary has been revised to Rs\. 21000\/- per month with effect from 1 April 2027/);
  assert.deepEqual(ok.warnings, []);
  assert.match(buildLetter({ ...base, type: "salary_revision" }).warnings[0], /not a revision/);
  assert.match(buildLetter({ ...base, type: "salary_revision", monthlySalary: null }).warnings[0], /No salary is recorded/);
});

test("employment verification is in the present tense for staff and the past tense once they have left", () => {
  const now = buildLetter({ ...base, type: "employment_verification" });
  assert.equal(now.heading, "TO WHOM IT MAY CONCERN");
  assert.match(now.paragraphs[0], /is employed with Velite Healthcare as Executive - F & D in the Office department since 1 June 2026\./);
  const past = buildLetter({ ...base, type: "employment_verification", employmentEnded: true, lastWorkingDay: "2026-11-10" });
  assert.match(past.paragraphs[0], /was employed with Velite Healthcare as Executive - F & D in the Office department from 1 June 2026 to 10 November 2026\./);
  assert.match(now.paragraphs[1], /without any liability on the part of the Company/);
});

test("relieving letter relieves the person from the close of the last working day", () => {
  const letter = buildLetter({ ...base, type: "relieving", resignationDate: "2026-10-17", lastWorkingDay: "2026-11-10" });
  assert.equal(letter.subject, "Relieving Letter");
  assert.match(letter.paragraphs[0], /resignation dated 17 October 2026\. We confirm that you stand relieved from the services of Velite Healthcare with effect from the close of working hours on 10 November 2026/);
  assert.match(letter.paragraphs[1], /handed over charge and completed the exit formalities/);
  assert.equal(buildLetter({ ...base, type: "relieving" }).warnings.length, 1);
});
