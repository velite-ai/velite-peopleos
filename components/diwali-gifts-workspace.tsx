"use client";

import { DiwaliCompare } from "@/components/diwali-compare";
import { DiwaliItems } from "@/components/diwali-items";
import { DiwaliMaster, MasterGift } from "@/components/diwali-master";
import { CASH_KEY, NO_FIRM, NO_GIFT_KEY, filterGifts, firmLabel, groupLabel, itemOptions, statusSummary, totalsOf } from "@/lib/diwali-analysis-rules";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Gift = {
  id: string; year: number; status: string; recipientType: "staff" | "other"; employeeId: string | null; recipientName: string; company: string;
  items: { item: string; quantity: number; unitValue: number }[]; giftValue: number; cashAmount: number; cashMode: string; cashPaidOn: string | null;
  group?: string | null; firm?: string | null; giftItem: string; totalValue: number; vendor: string; billNo: string; givenBy: string; givenOn: string | null; notes: string; employeeStatus?: string | null;
};
const hasLeft = (gift: Gift) => gift.employeeStatus === "separated" || gift.employeeStatus === "archived";
type StaffOption = { id: string; first_name: string; last_name: string | null; employee_code: string; business_head: string };

const STATUSES: [string, string][] = [["planned", "Planned"], ["bought", "Bought"], ["handed_over", "Handed over"]];
const CASH_MODES: [string, string][] = [["", "Not stated"], ["cash", "Cash in hand"], ["upi", "UPI"], ["bank", "Bank transfer"]];
const cashModeLabel = (value: string) => CASH_MODES.find(([key]) => key === value)?.[1] || "";
const statusLabel = (value: string) => STATUSES.find(([key]) => key === value)?.[1] || value;
const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);

