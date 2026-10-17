import type { LetterContent } from "./letter-rules";

/*
 * Turns a printable letter into a real PDF file (A4, Helvetica) that can be saved and shared.
 * Small and dependency-free: it lays the same text out as the on-screen preview (same wording, same order, justified paragraphs).
 * Runs in the browser; characters outside Latin-1 / Windows-1252 are shown as "?".
 */

const PAGE_W = 595.28; const PAGE_H = 841.89; const MM = 72 / 25.4;
const FONT_SIZE = 11; const LEADING = 17; const PARAGRAPH_GAP = 10;
const SIDE = 22 * MM; const BOTTOM = 20 * MM; const TEXT_W = PAGE_W - 2 * SIDE;

// Helvetica and Helvetica-Bold glyph widths (1/1000 em) for ASCII 32..126.
const HELVETICA = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELVETICA_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

type FontName = "F1" | "F2";
const WIN_ANSI: Record<number, number> = { 0x2013: 0x96, 0x2014: 0x97, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2026: 0x85, 0x20ac: 0x80 };

function byteFor(char: string): number {
  const code = char.charCodeAt(0);
  if (code >= 32 && code <= 126) return code;
  if (WIN_ANSI[code]) return WIN_ANSI[code];
  if (code >= 0xa0 && code <= 0xff) return code;
  return 0x3f; // ?
}
const encode = (text: string) => Array.from(text.replace(/\s+/g, " ")).map(char => String.fromCharCode(byteFor(char))).join("");
const escapeText = (encoded: string) => encoded.replace(/[\\()]/g, match => `\\${match}`);

function width(encoded: string, font: FontName, size: number): number {
  const table = font === "F2" ? HELVETICA_BOLD : HELVETICA;
  let units = 0;
  for (let index = 0; index < encoded.length; index++) { const code = encoded.charCodeAt(index); units += code >= 32 && code <= 126 ? table[code - 32] : 556; }
  return (units * size) / 1000;
}

class Document {
  pages: string[][] = [[]];
  y: number; // distance from the top of the current page
  top: number;
  constructor(top: number) { this.top = top; this.y = top; }
  get ops() { return this.pages[this.pages.length - 1]; }
  newPage() { this.pages.push([]); this.y = this.top; }
  ensure(height: number) { if (this.y + height > PAGE_H - BOTTOM) this.newPage(); }
  text(x: number, baselineFromTop: number, text: string, font: FontName, size: number, spacing = 0) {
    // Tw (word spacing) stays in force until changed, so every line sets it: 0 unless the line is justified.
    this.ops.push(`BT /${font} ${size} Tf ${spacing.toFixed(3)} Tw ${x.toFixed(2)} ${(PAGE_H - baselineFromTop).toFixed(2)} Td (${escapeText(text)}) Tj ET`);
  }
  line(x1: number, yTop1: number, x2: number, yTop2: number, lineWidth = 0.7) {
    this.ops.push(`${lineWidth} w ${x1.toFixed(2)} ${(PAGE_H - yTop1).toFixed(2)} m ${x2.toFixed(2)} ${(PAGE_H - yTop2).toFixed(2)} l S`);
  }
  rect(x: number, yTop: number, w: number, h: number) { this.ops.push(`0.7 w ${x.toFixed(2)} ${(PAGE_H - yTop - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`); }

  // One line of text on its own row.
  row(text: string, font: FontName = "F1", align: "left" | "center" | "right" = "left", underline = false, size = FONT_SIZE) {
    this.ensure(LEADING);
    const encoded = encode(text); const w = width(encoded, font, size);
    const x = align === "center" ? (PAGE_W - w) / 2 : align === "right" ? PAGE_W - SIDE - w : SIDE;
    this.text(x, this.y + LEADING - 4, encoded, font, size);
    if (underline) this.line(x, this.y + LEADING - 1.5, x + w, this.y + LEADING - 1.5, 0.6);
    this.y += LEADING;
  }
  // A wrapped paragraph; justified except for its last line.
  paragraph(text: string, font: FontName = "F1", justify = false, maxWidth = TEXT_W, x0 = SIDE) {
    const words = encode(text).split(" ").filter(Boolean); const lines: string[][] = []; let current: string[] = [];
    for (const word of words) {
      const trial = [...current, word].join(" ");
      if (current.length && width(trial, font, FONT_SIZE) > maxWidth) { lines.push(current); current = [word]; } else current.push(word);
    }
    if (current.length) lines.push(current);
    lines.forEach((parts, index) => {
      this.ensure(LEADING);
      const content = parts.join(" "); const natural = width(content, font, FONT_SIZE); const gaps = parts.length - 1;
      const spacing = justify && index < lines.length - 1 && gaps > 0 ? (maxWidth - natural) / gaps : 0;
      this.text(x0, this.y + LEADING - 4, content, font, FONT_SIZE, spacing);
      this.y += LEADING;
    });
  }
  gap(points: number) { this.y += points; }
}

