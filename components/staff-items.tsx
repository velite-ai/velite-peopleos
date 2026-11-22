"use client";
/* Company items given to staff (laptop, mobile phone, SIM, lab coat, slippers ...): the tab on a staff record, and the company-wide page with stock. */
/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { EVENT_LABEL, itemsCsv, STATUS_LABEL, stockCsv } from "@/lib/staff-item-rules";

type ItemType = { id: string; name: string; active: boolean };
type Head = { id: string; name: string };

async function api(url: string, options?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message || "That could not be done. Please try again.");
  return body?.data;
}
const send = (url: string, method: string, data: unknown) => api(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
const todayIndia = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const niceDate = (value: unknown) => { const text = String(value || "").slice(0, 10); const date = new Date(`${text}T00:00:00Z`); return text && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—"; };
const niceTime = (value: unknown) => { const date = value ? new Date(String(value)) : null; return date && !Number.isNaN(date.getTime()) ? date.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"; };
const statusClass = (status: string) => `items-status items-${status.replace("_", "-")}`;
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}

/* ---------- shared dialogs ---------- */

function Dialog({ title, eyebrow, onClose, children }: { title: string; eyebrow?: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop items-modal" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-head"><div><span className="eyebrow">{eyebrow || "COMPANY ITEMS"}</span><h2>{title}</h2></div><button onClick={onClose} aria-label="Close">×</button></div>
      {children}
    </section>
  </div>;
}

function GiveDialog({ employeeId, employeeName, types, stock, onTypesChanged, onClose, onSaved }: { employeeId: string; employeeName: string; types: ItemType[]; stock: any[]; onTypesChanged: () => void; onClose: () => void; onSaved: () => void }) {
  const active = types.filter(type => type.active);
  const [typeId, setTypeId] = useState(active[0]?.id || "");
  const [newName, setNewName] = useState("");
  const [details, setDetails] = useState(""); const [quantity, setQuantity] = useState("1"); const [issuedOn, setIssuedOn] = useState(todayIndia()); const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const picked = stock.find(row => row.item_type_id === typeId);
  const asked = Number(quantity) || 0;
  async function addType() {
    setBusy(true); setError("");
    try { const created = await send("/api/staff-items/types", "POST", { name: newName }); await onTypesChanged(); setTypeId(created.id); setNewName(""); }
    catch (problem) { setError((problem as Error).message); }
    setBusy(false);
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await send(`/api/employees/${employeeId}/items`, "POST", { itemTypeId: typeId, details, quantity: Number(quantity), issuedOn, note }); onSaved(); }
    catch (problem) { setError((problem as Error).message); setBusy(false); }
  }
  return <Dialog title={`Give an item to ${employeeName}`} onClose={onClose}>
    <form className="form-grid" onSubmit={submit}>
      <label className="span-two">What is being given?<select value={typeId} onChange={event => setTypeId(event.target.value)} required>{active.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
      <label className="span-two">Not in the list? Add a new kind of item<span className="items-addtype"><input value={newName} onChange={event => setNewName(event.target.value)} placeholder="For example Tablet, Apron, Helmet" maxLength={60} /><button type="button" className="secondary" disabled={busy || newName.trim().length < 2} onClick={addType}>＋ Add to the list</button></span></label>
      <label className="span-two">Details (make, model, serial / IMEI, SIM number, size)<input value={details} onChange={event => setDetails(event.target.value)} maxLength={300} placeholder="Dell Latitude 5420, serial ABC123" /></label>
      <label>Quantity<input type="number" min={1} max={999} step={1} value={quantity} onChange={event => setQuantity(event.target.value)} required /></label>
      <label>Date given<input type="date" max={todayIndia()} value={issuedOn} onChange={event => setIssuedOn(event.target.value)} required /></label>
      <label className="span-two">Note (optional)<input value={note} onChange={event => setNote(event.target.value)} maxLength={500} /></label>
      {picked?.set_up && <div className={`form-hint span-two${asked > picked.in_stock ? " items-warn" : ""}`}>In stock: <b>{picked.in_stock}</b>{asked > picked.in_stock ? ` — stock records show fewer than the ${asked} you are giving. You can still save; add the stock you bought on the Stock tab.` : ""}</div>}
      {picked && !picked.set_up && <div className="form-hint span-two">Stock for this item has not been entered yet, so it is not checked.</div>}
      {error && <div className="form-error span-two">{error}</div>}
      <div className="modal-actions span-two"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !typeId}>{busy ? "Saving…" : "Save"}</button></div>
    </form>
  </Dialog>;
}

/** Give the same item to one or many people at once (for example lab coats for a team). */
function GiveManyDialog({ people, types, defaultCompany, onTypesChanged, onClose, onSaved }: { people: any[]; types: ItemType[]; defaultCompany: string; onTypesChanged: () => void; onClose: () => void; onSaved: (count: number) => void }) {
  const active = types.filter(type => type.active);
  const [typeId, setTypeId] = useState(active[0]?.id || ""); const [newName, setNewName] = useState("");
  const [details, setDetails] = useState(""); const [quantity, setQuantity] = useState("1"); const [issuedOn, setIssuedOn] = useState(todayIndia()); const [note, setNote] = useState("");
  const [search, setSearch] = useState(""); const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const working = useMemo(() => people.filter(person => ["probation", "active", "notice_period"].includes(String(person.status).trim().toLowerCase().replaceAll(" ", "_")) && (!defaultCompany || person.businessHeadId === defaultCompany)), [people, defaultCompany]);
  const shown = useMemo(() => { const q = search.trim().toLowerCase(); return (q ? working.filter(person => `${person.name} ${person.code} ${person.head} ${person.role || ""}`.toLowerCase().includes(q)) : working).slice(0, 400); }, [working, search]);
  const toggle = (id: string) => setPicked(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  async function addType() {
    setBusy(true); setError("");
    try { const created = await send("/api/staff-items/types", "POST", { name: newName }); await onTypesChanged(); setTypeId(created.id); setNewName(""); } catch (problem) { setError((problem as Error).message); }
    setBusy(false);
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { const result = await send("/api/staff-items/bulk", "POST", { employeeIds: [...picked], itemTypeId: typeId, details, quantity: Number(quantity), issuedOn, note }); onSaved(result.created); }
    catch (problem) { setError((problem as Error).message); setBusy(false); }
  }
  return <Dialog title="Give an item" onClose={onClose}>
    <form className="form-grid" onSubmit={submit}>
      <label className="span-two">What is being given?<select value={typeId} onChange={event => setTypeId(event.target.value)} required>{active.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
      <label className="span-two">Not in the list? Add a new kind of item<span className="items-addtype"><input value={newName} onChange={event => setNewName(event.target.value)} placeholder="For example Tablet, Apron, Helmet" maxLength={60} /><button type="button" className="secondary" disabled={busy || newName.trim().length < 2} onClick={addType}>＋ Add to the list</button></span></label>
      <label className="span-two">Details (make, model, serial / IMEI, SIM number, size)<input value={details} onChange={event => setDetails(event.target.value)} maxLength={300} placeholder="Dell Latitude 5420, serial ABC123" /></label>
      <label>Quantity for each person<input type="number" min={1} max={999} step={1} value={quantity} onChange={event => setQuantity(event.target.value)} required /></label>
      <label>Date given<input type="date" max={todayIndia()} value={issuedOn} onChange={event => setIssuedOn(event.target.value)} required /></label>
      <label className="span-two">Note (optional)<input value={note} onChange={event => setNote(event.target.value)} maxLength={500} /></label>
      <div className="span-two items-people-box">
        <div className="items-people-head"><b>Who is it given to? <span className="items-count">{picked.size} chosen</span></b>
          <span><button type="button" className="items-btn" onClick={() => setPicked(current => new Set([...current, ...shown.map(person => person.id)]))}>Choose all shown ({shown.length})</button><button type="button" className="items-btn" disabled={!picked.size} onClick={() => setPicked(new Set())}>Clear</button></span></div>
        <input className="items-people-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name, code or company" aria-label="Search people" />
        <div className="items-people-list">{shown.map(person => <label key={person.id} className={picked.has(person.id) ? "picked" : ""}><input type="checkbox" checked={picked.has(person.id)} onChange={() => toggle(person.id)} /><span><b>{person.name}</b><small>{[person.code, person.head, person.role].filter(Boolean).join(" · ")}</small></span></label>)}{!shown.length && <p className="cleanup-empty">No one found.</p>}</div>
        {picked.size > 1 && <div className="form-hint">The same details and quantity are recorded for each of the {picked.size} people. For phones or SIM cards that each have their own number, give them one person at a time.</div>}
      </div>
      {error && <div className="form-error span-two">{error}</div>}
      <div className="modal-actions span-two"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !typeId || !picked.size}>{busy ? "Saving…" : picked.size > 1 ? `Give to ${picked.size} people` : "Save"}</button></div>
    </form>
  </Dialog>;
}

const ACTION_TITLE: Record<string, string> = { returned: "Mark as returned", lost: "Mark as lost", damaged: "Mark as damaged", reopen: "Put back with the person" };
function StatusDialog({ item, action, onClose, onSaved }: { item: any; action: string; onClose: () => void; onSaved: () => void }) {
  const [on, setOn] = useState(todayIndia()); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const needsNote = action === "lost" || action === "damaged";
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await send(`/api/staff-items/${item.id}/status`, "POST", { action, on, note }); onSaved(); }
    catch (problem) { setError((problem as Error).message); setBusy(false); }
  }
  return <Dialog title={`${ACTION_TITLE[action]}: ${item.type_name}`} onClose={onClose}>
    <form className="form-grid" onSubmit={submit}>
      {action !== "reopen" && <label>Date<input type="date" max={todayIndia()} min={String(item.issued_on).slice(0, 10)} value={on} onChange={event => setOn(event.target.value)} required /></label>}
      <label className="span-two">{needsNote ? `What happened? (required)` : "Note (optional)"}<input value={note} onChange={event => setNote(event.target.value)} maxLength={500} required={needsNote} placeholder={action === "damaged" ? "For example screen broken" : action === "lost" ? "For example lost on a trip" : ""} /></label>
      {action === "reopen" && <div className="form-hint span-two">Use this only to correct a mistake. The item goes back to being with the person.</div>}
      {error && <div className="form-error span-two">{error}</div>}
      <div className="modal-actions span-two"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
    </form>
  </Dialog>;
}

function EditDialog({ item, onClose, onSaved }: { item: any; onClose: () => void; onSaved: () => void }) {
  const [details, setDetails] = useState(item.details || ""); const [quantity, setQuantity] = useState(String(item.quantity)); const [issuedOn, setIssuedOn] = useState(String(item.issued_on).slice(0, 10)); const [note, setNote] = useState(item.note || "");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await send(`/api/staff-items/${item.id}`, "PATCH", { details, quantity: Number(quantity), issuedOn, note }); onSaved(); }
    catch (problem) { setError((problem as Error).message); setBusy(false); }
  }
  return <Dialog title={`Correct details: ${item.type_name}`} onClose={onClose}>
    <form className="form-grid" onSubmit={submit}>
      <label className="span-two">Details<input value={details} onChange={event => setDetails(event.target.value)} maxLength={300} /></label>
      <label>Quantity<input type="number" min={1} max={999} step={1} value={quantity} onChange={event => setQuantity(event.target.value)} required /></label>
      <label>Date given<input type="date" max={todayIndia()} value={issuedOn} onChange={event => setIssuedOn(event.target.value)} required /></label>
      <label className="span-two">Note<input value={note} onChange={event => setNote(event.target.value)} maxLength={500} /></label>
      {error && <div className="form-error span-two">{error}</div>}
      <div className="modal-actions span-two"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
    </form>
  </Dialog>;
}

