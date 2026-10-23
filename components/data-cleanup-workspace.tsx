"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { csvRow, DEFAULT_PROBATION_MONTHS, FIX_KEYS, FIX_LABELS, type FixKey } from "@/lib/data-cleanup-rules";

type FixPerson = { id: string; code: string; name: string; position: string | null; status: string; joined: string; company: string; department: string | null; missing: FixKey[] };
type Candidate = { id: string; code: string; name: string; position: string | null; company: string; joined: string; probationEnd: string | null; confirmation: string | null; suggestedEnd: string };

async function bodyData(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message || fallback);
  return body?.data;
}
const today = () => new Date().toISOString().slice(0, 10);
const statusText = (value: string) => value === "notice_period" ? "Notice period" : value.charAt(0).toUpperCase() + value.slice(1);

export function DataCleanupWorkspace({ businessHeadId, head, flash }: { businessHeadId: string; head: string; flash: (message: string) => void }) {
  const company = businessHeadId && businessHeadId !== "all" ? businessHeadId : "";
  return <>
    <div className="page-head"><div><span className="eyebrow">Data check</span><h1>Tidy up staff details</h1><p>{head} · Find what is missing from staff records, and fix the probation status of recent joiners.</p></div></div>
    <MissingDetails company={company} head={head} />
    <RecentJoiners company={company} head={head} flash={flash} />
  </>;
}

function MissingDetails({ company, head }: { company: string; head: string }) {
  const [people, setPeople] = useState<FixPerson[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<FixKey | "any">("any");
  useEffect(() => {
    let cancelled = false;
    setPeople(null); setError("");
    fetch(`/api/data-cleanup/fix-list${company ? `?businessHeadId=${company}` : ""}`).then(response => bodyData(response, "The list could not be loaded.")).then(data => { if (!cancelled) setPeople(data); }).catch(problem => { if (!cancelled) setError((problem as Error).message); });
    return () => { cancelled = true; };
  }, [company]);
  const counts = useMemo(() => Object.fromEntries(FIX_KEYS.map(key => [key, (people || []).filter(person => person.missing.includes(key)).length])) as Record<FixKey, number>, [people]);
  const withGaps = (people || []).filter(person => person.missing.length > 0);
  const shown = filter === "any" ? withGaps : withGaps.filter(person => person.missing.includes(filter));

  function download() {
    const header = ["Company", "Staff code", "Name", "Position", "Department", "Status", "Date joined", ...FIX_KEYS.map(key => FIX_LABELS[key]), "Things missing"];
    const lines = [csvRow(header), ...shown.map(person => csvRow([person.company, person.code, person.name, person.position, person.department, statusText(person.status), person.joined, ...FIX_KEYS.map(key => person.missing.includes(key) ? "Missing" : ""), person.missing.length]))];
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob);
    link.download = `Missing details - ${head} - ${today()}.csv`.replace(/[\\/:*?"<>|]+/g, "-");
    document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  }

  return <section className="panel cleanup-panel">
    <div className="panel-head padded"><div><h2>1. Details missing from staff records</h2><p>{people ? `${withGaps.length} of ${people.length} working staff have something missing.` : "Loading…"} The list opens in Excel; give each company its part to fill in.</p></div>
      <button className="primary" disabled={!shown.length} onClick={download}>Download for Excel ({shown.length})</button></div>
    {error && <p className="cleanup-error">{error}</p>}
    {people && <>
      <div className="cleanup-chips">
        <button className={filter === "any" ? "active" : ""} onClick={() => setFilter("any")}>Anything missing <b>{withGaps.length}</b></button>
        {FIX_KEYS.map(key => <button key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)} disabled={!counts[key]}>{FIX_LABELS[key]} <b>{counts[key]}</b></button>)}
      </div>
      <div className="cleanup-table">
        <div className="cleanup-row cleanup-head"><span>NAME</span><span>COMPANY</span><span>MISSING</span></div>
        {shown.slice(0, 150).map(person => <div className="cleanup-row" key={person.id}><span><b>{person.name}</b><small>{[person.code, person.position].filter(Boolean).join(" · ")}</small></span><span>{person.company}</span><span>{person.missing.map(key => <i className="cleanup-tag" key={key}>{FIX_LABELS[key]}</i>)}</span></div>)}
        {!shown.length && <p className="cleanup-empty">Nothing missing here.</p>}
        {shown.length > 150 && <p className="cleanup-empty">Showing the first 150. The download has all {shown.length}.</p>}
      </div>
    </>}
  </section>;
}