function acceptanceBlock(doc: Document) {
  doc.ensure(LEADING * 5);
  const rightX = PAGE_W - SIDE;
  doc.text(SIDE, doc.y + LEADING - 4, "Dated:", "F1", FONT_SIZE);
  const accepted = encode("Accepted & Agreed By"); const acceptedW = width(accepted, "F1", FONT_SIZE);
  doc.text(rightX - acceptedW, doc.y + LEADING - 4, accepted, "F1", FONT_SIZE);
  const name = encode("Employee Name"); const nameW = width(name, "F1", FONT_SIZE);
  doc.text(rightX - acceptedW / 2 - nameW / 2, doc.y + LEADING * 3 + 20, name, "F1", FONT_SIZE);
  doc.y += LEADING * 4 + 20;
}

export type LetterPdfOptions = { company?: string; title?: string };

// Builds the PDF. With `company`, the company name is printed at the top, because a shared file has no pre-printed letterhead.
export function buildLetterPdf(letter: LetterContent, options: LetterPdfOptions = {}): Uint8Array {
  const top = 20 * MM;
  const doc = new Document(top);
  if (options.company) {
    doc.row(options.company.toUpperCase(), "F2", "center", false, 15);
    doc.line(SIDE, doc.y + 4, PAGE_W - SIDE, doc.y + 4, 0.8);
    doc.gap(28);
  }

  // Reference and date on one line
  doc.ensure(LEADING);
  const date = encode(`Date: ${letter.dateText}`); const dateW = width(date, "F1", FONT_SIZE);
  doc.text(SIDE, doc.y + LEADING - 4, encode(`Reference No. ${letter.reference}`), "F1", FONT_SIZE);
  doc.text(PAGE_W - SIDE - dateW, doc.y + LEADING - 4, date, "F1", FONT_SIZE);
  doc.y += LEADING + 14;

  for (const line of letter.addressee) { doc.paragraph(line); doc.gap(PARAGRAPH_GAP); }
  if (letter.heading) { doc.gap(6); doc.row(letter.heading, "F2", "center", true); doc.gap(12); }
  if (letter.salutation) { doc.paragraph(letter.salutation, "F2"); doc.gap(PARAGRAPH_GAP); }
  doc.gap(2); doc.row(`Sub: ${letter.subject}`, "F2", "center", true); doc.gap(12);
  for (const paragraph of letter.paragraphs) { doc.paragraph(paragraph, "F1", true); doc.gap(PARAGRAPH_GAP); }
  for (const line of letter.closing) { doc.paragraph(line); doc.gap(PARAGRAPH_GAP); }
  doc.gap(4); doc.row(letter.signedFor, "F2"); doc.gap(34);
  doc.row(letter.signatory, "F2"); doc.gap(14);
  if (letter.cc) { doc.row(letter.cc); doc.gap(PARAGRAPH_GAP); }
  if (letter.acceptInline) { doc.gap(24); acceptanceBlock(doc); }

  if (letter.checklist) {
    doc.newPage();
    if (options.company) doc.gap(0);
    doc.row("Checklist of Mandatory Documents Required", "F2", "left", true); doc.gap(PARAGRAPH_GAP);
    const tableW = TEXT_W * 0.78; const firstW = tableW * 0.14; const rowH = 40;
    const draw = (cells: [string, string], bold: boolean) => {
      doc.ensure(rowH);
      doc.rect(SIDE, doc.y, firstW, rowH); doc.rect(SIDE + firstW, doc.y, tableW - firstW, rowH);
      doc.text(SIDE + 10, doc.y + rowH / 2 + 4, encode(cells[0]), bold ? "F2" : "F1", FONT_SIZE);
      doc.text(SIDE + firstW + 10, doc.y + rowH / 2 + 4, encode(cells[1]), bold ? "F2" : "F1", FONT_SIZE);
      doc.y += rowH;
    };
    draw(["Sl No", "Particulars"], true);
    letter.checklist.forEach((item, index) => draw([String(index + 1), item], false));
    doc.gap(28);
    doc.ensure(LEADING);
    doc.text(SIDE, doc.y + LEADING - 4, "Note:", "F2", FONT_SIZE);
    doc.text(SIDE + width("Note: ", "F2", FONT_SIZE), doc.y + LEADING - 4, "All * marked are mandatory on joining.", "F1", FONT_SIZE);
    doc.y += LEADING + 2;
    acceptanceBlock(doc);
  }

  return assemble(doc.pages, options.title || `${letter.subject} ${letter.reference}`);
}

function assemble(pages: string[][], title: string): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  add("<< /Type /Catalog /Pages 2 0 R >>"); // 1
  add(""); // 2 (pages) filled below
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"); // 3
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"); // 4
  const info = add(`<< /Title (${escapeText(encode(title))}) /Producer (Velite PeopleOS) >>`); // 5
  const pageIds: number[] = [];
  for (const ops of pages) {
    const stream = ops.join("\n");
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let output = "%PDF-1.4\n%âãÏÓ\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => { offsets.push(output.length); output += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(output.length);
  for (let index = 0; index < output.length; index++) bytes[index] = output.charCodeAt(index) & 0xff;
  return bytes;
}
