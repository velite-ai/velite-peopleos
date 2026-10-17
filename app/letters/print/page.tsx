"use client";
import { useEffect, useRef, useState } from "react";
import { buildLetter, LETTER_LABELS, LETTER_TYPES, type LetterData, type LetterType } from "@/lib/letter-rules";
import { buildLetterPdf } from "@/lib/letter-pdf";

// Opened by the Letters tab of a staff record. Shows a preview of the letter on a plain A4 page (blank space at the top for the letterhead).
// Nothing prints until Print is pressed; Download PDF saves a file that can be shared.
export default function PrintLetterPage() {
  const [data, setData] = useState<LetterData | null>(null);
  const [error, setError] = useState("");
  const [top, setTop] = useState("4.5");
  const [withCompany, setWithCompany] = useState(true);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const query = new URLSearchParams(window.location.search);
    const type = query.get("type") as LetterType | null; const employee = query.get("employee");
    if (!employee || !type || !LETTER_TYPES.includes(type)) { setError("This letter link is not complete. Open it again from the Letters tab of the staff record."); return; }
    try { const saved = window.localStorage.getItem("velite_letter_top_cm"); if (saved) setTop(saved); } catch { /* the default is fine */ }
    fetch(`/api/employees/${encodeURIComponent(employee)}/print-letter`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type }) })
      .then(async response => { const body = await response.json().catch(() => null); if (!response.ok) throw new Error(body?.error?.message || "The letter could not be prepared."); return body.data as LetterData; })
      .then(setData).catch(problem => setError((problem as Error).message));
  }, []);

  const letter = data ? buildLetter(data) : null;
  function download() {
    if (!data || !letter) return;
    const bytes = buildLetterPdf(letter, { company: withCompany ? data.company : undefined, title: `${LETTER_LABELS[data.type]} - ${data.name}` });
    const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
    const name = `${LETTER_LABELS[data.type]} - ${data.name} - ${data.reference}`.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ");
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${name}.pdf`;
    document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  }

  function changeTop(value: string) { setTop(value); try { window.localStorage.setItem("velite_letter_top_cm", value); } catch { /* not saved */ } }

  if (error) return <div className="letter-page"><div className="letter-toolbar no-print"><strong>Letter</strong><span className="letter-error">{error}</span><button type="button" onClick={() => window.close()}>Close</button></div></div>;
  if (!data || !letter) return <div className="letter-page"><div className="letter-toolbar no-print"><strong>Preparing the letter…</strong></div></div>;

  return <div className="letter-page">
    <div className="letter-toolbar no-print">
      <strong>{LETTER_LABELS[data.type]} · preview</strong>
      <button type="button" className="primary" onClick={() => window.print()}>Print</button>
      <button type="button" onClick={download}>Download PDF</button>
      <button type="button" onClick={() => window.close()}>Close</button>
      <label>Space at top for the letterhead (cm)<input type="number" min="0" max="12" step="0.5" value={top} onChange={event => changeTop(event.target.value)} /></label>
      <label className="letter-check"><input type="checkbox" checked={withCompany} onChange={event => setWithCompany(event.target.checked)} /> Put the company name at the top of the downloaded PDF</label>
      <p className="letter-hint">Check the letter below. Nothing is printed until you press Print. Print is for your letterhead paper; the downloaded PDF has no letterhead, so it carries the company name instead.</p>
      {letter.warnings.map(warning => <p className="letter-warning" key={warning}>⚠ {warning}</p>)}
    </div>
    <article className="letter-sheet" style={{ "--letter-top": `${Number(top) || 0}cm` } as React.CSSProperties}>
      <div className="letterhead-space no-print" aria-hidden="true">Space for the company letterhead</div>
      <div className="letter-ref"><span>Reference No. {letter.reference}</span><span>Date: {letter.dateText}</span></div>
      {letter.addressee.map(line => <p key={line}>{line}</p>)}
      {letter.heading && <p className="letter-heading">{letter.heading}</p>}
      {letter.salutation && <p><b>{letter.salutation}</b></p>}
      <p className="letter-subject">Sub: {letter.subject}</p>
      {letter.paragraphs.map(paragraph => <p className="letter-body" key={paragraph}>{paragraph}</p>)}
      {letter.closing.map(line => <p key={line}>{line}</p>)}
      <p className="letter-for"><b>{letter.signedFor}</b></p>
      <p className="letter-sign"><b>{letter.signatory}</b></p>
      {letter.cc && <p>{letter.cc}</p>}
      {letter.acceptInline && <div className="letter-accept letter-accept-inline"><span>Dated:</span><span className="letter-accept-by"><span>Accepted &amp; Agreed By</span><span className="letter-accept-name">Employee Name</span></span></div>}
    </article>
    {letter.checklist && <article className="letter-sheet letter-second" style={{ "--letter-top": `${Number(top) || 0}cm` } as React.CSSProperties}>
      <p className="letter-checklist-title">Checklist of Mandatory Documents Required</p>
      <table className="letter-checklist"><thead><tr><th>Sl No</th><th>Particulars</th></tr></thead><tbody>{letter.checklist.map((item, index) => <tr key={item}><td>{index + 1}</td><td>{item}</td></tr>)}</tbody></table>
      <p className="letter-note"><b>Note:</b> All * marked are mandatory on joining.</p>
      <div className="letter-accept"><span>Dated:</span><span className="letter-accept-by"><span>Accepted &amp; Agreed By</span><span className="letter-accept-name">Employee Name</span></span></div>
    </article>}
  </div>;
}
