"use client";
/* API records differ by module; every write is still validated and scoped by the server. */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type BusinessHead = { id: string; name: string };
type Person = { id: string; name: string; code: string; role: string };
type OperationsModule = "Recruitment" | "Onboarding" | "Leave & Shifts" | "Learning" | "Helpdesk" | "Separation" | "Reports";
type ModalKind = "requisition" | "candidate" | "conversion" | "onboarding" | "leave-policy" | "shift" | "course" | "assignment" | "case" | "separation" | "final-settlement";

const moduleCopy: Record<OperationsModule, { title: string; eyebrow: string; text: string; action: string; modal?: ModalKind }> = {
  Recruitment: { title: "Hiring", eyebrow: "Hiring", text: "Open a job, add candidates, interview them and make offers.", action: "Open a new job", modal: "requisition" },
  Onboarding: { title: "Joining", eyebrow: "Joining", text: "Get new staff ready: documents, logins and their first 90 days.", action: "Start joining steps", modal: "onboarding" },
  "Leave & Shifts": { title: "Leave & shifts", eyebrow: "Leave & shifts", text: "Leave requests and approvals, leave balances, and work shifts.", action: "Add a leave type", modal: "leave-policy" },
  Learning: { title: "Training", eyebrow: "Training", text: "Create training, assign it to staff and see who has finished.", action: "Add training", modal: "course" },
  Helpdesk: { title: "Help desk", eyebrow: "Help desk", text: "Questions and requests from staff, and the answers given.", action: "Add a request", modal: "case" },
  Separation: { title: "Leaving", eyebrow: "Leaving", text: "Notice period, handover, no-dues clearance and final settlement.", action: "Start exit steps", modal: "separation" },
  Reports: { title: "Reports", eyebrow: "Reports", text: "Staff, attendance, salary, appraisal and hiring figures you can download.", action: "Download staff list" },
};

const friendly = (value: unknown) => String(value || "open").replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
const statusClass = (value: unknown) => String(value || "open").toLowerCase().replaceAll("_", "-").replaceAll(" ", "-");
const dateOnly = (value: unknown) => value ? String(value).slice(0, 10) : "—";

async function responseData(response: Response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message || "The action could not be completed.");
  return body?.data;
}

