"use client";

import { useEffect, useMemo, useState } from "react";
import { AnalysisGift, CASH_KEY, firmSummary, groupSummary, itemSummary, statusSummary, topRecipients, totalsOf, yearChange } from "@/lib/diwali-analysis-rules";

const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
const STATUS_NAMES: Record<string, string> = { planned: "Planned", bought: "Bought", handed_over: "Handed over" };
const arrow = (value: number) => value === 0 ? "no change" : `${value > 0 ? "▲" : "▼"} ${money(Math.abs(value))}`;

// Gift-wise view of one year: who gets (or got) which gift, planned and handed over, with totals, groups and a comparison with last year.
export function DiwaliItems({ year, gifts, companyName = "", companyOrder = [], flash }: { year: number; gifts: AnalysisGift[]; companyName?: string; companyOrder?: string[]; flash: (message: string) => void }) {
  const [before, setBefore] = useState<AnalysisGift[] | null>(null);
  const [open, setOpen] = useState("");
  useEffect(() => {
    let current = true; setBefore(null);
    fetch(`/api/diwali-gifts?year=${year - 1}`).then(response => response.ok ? response.json() : null).then(body => { if (current) setBefore(body?.data?.gifts || []); }).catch(() => { if (current) setBefore([]); });
    return () => { current = false; };
  }, [year]);

  const status = useMemo(() => statusSummary(gifts), [gifts]);
  const items = useMemo(() => itemSummary(gifts), [gifts]);
  const groups = useMemo(() => groupSummary(gifts), [gifts]);
  const firms = useMemo(() => firmSummary(gifts, companyOrder), [gifts, companyOrder]);
  const top = useMemo(() => topRecipients(gifts, 10), [gifts]);
  const all = totalsOf(gifts);
  const change = before && before.length ? yearChange(gifts, before) : null;
  const handed = status.handed_over, pending = { people: status.planned.people + status.bought.people, total: status.planned.total + status.bought.total, giftValue: status.planned.giftValue + status.bought.giftValue, cash: status.planned.cash + status.bought.cash };
  const percent = all.people ? Math.round(handed.people / all.people * 100) : 0;

  async function pdf() {
    try {
      const [{ buildTablePdf }, { analysisBlocks }] = await Promise.all([import("@/lib/table-pdf"), import("@/lib/diwali-report")]);
      const blocks = analysisBlocks({
        year, status: (["planned", "bought", "handed_over"] as const).map(key => ({ key, ...status[key] })), items, groups, top,
        firms, companyName,
        change: change ? { beforeYear: year - 1, now: change.now, before: change.before } : undefined,
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([buildTablePdf(blocks, `Diwali gifts ${year} - analysis`) as BlobPart], { type: "application/pdf" }));
      link.download = `diwali-gifts-${year}-analysis.pdf`; link.click(); URL.revokeObjectURL(link.href);
    } catch { flash("The PDF could not be made."); }
  }

  if (!gifts.length) return <section className="panel loading-panel">No gifts recorded for Diwali {year} yet.</section>;
  return <div className="gift-analysis">
    <div className="gift-print-title"><h1>Diwali gifts {year} - analysis{companyName ? ` - ${companyName}` : ""}</h1><p>Confidential</p></div>
    <div className="gift-noprint gift-actions-bar"><span>Everything below is for <b>Diwali {year}</b> (change the year with the box above){companyName ? <> · company: <b>{companyName}</b></> : null}.</span><span><button className="secondary" onClick={() => window.print()}>🖨 Print</button><button className="primary" onClick={pdf}>⇩ Download PDF</button></span></div>

    <div className="metrics compact">
      <div className="metric"><div className="metric-icon purple">◎</div><span>PEOPLE</span><strong>{all.people}</strong><small>{money(all.total)} in all</small></div>
      <div className="metric"><div className="metric-icon green">✓</div><span>HANDED OVER</span><strong>{handed.people}</strong><small>{money(handed.total)} · {percent}% of people</small></div>
      <div className="metric"><div className="metric-icon orange">!</div><span>STILL TO HAND OVER</span><strong>{pending.people}</strong><small>{money(pending.total)} planned</small></div>
      <div className="metric"><div className="metric-icon blue">₹</div><span>GIFTS + CASH</span><strong>{money(all.total)}</strong><small>Gifts {money(all.giftValue)} · Cash {money(all.cash)}</small></div>
    </div>
    <div className="gift-progress"><i style={{ width: `${percent}%` }} /><span>{percent}% handed over ({handed.people} of {all.people})</span></div>

    <section className="panel table-panel">
      <div className="table-tools"><b>Gift-wise: planned and handed over</b><small>Click a gift to see the people</small></div>
      <div className="gift-compare-wrap"><table className="gift-compare gift-items-table">
        <thead><tr><th>Gift</th><th>Planned (people · pieces)</th><th>Handed over (people · pieces)</th><th>All (people · pieces)</th><th>Value</th></tr></thead>
        <tbody>{items.map(row => <ItemRowView key={row.key} row={row} open={open === row.key} onToggle={() => setOpen(open === row.key ? "" : row.key)} />)}</tbody>
      </table></div>
      <div className="table-foot"><span>Planned = planned or bought, not yet handed over. Cash counts one payment per person. Gift prices are included only where they were entered.</span></div>
    </section>

    <section className="panel table-panel"><div className="table-tools"><b>By company</b><small>Which Velite company gives the gift. Staff count under their own company; parties under the company chosen on the gift.</small></div>
      <div className="gift-compare-wrap"><table className="gift-compare"><thead><tr><th>Company</th><th>People</th><th>Handed over</th><th>To go</th><th>Gifts value</th><th>Cash</th><th>Total</th></tr></thead>
        <tbody>{firms.map(row => <tr key={row.firm}><td><b>{row.firm}</b></td><td>{row.people}</td><td>{row.handed}</td><td>{row.pending}</td><td>{money(row.giftValue)}</td><td>{money(row.cash)}</td><td><b>{money(row.total)}</b></td></tr>)}</tbody>
        <tfoot><tr><td><b>All</b></td><td><b>{all.people}</b></td><td><b>{handed.people}</b></td><td><b>{pending.people}</b></td><td><b>{money(all.giftValue)}</b></td><td><b>{money(all.cash)}</b></td><td><b>{money(all.total)}</b></td></tr></tfoot></table></div></section>

    <div className="gift-two">
      <section className="panel table-panel"><div className="table-tools"><b>By status</b></div>
        <div className="gift-compare-wrap"><table className="gift-compare"><thead><tr><th>Status</th><th>People</th><th>Gifts</th><th>Cash</th><th>Total</th></tr></thead>
          <tbody>{(["planned", "bought", "handed_over"] as const).map(key => <tr key={key}><td><span className={`gift-pill ${key}`}>{STATUS_NAMES[key]}</span></td><td>{status[key].people}</td><td>{money(status[key].giftValue)}</td><td>{money(status[key].cash)}</td><td><b>{money(status[key].total)}</b></td></tr>)}</tbody>
          <tfoot><tr><td><b>All</b></td><td><b>{all.people}</b></td><td><b>{money(all.giftValue)}</b></td><td><b>{money(all.cash)}</b></td><td><b>{money(all.total)}</b></td></tr></tfoot></table></div></section>
      <section className="panel table-panel"><div className="table-tools"><b>By group</b></div>
        <div className="gift-compare-wrap"><table className="gift-compare"><thead><tr><th>Group</th><th>People</th><th>Handed over</th><th>To go</th><th>Total</th></tr></thead>
          <tbody>{groups.map(row => <tr key={row.group}><td><b>{row.group}</b></td><td>{row.people}</td><td>{row.handed}</td><td>{row.pending}</td><td>{money(row.total)}<small>Gifts {money(row.giftValue)} · Cash {money(row.cash)}</small></td></tr>)}</tbody></table></div></section>
    </div>

    <div className="gift-two">
      <section className="panel table-panel"><div className="table-tools"><b>Compared with Diwali {year - 1}</b></div>
        {change ? <div className="gift-compare-wrap"><table className="gift-compare"><thead><tr><th></th><th>{year - 1}</th><th>{year}</th><th>Change</th></tr></thead><tbody>
          <tr><td>People</td><td>{change.before.people}</td><td>{change.now.people}</td><td>{change.diff.people > 0 ? "+" : ""}{change.diff.people}</td></tr>
          <tr><td>Gifts value</td><td>{money(change.before.giftValue)}</td><td>{money(change.now.giftValue)}</td><td>{arrow(change.diff.giftValue)}</td></tr>
          <tr><td>Cash</td><td>{money(change.before.cash)}</td><td>{money(change.now.cash)}</td><td>{arrow(change.diff.cash)}</td></tr>
          <tr><td><b>Total</b></td><td><b>{money(change.before.total)}</b></td><td><b>{money(change.now.total)}</b></td><td><b>{arrow(change.diff.total)}</b></td></tr></tbody></table></div>
          : <div className="empty-state padded">{before === null ? "Loading…" : `No gifts recorded for ${year - 1}.`}</div>}</section>
      <section className="panel table-panel"><div className="table-tools"><b>Highest total value</b></div>
        <div className="gift-compare-wrap"><table className="gift-compare"><tbody>{top.map((gift, index) => <tr key={gift.id}><td>{index + 1}</td><td><b>{gift.recipientName}</b><small>{gift.items.map(line => line.item).join(", ") || "Cash only"}</small></td><td>{money(gift.totalValue)}</td><td><span className={`gift-pill ${gift.status}`}>{STATUS_NAMES[gift.status]}</span></td></tr>)}</tbody></table></div></section>
    </div>
  </div>;
}

function ItemRowView({ row, open, onToggle }: { row: ReturnType<typeof itemSummary>[number]; open: boolean; onToggle: () => void }) {
  const isCash = row.key === CASH_KEY;
  const unit = isCash ? "payments" : "pcs";
  const planned = row.recipients.filter(person => person.status !== "handed_over"), handed = row.recipients.filter(person => person.status === "handed_over");
  return <>
    <tr className="gift-item-row" onClick={onToggle} aria-expanded={open}>
      <td><b>{open ? "▾" : "▸"} {row.item}</b></td>
      <td>{row.planned.people} · {row.planned.qty} {unit}</td>
      <td>{row.handed.people} · {row.handed.qty} {unit}</td>
      <td>{row.people} · {row.qty} {unit}</td>
      <td>{row.value ? <b>{money(row.value)}</b> : "—"}</td>
    </tr>
    <tr className={`gift-item-detail ${open ? "open" : ""}`}><td colSpan={5}><div className="gift-two">
      <div><b>Planned ({planned.length})</b><ul>{planned.map((person, index) => <li key={index}>{person.name}<small>{isCash ? money(person.value) : `${person.qty} ${unit}`}{person.status === "bought" ? " · bought" : ""}</small></li>)}{!planned.length && <li className="muted">Nobody</li>}</ul></div>
      <div><b>Handed over ({handed.length})</b><ul>{handed.map((person, index) => <li key={index}>{person.name}<small>{isCash ? money(person.value) : `${person.qty} ${unit}`}</small></li>)}{!handed.length && <li className="muted">Nobody</li>}</ul></div>
    </div></td></tr>
  </>;
}
