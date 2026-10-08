"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Gift = {
  id: string; year: number; status: string; recipientType: "staff" | "other"; employeeId: string | null; recipientName: string; company: string;
  giftItem: string; quantity: number; unitValue: number; totalValue: number; vendor: string; billNo: string; givenBy: string; givenOn: string | null; notes: string;
};
type StaffOption = { id: string; first_name: string; last_name: string | null; employee_code: string; business_head: string };

const STATUSES: [string, string][] = [["planned", "Planned"], ["bought", "Bought"], ["handed_over", "Handed over"]];
const statusLabel = (value: string) => STATUSES.find(([key]) => key === value)?.[1] || value;
const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);

async function bodyData(response: Response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message || "The gift register could not be updated.");
  return body?.data;
}

export function DiwaliGiftsWorkspace({ flash }: { flash: (message: string) => void }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [years, setYears] = useState<number[]>([]);
  const [gifts, setGifts] = useState<Gift[] | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editing, setEditing] = useState<Gift | "new" | null>(null);
  const [refresh, setRefresh] = useState(0);

  const load = useCallback(() => {
    let current = true;
    fetch(`/api/diwali-gifts?year=${year}`).then(bodyData).then(data => {
      if (!current) return;
      setGifts(data.gifts); setYears(data.years); setError("");
    }).catch(problem => { if (current) { setGifts([]); setError((problem as Error).message); } });
    return () => { current = false; };
  }, [year]);
  useEffect(() => load(), [load, refresh]);

  const yearOptions = useMemo(() => [...new Set([...years, thisYear, thisYear + 1, year])].sort((a, b) => b - a), [years, thisYear, year]);
  const all = gifts || [];
  const visible = all.filter(gift => (statusFilter === "all" || gift.status === statusFilter) && (!search.trim() || `${gift.recipientName} ${gift.company} ${gift.giftItem} ${gift.vendor} ${gift.billNo}`.toLowerCase().includes(search.trim().toLowerCase())));
  const spend = all.reduce((sum, gift) => sum + gift.totalValue, 0);
  const pieces = all.reduce((sum, gift) => sum + gift.quantity, 0);
  const handedOver = all.filter(gift => gift.status === "handed_over").length;

  async function changeStatus(gift: Gift, status: string) {
    const before = gifts;
    setGifts(current => (current || []).map(item => item.id === gift.id ? { ...item, status } : item));
    try { await bodyData(await fetch(`/api/diwali-gifts/${gift.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) })); }
    catch (problem) { setGifts(before); flash((problem as Error).message); }
  }

  async function remove(gift: Gift) {
    if (!window.confirm(`Remove the gift for ${gift.recipientName}? It is hidden from the list but kept in the database.`)) return;
    try { await bodyData(await fetch(`/api/diwali-gifts/${gift.id}`, { method: "DELETE" })); setRefresh(value => value + 1); flash("Gift removed."); }
    catch (problem) { flash((problem as Error).message); }
  }

  function download() {
    const cell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const header = ["Recipient", "Company", "Gift", "Quantity", "Value each (INR)", "Total (INR)", "Status", "Bought from", "Bill no.", "Given on", "Given by", "Notes"];
    const lines = [header, ...visible.map(gift => [gift.recipientName, gift.company, gift.giftItem, gift.quantity, gift.unitValue, gift.totalValue, statusLabel(gift.status), gift.vendor, gift.billNo, gift.givenOn || "", gift.givenBy, gift.notes])].map(line => line.map(cell).join(","));
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    link.download = `diwali-gifts-${year}.csv`; link.click(); URL.revokeObjectURL(link.href);
  }

  return <>
    <div className="page-head"><div><span className="eyebrow">Confidential · Super Admin only</span><h1>Diwali gifts</h1><p>Who gets what, what it costs and whether it has been handed over. Nobody else can see this page.</p></div><button className="primary" onClick={() => setEditing("new")}>＋ Add gift</button></div>
    <div className="metrics compact">
      <div className="metric"><div className="metric-icon purple">◎</div><span>GIFTS</span><strong>{all.length}</strong><small>{pieces} pieces in {year}</small></div>
      <div className="metric"><div className="metric-icon green">₹</div><span>TOTAL SPEND</span><strong>{money(spend)}</strong><small>All gifts for {year}</small></div>
      <div className="metric"><div className="metric-icon blue">✓</div><span>HANDED OVER</span><strong>{handedOver}</strong><small>of {all.length} gifts</small></div>
      <div className="metric"><div className="metric-icon orange">!</div><span>STILL TO HAND OVER</span><strong>{all.length - handedOver}</strong><small>Planned or bought</small></div>
    </div>
    <section className="panel table-panel">
      <div className="table-tools gift-tools"><div className="gift-filters"><select value={year} onChange={event => setYear(Number(event.target.value))} aria-label="Year">{yearOptions.map(value => <option key={value} value={value}>Diwali {value}</option>)}</select><input type="search" placeholder="Find a name, gift or bill" value={search} onChange={event => setSearch(event.target.value)} aria-label="Find a gift" /><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} aria-label="Status"><option value="all">All statuses</option>{STATUSES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div><button className="secondary" disabled={!visible.length} onClick={download}>⇩ Download this list</button></div>
      <div className="data-table gift-table"><div className="tr th"><span>RECIPIENT</span><span>GIFT</span><span>VALUE</span><span>STATUS</span><span>GIVEN</span><span></span></div>
        {visible.map(gift => <div className="tr" key={gift.id}>
          <span><b>{gift.recipientName}<small>{gift.company || (gift.recipientType === "other" ? "Outside Velite" : "")}</small></b></span>
          <span><b>{gift.giftItem}<small>{gift.quantity} × {money(gift.unitValue)}{gift.vendor ? ` · ${gift.vendor}` : ""}{gift.billNo ? ` · Bill ${gift.billNo}` : ""}</small></b></span>
          <span><b>{money(gift.totalValue)}</b></span>
          <span><select className={`gift-status ${gift.status}`} value={gift.status} onChange={event => changeStatus(gift, event.target.value)} aria-label={`Status for ${gift.recipientName}`}>{STATUSES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></span>
          <span>{gift.givenOn ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${gift.givenOn}T00:00:00`)) : "—"}{gift.givenBy && <small>by {gift.givenBy}</small>}</span>
          <span className="gift-actions"><button className="link" onClick={() => setEditing(gift)}>Edit</button><button className="link danger" onClick={() => remove(gift)}>Remove</button></span>
        </div>)}
        {gifts === null ? <div className="empty-state padded">Loading…</div> : error ? <div className="empty-state padded">{error}</div> : !visible.length && <div className="empty-state padded">{all.length ? "No gifts match this search." : `No gifts recorded for Diwali ${year} yet. Click “Add gift” to start.`}</div>}
      </div>
      <div className="table-foot"><span>{visible.length} of {all.length} gifts shown · Amounts and names are stored encrypted</span></div>
    </section>
    {editing && <GiftForm gift={editing === "new" ? null : editing} year={year} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setRefresh(value => value + 1); flash("Gift saved."); }} />}
  </>;
}