/** The buttons that fit an item's current status. */
function ItemButtons({ item, onAction }: { item: any; onAction: (action: string) => void }) {
  const b = (action: string, label: string, danger = false) => <button key={action} type="button" className={`items-btn${danger ? " danger" : ""}`} onClick={() => onAction(action)}>{label}</button>;
  if (item.status === "with_staff") return <>{b("returned", "Returned")}{b("damaged", "Damaged", true)}{b("lost", "Lost", true)}{b("edit", "Edit")}</>;
  if (item.status === "damaged") return <>{b("returned", "Repaired and returned")}{b("lost", "Lost", true)}{b("reopen", "Put back with person")}{b("edit", "Edit")}</>;
  if (item.status === "lost") return <>{b("returned", "Found and returned")}{b("reopen", "Put back with person")}{b("edit", "Edit")}</>;
  return <>{b("reopen", "Put back with person")}{b("edit", "Edit")}</>;
}

/* ---------- the tab on a staff record ---------- */

export function StaffItemsPanel({ employeeId, employeeName, flash }: { employeeId: string; employeeName: string; flash: (message: string) => void }) {
  const [data, setData] = useState<any>(null); const [types, setTypes] = useState<ItemType[]>([]); const [error, setError] = useState("");
  const [dialog, setDialog] = useState<null | { kind: "give" } | { kind: "status"; item: any; action: string } | { kind: "edit"; item: any }>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const [items, typeList] = await Promise.all([api(`/api/employees/${employeeId}/items`), api("/api/staff-items/types")]); setData(items); setTypes(typeList); setError(""); }
    catch (problem) { setError((problem as Error).message); }
  }, [employeeId]);
  useEffect(() => { void load(); }, [load]);
  const loadTypes = useCallback(async () => { setTypes(await api("/api/staff-items/types")); }, []);
  if (error) return <section className="record-card"><header><div><h3>Company items</h3></div></header><div className="record-empty">{error.includes("permission") ? "You do not have access to company items for this person." : error}</div></section>;
  if (!data) return <section className="record-card"><header><div><h3>Company items</h3></div></header><div className="record-empty">Loading…</div></section>;
  const events = (id: string) => data.events.filter((event: any) => event.item_id === id);
  const now = data.items.filter((item: any) => item.status === "with_staff");
  const earlier = data.items.filter((item: any) => item.status !== "with_staff");
  const row = (item: any) => <div className="items-row" key={item.id}>
    <div className="items-main"><b>{item.type_name}{item.quantity > 1 ? ` × ${item.quantity}` : ""}</b>{item.details && <span>{item.details}</span>}<small>Given {niceDate(item.issued_on)}{item.status !== "with_staff" && item.status_on ? ` · ${STATUS_LABEL[item.status as keyof typeof STATUS_LABEL]} ${niceDate(item.status_on)}` : ""}{item.note ? ` · ${item.note}` : ""}</small></div>
    <span className={statusClass(item.status)}>{STATUS_LABEL[item.status as keyof typeof STATUS_LABEL]}</span>
    {data.canWrite && <div className="items-actions"><ItemButtons item={item} onAction={action => setDialog(action === "edit" ? { kind: "edit", item } : { kind: "status", item, action })} /></div>}
    <button type="button" className="items-history-toggle" onClick={() => setOpen(open === item.id ? null : item.id)}>{open === item.id ? "Hide history" : "History"}</button>
    {open === item.id && <ul className="items-history">{events(item.id).map((event: any, index: number) => <li key={index}><b>{EVENT_LABEL[event.event] || event.event}</b> · {niceDate(event.occurred_on)}{event.by ? ` · ${event.by}` : ""}{event.note ? <small>{event.note}</small> : null}<small>recorded {niceTime(event.created_at)}</small></li>)}</ul>}
  </div>;
  const done = () => { setDialog(null); void load(); };
  return <section className="record-card record-card-wide items-card">
    <header><div><h3>Company items</h3><p>Laptop, phone, SIM, lab coat and other company property given to {employeeName}. Every change is kept in the history.</p></div>{data.canWrite && data.working && <button onClick={() => setDialog({ kind: "give" })}>＋ Give an item</button>}</header>
    {data.canWrite && !data.working && <div className="form-hint">This person is no longer working, so new items cannot be given. Returns can still be recorded.</div>}
    <h4 className="items-h">With {employeeName} now ({now.length})</h4>
    {now.length ? now.map(row) : <div className="record-empty">Nothing is recorded as given to this person.</div>}
    {earlier.length > 0 && <><h4 className="items-h">Earlier ({earlier.length})</h4>{earlier.map(row)}</>}
    {dialog?.kind === "give" && <GiveDialog employeeId={employeeId} employeeName={employeeName} types={types} stock={data.stock} onTypesChanged={loadTypes} onClose={() => setDialog(null)} onSaved={() => { flash("Item recorded."); done(); }} />}
    {dialog?.kind === "status" && <StatusDialog item={dialog.item} action={dialog.action} onClose={() => setDialog(null)} onSaved={() => { flash("Saved."); done(); }} />}
    {dialog?.kind === "edit" && <EditDialog item={dialog.item} onClose={() => setDialog(null)} onSaved={() => { flash("Details corrected."); done(); }} />}
  </section>;
}

