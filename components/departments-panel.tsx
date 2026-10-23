"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Usage } from "@/lib/department-rules";

type Dept = { id: string; business_head_id: string; company: string; code: string; name: string; working: number; former: number };
type Head = { id: string; name: string };
type DeletePlan = { name: string; usage: Usage; blockers: string[]; canDelete: boolean };

async function bodyData(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message || fallback);
  return body?.data;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

export function DepartmentsPanel({ heads, businessHeadId, flash, onChanged }: { heads: Head[]; businessHeadId: string; flash: (message: string) => void; onChanged: () => void }) {
  const company = businessHeadId && businessHeadId !== "all" ? businessHeadId : "";
  const [rows, setRows] = useState<Dept[] | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [addHead, setAddHead] = useState(company);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Dept | null>(null);

  useEffect(() => { if (company) setAddHead(company); }, [company]);
  useEffect(() => {
    let cancelled = false;
    setError("");
    fetch(`/api/organisation/departments${company ? `?businessHeadId=${company}` : ""}`).then(response => bodyData(response, "The departments could not be loaded.")).then(data => { if (!cancelled) setRows(data); }).catch(problem => { if (!cancelled) setError((problem as Error).message); });
    return () => { cancelled = true; };
  }, [company, reload]);

  const changed = useCallback(() => { setReload(value => value + 1); onChanged(); }, [onChanged]);
  const byCompany = useMemo(() => { const map = new Map<string, Dept[]>(); for (const row of rows || []) map.set(row.company, [...(map.get(row.company) || []), row]); return [...map.entries()]; }, [rows]);

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !addHead) return;
    setBusy(true); setError("");
    try { await bodyData(await fetch("/api/organisation/departments", json("POST", { businessHeadId: addHead, name })), "The department could not be added."); flash(`Department "${name.trim()}" added.`); setName(""); changed(); }
    catch (problem) { setError((problem as Error).message); } finally { setBusy(false); }
  }
  async function rename(dept: Dept) {
    const next = window.prompt(`New name for "${dept.name}":`, dept.name);
    if (next === null || !next.trim() || next.trim() === dept.name) return;
    setError("");
    try { await bodyData(await fetch(`/api/organisation/departments/${dept.id}`, json("PATCH", { name: next })), "The department could not be renamed."); flash("Department renamed."); changed(); }
    catch (problem) { setError((problem as Error).message); }
  }

  return <section className="panel dept-panel">
    <div className="panel-head padded"><div><h2>Departments</h2><p>Add, rename or delete the departments of each company. Staff are placed in a department from their own record.</p></div></div>
    <form className="dept-add" onSubmit={add}>
      <select value={addHead} onChange={event => setAddHead(event.target.value)} aria-label="Company" disabled={Boolean(company)}>{!company && <option value="">Choose company…</option>}{heads.map(head => <option key={head.id} value={head.id}>{head.name}</option>)}</select>
      <input value={name} onChange={event => setName(event.target.value)} placeholder="New department name, for example Dispatch" maxLength={160} aria-label="Department name" />
      <button className="primary" disabled={busy || !name.trim() || !addHead}>{busy ? "Adding…" : "Add department"}</button>
    </form>
    {error && <p className="cleanup-error">{error}</p>}
    {!rows && !error && <p className="cleanup-empty">Loading…</p>}
    {byCompany.map(([companyName, list]) => <div className="dept-company" key={companyName}>
      <h3>{companyName} <small>{list.length} {list.length === 1 ? "department" : "departments"}</small></h3>
      <div className="dept-list">{list.map(dept => <div className="dept-row" key={dept.id}>
        <span><b>{dept.name}</b><small>{dept.working ? `${people(dept.working)} working` : "No one working here"}{dept.former ? ` · ${dept.former} former` : ""}</small></span>
        <span className="dept-actions"><button onClick={() => rename(dept)}>Rename</button><button className="danger" onClick={() => setRemoving(dept)}>Delete</button></span>
      </div>)}</div>
    </div>)}
    {rows && !rows.length && <p className="cleanup-empty">No departments yet. Add the first one above.</p>}
    {removing && <DeleteDialog dept={removing} others={(rows || []).filter(row => row.business_head_id === removing.business_head_id && row.id !== removing.id)} onClose={() => setRemoving(null)} onDone={message => { setRemoving(null); flash(message); changed(); }} />}
  </section>;
}

function DeleteDialog({ dept, others, onClose, onDone }: { dept: Dept; others: Dept[]; onClose: () => void; onDone: (message: string) => void }) {
  const [plan, setPlan] = useState<DeletePlan | null>(null);
  const [target, setTarget] = useState<string>("");  // "" = not chosen yet, "none" = no department
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const moveValue = target === "" ? undefined : target === "none" ? null : target;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/organisation/departments/${dept.id}`, json("DELETE", { dryRun: true, ...(moveValue !== undefined ? { moveToDepartmentId: moveValue } : {}) })).then(response => bodyData(response, "Could not check this department.")).then(data => { if (!cancelled) setPlan(data); }).catch(problem => { if (!cancelled) setError((problem as Error).message); });
    return () => { cancelled = true; };
  }, [dept.id, moveValue]);

  const needsMove = plan ? plan.usage.employees + plan.usage.candidates + plan.usage.costCentres + plan.usage.jobPositions + plan.usage.requisitions > 0 : false;
  async function confirm() {
    setBusy(true); setError("");
    try { const data = await bodyData(await fetch(`/api/organisation/departments/${dept.id}`, json("DELETE", moveValue !== undefined ? { moveToDepartmentId: moveValue } : {})), "The department could not be deleted."); onDone(`Department "${dept.name}" deleted${data.people ? `; ${people(data.people)} moved${data.movedTo ? ` to ${data.movedTo}` : " to no department"}` : ""}.`); }
    catch (problem) { setError((problem as Error).message); setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true">
    <div className="modal-head"><div><span className="eyebrow">{dept.company}</span><h2>Delete "{dept.name}"?</h2></div><button onClick={onClose}>×</button></div>
    <div className="dept-dialog">
      {!plan && !error && <p>Checking…</p>}
      {plan && needsMove && <>
        <p>In this department: <b>{[plan.usage.employees ? people(plan.usage.employees) : "", plan.usage.candidates ? `${plan.usage.candidates} candidate(s)` : "", plan.usage.jobPositions ? `${plan.usage.jobPositions} job position(s)` : "", plan.usage.costCentres ? `${plan.usage.costCentres} cost centre(s)` : "", plan.usage.requisitions ? `${plan.usage.requisitions} job requisition(s)` : ""].filter(Boolean).join(", ")}</b>{plan.usage.employees ? " (former staff included)" : ""}. Choose where they move to:</p>
        <select value={target} onChange={event => setTarget(event.target.value)} aria-label="Move to"><option value="">Choose a department…</option>{others.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}<option value="none">No department (set again later)</option></select>
      </>}
      {plan && !needsMove && !plan.blockers.length && <p>No one is in this department. It will be removed from the lists. Past records keep its name.</p>}
      {plan?.blockers.filter(item => !(needsMove && target === "" && /Choose where to move them/.test(item))).map(item => <p className="form-error" key={item}>{item}</p>)}
      {error && <p className="form-error">{error}</p>}
    </div>
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="danger-solid" disabled={busy || !plan || !plan.canDelete} onClick={confirm}>{busy ? "Deleting…" : "Delete department"}</button></div>
  </section></div>;
}