function GiftForm({ gift, year, onClose, onSaved }: { gift: Gift | null; year: number; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<"staff" | "other">(gift?.recipientType || "staff");
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [quantity, setQuantity] = useState(String(gift?.quantity ?? 1));
  const [unitValue, setUnitValue] = useState(String(gift?.unitValue ?? ""));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch("/api/employees").then(response => response.ok ? response.json() : { data: [] }).then(body => setStaff(body.data || [])).catch(() => setStaff([])); }, []);
  const total = (Number(quantity) || 0) * (Number(unitValue) || 0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) || "").trim();
    const payload = {
      recipientType: type, employeeId: type === "staff" ? text("employeeId") || null : null, recipientName: text("recipientName"), company: text("company"),
      giftItem: text("giftItem"), quantity: Number(quantity), unitValue: Number(unitValue || 0), vendor: text("vendor"), billNo: text("billNo"),
      givenBy: text("givenBy"), givenOn: text("givenOn") || null, notes: text("notes"), status: text("status") || "planned",
    };
    try {
      await bodyData(await fetch(gift ? `/api/diwali-gifts/${gift.id}` : "/api/diwali-gifts", { method: gift ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(gift ? payload : { ...payload, year }) }));
      onSaved();
    } catch (problem) { setError((problem as Error).message); setBusy(false); }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="gift-form-title">
      <div className="modal-head"><div><span className="eyebrow">Diwali {year}</span><h2 id="gift-form-title">{gift ? "Edit gift" : "Add a gift"}</h2></div><button onClick={onClose} aria-label="Close">×</button></div>
      <form onSubmit={submit} className="form-grid">
        <div className="span-two gift-type"><label><input type="radio" checked={type === "staff"} onChange={() => setType("staff")} /> Velite staff member</label><label><input type="radio" checked={type === "other"} onChange={() => setType("other")} /> Someone else (client, vendor, other)</label></div>
        {type === "staff"
          ? <label className="span-two">Staff member<select name="employeeId" required defaultValue={gift?.employeeId || ""}><option value="" disabled>Choose a person…</option>{staff.map(person => <option key={person.id} value={person.id}>{[person.first_name, person.last_name].filter(Boolean).join(" ")} · {person.employee_code} · {person.business_head}</option>)}</select></label>
          : <><label>Name<input name="recipientName" required defaultValue={gift?.recipientType === "other" ? gift.recipientName : ""} /></label><label>Company or relation<input name="company" defaultValue={gift?.recipientType === "other" ? gift.company : ""} placeholder="For example Supplier, Client" /></label></>}
        <label className="span-two">Gift<input name="giftItem" required defaultValue={gift?.giftItem || ""} placeholder="For example Dry fruit box, Sweets hamper" /></label>
        <label>Quantity<input type="number" min="1" step="1" required value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
        <label>Value of one gift (₹)<input type="number" min="0" step="0.01" required value={unitValue} onChange={event => setUnitValue(event.target.value)} /></label>
        <div className="span-two gift-total">Total: <b>{money(total)}</b></div>
        <label>Status<select name="status" defaultValue={gift?.status || "planned"}>{STATUSES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Date given<input type="date" name="givenOn" defaultValue={gift?.givenOn || ""} /></label>
        <label>Bought from<input name="vendor" defaultValue={gift?.vendor || ""} /></label>
        <label>Bill number<input name="billNo" defaultValue={gift?.billNo || ""} /></label>
        <label className="span-two">Handed over by<input name="givenBy" defaultValue={gift?.givenBy || ""} /></label>
        <label className="span-two">Notes<input name="notes" defaultValue={gift?.notes || ""} /></label>
        {error && <p className="form-error span-two" role="alert">{error}</p>}
        <div className="modal-actions span-two"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? "Saving…" : "Save gift"}</button></div>
      </form>
    </section>
  </div>;
}