/* ---------- the company-wide page ---------- */

type Tab = "items" | "stock" | "types";

function StockDialog({ heads, defaultHeadId, types, preset, onClose, onSaved }: { heads: Head[]; defaultHeadId: string; types: ItemType[]; preset?: { businessHeadId: string; itemTypeId: string; entryType: "added" | "removed" }; onClose: () => void; onSaved: () => void }) {
  const [businessHeadId, setBusinessHeadId] = useState(preset?.businessHeadId || (defaultHeadId !== "all" ? defaultHeadId : ""));
  const [itemTypeId, setItemTypeId] = useState(preset?.itemTypeId || types.find(type => type.active)?.id || "");
  const [entryType, setEntryType] = useState<"added" | "removed">(preset?.entryType || "added");
  const [quantity, setQuantity] = useState("1"); const [entryOn, setEntryOn] = useState(todayIndia()); const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await send("/api/staff-items/stock", "POST", { businessHeadId, itemTypeId, entryType, quantity: Number(quantity), entryOn, note }); onSaved(); }
    catch (problem) { setError((problem as Error).message); setBusy(false); }
  }
  return <Dialog title={entryType === "added" ? "Add stock" : "Take stock out"} eyebrow="STOCK" onClose={onClose}>
    <form className="form-grid" onSubmit={submit}>
      <label className="span-two">What happened?<select value={entryType} onChange={event => setEntryType(event.target.value as "added" | "removed")}><option value="added">Stock bought or received</option><option value="removed">Stock taken out (sold, scrapped, given away)</option></select></label>
      <label>Company<select value={businessHeadId} onChange={event => setBusinessHeadId(event.target.value)} required><option value="">Choose…</option>{heads.map(head => <option key={head.id} value={head.id}>{head.name}</option>)}</select></label>
      <label>Item<select value={itemTypeId} onChange={event => setItemTypeId(event.target.value)} required>{types.filter(type => type.active || type.id === itemTypeId).map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
      <label>Quantity<input type="number" min={1} max={100000} step={1} value={quantity} onChange={event => setQuantity(event.target.value)} required /></label>
      <label>Date<input type="date" max={todayIndia()} value={entryOn} onChange={event => setEntryOn(event.target.value)} required /></label>
      <label className="span-two">{entryType === "removed" ? "Why? (required)" : "Note (supplier, bill number … optional)"}<input value={note} onChange={event => setNote(event.target.value)} maxLength={500} required={entryType === "removed"} /></label>
      {error && <div className="form-error span-two">{error}</div>}
      <div className="modal-actions span-two"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
    </form>
  </Dialog>;
}