export function OperationsWorkspace({ active, businessHeadId, head, heads, people, flash }: {
  active: OperationsModule;
  businessHeadId: string;
  head: string;
  heads: BusinessHead[];
  people: Person[];
  flash: (message: string) => void;
}) {
  const copy = moduleCopy[active];
  const [records, setRecords] = useState<any[]>([]);
  const [secondary, setSecondary] = useState<any[]>([]);
  const [tertiary, setTertiary] = useState<any[]>([]);
  const [report, setReport] = useState<any>(null);
  const [busy, setBusy] = useState(true);
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [refresh, setRefresh] = useState(0);

  const scoped = useCallback((path: string) => {
    if (businessHeadId === "all") return path;
    const separator = path.includes("?") ? "&" : "?";
    return `${path}${separator}businessHeadId=${encodeURIComponent(businessHeadId)}`;
  }, [businessHeadId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (active === "Recruitment") {
        const [requisitions, candidates, offers] = await Promise.all([
          fetch(scoped("/api/recruitment/requisitions")).then(responseData),
          fetch(scoped("/api/recruitment/candidates")).then(responseData),
          fetch(scoped("/api/recruitment/offers")).then(responseData),
        ]);
        if (!cancelled) { setRecords(requisitions || []); setSecondary(candidates || []); setTertiary(offers || []); }
      } else if (active === "Onboarding") {
        const [cases, candidates] = await Promise.all([
          fetch(scoped("/api/onboarding")).then(responseData),
          fetch(scoped("/api/recruitment/candidates?stage=hired")).then(responseData),
        ]);
        if (!cancelled) { setRecords(cases || []); setSecondary(candidates || []); setTertiary([]); }
      } else if (active === "Leave & Shifts") {
        const [requests, policies, shifts] = await Promise.all([
          fetch(scoped("/api/leave/requests")).then(responseData),
          fetch(scoped("/api/leave/policies")).then(responseData),
          fetch(scoped("/api/shifts")).then(responseData),
        ]);
        if (!cancelled) { setRecords(requests || []); setSecondary(policies || []); setTertiary(shifts || []); }
      } else if (active === "Learning") {
        const [courses, enrolments] = await Promise.all([
          fetch(scoped("/api/learning/courses")).then(responseData),
          fetch(scoped("/api/learning/enrolments")).then(responseData),
        ]);
        if (!cancelled) { setRecords(courses || []); setSecondary(enrolments || []); setTertiary([]); }
      } else if (active === "Helpdesk") {
        const cases = await fetch(scoped("/api/helpdesk")).then(responseData);
        if (!cancelled) { setRecords(cases || []); setSecondary([]); setTertiary([]); }
      } else if (active === "Separation") {
        const [separations, settlements] = await Promise.all([
          fetch(scoped("/api/separations")).then(responseData),
          fetch(scoped("/api/separations/final-settlements")).then(response => response.ok ? responseData(response) : []),
        ]);
        if (!cancelled) { setRecords(separations || []); setSecondary(settlements || []); setTertiary([]); }
      } else {
        const workforce = await fetch(scoped("/api/reports/workforce")).then(responseData);
        if (!cancelled) { setReport(workforce); setRecords(workforce?.headcount || []); setSecondary(workforce?.departments || []); setTertiary(workforce?.movements || []); }
      }
    };
    load().catch(error => { if (!cancelled) { setRecords([]); setSecondary([]); setTertiary([]); flash(error.message || `${active} could not be loaded.`); } })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [active, scoped, refresh, flash]);

  const summary = useMemo(() => {
    if (active === "Recruitment") return [records.length, secondary.length, secondary.filter(row => !["hired", "rejected", "withdrawn"].includes(row.stage)).length, tertiary.filter(row => row.status === "accepted").length];
    if (active === "Onboarding") return [records.length, records.filter(row => row.status !== "completed").length, records.reduce((sum, row) => sum + Number(row.completed_tasks || 0), 0), records.filter(row => Number(row.progress || 0) === 100).length];
    if (active === "Leave & Shifts") return [records.length, records.filter(row => row.status === "pending").length, secondary.length, tertiary.length];
    if (active === "Learning") return [records.length, secondary.length, secondary.filter(row => row.status === "completed").length, secondary.filter(row => row.due_date && row.status !== "completed" && String(row.due_date).slice(0, 10) < new Date().toISOString().slice(0, 10)).length];
    if (active === "Helpdesk") return [records.length, records.filter(row => row.status === "open").length, records.filter(row => row.priority === "urgent").length, records.filter(row => ["resolved", "closed"].includes(row.status)).length];
    if (active === "Separation") return [records.length, records.filter(row => row.status === "pending").length, records.reduce((sum, row) => sum + Number(row.task_count || 0) - Number(row.completed_tasks || 0), 0), secondary.filter(row => row.status === "completed").length];
    return [records.reduce((sum, row) => sum + Number(row.active || 0), 0), secondary.length, report?.attendance?.length || 0, tertiary.reduce((sum, row) => sum + Number(row.joiners || 0), 0)];
  }, [active, records, secondary, tertiary, report]);

  const labels: Record<OperationsModule, [string, string, string, string]> = {
    Recruitment: ["REQUISITIONS", "CANDIDATES", "ACTIVE PIPELINE", "ACCEPTED OFFERS"],
    Onboarding: ["JOINING CASES", "IN PROGRESS", "TASKS COMPLETE", "READY"],
    "Leave & Shifts": ["LEAVE REQUESTS", "PENDING", "POLICIES", "SHIFTS"],
    Learning: ["COURSES", "ASSIGNMENTS", "COMPLETED", "OVERDUE"],
    Helpdesk: ["CASES", "OPEN", "URGENT", "RESOLVED"],
    Separation: ["SEPARATIONS", "PENDING", "OPEN TASKS", "SETTLEMENTS PAID"],
    Reports: ["ACTIVE PEOPLE", "DEPARTMENTS", "ATTENDANCE DAYS", "12-MONTH JOINERS"],
  };

  async function post(path: string, payload: unknown, method = "POST") {
    const response = await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    await responseData(response);
    setRefresh(value => value + 1);
  }

  async function requisitionAction(row: any) {
    const decision = row.status === "draft" ? "submit" : row.status === "pending" ? "approve" : row.status === "approved" ? "close" : null;
    if (!decision) return flash(`This requisition is already ${friendly(row.status).toLowerCase()}.`);
    const reason = window.prompt(`Reason to ${decision} ${row.requisition_code}:`, `${friendly(decision)} requisition`);
    if (!reason) return;
    try { await post(`/api/recruitment/requisitions/${row.id}/decision`, { decision, reason }); flash(`Requisition ${friendly(decision).toLowerCase()}d.`); } catch (error) { flash((error as Error).message); }
  }

  async function candidateAction(row: any) {
    const next = window.prompt("Move candidate to stage: screening, assessment, interview, offered, hired, rejected or withdrawn", row.stage === "applied" ? "screening" : "interview");
    if (!next) return;
    const reason = window.prompt("Reason / interview note:", "Pipeline stage updated");
    if (!reason) return;
    try { await post(`/api/recruitment/candidates/${row.id}/stage`, { stage: next, notes: reason }); flash(`${row.full_name} moved to ${friendly(next)}.`); } catch (error) { flash((error as Error).message); }
  }

  async function leaveAction(row: any) {
    if (row.status !== "pending") return flash(`This request is already ${friendly(row.status).toLowerCase()}.`);
    const decision = window.confirm(`Approve ${row.employee_name}'s ${row.days}-day leave request?`) ? "approve" : "reject";
    const reason = window.prompt(`Reason to ${decision}:`, decision === "approve" ? "Leave entitlement verified" : "Request cannot be approved");
    if (!reason) return;
    try { await post(`/api/leave/requests/${row.id}/decision`, { decision, reason }); flash(`Leave request ${decision}d.`); } catch (error) { flash((error as Error).message); }
  }

  async function policyAction(row: any) {
    const action = ["draft", "rejected"].includes(row.status) ? "submit" : row.status === "pending" ? "approve" : null;
    if (!action) return flash(`This policy version is ${friendly(row.status).toLowerCase()}.`);
    const reason = window.prompt(`Reason to ${action} ${row.name}:`, action === "submit" ? "Policy version ready for independent review" : "Entitlement, dates and carry-forward controls verified");
    if (!reason) return;
    try { await post(`/api/leave/policies/${row.id}/decision`, { action, reason }); flash(`Leave policy ${friendly(action).toLowerCase()}ed.`); } catch (error) { flash((error as Error).message); }
  }

  async function helpdeskAction(row: any) {
    if (row.status === "closed") return flash("This case is closed.");
    const status = window.prompt("New status: open, in_progress, waiting_on_employee, resolved or closed", row.status === "open" ? "in_progress" : "resolved");
    if (!status) return;
    const resolution = ["resolved", "closed"].includes(status) ? window.prompt("Resolution:") : null;
    if (["resolved", "closed"].includes(status) && !resolution) return;
    const reason = window.prompt("Reason for this update:", "Service case progressed");
    if (!reason) return;
    try { await post(`/api/helpdesk/${row.id}`, { status, resolution, reason }, "PATCH"); flash(`Case ${row.case_number} updated.`); } catch (error) { flash((error as Error).message); }
  }

  async function separationAction(row: any) {
    const decision = row.status === "pending" ? "approve" : row.status === "approved" ? "complete" : null;
    if (!decision) return flash(`This separation is ${friendly(row.status).toLowerCase()}.`);
    const reason = window.prompt(`Reason to ${decision} this separation:`, decision === "approve" ? "Notice and last working date reviewed" : "All offboarding controls completed");
    if (!reason) return;
    try { await post(`/api/separations/${row.id}/decision`, { decision, approvedLastWorkingDate: dateOnly(row.proposed_last_working_date), reason }); flash(`Separation ${friendly(decision).toLowerCase()}d.`); } catch (error) { flash((error as Error).message); }
  }

  async function settlementAction(row: any) {
    if (row.document_id) {
      try {
        const download = await responseData(await fetch(`/api/documents/${row.document_id}/download`));
        window.open(download.url, "_blank", "noopener,noreferrer");
        flash("A private five-minute final-settlement statement link was opened.");
      } catch (error) { flash((error as Error).message); }
      return;
    }
    if (row.status === "completed") return flash(row.generation_status === "failed" ? `Statement generation failed: ${row.generation_error || "worker error"}` : "The signed settlement statement is being generated securely.");
    const action = ["draft", "rejected"].includes(row.status) ? "submit" : row.status === "pending" ? "approve" : row.status === "approved" ? "mark_paid" : null;
    if (!action) return flash(`This final settlement is ${friendly(row.status).toLowerCase()}.`);
    const reason = window.prompt(`Reason to ${action.replace("_", " ")} this final settlement:`, action === "submit" ? "Calculation and source evidence reviewed" : action === "approve" ? "Final settlement independently verified" : "Payment or recovery completed");
    if (!reason) return;
    const paymentReference = action === "mark_paid" ? window.prompt("Payment or recovery reference:") : undefined;
    if (action === "mark_paid" && !paymentReference) return;
    try { await post(`/api/separations/final-settlements/${row.id}/decision`, { action, reason, paymentReference }); flash(`Final settlement ${friendly(action).toLowerCase()}.`); } catch (error) { flash((error as Error).message); }
  }

  async function exportReport(reportName: "workforce" | "attendance" | "payroll" | "performance" | "recruitment") {
    const response = await fetch("/api/reports/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ report: reportName, businessHeadId: businessHeadId === "all" ? null : businessHeadId, reason: `${friendly(reportName)} operations export` }) });
    if (!response.ok) return flash((await response.json().catch(() => null))?.error?.message || "Export failed.");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = `velite-${reportName}-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
    flash(`${friendly(reportName)} export downloaded and audited.`);
  }

  const primaryRows = active === "Reports" ? records : records;
  const title = (row: any) => active === "Recruitment" ? `${row.requisition_code} · ${row.position}` : active === "Onboarding" ? row.full_name : active === "Leave & Shifts" ? `${row.employee_name} · ${row.leave_type}` : active === "Learning" ? row.title : active === "Helpdesk" ? `${row.case_number} · ${row.subject}` : active === "Separation" ? row.employee_name : row.name;
  const detail = (row: any) => active === "Recruitment" ? `${row.business_head}${row.department ? ` · ${row.department}` : ""} · ${row.candidates} candidate(s)` : active === "Onboarding" ? `${row.position} · ${row.completed_tasks}/${row.task_count} tasks · joins ${dateOnly(row.planned_joining_date)}` : active === "Leave & Shifts" ? `${dateOnly(row.start_date)} to ${dateOnly(row.end_date)} · ${row.days} day(s)` : active === "Learning" ? `${row.code} · ${row.enrolled} enrolment(s)` : active === "Helpdesk" ? `${row.business_head} · ${row.category} · ${friendly(row.priority)} priority` : active === "Separation" ? `${row.separation_type} · last day ${dateOnly(row.approved_last_working_date || row.proposed_last_working_date)} · ${row.completed_tasks}/${row.task_count} tasks` : `${row.active} active · ${row.probation} probation · ${row.notice} notice`;
  const click = (row: any) => active === "Recruitment" ? requisitionAction(row) : active === "Leave & Shifts" ? leaveAction(row) : active === "Helpdesk" ? helpdeskAction(row) : active === "Separation" ? separationAction(row) : flash(`${title(row)} opened.`);

  return <>
    <div className="page-head"><div><span className="eyebrow">{copy.eyebrow}</span><h1>{copy.title}</h1><p>{head} · {copy.text}</p></div><button className="primary" onClick={() => copy.modal ? setModal(copy.modal) : exportReport("workforce")}>＋ {copy.action}</button></div>
    <div className="metrics compact">{labels[active].map((label, index) => <SmallMetric key={label} label={label} value={summary[index]} index={index} />)}</div>
    <section className="panel operations-toolbar"><div><strong>What you can do here</strong><span>Every change is recorded with who made it</span></div><div>
      {active === "Recruitment" && <><button className="secondary" onClick={() => setModal("candidate")}>Add candidate</button><button className="secondary" onClick={() => setModal("conversion")}>Convert accepted hire</button></>}
      {active === "Leave & Shifts" && <button className="secondary" onClick={() => setModal("shift")}>Create shift</button>}
      {active === "Learning" && <button className="secondary" onClick={() => setModal("assignment")}>Assign learning</button>}
      {active === "Separation" && <button className="secondary" onClick={() => setModal("final-settlement")}>Calculate final settlement</button>}
      {active === "Reports" && <>{(["attendance", "payroll", "performance", "recruitment"] as const).map(name => <button className="secondary" key={name} onClick={() => exportReport(name)}>{friendly(name)}</button>)}</>}
    </div></section>
    <section className="panel worklist operations-list"><div className="panel-head padded"><div><h2>{active === "Reports" ? "Workforce by business head" : "Primary work queue"}</h2><p>{busy ? "Loading authorised records…" : `${primaryRows.length} record(s) in this secured view`}</p></div></div>
      {!busy && primaryRows.map((row, index) => <button key={row.id || index} onClick={() => click(row)}><i>{index + 1}</i><div><b>{title(row)}</b><span>{detail(row)}</span></div><em className={`status ${statusClass(row.status || (Number(row.probation) ? "attention" : "active"))}`}>{friendly(row.status || (Number(row.probation) ? "attention" : "active"))}</em><strong>›</strong></button>)}
      {busy && <div className="empty-state padded">Loading…</div>}{!busy && !primaryRows.length && <div className="empty-state padded">No records in this view.</div>}
    </section>
    {active === "Recruitment" && <section className="panel worklist operations-list"><div className="panel-head padded"><div><h2>Candidate pipeline</h2><p>Click a candidate to move them through a controlled stage</p></div></div>{secondary.slice(0, 20).map((row, index) => <button key={row.id} onClick={() => candidateAction(row)}><i>{index + 1}</i><div><b>{row.full_name}</b><span>{row.position} · {row.business_head} · {row.email || row.phone || "Contact pending"}</span></div><em className={`status ${statusClass(row.stage)}`}>{friendly(row.stage)}</em><strong>›</strong></button>)}</section>}
    {active === "Leave & Shifts" && <div className="grid halves"><section className="panel worklist operations-list"><div className="panel-head padded"><div><h2>Leave policy versions</h2><p>Click a draft or pending version to advance maker-checker approval</p></div></div>{secondary.slice(0, 20).map((row, index) => <button key={row.id} onClick={() => policyAction(row)}><i>{index + 1}</i><div><b>{row.code} · {row.name}</b><span>{row.annual_entitlement} days · {friendly(row.accrual_frequency)} · effective {dateOnly(row.effective_from)}</span></div><em className={`status ${statusClass(row.status)}`}>{friendly(row.status)}</em><strong>›</strong></button>)}</section><section className="panel worklist operations-list"><div className="panel-head padded"><div><h2>Active shifts</h2><p>Work-time, grace and payroll thresholds</p></div></div>{tertiary.slice(0, 20).map((row, index) => <button key={row.id} onClick={() => flash(`${row.name} shift opened.`)}><i>{index + 1}</i><div><b>{row.code} · {row.name}</b><span>{String(row.start_time).slice(0, 5)}–{String(row.end_time).slice(0, 5)} · {row.full_day_minutes} full-day minutes</span></div><em className="status active">Active</em><strong>›</strong></button>)}</section></div>}
    {active === "Learning" && <section className="panel worklist operations-list"><div className="panel-head padded"><div><h2>Assignments</h2><p>Completion and certification due dates</p></div></div>{secondary.slice(0, 20).map((row, index) => <button key={row.id} onClick={() => flash(`${row.employee_name}'s ${row.title} assignment opened.`)}><i>{index + 1}</i><div><b>{row.employee_name} · {row.title}</b><span>{row.progress}% complete · due {dateOnly(row.due_date)}</span></div><em className={`status ${statusClass(row.status)}`}>{friendly(row.status)}</em><strong>›</strong></button>)}</section>}
    {active === "Separation" && <section className="panel worklist operations-list"><div className="panel-head padded"><div><h2>Final settlement control</h2><p>Versioned calculation, maker-checker approval, payment evidence and private statement</p></div></div>{secondary.slice(0, 20).map((row, index) => <button key={row.id} onClick={() => settlementAction(row)}><i>{index + 1}</i><div><b>{row.employee_name} · {new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(Number(row.net_payable))}</b><span>Gross {Number(row.gross_payable).toLocaleString("en-IN")} · recoveries {Number(row.recoveries).toLocaleString("en-IN")} · rule {row.rule_code || "—"} v{row.rule_version || "—"}{row.generation_status ? ` · statement ${friendly(row.generation_status).toLowerCase()}` : ""}</span></div><em className={`status ${statusClass(row.document_id ? "issued" : row.status)}`}>{row.document_id ? "Download" : friendly(row.status)}</em><strong>›</strong></button>)}{!secondary.length && <div className="empty-state padded">No final settlement has been calculated.</div>}</section>}
    {modal && <OperationsForm kind={modal} activeHead={businessHeadId} heads={heads} people={people} records={records} secondary={secondary} tertiary={tertiary} onClose={() => setModal(null)} onSaved={() => { setModal(null); setRefresh(value => value + 1); flash("Saved successfully with an audit entry."); }} />}
  </>;
}

function SmallMetric({ label, value, index }: { label: string; value: number; index: number }) {
  const icons = ["◎", "◷", "✓", "!"]; const tones = ["purple", "orange", "green", "blue"];
  return <div className="metric"><div className={`metric-icon ${tones[index]}`}>{icons[index]}</div><span>{label}</span><strong>{Number(value || 0).toLocaleString("en-IN")}</strong><small>Current authorised scope</small></div>;
}

function OperationsForm({ kind, activeHead, heads, people, records, secondary, tertiary, onClose, onSaved }: {
  kind: ModalKind; activeHead: string; heads: BusinessHead[]; people: Person[]; records: any[]; secondary: any[]; tertiary: any[]; onClose: () => void; onSaved: () => void;
}) {
  const [headId, setHeadId] = useState(activeHead === "all" ? heads[0]?.id || "" : activeHead);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => { if (!headId) return; fetch(`/api/departments?businessHeadId=${encodeURIComponent(headId)}`).then(response => response.ok ? response.json() : ({ data: [] })).then(body => setDepartments(body.data || [])); }, [headId]);
  const today = new Date().toISOString().slice(0, 10);
  const titles: Record<ModalKind, string> = { requisition: "Create requisition", candidate: "Add candidate", conversion: "Convert accepted candidate", onboarding: "Start onboarding", "leave-policy": "Create leave policy", shift: "Create work shift", course: "Create learning course", assignment: "Assign learning", case: "Create helpdesk case", separation: "Start separation", "final-settlement": "Calculate final settlement" };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); const form = new FormData(event.currentTarget);
    let endpoint = ""; let payload: any = {};
    if (kind === "requisition") { endpoint = "/api/recruitment/requisitions"; payload = { requisitionCode: form.get("code"), businessHeadId: headId, departmentId: form.get("departmentId") || null, position: form.get("position"), openings: Number(form.get("openings")), employmentType: form.get("employmentType"), budgetMin: form.get("budgetMin") ? Number(form.get("budgetMin")) : null, budgetMax: form.get("budgetMax") ? Number(form.get("budgetMax")) : null, reason: form.get("reason"), targetDate: form.get("targetDate") || null }; }
    if (kind === "candidate") { endpoint = "/api/recruitment/candidates"; payload = { businessHeadId: headId, requisitionId: form.get("requisitionId") || null, fullName: form.get("fullName"), email: form.get("email") || null, phone: form.get("phone") || null, position: form.get("position"), departmentId: form.get("departmentId") || null, source: form.get("source") || null, consented: form.get("consented") === "on" }; }
    if (kind === "conversion") { const offer = tertiary.find(item => item.id === form.get("offerId")); if (!offer) { setError("Select an accepted offer."); setBusy(false); return; } endpoint = `/api/recruitment/candidates/${offer.candidate_id}/convert`; payload = { offerId: offer.id, employeeCode: form.get("employeeCode"), dateJoined: form.get("dateJoined"), probationEndDate: form.get("probationEndDate") || null, workEmail: form.get("workEmail") || null, account: form.get("createAccount") === "on" ? { mode: "new", email: form.get("workEmail"), temporaryPassword: form.get("temporaryPassword") } : { mode: "none" }, onboarding: { templateName: "Standard 90-day onboarding", tasks: [] }, reason: form.get("reason") }; }
    if (kind === "onboarding") { endpoint = "/api/onboarding"; const joining = String(form.get("joiningDate")); payload = { candidateId: form.get("candidateId"), templateName: form.get("templateName"), plannedJoiningDate: joining, tasks: [{ title: "Verify joining documents", category: "HR", dueDate: joining }, { title: "Provision accounts and access", category: "IT", dueDate: joining }, { title: "Prepare induction and 30-60-90 plan", category: "Manager", dueDate: joining }, { title: "Allocate equipment and workspace", category: "Administration", dueDate: joining }, { title: "Validate bank and statutory details", category: "Finance", dueDate: joining }] }; }
    if (kind === "leave-policy") { endpoint = "/api/leave/policies"; payload = { businessHeadId: headId, code: form.get("code"), name: form.get("name"), paid: form.get("paid") === "on", annualEntitlement: Number(form.get("entitlement")), accrualFrequency: form.get("accrual"), carryForwardLimit: Number(form.get("carryForward")), encashable: form.get("encashable") === "on", eligibility: {}, effectiveFrom: form.get("effectiveFrom"), effectiveTo: null }; }
    if (kind === "shift") { endpoint = "/api/shifts"; payload = { businessHeadId: headId, code: form.get("code"), name: form.get("name"), startTime: form.get("startTime"), endTime: form.get("endTime"), breakMinutes: Number(form.get("breakMinutes")), graceMinutes: Number(form.get("graceMinutes")), halfDayMinutes: Number(form.get("halfDayMinutes")), fullDayMinutes: Number(form.get("fullDayMinutes")), crossesMidnight: form.get("crossesMidnight") === "on" }; }
    if (kind === "course") { endpoint = "/api/learning/courses"; payload = { businessHeadId: headId || null, code: form.get("code"), title: form.get("title"), description: form.get("description") || null, mandatory: form.get("mandatory") === "on", validityMonths: form.get("validityMonths") ? Number(form.get("validityMonths")) : null }; }
    if (kind === "assignment") { endpoint = "/api/learning/enrolments"; payload = { courseId: form.get("courseId"), employeeIds: [form.get("employeeId")], dueDate: form.get("dueDate") || null }; }
    if (kind === "case") { endpoint = "/api/helpdesk"; payload = { businessHeadId: headId, employeeId: form.get("employeeId") || null, category: form.get("category"), subject: form.get("subject"), description: form.get("description"), confidential: form.get("confidential") === "on", priority: form.get("priority") }; }
    if (kind === "separation") { endpoint = "/api/separations"; payload = { employeeId: form.get("employeeId"), separationType: form.get("separationType"), submittedDate: form.get("submittedDate"), proposedLastWorkingDate: form.get("lastWorkingDate"), reason: form.get("reason"), noticeDays: Number(form.get("noticeDays")) }; }
    if (kind === "final-settlement") { endpoint = "/api/separations/final-settlements"; const amount = Number(form.get("manualAmount") || 0); payload = { separationId: form.get("separationId"), manualItems: amount > 0 ? [{ code: form.get("manualCode"), label: form.get("manualLabel"), category: form.get("manualCategory"), amount, reason: form.get("manualReason") }] : [], reason: form.get("reason") }; }
    try { const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }); await responseData(response); onSaved(); } catch (submissionError) { setError((submissionError as Error).message); setBusy(false); }
  }

  const headField = <label>Business head<select value={headId} onChange={event => setHeadId(event.target.value)} required>{heads.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;
  const departmentField = <label>Department<select name="departmentId"><option value="">Not assigned</option>{departments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;
  const headPeople = people;
  const acceptedOffers = tertiary.filter(offer => offer.status === "accepted" && secondary.some(candidate => candidate.id === offer.candidate_id && candidate.consented_at));
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="operations-form-title"><div className="modal-head"><div><span className="eyebrow">SECURED WORKFLOW</span><h2 id="operations-form-title">{titles[kind]}</h2></div><button onClick={onClose} aria-label="Close">×</button></div><form className="form-grid" onSubmit={submit}>
    {kind === "requisition" && <>{headField}{departmentField}<label>Requisition code<input name="code" placeholder="REQ-2026-001" required /></label><label>Position<input name="position" required /></label><label>Openings<input name="openings" type="number" min="1" defaultValue="1" required /></label><label>Employment type<select name="employmentType" defaultValue="permanent"><option value="permanent">Permanent</option><option value="fixed_term">Fixed term</option><option value="contract">Contract</option><option value="intern">Intern</option></select></label><label>Minimum annual CTC<input name="budgetMin" type="number" min="0" /></label><label>Maximum annual CTC<input name="budgetMax" type="number" min="0" /></label><label>Target date<input name="targetDate" type="date" /></label><label>Business reason<input name="reason" required /></label></>}
    {kind === "candidate" && <>{headField}{departmentField}<label className="span-two">Requisition<select name="requisitionId"><option value="">General application</option>{records.filter(item => !["completed", "cancelled"].includes(item.status)).map(item => <option key={item.id} value={item.id}>{item.requisition_code} · {item.position}</option>)}</select></label><label>Full name<input name="fullName" required /></label><label>Position<input name="position" required /></label><label>Email<input name="email" type="email" /></label><label>Phone<input name="phone" /></label><label>Source<input name="source" placeholder="Referral, portal, agency…" /></label><label className="check-label"><input name="consented" type="checkbox" /> Candidate consent recorded</label></>}
    {kind === "conversion" && <>{acceptedOffers.length ? <><label className="span-two">Accepted offer<select name="offerId" required>{acceptedOffers.map(offer => <option key={offer.id} value={offer.id}>{offer.candidate_name} · {offer.offer_number} · joins {dateOnly(offer.proposed_joining_date)}</option>)}</select></label><label>Employee code<input name="employeeCode" required /></label><label>Date joined<input name="dateJoined" type="date" required /></label><label>Probation ends<input name="probationEndDate" type="date" /></label><label>Work email<input name="workEmail" type="email" /></label><label className="check-label"><input name="createAccount" type="checkbox" /> Create employee login</label><label>Temporary password<input name="temporaryPassword" type="password" minLength={12} /></label><label className="span-two">Conversion reason<input name="reason" defaultValue="Accepted offer converted to employee after identity and consent checks" required /></label></> : <div className="form-error span-two">No consented candidate with an accepted offer is ready to convert.</div>}</>}
    {kind === "onboarding" && <><label className="span-two">Hired candidate<select name="candidateId" required>{secondary.map(item => <option key={item.id} value={item.id}>{item.full_name} · {item.position}</option>)}</select></label><label>Template<input name="templateName" defaultValue="Standard 90-day onboarding" required /></label><label>Planned joining date<input name="joiningDate" type="date" required /></label><div className="form-hint span-two">HR, manager, IT, administration and finance tasks will be created automatically.</div></>}
    {kind === "leave-policy" && <>{headField}<label>Policy code<input name="code" placeholder="CL" required /></label><label>Policy name<input name="name" placeholder="Casual Leave" required /></label><label>Annual entitlement<input name="entitlement" type="number" min="0" step="0.5" defaultValue="12" required /></label><label>Accrual<select name="accrual" defaultValue="monthly"><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option><option value="none">No automatic accrual</option></select></label><label>Carry-forward limit<input name="carryForward" type="number" min="0" step="0.5" defaultValue="0" required /></label><label>Effective from<input name="effectiveFrom" type="date" defaultValue={today} required /></label><label className="check-label"><input name="paid" type="checkbox" defaultChecked /> Paid leave</label><label className="check-label"><input name="encashable" type="checkbox" /> Encashable</label></>}
    {kind === "shift" && <>{headField}<label>Shift code<input name="code" placeholder="GEN" required /></label><label>Shift name<input name="name" placeholder="General shift" required /></label><label>Starts<input name="startTime" type="time" defaultValue="09:00" required /></label><label>Ends<input name="endTime" type="time" defaultValue="18:00" required /></label><label>Break minutes<input name="breakMinutes" type="number" min="0" defaultValue="60" required /></label><label>Grace minutes<input name="graceMinutes" type="number" min="0" defaultValue="15" required /></label><label>Half-day minutes<input name="halfDayMinutes" type="number" min="1" defaultValue="240" required /></label><label>Full-day minutes<input name="fullDayMinutes" type="number" min="1" defaultValue="480" required /></label><label className="check-label"><input name="crossesMidnight" type="checkbox" /> Crosses midnight</label></>}
    {kind === "course" && <>{headField}<label>Course code<input name="code" placeholder="POSH-2026" required /></label><label className="span-two">Course title<input name="title" required /></label><label className="span-two">Description<input name="description" /></label><label>Certificate validity (months)<input name="validityMonths" type="number" min="1" /></label><label className="check-label"><input name="mandatory" type="checkbox" /> Mandatory learning</label></>}
    {kind === "assignment" && <><label className="span-two">Course<select name="courseId" required>{records.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label>Employee<select name="employeeId" required>{headPeople.map(item => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</select></label><label>Due date<input name="dueDate" type="date" /></label></>}
    {kind === "case" && <>{headField}<label>Employee (optional)<select name="employeeId"><option value="">Organisation-wide</option>{headPeople.map(item => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</select></label><label>Category<input name="category" placeholder="Payroll, policy, workplace…" required /></label><label>Priority<select name="priority" defaultValue="normal"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><label className="span-two">Subject<input name="subject" required /></label><label className="span-two">Description<input name="description" required /></label><label className="check-label"><input name="confidential" type="checkbox" /> Confidential HR case</label></>}
    {kind === "separation" && <><label className="span-two">Employee<select name="employeeId" required>{headPeople.map(item => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</select></label><label>Separation type<select name="separationType" defaultValue="resignation"><option value="resignation">Resignation</option><option value="termination">Termination</option><option value="retirement">Retirement</option><option value="contract_completion">Contract completion</option><option value="abandonment">Abandonment</option></select></label><label>Notice days<input name="noticeDays" type="number" min="0" defaultValue="30" required /></label><label>Submitted date<input name="submittedDate" type="date" defaultValue={today} required /></label><label>Proposed last working date<input name="lastWorkingDate" type="date" required /></label><label className="span-two">Reason<input name="reason" required /></label></>}
    {kind === "final-settlement" && <><label className="span-two">Approved separation<select name="separationId" required>{records.filter(item => ["approved", "completed"].includes(item.status)).map(item => <option key={item.id} value={item.id}>{item.employee_name} · last day {dateOnly(item.approved_last_working_date || item.proposed_last_working_date)}</option>)}</select></label><div className="form-hint span-two">Salary, encashable leave, notice recovery, gratuity and loans are calculated from locked, approved source records and the effective FINAL_SETTLEMENT rule version.</div><label>Optional manual item code<input name="manualCode" placeholder="BONUS_ADJUSTMENT" /></label><label>Item label<input name="manualLabel" placeholder="Approved bonus adjustment" /></label><label>Category<select name="manualCategory" defaultValue="earning"><option value="earning">Earning</option><option value="recovery">Recovery</option></select></label><label>Amount<input name="manualAmount" type="number" min="0" step="0.01" defaultValue="0" /></label><label className="span-two">Manual item reason<input name="manualReason" placeholder="Required only when an amount is entered" /></label><label className="span-two">Calculation reason<input name="reason" defaultValue="Final settlement calculated from locked attendance and approved effective rules" required /></label></>}
    {error && <div className="form-error span-two">{error}</div>}<div className="modal-actions span-two"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy || (kind === "conversion" && !acceptedOffers.length)}>{busy ? "Saving…" : "Save and continue"}</button></div>
  </form></section></div>;
}
