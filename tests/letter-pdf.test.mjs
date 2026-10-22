import assert from "node:assert/strict";
import test from "node:test";
import { buildLetter, LETTER_TYPES } from "../lib/letter-rules.ts";
import { buildLetterPdf, jpegInfo } from "../lib/letter-pdf.ts";

const data = {
  type: "offer", company: "Velite Healthcare", reference: "VH/2026-27/05/13/1", date: "2026-05-13", name: "Tisha", title: "Ms.",
  addressLines: ["BXII 886, Shahpura Road", "Ludhiana"], mobile: "7901710703", employeeCode: "84", position: "Executive - F & D", department: "Office",
  joinedDate: "2026-06-01", probationMonths: 6, monthlySalary: 18333, resignationDate: "2026-10-17", lastWorkingDay: "2026-11-10", noticeDays: 24,
  confirmationDate: "2026-12-01", salaryEffectiveDate: "2027-04-01", employmentEnded: false, endDateAssumed: false,
};
const text = bytes => Array.from(bytes, byte => String.fromCharCode(byte)).join("");

test("every letter type produces a well-formed PDF (cross-reference table, lengths and end marker are correct)", () => {
  for (const type of LETTER_TYPES) {
    const pdf = text(buildLetterPdf(buildLetter({ ...data, type }), { company: "Velite Healthcare" }));
    assert.match(pdf, /^%PDF-1\.4/, type);
    assert.match(pdf, /%%EOF\n$/, type);
    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(pdf)[1]);
    assert.equal(pdf.slice(startxref, startxref + 4), "xref", type);
    const count = Number(/xref\n0 (\d+)\n/.exec(pdf.slice(startxref))[1]);
    const offsets = [...pdf.slice(startxref).matchAll(/(\d{10}) 00000 n /g)].map(match => Number(match[1]));
    assert.equal(offsets.length, count - 1, type);
    offsets.forEach((offset, index) => assert.equal(pdf.slice(offset, offset + `${index + 1} 0 obj`.length), `${index + 1} 0 obj`, `${type} object ${index + 1}`));
    for (const match of pdf.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)) assert.equal(Number(match[1]), match[2].length, `${type} stream length`);
  }
});

test("the PDF carries the letter text, the reference number and (for sharing) the company name", () => {
  const pdf = text(buildLetterPdf(buildLetter(data), { company: "Velite Healthcare" }));
  assert.match(pdf, /\(VELITE HEALTHCARE\) Tj/);
  assert.match(pdf, /\(Reference No\. VH\/2026-27\/05\/13\/1\) Tj/);
  assert.match(pdf, /\(Date: 13 May 2026\) Tj/);
  assert.match(pdf, /Dear Ms\. Tisha,/);
  assert.match(pdf, /Offer Letter for Employment/);
  assert.match(pdf, /Rs\. 18333\/- per month during probation/);
  assert.match(pdf, /Checklist of Mandatory Documents Required/);
  assert.doesNotMatch(text(buildLetterPdf(buildLetter(data))), /VELITE HEALTHCARE/);
});

test("the offer letter has two pages, the others one; long paragraphs are justified", () => {
  const pages = bytes => (text(bytes).match(/\/Type \/Page /g) || []).length;
  assert.equal(pages(buildLetterPdf(buildLetter(data))), 2);
  for (const type of LETTER_TYPES.filter(type => type !== "offer")) assert.equal(pages(buildLetterPdf(buildLetter({ ...data, type }))), 1, type);
  assert.match(text(buildLetterPdf(buildLetter(data))), / Tw /);
});

test("characters are written in the PDF's own encoding: dashes work, unsupported characters become ?, brackets are escaped", () => {
  const letter = buildLetter({ ...data, name: "Test (Raj) ਕ", position: "Head – Sales" });
  const pdf = text(buildLetterPdf(letter));
  assert.match(pdf, /Head \x96 Sales/);
  assert.match(pdf, /Test \\\(Raj\\\) \?/);
});

test("a long letter flows onto a second page instead of running off the paper", () => {
  const letter = buildLetter(data);
  letter.paragraphs = Array.from({ length: 30 }, () => "This paragraph is repeated to make the letter long enough that it cannot fit on a single page of paper. ".repeat(3));
  letter.checklist = null;
  assert.ok((text(buildLetterPdf(letter)).match(/\/Type \/Page /g) || []).length >= 2);
});