function RecentJoiners({ company, head, flash }: { company: string; head: string; flash: (message: string) => void }) {
  const [joinedWithin, setJoinedWithin] = useState(6);
  const [probationMonths, setProbationMonths] = useState(DEFAULT_PROBATION_MONTHS);
  const [people, setPeople] = useState<Candidate[] | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [ends, setEnds] = useState<Record<string, string>>({});
  const [clearConfirmation, setClearConfirmation] = useState(true);
  const [reason, setReason] = useState("Marked as on probation (staff data tidy-up)");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPeople(null); setError("");
    const query = new URLSearchParams({ joinedWithinMonths: String(joinedWithin), probationMonths: String(probationMonths) }); if (company) query.set("businessHeadId", company);
    fetch(`/api/data-cleanup/probation?${query}`).then(response => bodyData(response, "The list could not be loaded.")).then((data: Candidate[]) => {
      if (cancelled) return;
      setPeople(data);
      // Anyone whose probation would already be over by now is left unticked: putting them on probation would only show them as overdue.
      setPicked(Object.fromEntries(data.map(person => [person.id, person.suggestedEnd >= today()])));
      setEnds(Object.fromEntries(data.map(person => [person.id, person.suggestedEnd])));
    }).catch(problem => { if (!cancelled) setError((problem as Error).message); });
    return () => { cancelled = true; };
  }, [company, joinedWithin, probationMonths, reload]);

  const chosen = (people || []).filter(person => picked[person.id]);
  const confirmed = chosen.filter(person => person.confirmation).length;
  const apply = useCallback(async () => {
    if (!chosen.length) return;
    const clearNote = clearConfirmation && confirmed ? ` ${confirmed} of them have a confirmation date, which will be cleared.` : "";
    if (!window.confirm(`Put ${chosen.length} ${chosen.length === 1 ? "person" : "people"} on probation?${clearNote} This is saved in each person's history.`)) return;
    setBusy(true); setError("");
    try {
      const data = await bodyData(await fetch("/api/data-cleanup/probation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: chosen.map(person => ({ id: person.id, probationEndDate: ends[person.id] || person.suggestedEnd })), clearConfirmation, reason }) }), "The change could not be saved.");
      flash(`${data.changed} ${data.changed === 1 ? "person is" : "people are"} now on probation${data.skipped ? ` (${data.skipped} skipped: no longer Active)` : ""}.`);
      setReload(value => value + 1);
    } catch (problem) { setError((problem as Error).message); } finally { setBusy(false); }
  }, [chosen, clearConfirmation, confirmed, ends, flash, reason]);

  return <section className="panel cleanup-panel">
    <div className="panel-head padded"><div><h2>2. Put recent joiners on probation</h2><p>New joiners who are marked <b>Active</b> do not get probation reminders. Choose who is still on probation and when it ends. {head}</p></div></div>
    <div className="cleanup-controls">
      <label>Joined in the last <input type="number" min="1" max="24" value={joinedWithin} onChange={event => setJoinedWithin(Number(event.target.value) || 6)} /> months</label>
      <label>Probation lasts <input type="number" min="1" max="24" value={probationMonths} onChange={event => setProbationMonths(Number(event.target.value) || DEFAULT_PROBATION_MONTHS)} /> months from joining</label>
    </div>
    {error && <p className="cleanup-error">{error}</p>}
    {!people && !error && <p className="cleanup-empty">Loading…</p>}
    {people && <>
      <div className="cleanup-table">
        <div className="cleanup-row cleanup-probation cleanup-head"><span></span><span>NAME</span><span>JOINED</span><span>CONFIRMED ON</span><span>PROBATION ENDS</span></div>
        {people.map(person => <div className="cleanup-row cleanup-probation" key={person.id}>
          <span><input type="checkbox" aria-label={`Select ${person.name}`} checked={Boolean(picked[person.id])} onChange={event => setPicked(current => ({ ...current, [person.id]: event.target.checked }))} /></span>
          <span><b>{person.name}</b><small>{[person.code, person.company].join(" · ")}</small></span>
          <span>{person.joined}</span>
          <span>{person.confirmation || "—"}</span>
          <span><input type="date" value={ends[person.id] || ""} min={person.joined} onChange={event => setEnds(current => ({ ...current, [person.id]: event.target.value }))} />{person.suggestedEnd < today() && <small>Period already over</small>}</span>
        </div>)}
        {!people.length && <p className="cleanup-empty">No Active staff joined in this period.</p>}
      </div>
      {people.length > 0 && <div className="cleanup-apply">
        <label className="cleanup-check"><input type="checkbox" checked={clearConfirmation} onChange={event => setClearConfirmation(event.target.checked)} /> Clear their confirmation date (they are not confirmed yet; it is set again when they are confirmed)</label>
        <label>Reason for the history<input value={reason} onChange={event => setReason(event.target.value)} /></label>
        <button className="primary" disabled={busy || !chosen.length || reason.trim().length < 3} onClick={apply}>{busy ? "Saving…" : `Put ${chosen.length} on probation`}</button>
      </div>}
    </>}
  </section>;
}
