/*
 * The company letterheads (scans of the printed letter pads, resized to ~150 dpi in public/letterheads/).
 * Used behind the letter in the downloaded PDF and in the preview; Print never includes them, because the real paper is in the printer.
 * Others 1 and Others 2 have no letterhead, so their letters keep the plain layout.
 * Margins are in points from the top / bottom of an A4 page and keep the text clear of each design's header and footer.
 * "stretch" fills the whole page; "top" keeps the picture's own proportions and starts at the top edge (Velite India's pad is not A4 shaped).
 */

export type LetterheadKey = "healthcare" | "sciences" | "pharmaceuticals" | "india";
export type Letterhead = { key: LetterheadKey; file: string; fit: "stretch" | "top"; topPt: number; bottomPt: number };

export const LETTERHEADS: Record<LetterheadKey, Letterhead> = {
  healthcare: { key: "healthcare", file: "/letterheads/healthcare.jpg", fit: "stretch", topPt: 122, bottomPt: 82 },
  sciences: { key: "sciences", file: "/letterheads/sciences.jpg", fit: "stretch", topPt: 118, bottomPt: 80 },
  pharmaceuticals: { key: "pharmaceuticals", file: "/letterheads/pharmaceuticals.jpg", fit: "stretch", topPt: 182, bottomPt: 62 },
  india: { key: "india", file: "/letterheads/india.jpg", fit: "top", topPt: 132, bottomPt: 57 },
};

// Which letterhead belongs to a company, by its name ("Velite Healthcare" -> healthcare). Undefined when the company has none.
export function letterheadFor(company: string | undefined | null): Letterhead | undefined {
  const name = (company ?? "").toLowerCase();
  if (name.includes("healthcare")) return LETTERHEADS.healthcare;
  if (name.includes("pharma")) return LETTERHEADS.pharmaceuticals;
  if (name.includes("science")) return LETTERHEADS.sciences;
  if (/\bindia\b/.test(name)) return LETTERHEADS.india;
  return undefined;
}