// Velite's companies in the order the team uses them; anything else follows alphabetically.
const COMPANY_ORDER = ["healthcare", "india", "pharmaceuticals", "sciences", "others 1", "others 2"];
// Besides Velite's own companies, a gift can be given by (or counted under) these two kinds of outside party.
// Lists are shown A to Z by name, whichever company is chosen.
const byName = (a: { recipientName: string }, b: { recipientName: string }) => a.recipientName.localeCompare(b.recipientName, "en", { sensitivity: "base", numeric: true });
const PARTY_TYPES = ["Franchisee Party", "Third-Party Client"];
const orderCompanies = (names: string[]) => [...names].sort((a, b) => { const rank = (name: string) => { const at = COMPANY_ORDER.findIndex(key => name.toLowerCase().includes(key)); return at < 0 ? 99 : at; }; return rank(a) - rank(b) || a.localeCompare(b); });

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
  const [view, setView] = useState<"list" | "items" | "master" | "compare">("list");
  const [itemFilter, setItemFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [companyNames, setCompanyNames] = useState<string[]>([]);
  useEffect(() => { fetch("/api/business-heads").then(response => response.ok ? response.json() : { data: [] }).then(body => setCompanyNames([...orderCompanies((body.data || []).map((row: { name: string }) => row.name)), ...PARTY_TYPES])).catch(() => setCompanyNames(PARTY_TYPES)); }, []);
  const [selected, setSelected] = useState<string[]>([]);
  const [tool, setTool] = useState<"import" | "plan" | null>(null);

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
  const everyone = gifts || [];
  const companyOptions = useMemo(() => { const present = new Set(everyone.map(firmLabel)); return [...companyNames, ...[...present].filter(name => !companyNames.includes(name) && name !== NO_FIRM), ...(present.has(NO_FIRM) ? [NO_FIRM] : [])]; }, [everyone, companyNames]);
  const all = useMemo(() => filterGifts(everyone, { status: "all", item: "all", group: "all", search: "", firm: companyFilter }) as Gift[], [everyone, companyFilter]);
  const visible = (filterGifts(all, { status: statusFilter, item: itemFilter, group: groupFilter, search }) as Gift[]).sort(byName);
  const itemChoices = useMemo(() => itemOptions(all), [all]);
  const groupChoices = useMemo(() => [...new Set(all.map(groupLabel))].sort(), [all]);
  const byStatus = useMemo(() => statusSummary(all), [all]);
  const shown = totalsOf(visible);
  const filterText = [companyFilter !== "all" ? `Company: ${companyFilter}` : "", statusFilter !== "all" ? `Status: ${statusLabel(statusFilter)}` : "", itemFilter !== "all" ? `Gift: ${itemFilter === CASH_KEY ? "Cash" : itemFilter === NO_GIFT_KEY ? "No gift items" : itemChoices.find(choice => choice.key === itemFilter)?.label || itemFilter}` : "", groupFilter !== "all" ? `Group: ${groupFilter}` : "", search.trim() ? `Search: ${search.trim()}` : ""].filter(Boolean).join(" · ") || "All gifts";
  const spend = all.reduce((sum, gift) => sum + gift.totalValue, 0);
  const giftsValue = all.reduce((sum, gift) => sum + gift.giftValue, 0);
  const cashValue = all.reduce((sum, gift) => sum + gift.cashAmount, 0);
  const handedOver = all.filter(gift => gift.status === "handed_over").length;

  useEffect(() => { setSelected([]); }, [year, statusFilter, itemFilter, groupFilter, companyFilter, search]);
  const selectedVisible = visible.filter(gift => selected.includes(gift.id));
  async function markSelected(status: string) {
    if (!selectedVisible.length) return;
    if (!window.confirm(`Mark ${selectedVisible.length} ${selectedVisible.length === 1 ? "person" : "people"} as ${statusLabel(status)}?`)) return;
    const results = await Promise.allSettled(selectedVisible.map(gift => fetch(`/api/diwali-gifts/${gift.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) }).then(response => response.ok ? true : Promise.reject())));
    const failed = results.filter(result => result.status === "rejected").length;
    setSelected([]); setRefresh(value => value + 1);
    flash(failed ? `${results.length - failed} updated, ${failed} could not be changed.` : `${results.length} marked ${statusLabel(status)}.`);
  }

  async function setCompanyOfSelected(firm: string) {
    if (!selectedVisible.length || !firm) return;
    if (!window.confirm(`Set the company to ${firm} for ${selectedVisible.length} ${selectedVisible.length === 1 ? "person" : "people"}?`)) return;
    const results = await Promise.allSettled(selectedVisible.map(gift => fetch(`/api/diwali-gifts/${gift.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ firm }) }).then(response => response.ok ? true : Promise.reject())));
    const failed = results.filter(result => result.status === "rejected").length;
    setSelected([]); setRefresh(value => value + 1);
    flash(failed ? `${results.length - failed} updated, ${failed} could not be changed.` : `Company set to ${firm} for ${results.length}.`);
  }

  async function pdf() {
    try {
      const [{ buildTablePdf }, { listBlocks }] = await Promise.all([import("@/lib/table-pdf"), import("@/lib/diwali-report")]);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([buildTablePdf(listBlocks(year, visible, filterText), `Diwali gifts ${year}`) as BlobPart], { type: "application/pdf" }));
      link.download = `diwali-gifts-${year}.pdf`; link.click(); URL.revokeObjectURL(link.href);
    } catch { flash("The PDF could not be made."); }
  }

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
    const header = ["Recipient", "Company", "Gift items", "Gifts value (INR)", "Cash (INR)", "Cash paid by", "Cash paid on", "Total (INR)", "Status", "Bought from", "Bill no.", "Given on", "Given by", "Notes"];
    const lines = [header, ...visible.map(gift => [gift.recipientName, gift.company, gift.items.map(line => `${line.quantity} × ${line.item} @ ${line.unitValue}`).join("; "), gift.giftValue, gift.cashAmount, cashModeLabel(gift.cashMode), gift.cashPaidOn || "", gift.totalValue, statusLabel(gift.status), gift.vendor, gift.billNo, gift.givenOn || "", gift.givenBy, gift.notes])].map(line => line.map(cell).join(","));
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    link.download = `diwali-gifts-${year}.csv`; link.click(); URL.revokeObjectURL(link.href);
  }

  return <>
    <div className="page-head gift-noprint"><div><span className="eyebrow">Confidential · Super Admin only</span><h1>Diwali gifts</h1><p>Who gets what, what it costs and whether it has been handed over. Nobody else can see this page.</p></div><div className="gift-filters"><button className="secondary" onClick={() => setTool("import")}>Load an earlier year</button><button className="secondary" onClick={() => setTool("plan")}>Plan {year + 1} from {year}</button><button className="primary" onClick={() => setEditing("new")}>＋ Add gift</button></div></div>
    <div className="gift-tabs gift-noprint" role="tablist">{([["list", "List"], ["items", "By gift & analysis"], ["master", "Gift master"], ["compare", "Compare years"]] as const).map(([key, label]) => <button key={key} role="tab" aria-selected={view === key} className={view === key ? "active" : ""} onClick={() => setView(key)}>{label}</button>)}{view !== "compare" && view !== "master" && <select className="gift-year gift-company" value={companyFilter} onChange={event => setCompanyFilter(event.target.value)} aria-label="Company"><option value="all">All companies</option>{companyOptions.map(name => <option key={name} value={name}>{name}</option>)}</select>}{view !== "compare" && <select className="gift-year" value={year} onChange={event => setYear(Number(event.target.value))} aria-label="Year">{yearOptions.map(value => <option key={value} value={value}>Diwali {value}</option>)}</select>}</div>
    {view === "compare" ? <DiwaliCompare /> : view === "master" ? <DiwaliMaster year={year} gifts={all} flash={flash} onChanged={() => setRefresh(value => value + 1)} /> : view === "items" ? <DiwaliItems year={year} gifts={all} companyName={companyFilter === "all" ? "" : companyFilter} companyOrder={companyNames} flash={flash} /> : <>
    <div className="gift-print-title"><h1>Diwali gifts {year}</h1><p>{filterText} · Confidential</p></div>
    <div className="metrics compact">
      <div className="metric"><div className="metric-icon purple">◎</div><span>PEOPLE</span><strong>{all.length}</strong><small>{handedOver} handed over · {all.length - handedOver} still to go</small></div>
      <div className="metric"><div className="metric-icon green">₹</div><span>TOTAL VALUE</span><strong>{money(spend)}</strong><small>Gifts + cash for {year}</small></div>
      <div className="metric"><div className="metric-icon blue">🎁</div><span>GIFTS</span><strong>{money(giftsValue)}</strong><small>Value of gift items</small></div>
      <div className="metric"><div className="metric-icon orange">₹</div><span>CASH</span><strong>{money(cashValue)}</strong><small>{all.filter(gift => gift.cashAmount > 0).length} people get cash</small></div>
    </div>
    <section className="panel table-panel">
      <div className="gift-noprint gift-chips" role="group" aria-label="Show gifts that are">
        {([["all", "All", all.length], ["planned", "Planned", byStatus.planned.people], ["bought", "Bought", byStatus.bought.people], ["handed_over", "Handed over", byStatus.handed_over.people]] as [string, string, number][]).map(([key, label, count]) => <button key={key} className={`chip-${key} ${statusFilter === key ? "active" : ""}`} onClick={() => setStatusFilter(key)}>{label} <b>{count}</b></button>)}
      </div>
      <div className="table-tools gift-tools gift-noprint"><div className="gift-filters">
        <input type="search" placeholder="Find a name or gift" value={search} onChange={event => setSearch(event.target.value)} aria-label="Find a gift" />
        <select value={itemFilter} onChange={event => setItemFilter(event.target.value)} aria-label="Gift"><option value="all">All gifts</option>{itemChoices.map(choice => <option key={choice.key} value={choice.key}>{choice.key === CASH_KEY ? "Cash only / with cash" : choice.label}</option>)}<option value={NO_GIFT_KEY}>No gift items (cash only)</option></select>
        {groupChoices.length > 1 && <select value={groupFilter} onChange={event => setGroupFilter(event.target.value)} aria-label="Group"><option value="all">All groups</option>{groupChoices.map(name => <option key={name} value={name}>{name}</option>)}</select>}
      </div><div className="gift-filters"><button className="secondary" disabled={!visible.length} onClick={() => window.print()}>🖨 Print</button><button className="secondary" disabled={!visible.length} onClick={pdf}>⇩ PDF</button><button className="secondary" disabled={!visible.length} onClick={download}>⇩ Excel</button></div></div>
      {selectedVisible.length > 0 && <div className="gift-noprint gift-bulk"><b>{selectedVisible.length} selected</b><button className="primary" onClick={() => markSelected("handed_over")}>✓ Mark as Handed over</button><button className="secondary" onClick={() => markSelected("bought")}>Mark as Bought</button><button className="secondary" onClick={() => markSelected("planned")}>Mark as Planned</button><select aria-label="Set company" value="" onChange={event => setCompanyOfSelected(event.target.value)}><option value="">Set company…</option>{companyNames.map(name => <option key={name} value={name}>{name}</option>)}</select><button className="link" onClick={() => setSelected([])}>Clear</button></div>}
      <div className="data-table gift-table"><div className="tr th"><span className="gift-noprint"><input type="checkbox" aria-label="Select all shown" checked={visible.length > 0 && selectedVisible.length === visible.length} onChange={event => setSelected(event.target.checked ? visible.map(gift => gift.id) : [])} /></span><span>RECIPIENT</span><span>GIFT ITEMS</span><span>GIFTS VALUE</span><span>CASH</span><span>TOTAL</span><span>STATUS</span><span className="gift-noprint"></span></div>
        {visible.map(gift => <div className={`tr ${selected.includes(gift.id) ? "picked" : ""}`} key={gift.id}>
          <span className="gift-noprint"><input type="checkbox" aria-label={`Select ${gift.recipientName}`} checked={selected.includes(gift.id)} onChange={event => setSelected(current => event.target.checked ? [...current, gift.id] : current.filter(id => id !== gift.id))} /></span>
          <span><b>{gift.recipientName}{hasLeft(gift) && <em className="gift-left"> · Has left</em>}<small><span className={`gift-firm ${firmLabel(gift) === NO_FIRM ? "unset" : ""}`}>{firmLabel(gift)}</span>{gift.recipientType === "other" && gift.company ? ` · ${gift.company}` : ""}{gift.notes ? ` · ${gift.notes}` : ""}</small></b></span>
          <span><b>{gift.items.length ? gift.items.map(line => `${line.quantity > 1 ? `${line.quantity} × ` : ""}${line.item}`).join(", ") : "Cash only"}<small>{gift.items.filter(line => line.unitValue > 0).map(line => `${line.item} ${line.quantity} × ${money(line.unitValue)}`).join(" · ")}{gift.vendor ? ` · ${gift.vendor}` : ""}{gift.billNo ? ` · Bill ${gift.billNo}` : ""}</small></b></span>
          <span>{gift.giftValue > 0 ? money(gift.giftValue) : "—"}</span>
          <span>{gift.cashAmount > 0 ? <>{money(gift.cashAmount)}{gift.cashMode && <small>{cashModeLabel(gift.cashMode)}</small>}</> : "—"}</span>
          <span><b>{money(gift.totalValue)}</b></span>
          <span><select className={`gift-status ${gift.status}`} value={gift.status} onChange={event => changeStatus(gift, event.target.value)} aria-label={`Status for ${gift.recipientName}`}>{STATUSES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><em className="gift-status-print">{statusLabel(gift.status)}</em>{gift.givenOn && <small>{new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${gift.givenOn}T00:00:00`))}{gift.givenBy ? ` · ${gift.givenBy}` : ""}</small>}</span>
          <span className="gift-actions gift-noprint"><button className="link" onClick={() => setEditing(gift)}>Edit</button><button className="link danger" onClick={() => remove(gift)}>Remove</button></span>
        </div>)}
        {visible.length > 0 && <div className="tr gift-total-row"><span className="gift-noprint"></span><span><b>Total · {visible.length} {visible.length === 1 ? "person" : "people"}</b></span><span></span><span><b>{money(shown.giftValue)}</b></span><span><b>{money(shown.cash)}</b></span><span><b>{money(shown.total)}</b></span><span></span><span className="gift-noprint"></span></div>}
        {gifts === null ? <div className="empty-state padded">Loading…</div> : error ? <div className="empty-state padded">{error}</div> : !visible.length && <div className="empty-state padded">{all.length ? "No gifts match these choices." : `No gifts recorded for Diwali ${year} yet. Click “Add gift” to start.`}</div>}
      </div>
      <div className="table-foot gift-noprint"><span>{visible.length} of {all.length} shown · {filterText} · Amounts and names are stored encrypted</span></div>
    </section>
    </>}
    {tool === "import" && <ImportDialog onClose={() => setTool(null)} onDone={(message, y) => { setTool(null); if (y) setYear(y); setRefresh(value => value + 1); flash(message); }} />}
    {tool === "plan" && <PlanDialog year={year} onClose={() => setTool(null)} onDone={message => { setTool(null); setYear(year + 1); setRefresh(value => value + 1); flash(message); }} />}
    {editing && <GiftForm gift={editing === "new" ? null : editing} year={year} companies={companyNames} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setRefresh(value => value + 1); flash("Gift saved."); }} />}
  </>;
}

function GiftForm({ gift, year, companies, onClose, onSaved }: { gift: Gift | null; year: number; companies: string[]; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<"staff" | "other">(gift?.recipientType || "staff");
  const [staff, setStaff] = useState<StaffOption[]>([]);
  type Line = { item: string; quantity: string; unitValue: string; other?: boolean };
  const [master, setMaster] = useState<MasterGift[]>([]);
  useEffect(() => { fetch("/api/diwali-gifts/master").then(response => response.ok ? response.json() : { data: [] }).then(body => setMaster(body.data || [])).catch(() => setMaster([])); }, []);
  const masterByName = (name: string) => master.find(entry => entry.name.trim().toLowerCase() === name.replace(/\s+/g, " ").trim().toLowerCase());
  function chooseGift(index: number, value: string) {
    if (value === "") setLine(index, { item: "", unitValue: "", other: false });
    else if (value === "__other") setLine(index, { other: true, item: masterByName(lines[index].item) ? "" : lines[index].item });
    else { const entry = master.find(candidate => candidate.id === value); if (entry) setLine(index, { item: entry.name, unitValue: entry.unitValue > 0 ? String(entry.unitValue) : lines[index].unitValue, other: false }); }
  }
  const [lines, setLines] = useState<Line[]>(gift?.items.length ? gift.items.map(line => ({ item: line.item, quantity: String(line.quantity), unitValue: String(line.unitValue || "") })) : gift ? [] : [{ item: "", quantity: "1", unitValue: "" }]);
  const [cash, setCash] = useState(gift?.cashAmount ? String(gift.cashAmount) : "");
  const setLine = (index: number, change: Partial<Line>) => setLines(current => current.map((line, at) => at === index ? { ...line, ...change } : line));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch("/api/employees").then(response => response.ok ? response.json() : { data: [] }).then(body => setStaff(body.data || [])).catch(() => setStaff([])); }, []);
  const giftTotal = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitValue) || 0), 0);
  const total = giftTotal + (Number(cash) || 0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) || "").trim();
    const payload = {
      recipientType: type, employeeId: type === "staff" ? text("employeeId") || null : null, recipientName: text("recipientName"), company: text("company"), firm: type === "other" ? text("firm") : undefined,
      items: lines.filter(line => line.item.trim()).map(line => ({ item: line.item.trim(), quantity: Math.max(1, Math.round(Number(line.quantity) || 1)), unitValue: Number(line.unitValue) || 0 })),
      cashAmount: Number(cash) || 0, cashMode: text("cashMode"), cashPaidOn: text("cashPaidOn") || null, vendor: text("vendor"), billNo: text("billNo"),
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
          ? <label className="span-two">Staff member (the gift is counted under their company)<select name="employeeId" required defaultValue={gift?.employeeId || ""}><option value="" disabled>Choose a person…</option>{staff.map(person => <option key={person.id} value={person.id}>{[person.first_name, person.last_name].filter(Boolean).join(" ")} · {person.employee_code} · {person.business_head}</option>)}</select></label>
          : <><label>Name<input name="recipientName" required defaultValue={gift?.recipientType === "other" ? gift.recipientName : ""} /></label><label>Company or relation<input name="company" defaultValue={gift?.recipientType === "other" ? gift.company : ""} placeholder="For example Supplier, Client" /></label><label className="span-two">Velite company giving this gift, or the kind of party<select name="firm" defaultValue={gift?.firm || ""}><option value="">Not set yet</option><optgroup label="Velite companies">{companies.filter(name => !PARTY_TYPES.includes(name)).map(name => <option key={name} value={name}>{name}</option>)}</optgroup><optgroup label="Outside parties">{PARTY_TYPES.map(name => <option key={name} value={name}>{name}</option>)}</optgroup></select></label></>}
        <div className="span-two gift-lines"><b>Gift items</b><small> Choose each gift from the Gift master: its price comes in by itself and the value is worked out from how many. You can still change a price for one person.</small>
          {lines.map((line, index) => <div className="gift-line" key={index}>
            <span className="gift-pick">
              <select aria-label="Gift" value={line.other || (line.item && !masterByName(line.item)) ? "__other" : masterByName(line.item)?.id || ""} onChange={event => chooseGift(index, event.target.value)}>
                <option value="">Choose a gift…</option>{master.map(entry => <option key={entry.id} value={entry.id}>{entry.name}{entry.unitValue > 0 ? ` · ${money(entry.unitValue)}` : ""}</option>)}<option value="__other">Other (type the name)</option>
              </select>
              {(line.other || (line.item && !masterByName(line.item))) && <input aria-label="Gift name" placeholder="Type the gift name" value={line.item} onChange={event => setLine(index, { item: event.target.value })} />}
            </span>
            <input aria-label="Quantity" type="number" min="1" step="1" value={line.quantity} onChange={event => setLine(index, { quantity: event.target.value })} />
            <input aria-label="Value of one (₹)" type="number" min="0" step="0.01" placeholder="₹ each" value={line.unitValue} onChange={event => setLine(index, { unitValue: event.target.value })} />
            <span className="gift-line-total">{money((Number(line.quantity) || 0) * (Number(line.unitValue) || 0))}</span>
            <button type="button" className="link danger" onClick={() => setLines(current => current.filter((_, at) => at !== index))} aria-label="Remove this gift">Remove</button>
          </div>)}
          <button type="button" className="secondary" onClick={() => setLines(current => [...current, { item: "", quantity: "1", unitValue: "" }])}>＋ Add another gift</button>
        </div>
        <div className="span-two gift-total">Gifts: <b>{money(giftTotal)}</b></div>
        <label>Cash given (₹)<input type="number" min="0" step="0.01" placeholder="Leave empty if no cash" value={cash} onChange={event => setCash(event.target.value)} /></label>
        <label>Cash paid by<select name="cashMode" defaultValue={gift?.cashMode || ""}>{CASH_MODES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Cash paid on<input type="date" name="cashPaidOn" defaultValue={gift?.cashPaidOn || ""} /></label>
        <div className="span-two gift-total">Total value (gifts + cash): <b>{money(total)}</b></div>
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

type ImportResult = { skipped: string[]; handed: number; planned: number; rows: number; toAdd: number; alreadyThere: number; toLabel: number; byYear: { year: number; gifts: number; value: number }[]; linked: number; notLinked: number; partial: string[]; left: string[]; unclear: string[]; added: number };

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: (message: string, year?: number) => void }) {
  const [kind, setKind] = useState<"workers" | "parties">("workers");
  const [sheet, setSheet] = useState("Workers");
  const [year, setYear] = useState("2025");
  const [text, setText] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(dryRun: boolean) {
    setBusy(true); setError("");
    try {
      const data = await bodyData(await fetch("/api/diwali-gifts/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, year: Number(year), sheet, kind, dryRun }) })) as ImportResult;
      if (dryRun) setResult(data); else onDone(`${data.added} gifts added${data.toLabel ? `, ${data.toLabel} labelled ${sheet}` : ""}.`, Number(year));
    } catch (problem) { setError((problem as Error).message); }
    setBusy(false);
  }
  const names = (list: string[]) => list.slice(0, 12).join(", ") + (list.length > 12 ? ` and ${list.length - 12} more` : "");
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="gift-import-title">
      <div className="modal-head"><div><span className="eyebrow">From your Google Sheet</span><h2 id="gift-import-title">Load an earlier year</h2></div><button onClick={onClose} aria-label="Close">×</button></div>
      <div className="form-grid">
        <label className="span-two">What are you loading?<select value={kind} onChange={event => { const next = event.target.value as "workers" | "parties"; setKind(next); setSheet(next === "parties" ? "Parties" : "Workers"); setYear(next === "parties" ? "2026" : "2025"); setResult(null); }}><option value="workers">Staff and workers (Google Sheet tab)</option><option value="parties">Parties: franchisees, distributors, clients (Party, Gift, Status)</option></select></label>
        {kind === "parties"
          ? <p className="span-two">Paste one party per line with four columns separated by a tab or a | sign: <b>Party name, Gift, Status (Handed over or Planned), Notes</b>. A gift can be several items, for example “2 Comforter + 2 Dry Fruit Box”. Parties with “No gift” or no gift are left out and listed in the check.</p>
          : <p className="span-two">Open one tab of the sheet, press Ctrl+A then Ctrl+C, and paste below. Gift is read from column G and cash from column H; column L is next year’s planned cash. Everything else is ignored. Do each tab (Workers, Office) separately.</p>}
        <label>Tab name (kept as a label)<input value={sheet} onChange={event => { setSheet(event.target.value); setResult(null); }} /></label>
        <label>Diwali year<input type="number" value={year} onChange={event => { setYear(event.target.value); setResult(null); }} /></label>
        <label className="span-two">Pasted sheet<textarea rows={8} value={text} onChange={event => { setText(event.target.value); setResult(null); }} placeholder="Paste here" /></label>
        {result && <div className="span-two">
          <p><b>{result.toAdd}</b> gifts will be added ({result.alreadyThere} already in the register are skipped{result.toLabel > 0 ? `; ${result.toLabel} of those get the “${sheet}” label so they can be counted by group` : ""}). {result.byYear.map(item => `Diwali ${item.year}: ${item.gifts} gifts, cash ${money(item.value)}`).join(" · ")}.</p>
          {kind === "parties"
            ? <p>{result.handed} handed over · {result.planned} planned.{result.skipped.length > 0 ? ` Left out (no gift): ${result.skipped.length}.` : ""}</p>
            : <p>{result.linked} are linked to a staff record; {result.notLinked} are not (one-word names and people not found are saved by name only).</p>}
          {kind === "parties" && result.skipped.length > 0 && <p><b>No gift, not added:</b> {names(result.skipped)}</p>}
          {result.left.length > 0 && <p><b>Have since left:</b> {names(result.left)}</p>}
          {result.partial.length > 0 && <p><b>Linked by part of the name (check):</b> {names(result.partial)}</p>}
          {result.unclear.length > 0 && <p><b>Several staff share the name, not linked:</b> {names(result.unclear)}</p>}
        </div>}
        {error && <p className="form-error span-two" role="alert">{error}</p>}
        <div className="modal-actions span-two"><button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="secondary" disabled={busy || !text.trim()} onClick={() => run(true)}>1. Check first</button>
          <button type="button" className="primary" disabled={busy || !result || (!result.toAdd && !result.toLabel)} onClick={() => run(false)}>2. Add to register</button></div>
      </div>
    </section>
  </div>;
}

type PlanResult = { toYear: number; copied: number; value: number; left: number; leftValue: number; alreadyPlanned: number; added: number };

function PlanDialog({ year, onClose, onDone }: { year: number; onClose: () => void; onDone: (message: string) => void }) {
  const [result, setResult] = useState<PlanResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const call = useCallback(async (dryRun: boolean) => {
    setBusy(true); setError("");
    try {
      const data = await bodyData(await fetch("/api/diwali-gifts/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fromYear: year, dryRun }) })) as PlanResult;
      if (dryRun) setResult(data); else onDone(`${data.added} planned gifts added for Diwali ${data.toYear}.`);
    } catch (problem) { setError((problem as Error).message); }
    setBusy(false);
  }, [year, onDone]);
  useEffect(() => { call(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="gift-plan-title">
      <div className="modal-head"><div><span className="eyebrow">Planning</span><h2 id="gift-plan-title">Plan Diwali {year + 1} from {year}</h2></div><button onClick={onClose} aria-label="Close">×</button></div>
      <div className="form-grid">
        {!result && !error && <p className="span-two">Checking…</p>}
        {result && <div className="span-two">
          <p>Same gift and amount as {year}, marked <b>Planned</b>, for <b>{result.copied}</b> recipients — about <b>{money(result.value)}</b>.</p>
          {result.left > 0 && <p>{result.left} recipients ({money(result.leftValue)}) are skipped because they have left.</p>}
          {result.alreadyPlanned > 0 && <p>{result.alreadyPlanned} already have a gift planned for {year + 1} and are not touched.</p>}
          <p>You can change any amount afterwards. People saved by name only (not linked to a staff record) are copied, so check them.</p>
        </div>}
        {error && <p className="form-error span-two" role="alert">{error}</p>}
        <div className="modal-actions span-two"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="button" className="primary" disabled={busy || !result || !result.copied} onClick={() => call(false)}>Add to Diwali {year + 1}</button></div>
      </div>
    </section>
  </div>;
}
