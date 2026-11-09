"use client";
/* Salary inputs: paid leave, extra overtime hours, advance deducted and "no salary" for one salary month.
   Saved with PUT /api/payroll/inputs; the salary run (Calculate payroll) reads them. */
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useState } from "react";

type Row = {
  employeeId: string; code: string; name: string; position: string | null;
  expectedDays: number | null; presentDays: number | null; halfDays: number | null; unpaidDays: number | null;
  paidLeaveDays: number; overtimeHours: number; advanceDeducted: number; noSalary: boolean; note: string; stoppedComing: boolean; saved: boolean;
};
type Loaded = { status: string; editable: boolean; attendanceStatus: string | null; rows: Row[] };
type Draft = { paidLeaveDays: string; overtimeHours: string; advanceDeducted: string; noSalary: boolean; note: string };

const toDraft = (row: Row): Draft => ({ paidLeaveDays: row.paidLeaveDays ? String(row.paidLeaveDays) : "", overtimeHours: row.overtimeHours ? String(row.overtimeHours) : "", advanceDeducted: row.advanceDeducted ? String(row.advanceDeducted) : "", noSalary: row.noSalary, note: row.note });
const same = (a: Draft, b: Draft) => Number(a.paidLeaveDays || 0) === Number(b.paidLeaveDays || 0) && Number(a.overtimeHours || 0) === Number(b.overtimeHours || 0) && Number(a.advanceDeducted || 0) === Number(b.advanceDeducted || 0) && a.noSalary === b.noSalary && a.note.trim() === b.note.trim();
const nice = (value: string) => value.toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase()).replace(/\s+/g, " ").trim();

