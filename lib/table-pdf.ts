/*
 * A small dependency-free PDF writer for lists and reports (A4 landscape, Helvetica): a title, headings and tables with
 * wrapped cells, the header row repeated on every page, totals rows and page numbers. Runs in the browser.
 * Characters outside Latin-1 / Windows-1252 are shown as "?". The glyph widths are the same as in lib/letter-pdf.ts.
 */

const PAGE_W = 841.89; const PAGE_H = 595.28; const MARGIN = 30; const SIZE = 8.5; const LEAD = 11.5; const PAD = 3.5;
const CONTENT_W = PAGE_W - 2 * MARGIN;

const HELVETICA = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELVETICA_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

type FontName = "F1" | "F2";
const WIN_ANSI: Record<number, number> = { 0x2013: 0x96, 0x2014: 0x97, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2026: 0x85, 0x20ac: 0x80 };
function byteFor(char: string): number {
  const code = char.charCodeAt(0);
  if (code >= 32 && code <= 126) return code;
  if (WIN_ANSI[code]) return WIN_ANSI[code];
  if (code >= 0xa0 && code <= 0xff) return code;
  return 0x3f;
}
export const encodePdfText = (text: string) => Array.from(String(text).replace(/\s+/g, " ")).map(char => String.fromCharCode(byteFor(char))).join("");
const escapeText = (encoded: string) => encoded.replace(/[\\()]/g, match => `\\${match}`);
function widthOf(encoded: string, font: FontName, size: number): number {
  const table = font === "F2" ? HELVETICA_BOLD : HELVETICA;
  let units = 0;
  for (let index = 0; index < encoded.length; index++) { const code = encoded.charCodeAt(index); units += code >= 32 && code <= 126 ? table[code - 32] : 556; }
  return (units * size) / 1000;
}

export type PdfColumn = { header: string; weight: number; align?: "left" | "right" };
export type PdfBlock =
  | { kind: "title"; text: string; sub?: string }
  | { kind: "heading"; text: string }
  | { kind: "text"; text: string }
  | { kind: "table"; columns: PdfColumn[]; rows: string[][]; foot?: string[] }
  | { kind: "gap" };

// Splits text into lines that fit the width (long words are cut).
export function wrapText(text: string, maxWidth: number, font: FontName = "F1", size = SIZE): string[] {
  const words = encodePdfText(text).split(" ").filter(Boolean);
  const lines: string[] = []; let current = "";
  const push = () => { if (current) lines.push(current); current = ""; };
  for (let word of words) {
    while (widthOf(word, font, size) > maxWidth && word.length > 1) {
      let cut = word.length - 1; while (cut > 1 && widthOf(word.slice(0, cut), font, size) > maxWidth) cut--;
      if (current) push();
      lines.push(word.slice(0, cut)); word = word.slice(cut);
    }
    const trial = current ? `${current} ${word}` : word;
    if (current && widthOf(trial, font, size) > maxWidth) { push(); current = word; } else current = trial;
  }
  push();
  return lines.length ? lines : [""];
}

export function buildTablePdf(blocks: PdfBlock[], title: string): Uint8Array {
  const pages: string[][] = [[]];
  let y = MARGIN;
  const ops = () => pages[pages.length - 1];
  const newPage = () => { pages.push([]); y = MARGIN; };
  const ensure = (height: number) => { if (y + height > PAGE_H - MARGIN - 14) newPage(); };
  const text = (x: number, baseline: number, encoded: string, font: FontName, size: number) => ops().push(`BT /${font} ${size} Tf ${x.toFixed(2)} ${(PAGE_H - baseline).toFixed(2)} Td (${escapeText(encoded)}) Tj ET`);
  const rule = (x1: number, x2: number, top: number, w = 0.5, gray = 0.6) => ops().push(`${gray} G ${w} w ${x1.toFixed(2)} ${(PAGE_H - top).toFixed(2)} m ${x2.toFixed(2)} ${(PAGE_H - top).toFixed(2)} l S 0 G`);
  const fill = (x: number, top: number, w: number, h: number, gray: number) => ops().push(`${gray} g ${x.toFixed(2)} ${(PAGE_H - top - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f 0 g`);
  const line = (value: string, font: FontName, size: number, extra = 0) => { ensure(size + 6 + extra); text(MARGIN, y + size, encodePdfText(value), font, size); y += size + 6 + extra; };

  for (const block of blocks) {
    if (block.kind === "title") { line(block.text, "F2", 15); if (block.sub) { for (const part of wrapText(block.sub, CONTENT_W, "F1", 9)) line(part, "F1", 9); } y += 4; }
    else if (block.kind === "heading") { y += 6; ensure(40); line(block.text, "F2", 11); }
    else if (block.kind === "text") { for (const part of wrapText(block.text, CONTENT_W, "F1", 9)) line(part, "F1", 9); }
    else if (block.kind === "gap") y += 8;
    else {
      const total = block.columns.reduce((sum, column) => sum + column.weight, 0);
      const widths = block.columns.map(column => (column.weight / total) * CONTENT_W);
      const xs = widths.map((_, index) => MARGIN + widths.slice(0, index).reduce((sum, w) => sum + w, 0));
      const drawRow = (cells: string[], font: FontName, shade?: number, repeatHeader = false) => {
        const wrapped = cells.map((cell, index) => wrapText(cell, widths[index] - 2 * PAD, font));
        const height = Math.max(...wrapped.map(parts => parts.length)) * LEAD + 2 * PAD - 2;
        if (y + height > PAGE_H - MARGIN - 14) { newPage(); if (repeatHeader) { rule(MARGIN, MARGIN + CONTENT_W, y, 0.8, 0.3); header(); } }
        if (shade !== undefined) fill(MARGIN, y, CONTENT_W, height, shade);
        wrapped.forEach((parts, index) => parts.forEach((part, at) => {
          const w = widthOf(part, font, SIZE);
          const x = block.columns[index].align === "right" ? xs[index] + widths[index] - PAD - w : xs[index] + PAD;
          text(x, y + PAD + SIZE + at * LEAD - 1, part, font, SIZE);
        }));
        y += height; rule(MARGIN, MARGIN + CONTENT_W, y);
      };
      const header = () => { drawRow(block.columns.map(column => column.header), "F2", 0.9); };
      ensure(LEAD * 3); rule(MARGIN, MARGIN + CONTENT_W, y, 0.8, 0.3); header();
      for (const row of block.rows) drawRow(row, "F1", undefined, true);
      if (block.foot) drawRow(block.foot, "F2", 0.94, true);
      y += 6;
    }
  }

  // Page numbers.
  pages.forEach((pageOps, index) => {
    const label = encodePdfText(`${title} - page ${index + 1} of ${pages.length}`);
    pageOps.push(`BT /F1 7.5 Tf ${MARGIN} ${(MARGIN - 12).toFixed(2)} Td (${escapeText(label)}) Tj ET`);
  });

  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const info = add(`<< /Title (${escapeText(encodePdfText(title))}) /Producer (Velite PeopleOS) >>`);
  const pageIds: number[] = [];
  for (const pageOps of pages) {
    const stream = pageOps.join("\n");
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  let output = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => { offsets.push(output.length); output += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(output.length);
  for (let index = 0; index < output.length; index++) bytes[index] = output.charCodeAt(index) & 0xff;
  return bytes;
}
