"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

export type MasterGift = { id: string; name: string; unitValue: number; note: string };
const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
const key = (name: string) => name.replace(/\s+/g, " ").trim().toLowerCase();

async function call(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message || "That could not be saved.");
  return body?.data;
}

// The list of gifts with a standard price each. Pick a gift in the gift form and its price fills in by itself.
export function DiwaliMaster({ year, gifts, flash, onChanged }: { year: number; gifts: { items: { item: string; quantity: number }[] }[]; flash: (message: string) => void; onChanged: () => void }) {
  const [list, setList] = useState<MasterGift[] | null>(null);
  const [editing, setEditing] = useState<MasterGift | "new" | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ people: number; lines: number; valueAdded: number; overwrite: boolean } | null>(null);

  const load = useCallback(() => { call("/api/diwali-gifts/master").then(setList).catch(problem => { setList([]); setError((problem as Error).message); }); }, []);
  useEffect(() => load(), [load]);

  const used = useMemo(() => {
    const counts = new Map<string, { people: number; pieces: number }>();
    for (const gift of gifts) for (const line of gift.items) { const entry = counts.get(key(line.item)) || { people: 0, pieces: 0 }; entry.people += 1; entry.pieces += line.quantity; counts.set(key(line.item), entry); }
    return counts;
  }, [gifts]);
  const missing = useMemo(() => {
    const known = new Set((list || []).map(gift => key(gift.name)));
    const names = new Map<string, string>();
    for (const gift of gifts) for (const line of gift.items) if (!known.has(key(line.item))) names.set(key(line.item), line.item.replace(/\s+/g, " ").trim());
    return [...names.values()].sort();
  }, [gifts, list]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const payload = { name: String(form.get("name") || "").trim(), unitValue: Number(form.get("unitValue") || 0), note: String(form.get("note") || "").trim() };
    try {
      await call(editing === "new" ? "/api/diwali-gifts/master" : `/api/diwali-gifts/master/${(editing as MasterGift).id}`, { method: editing === "new" ? "POST" : "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      setEditing(null); load(); flash("Gift saved in the master.");
    } catch (problem) { setError((problem as Error).message); }
    setBusy(false);
  }
  async function remove(gift: MasterGift) {
    if (!window.confirm(`Remove “${gift.name}” from the master? Gifts already given keep their name and price.`)) return;
    try { await call(`/api/diwali-gifts/master/${gift.id}`, { method: "DELETE" }); load(); } catch (problem) { flash((problem as Error).message); }
  }
  async function addMissing() {
    setBusy(true);
    const results = await Promise.allSettled(missing.map(name => call("/api/diwali-gifts/master", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, unitValue: 0, note: "" }) })));
    setBusy(false); load(); flash(`${results.filter(result => result.status === "fulfilled").length} gifts added to the master. Now enter their prices.`);
  }
  async function apply(overwrite: boolean, dryRun: boolean) {
    setBusy(true);
    try {
      const data = await call("/api/diwali-gifts/master/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ year, overwrite, dryRun }) });
      if (dryRun) setPreview({ people: data.people, lines: data.lines, valueAdded: data.valueAdded, overwrite });
      else { setPreview(null); onChanged(); flash(`Prices filled in for ${data.applied} people.`); }
    } catch (problem) { flash((problem as Error).message); }
    setBusy(false);
  }

  return <>
    <section className="panel table-panel">
      <div className="table-tools"><div><b>Gift master</b><small className="gift-help">The gifts you give, with a standard price. In “Add gift”, choose a gift from this list and its price comes in by itself.</small></div><button className="primary" onClick={() => { setError(""); setEditing("new"); }}>＋ Add a gift to the master</button></div>
      {missing.length > 0 && <div className="gift-bulk"><span>{missing.length} gift {missing.length === 1 ? "name" : "names"} used in Diwali {year} {missing.length === 1 ? "is" : "are"} not in the master: <b>{missing.slice(0, 6).join(", ")}{missing.length > 6 ? "…" : ""}</b></span><button className="secondary" disabled={busy} onClick={addMissing}>Add {missing.length === 1 ? "it" : "them"} to the master</button></div>}
      <div className="gift-compare-wrap"><table className="gift-compare"><thead><tr><th>Gift</th><th>Standard price</th><th>Given in Diwali {year}</th><th></th></tr></thead>
        <tbody>{(list || []).map(gift => { const count = used.get(key(gift.name)); return <tr key={gift.id}>
          <td><b>{gift.name}</b>{gift.note && <small>{gift.note}</small>}</td>
          <td>{gift.unitValue > 0 ? <b>{money(gift.unitValue)}</b> : <span className="gift-left">Price not entered</span>}</td>
          <td>{count ? `${count.people} people · ${count.pieces} pcs` : "—"}</td>
          <td className="gift-actions"><button className="link" onClick={() => { setError(""); setEditing(gift); }}>Edit</button><button className="link danger" onClick={() => remove(gift)}>Remove</button></td></tr>; })}</tbody></table>
        {list === null ? <div className="empty-state padded">Loading…</div> : !list.length && <div className="empty-state padded">{error || "No gifts in the master yet. Add the gifts you give, such as Comforter Set or Dry Fruit."}</div>}</div>
    </section>

    <section className="panel table-panel">
      <div className="table-tools"><div><b>Put these prices on Diwali {year} gifts</b><small className="gift-help">Gifts loaded from a sheet have no price. This fills the master price into every gift line that has none, and recalculates each person's gifts value and total.</small></div></div>
      <div className="gift-bulk">
        <button className="secondary" disabled={busy || !list?.length} onClick={() => apply(false, true)}>Check what would change</button>
        <button className="secondary" disabled={busy || !list?.length} onClick={() => apply(true, true)}>Check, also replacing prices already entered</button>
        {preview && <span>{preview.people === 0 ? "Nothing to change." : <><b>{preview.people}</b> people, {preview.lines} gift lines get a price; the total changes by <b>{money(preview.valueAdded)}</b>.</>}</span>}
        {preview && preview.people > 0 && <button className="primary" disabled={busy} onClick={() => apply(preview.overwrite, false)}>Apply to Diwali {year}</button>}
      </div>
    </section>

    {editing && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setEditing(null); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="master-form-title">
        <div className="modal-head"><div><span className="eyebrow">Gift master</span><h2 id="master-form-title">{editing === "new" ? "Add a gift" : "Edit gift"}</h2></div><button onClick={() => setEditing(null)} aria-label="Close">×</button></div>
        <form onSubmit={save} className="form-grid">
          <label className="span-two">Gift name<input name="name" required defaultValue={editing === "new" ? "" : editing.name} placeholder="For example Comforter Set" autoFocus /></label>
          <label>Standard price of one (₹)<input name="unitValue" type="number" min="0" step="0.01" required defaultValue={editing === "new" ? "" : editing.unitValue} /></label>
          <label>Note (optional)<input name="note" defaultValue={editing === "new" ? "" : editing.note} placeholder="Size, supplier…" /></label>
          {error && <p className="form-error span-two" role="alert">{error}</p>}
          <div className="modal-actions span-two"><button type="button" className="secondary" onClick={() => setEditing(null)}>Cancel</button><button className="primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
        </form>
      </section>
    </div>}
  </>;
}
