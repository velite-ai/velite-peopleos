"use client";

import { useEffect, useMemo, useState } from "react";
import { CompareGift, change, compareYears } from "@/lib/diwali-compare-rules";

const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

export function DiwaliCompare() {
  const [gifts, setGifts] = useState<CompareGift[] | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [show, setShow] = useState("all");
  const [group, setGroup] = useState("all");
  useEffect(() => {
    fetch("/api/diwali-gifts/compare").then(async response => { const body = await response.json().catch(() => null); if (!response.ok) throw new Error(body?.error?.message || "Could not load the gifts."); return body.data.gifts as CompareGift[]; })
      .then(setGifts).catch(problem => { setGifts([]); setError((problem as Error).message); });
  }, []);
  const view = useMemo(() => compareYears(gifts || []), [gifts]);
  const last = view.years[view.years.length - 1], before = view.years[view.years.length - 2];
  const rows = view.rows.filter(row => (group === "all" || row.group === group) && (!search.trim() || `${row.name} ${row.company}`.toLowerCase().includes(search.trim().toLowerCase())) && (show === "all" || (show === "left" ? row.left : show === "working" ? !row.left : show === "missing" ? Boolean(before && last && row.cells[before] && !row.cells[last]) : Boolean(last && row.cells[last] && !(before && row.cells[before])))));

  function download() {
    const cell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const header = ["Person", "Group", "Company / place", "Has left", ...view.years.flatMap(year => [`${year} gift`, `${year} value (INR)`])];
    const lines = [header, ...rows.map(row => [row.name, row.group, row.company, row.left ? "Yes" : "", ...view.years.flatMap(year => [row.cells[year]?.items.join("; ") || "", row.cells[year]?.value ?? ""])])].map(line => line.map(cell).join(","));
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    link.download = "diwali-year-by-year.csv"; link.click(); URL.revokeObjectURL(link.href);
  }

  if (gifts === null) return <section className="panel loading-panel">Loading…</section>;
  if (error) return <section className="panel loading-panel">{error}</section>;
  if (!view.years.length) return <section className="panel loading-panel">No gifts recorded yet. Use “Load an earlier year” first.</section>;
  return <>
    <section className="panel table-panel">
      <div className="table-tools"><b>Head-count and cash by group</b></div>
      <div className="gift-compare-wrap"><table className="gift-compare">
        <thead><tr><th>Group</th>{view.years.map(year => <th key={year}>Diwali {year}</th>)}</tr></thead>
        <tbody>{view.byGroup.map(item => <tr key={item.group}><td><b>{item.group}</b></td>{item.years.map(cell => <td key={cell.year}>{cell.people ? <><b>{cell.people} people</b><small>{money(cell.value)}{cell.left ? ` · ${cell.left} have left` : ""}</small></> : "—"}</td>)}</tr>)}</tbody>
        <tfoot><tr><td><b>All groups</b></td>{view.years.map(year => <td key={year}><b>{view.people[year]} people</b><small>{money(view.totals[year])}</small></td>)}</tr></tfoot>
      </table></div>
    </section>
    <section className="panel table-panel">
      <div className="table-tools gift-tools"><div className="gift-filters"><select value={group} onChange={event => setGroup(event.target.value)} aria-label="Group"><option value="all">Workers and Office</option>{view.byGroup.map(item => <option key={item.group} value={item.group}>{item.group}</option>)}</select><input type="search" placeholder="Find a name" value={search} onChange={event => setSearch(event.target.value)} aria-label="Find a person" />
        <select value={show} onChange={event => setShow(event.target.value)} aria-label="Show"><option value="all">Everyone</option><option value="working">Still with Velite</option><option value="left">Has left</option>{before && last && <option value="missing">Got a gift in {before}, none in {last}</option>}{before && last && <option value="new">New in {last}</option>}</select></div>
        <button className="secondary" onClick={download}>⇩ Download for Excel</button></div>
      <div className="gift-compare-wrap"><table className="gift-compare">
        <thead><tr><th>Person</th>{view.years.map(year => <th key={year}>{year}</th>)}{before && last && <th>Change {before}→{last}</th>}</tr></thead>
        <tbody>{rows.map(row => { const diff = before && last ? change(row, before, last) : null; return <tr key={row.key}>
          <td><b>{row.name}{row.left && <em className="gift-left"> · Has left</em>}</b><small>{row.company}</small></td>
          {view.years.map(year => { const cell = row.cells[year]; return <td key={year}>{cell ? <><b>{money(cell.value)}</b><small>{cell.items.join("; ")}{cell.status === "planned" ? " · planned" : ""}</small></> : "—"}</td>; })}
          {before && last && <td>{diff === null ? "—" : diff === 0 ? "same" : `${diff > 0 ? "+" : "−"}${money(Math.abs(diff))}`}</td>}
        </tr>; })}</tbody>
        <tfoot><tr><td><b>Total</b></td>{view.years.map(year => <td key={year}><b>{money(view.totals[year])}</b></td>)}{before && last && <td><b>{money(view.totals[last] - view.totals[before])}</b></td>}</tr></tfoot>
      </table></div>
      <div className="table-foot"><span>{rows.length} of {view.rows.length} people shown · cash only; gift item prices are not in the sheet</span></div>
    </section>
  </>;
}