export function CompanyItemsWorkspace({ businessHeadId, head, heads, people = [], canWrite, flash }: { businessHeadId: string; head: string; heads: Head[]; people?: any[]; canWrite: boolean; flash: (message: string) => void }) {
  const [tab, setTab] = useState<Tab>("items");
  const [types, setTypes] = useState<ItemType[]>([]);
  const [rows, setRows] = useState<any[] | null>(null);
  const [stock, setStock] = useState<{ rows: any[]; entries: any[] } | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("with_staff"); const [typeId, setTypeId] = useState(""); const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<null | { kind: "status"; item: any; action: string } | { kind: "edit"; item: any } | { kind: "stock"; preset?: any } | { kind: "give" }>(null);
  const [newType, setNewType] = useState(""); const [busy, setBusy] = useState(false);
  const company = businessHeadId && businessHeadId !== "all" ? businessHeadId : "";

  const loadTypes = useCallback(async () => { try { setTypes(await api("/api/staff-items/types")); } catch (problem) { setError((problem as Error).message); } }, []);
  const loadItems = useCallback(async () => {
    const query = new URLSearchParams(); if (company) query.set("businessHeadId", company); if (status !== "all") query.set("status", status); if (typeId) query.set("typeId", typeId); if (search.trim()) query.set("q", search.trim());
    try { setRows(await api(`/api/staff-items?${query}`)); setError(""); } catch (problem) { setError((problem as Error).message); setRows([]); }
  }, [company, status, typeId, search]);
  const loadStock = useCallback(async () => {
    try { setStock(await api(`/api/staff-items/stock${company ? `?businessHeadId=${company}` : ""}`)); setError(""); } catch (problem) { setError((problem as Error).message); setStock({ rows: [], entries: [] }); }
  }, [company]);
  useEffect(() => { void loadTypes(); }, [loadTypes]);
  useEffect(() => { const timer = setTimeout(() => { void loadItems(); }, search ? 250 : 0); return () => clearTimeout(timer); }, [loadItems, search]);
  useEffect(() => { void loadStock(); }, [loadStock]);
  const refreshAll = () => { setDialog(null); void loadItems(); void loadStock(); };

  async function addType(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    try { await send("/api/staff-items/types", "POST", { name: newType }); setNewType(""); await loadTypes(); flash("Item type added."); } catch (problem) { flash((problem as Error).message); }
    setBusy(false);
  }
  async function toggleType(type: ItemType) {
    try { await send(`/api/staff-items/types/${type.id}`, "PATCH", { active: !type.active }); await loadTypes(); } catch (problem) { flash((problem as Error).message); }
  }
  const shownHeads = company ? heads.filter(item => item.id === company) : heads;
  // One block per person: the name is shown once and their items are listed under it.
  const groups = useMemo(() => {
    const map = new Map<string, { id: string; name: string; code: string; company: string; left: boolean; items: any[] }>();
    for (const row of rows || []) {
      let group = map.get(row.employee_id);
      if (!group) { group = { id: row.employee_id, name: row.employee_name, code: row.employee_code, company: row.business_head, left: !["probation", "active", "notice_period"].includes(row.employee_status), items: [] }; map.set(row.employee_id, group); }
      group.items.push(row);
    }
    return [...map.values()];
  }, [rows]);
  const counts = useMemo(() => ({ people: new Set((rows || []).map(row => row.employee_id)).size, pieces: (rows || []).reduce((sum, row) => sum + Number(row.quantity || 0), 0) }), [rows]);

  return <>
    <div className="page-head"><div><span className="eyebrow">Joining &amp; leaving</span><h1>Company items</h1><p>{head} · Laptops, phones, SIM cards, lab coats and other company property: who has what, and what is in stock.</p></div></div>
    <nav className="items-tabs" aria-label="Company items sections">{([["items", "Items given to staff"], ["stock", "Stock"], ["types", "Item types"]] as [Tab, string][]).map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}</nav>
    {error && <p className="cleanup-error">{error}</p>}

    {tab === "items" && <section className="panel">
      <div className="panel-head padded"><div><h2>Items given to staff</h2><p>{rows ? `${rows.length} record${rows.length === 1 ? "" : "s"} · ${counts.people} people · ${counts.pieces} pieces` : "Loading…"}. Use <b>＋ Give an item</b> here (one person or many), or the Company items tab on a staff record.</p></div>
        <div className="items-head-buttons"><button className="secondary" disabled={!rows?.length} onClick={() => download("company-items.csv", itemsCsv(rows || []))}>Download for Excel</button>{canWrite && <button className="primary" onClick={() => setDialog({ kind: "give" })}>＋ Give an item</button>}</div></div>
      <div className="items-filters">
        <div className="items-chips">{([["with_staff", "With staff"], ["all", "All"], ["returned", "Returned"], ["damaged", "Damaged"], ["lost", "Lost"]] as [string, string][]).map(([key, label]) => <button key={key} className={status === key ? "active" : ""} onClick={() => setStatus(key)}>{label}</button>)}</div>
        <select value={typeId} onChange={event => setTypeId(event.target.value)} aria-label="Item"><option value="">All items</option>{types.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</select>
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name, code or details" aria-label="Search" />
      </div>
      <div className="items-groups">
        {groups.length > 0 && <div className="items-line items-head"><span>ITEM</span><span>DETAILS</span><span>GIVEN</span><span>STATUS</span><span></span></div>}
        {groups.map(group => <section className="items-group" key={group.id}>
          <header className="items-person"><b>{group.name}</b><small>{[group.code, group.company, group.left ? "Has left" : ""].filter(Boolean).join(" · ")}</small><em>{group.items.length} item{group.items.length === 1 ? "" : "s"}</em></header>
          {group.items.map(row => <div className="items-line" key={row.id}>
            <b>{row.type_name}{row.quantity > 1 ? ` × ${row.quantity}` : ""}</b>
            <span>{row.details || "—"}{row.note ? <small>{row.note}</small> : null}</span>
            <span>{niceDate(row.issued_on)}{row.status !== "with_staff" && row.status_on ? <small>{STATUS_LABEL[row.status as keyof typeof STATUS_LABEL]} {niceDate(row.status_on)}</small> : null}</span>
            <span className={statusClass(row.status)}>{STATUS_LABEL[row.status as keyof typeof STATUS_LABEL]}</span>
            {canWrite ? <div className="items-actions"><ItemButtons item={row} onAction={action => setDialog(action === "edit" ? { kind: "edit", item: row } : { kind: "status", item: row, action })} /></div> : <span></span>}
          </div>)}
        </section>)}
        {rows && !rows.length && <p className="cleanup-empty">Nothing found. Items are added from a staff record: open the person, then the Company items tab.</p>}
      </div>
    </section>}

    {tab === "stock" && <section className="panel">
      <div className="panel-head padded"><div><h2>Stock</h2><p>In stock = bought − taken out − with staff − lost − damaged. Items that come back are in stock again.</p></div>
        <div className="items-head-buttons"><button className="secondary" disabled={!stock?.rows.length} onClick={() => download("company-items-stock.csv", stockCsv((stock?.rows || []).map(row => ({ business_head: row.business_head, type_name: row.type_name, added: row.added, removed: row.removed, withStaff: row.with_staff, lost: row.lost, damaged: row.damaged }))))}>Download for Excel</button>{canWrite && <button className="primary" onClick={() => setDialog({ kind: "stock" })}>＋ Add stock</button>}</div></div>
      <div className="items-table items-stock">
        <div className="items-row items-head"><span>ITEM</span><span>BOUGHT</span><span>TAKEN OUT</span><span>WITH STAFF</span><span>LOST</span><span>DAMAGED</span><span>IN STOCK</span><span></span></div>
        {(stock?.rows || []).map(row => <div className="items-row" key={`${row.business_head_id}-${row.item_type_id}`}>
          <span><b>{row.type_name}</b>{!company && <small>{row.business_head}</small>}</span><span>{row.added}</span><span>{row.removed}</span><span>{row.with_staff}</span><span>{row.lost}</span><span>{row.damaged}</span>
          <span className={row.in_stock < 0 ? "items-negative" : ""} title={row.in_stock < 0 ? "Stock records are less than what has been given. Add the stock that was bought." : undefined}>{row.set_up ? <b>{row.in_stock}</b> : <small title="No stock has been entered for this item yet. Use Add stock.">Not set up</small>}</span>
          <span className="items-actions">{canWrite && <><button className="items-btn" onClick={() => setDialog({ kind: "stock", preset: { businessHeadId: row.business_head_id, itemTypeId: row.item_type_id, entryType: "added" } })}>＋ Add</button><button className="items-btn" onClick={() => setDialog({ kind: "stock", preset: { businessHeadId: row.business_head_id, itemTypeId: row.item_type_id, entryType: "removed" } })}>Take out</button></>}</span>
        </div>)}
        {stock && !stock.rows.length && <p className="cleanup-empty">No stock recorded yet. Use “Add stock” to enter what the company has bought or holds.</p>}
      </div>
      {stock && stock.entries.length > 0 && <><h3 className="items-h padded">Stock history</h3><ul className="items-history items-stock-history">{stock.entries.slice(0, 30).map(entry => <li key={entry.id}><b>{entry.entry_type === "added" ? "+" : "−"}{entry.quantity} {entry.type_name}</b> · {entry.business_head} · {niceDate(entry.entry_on)}{entry.by ? ` · ${entry.by}` : ""}{entry.note ? <small>{entry.note}</small> : null}</li>)}</ul></>}
    </section>}

    {tab === "types" && <section className="panel">
      <div className="panel-head padded"><div><h2>Item types</h2><p>The kinds of items that can be given. Hide a type you no longer use; items already given keep it.</p></div></div>
      <div className="items-table">{types.map(type => <div className="items-row items-type" key={type.id}><b className={type.active ? "" : "items-hidden"}>{type.name}</b><span>{type.active ? "Shown" : "Hidden"}</span>{canWrite && <button className="items-btn" onClick={() => toggleType(type)}>{type.active ? "Hide" : "Show again"}</button>}</div>)}</div>
      {canWrite && <form className="items-addtype padded" onSubmit={addType}><input value={newType} onChange={event => setNewType(event.target.value)} placeholder="New kind of item, for example Tablet" maxLength={60} aria-label="New item type" /><button className="primary" disabled={busy || newType.trim().length < 2}>＋ Add to the list</button></form>}
    </section>}

    {dialog?.kind === "give" && <GiveManyDialog people={people} types={types} defaultCompany={company} onTypesChanged={loadTypes} onClose={() => setDialog(null)} onSaved={count => { flash(count === 1 ? "Item recorded." : `Item given to ${count} people.`); refreshAll(); }} />}
    {dialog?.kind === "status" && <StatusDialog item={dialog.item} action={dialog.action} onClose={() => setDialog(null)} onSaved={() => { flash("Saved."); refreshAll(); }} />}
    {dialog?.kind === "edit" && <EditDialog item={dialog.item} onClose={() => setDialog(null)} onSaved={() => { flash("Details corrected."); refreshAll(); }} />}
    {dialog?.kind === "stock" && <StockDialog heads={shownHeads.length ? shownHeads : heads} defaultHeadId={company || "all"} types={types} preset={dialog.preset} onClose={() => setDialog(null)} onSaved={() => { flash("Stock saved."); refreshAll(); }} />}
  </>;
}