export function PayrollInputs({ periodId, monthLabel, refreshKey, flash, onSaved }: { periodId: string; monthLabel: string; refreshKey: number; flash: (message: string) => void; onSaved: () => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [original, setOriginal] = useState<Record<string, Draft>>({});
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);

  const load = useCallback(async () => {
    const response = await fetch(`/api/payroll/inputs?payrollPeriodId=${encodeURIComponent(periodId)}`);
    const body = await response.json().catch(() => null);
    if (!response.ok) { flash(body?.error?.message || "The salary inputs could not be loaded."); return; }
    const data = body.data as Loaded;
    setLoaded(data);
    const next: Record<string, Draft> = {};
    for (const row of data.rows) next[row.employeeId] = toDraft(row);
    setDrafts(next); setOriginal(next);
  }, [periodId, flash]);
  useEffect(() => { setLoaded(null); load(); }, [load, refreshKey]);

  const rows = useMemo(() => (loaded?.rows || []).filter(row => !search.trim() || `${row.name} ${row.code}`.toLowerCase().includes(search.trim().toLowerCase())), [loaded, search]);
  const changed = useMemo(() => (loaded?.rows || []).filter(row => drafts[row.employeeId] && original[row.employeeId] && !same(drafts[row.employeeId], original[row.employeeId])), [loaded, drafts, original]);
  const editable = Boolean(loaded?.editable);
  const set = (id: string, patch: Partial<Draft>) => setDrafts(current => ({ ...current, [id]: { ...current[id], ...patch } }));

  async function save() {
    if (!changed.length) return;
    const reason = window.prompt("Reason for these salary inputs:", `Salary inputs for ${monthLabel}`);
    if (!reason) return;
    setBusy(true);
    try {
      const response = await fetch("/api/payroll/inputs", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ payrollPeriodId: periodId, reason, rows: changed.map(row => { const d = drafts[row.employeeId]; return { employeeId: row.employeeId, paidLeaveDays: Number(d.paidLeaveDays || 0), overtimeHours: Number(d.overtimeHours || 0), advanceDeducted: Number(d.advanceDeducted || 0), noSalary: d.noSalary, note: d.note.trim() }; }) }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message || "The salary inputs could not be saved.");
      flash(`Saved for ${changed.length} ${changed.length === 1 ? "person" : "people"}. Now press “Calculate payroll” to use them.`);
      await load(); onSaved();
    } catch (error) { flash((error as Error).message); } finally { setBusy(false); }
  }

  if (!loaded) return <section className="panel salary-inputs"><div className="panel-head padded"><div><h2>Salary inputs</h2><p>Loading…</p></div></div></section>;
  const withInputs = (loaded.rows || []).filter(row => { const d = drafts[row.employeeId]; return d && (Number(d.paidLeaveDays || 0) || Number(d.overtimeHours || 0) || Number(d.advanceDeducted || 0) || d.noSalary); }).length;

  return <section className="panel table-panel salary-inputs">
    <div className="panel-head padded"><div><h2>Salary inputs</h2><p>Paid leave, overtime and advances are decided while working out the salary. Fill them in here, save, then press “Calculate payroll”.{withInputs ? ` ${withInputs} ${withInputs === 1 ? "person has" : "people have"} inputs.` : ""}</p></div>
      <div className="salary-inputs-tools"><button className="secondary" onClick={() => setOpen(value => !value)}>{open ? "Hide" : "Show"}</button></div></div>
    {open && <>
      {loaded.attendanceStatus !== "locked" && <div className="form-hint salary-inputs-note">Attendance for this month is not locked yet, so the days below are blank. Lock the month in Attendance first; the salary cannot be calculated before that.</div>}
      {!loaded.editable && <div className="form-hint salary-inputs-note">The month is {loaded.status.replaceAll("_", " ")}, so these inputs can no longer be changed.</div>}
      <div className="salary-inputs-bar"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a name or code" aria-label="Find a person" />
        <button className="primary" disabled={!editable || busy || !changed.length} onClick={save}>{busy ? "Saving…" : changed.length ? `Save inputs (${changed.length})` : "Save inputs"}</button></div>
      <div className="data-table salary-inputs-table"><div className="tr th"><span>PERSON</span><span>PRESENT</span><span>UNPAID</span><span>PAID LEAVE</span><span>OVERTIME (HRS)</span><span>ADVANCE (₹)</span><span>NO SALARY</span><span>NOTE</span></div>
        {rows.map(row => {
          const d = drafts[row.employeeId] || toDraft(row);
          const present = row.presentDays === null ? null : row.presentDays + (row.halfDays || 0) / 2;
          const tooMuch = row.unpaidDays !== null && Number(d.paidLeaveDays || 0) > row.unpaidDays && !d.noSalary;
          return <div className={`tr ${d.noSalary ? "no-salary" : ""}`} key={row.employeeId}>
            <span><b>{nice(row.name)}<small>{row.code}{row.position ? ` · ${row.position}` : ""}</small></b></span>
            <span>{present === null ? "—" : present}</span>
            <span>{row.unpaidDays === null ? "—" : row.unpaidDays}</span>
            <span><input type="number" min="0" max="31" step="0.5" value={d.paidLeaveDays} disabled={!editable || d.noSalary} onChange={event => set(row.employeeId, { paidLeaveDays: event.target.value })} aria-label={`Paid leave for ${row.name}`} />{tooMuch && <small className="warn">Only {row.unpaidDays} unpaid {row.unpaidDays === 1 ? "day" : "days"} can be made paid</small>}</span>
            <span><input type="number" min="0" step="0.5" value={d.overtimeHours} disabled={!editable || d.noSalary} onChange={event => set(row.employeeId, { overtimeHours: event.target.value })} aria-label={`Overtime hours for ${row.name}`} /></span>
            <span><input type="number" min="0" step="1" value={d.advanceDeducted} disabled={!editable || d.noSalary} onChange={event => set(row.employeeId, { advanceDeducted: event.target.value })} aria-label={`Advance deducted for ${row.name}`} /></span>
            <span><label className="salary-check"><input type="checkbox" checked={d.noSalary} disabled={!editable} onChange={event => set(row.employeeId, { noSalary: event.target.checked })} /> Pay nothing</label>{row.stoppedComing && <small className="warn">Stopped coming</small>}</span>
            <span><input value={d.note} maxLength={300} disabled={!editable} onChange={event => set(row.employeeId, { note: event.target.value })} placeholder="Optional" aria-label={`Note for ${row.name}`} /></span>
          </div>;
        })}
      </div>
      {!rows.length && <div className="empty-state padded">No one found.</div>}
    </>}
  </section>;
}