test("word spacing never leaks from a justified paragraph into the lines after it", () => {
  const pdf = text(buildLetterPdf(buildLetter({ ...data, type: "appointment" })));
  const lines = pdf.split("\n").filter(line => line.startsWith("BT "));
  assert.ok(lines.every(line => / Tw /.test(line)), "every text line sets its own word spacing");
  const closing = lines.filter(line => /\((For Velite Healthcare,|Authorized Signatory|cc: Employee file|Dated:|Accepted & Agreed By|Employee Name)\) Tj/.test(line));
  assert.equal(closing.length, 6);
  assert.ok(closing.every(line => / 0\.000 Tw /.test(line)), "signature and acceptance lines are not stretched");
});

// ---- company letterheads ----
import { readFileSync } from "node:fs";
import { LETTERHEADS, letterheadFor } from "../lib/letterheads.ts";

const headJpeg = key => new Uint8Array(readFileSync(new URL(`../public/letterheads/${key}.jpg`, import.meta.url)));

test("each company gets its own letterhead; Others 1 and Others 2 have none", () => {
  assert.equal(letterheadFor("Velite Healthcare")?.key, "healthcare");
  assert.equal(letterheadFor("Velite Pharmaceuticals")?.key, "pharmaceuticals");
  assert.equal(letterheadFor("Velite Sciences Private Limited")?.key, "sciences");
  assert.equal(letterheadFor("Velite India")?.key, "india");
  assert.equal(letterheadFor("Others 1"), undefined);
  assert.equal(letterheadFor("Others 2"), undefined);
  assert.equal(letterheadFor(undefined), undefined);
});

test("the letterhead pictures are readable JPEGs at about A4 size", () => {
  for (const key of Object.keys(LETTERHEADS)) {
    const info = jpegInfo(headJpeg(key));
    assert.ok(info, key);
    assert.equal(info.width, 1240, key);
    assert.ok(info.height >= 1500 && info.height <= 1760, key);
    assert.ok(readFileSync(new URL(`../public/letterheads/${key}.jpg`, import.meta.url)).length < 150_000, `${key} stays small`);
  }
  assert.equal(jpegInfo(new Uint8Array([1, 2, 3, 4])), null);
});

test("with a letterhead the PDF embeds the picture on every page, stays well-formed, and does not repeat the company name", () => {
  for (const key of Object.keys(LETTERHEADS)) {
    const design = LETTERHEADS[key];
    const pdf = text(buildLetterPdf(buildLetter({ ...data, type: "offer" }), { company: "Velite Healthcare", letterhead: { design, jpeg: headJpeg(key) } }));
    const pages = (pdf.match(/\/Type \/Page /g) ?? []).length;
    assert.equal(pages, 2, "offer letter = letter + checklist page");
    assert.equal((pdf.match(/\/Im1 Do/g) ?? []).length, pages, `${key}: picture on every page`);
    assert.equal((pdf.match(/\/Subtype \/Image/g) ?? []).length, 1, `${key}: picture stored once`);
    assert.doesNotMatch(pdf, /VELITE HEALTHCARE\) Tj/, "the letterhead already carries the company name");
    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(pdf)[1]);
    const offsets = [...pdf.slice(startxref).matchAll(/(\d{10}) 00000 n /g)].map(match => Number(match[1]));
    offsets.forEach((offset, index) => assert.equal(pdf.slice(offset, offset + `${index + 1} 0 obj`.length), `${index + 1} 0 obj`, `${key} object ${index + 1}`));
    const image = /\/Length (\d+) >>\nstream\n/.exec(pdf.slice(pdf.indexOf("/Subtype /Image")));
    assert.equal(Number(image[1]), headJpeg(key).length, `${key}: JPEG bytes stored unchanged`);
  }
});

test("text keeps clear of the letterhead: first line below the header, last line above the footer", () => {
  for (const key of Object.keys(LETTERHEADS)) {
    const design = LETTERHEADS[key];
    const pdf = text(buildLetterPdf(buildLetter({ ...data, type: "relieving" }), { letterhead: { design, jpeg: headJpeg(key) } }));
    const ys = [...pdf.matchAll(/ Td \(/g)].length && [...pdf.matchAll(/Tw [\d.]+ ([\d.]+) ([\d.]+) Td/g)].map(match => Number(match[2]));
    assert.ok(Math.max(...ys) <= 841.89 - design.topPt, `${key}: starts below the header`);
    assert.ok(Math.min(...ys) >= design.bottomPt, `${key}: ends above the footer`);
  }
});

test("a broken letterhead file is ignored and the plain layout with the company name is used", () => {
  const pdf = text(buildLetterPdf(buildLetter(data), { company: "Velite Healthcare", letterhead: { design: LETTERHEADS.healthcare, jpeg: new Uint8Array([0, 1, 2]) } }));
  assert.doesNotMatch(pdf, /\/Subtype \/Image/);
  assert.match(pdf, /VELITE HEALTHCARE/);
});
