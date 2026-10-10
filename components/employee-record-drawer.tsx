"use client";
/* Employee record payloads are permission-shaped by the server. */
/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmployeePhoto } from "@/components/employee-photo";
import { countLabel } from "@/lib/company-correction-rules";

type DirectoryPerson = {
  id: string;
  name: string;
  code: string;
  businessHeadId: string;
  departmentId: string | null;
};

const DOCUMENT_CATEGORIES: [string, string][] = [["identity", "Identity proof"], ["address_proof", "Address proof"], ["education", "Education certificate"], ["experience", "Previous employment"], ["contract", "Contract or offer letter"], ["bank", "Bank details"], ["tax", "Tax"], ["health", "Health"], ["background_check", "Background check"], ["other", "Other"]];
type Tab = "employment" | "personal" | "pay" | "growth" | "letters" | "documents" | "timeline";
type FormKind = "employment" | "personal" | "emergency" | "sensitive" | "compensation" | "skill" | "plan" | "letter" | "delete";

const friendly = (value: unknown) => String(value || "—").replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
const dateOnly = (value: unknown) => value ? String(value).slice(0, 10) : "—";
const money = (value: unknown) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value || 0));

async function requiredData(response: Response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message || "The employee record action could not be completed.");
  return body?.data;
}

async function optionalData(path: string) {
  const response = await fetch(path);
  if ([401, 403, 404].includes(response.status)) return null;
  return requiredData(response);
}

export function EmployeeRecordDrawer({ person, people, heads = [], canChangeCompany = false, onClose, onChanged, onDeleted, onRestored, onMoved, onPhotoChanged, flash }: {
  person: DirectoryPerson;
  people: DirectoryPerson[];
  heads?: { id: string; name: string }[];
  canChangeCompany?: boolean;
  onMoved?: () => void;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
  onRestored?: () => void;
  onPhotoChanged?: () => void;
  flash: (message: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("employment");
  const [form, setForm] = useState<FormKind | null>(null);
  const [busy, setBusy] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [record, setRecord] = useState<any>(null);
  const [personal, setPersonal] = useState<any>(null);
  const [emergency, setEmergency] = useState<any>(null);
  const [sensitive, setSensitive] = useState<any>(null);
  const [skills, setSkills] = useState<any[] | null>(null);
  const [catalogue, setCatalogue] = useState<any[] | null>(null);
  const [plans, setPlans] = useState<any[] | null>(null);
  const [cycles, setCycles] = useState<any[] | null>(null);
  const [letters, setLetters] = useState<any[] | null>(null);
  const [departments, setDepartments] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[] | null>(null);
  const [docBusy, setDocBusy] = useState(false);
  const [docCategory, setDocCategory] = useState("");
  const [docExpiry, setDocExpiry] = useState("");
  const docInput = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [companyOpen, setCompanyOpen] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const photoChanged = useRef(false);
  const closeRecord = useCallback(() => { onClose(); if (photoChanged.current) onPhotoChanged?.(); }, [onClose, onPhotoChanged]);

  const load = useCallback(async () => {
    setBusy(true);
    const head = encodeURIComponent(person.businessHeadId);
    const employee = encodeURIComponent(person.id);
    try {
      const results = await Promise.all([
        optionalData(`/api/employees/${employee}`),
        optionalData(`/api/employees/${employee}/personal-details`),
        optionalData(`/api/employees/${employee}/emergency-contacts`),
        optionalData(`/api/employees/${employee}/sensitive`),
        optionalData(`/api/employees/${employee}/skills`),
        optionalData(`/api/skills/catalogue?businessHeadId=${head}`),
        optionalData(`/api/development-plans?businessHeadId=${head}&employeeId=${employee}`),
        optionalData(`/api/performance/cycles?businessHeadId=${head}`),
        optionalData(`/api/employee-letters?businessHeadId=${head}&employeeId=${employee}`),
        optionalData(`/api/departments?businessHeadId=${head}`),
        optionalData(`/api/documents?employeeId=${employee}`),
      ]);
      setRecord(results[0]); setPersonal(results[1]); setEmergency(results[2]); setSensitive(results[3]);
      setSkills(results[4]); setCatalogue(results[5]); setPlans(results[6]); setCycles(results[7]); setLetters(results[8]);
      setDepartments(results[9] || []); setDocuments(results[10]);
    } catch (error) {
      flash((error as Error).message);
    } finally {
      setBusy(false);
    }
  }, [person.id, person.businessHeadId, flash]);

  useEffect(() => { load(); }, [load, refresh]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !form) closeRecord(); };
    document.addEventListener("keydown", escape); return () => document.removeEventListener("keydown", escape);
  }, [form, closeRecord]);

  const employee = record?.employee;
  const initials = person.name.split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase();
  const completion = useMemo(() => {
    if (!employee) return 0;
    const checks = [employee.department_id, employee.reporting_manager_id, employee.grade, employee.work_email, employee.probation_end_date || employee.confirmation_date, personal?.completion?.personalDetails || personal?.personalDetails, emergency?.contacts?.length, sensitive?.bankDetails, sensitive?.statutoryDetails];
    return Math.round(checks.filter(Boolean).length / checks.length * 100);
  }, [employee, personal, emergency, sensitive]);

  async function uploadDocument(file: File | undefined) {
    if (!file) return;
    if (!docCategory) { if (docInput.current) docInput.current.value = ""; return flash("Choose what kind of document this is first."); }
    setDocBusy(true);
    try {
      const body = new FormData(); body.set("file", file); body.set("category", docCategory); body.set("expiresOn", docExpiry);
      await requiredData(await fetch(`/api/employees/${encodeURIComponent(person.id)}/documents`, { method: "POST", body }));
      setDocCategory(""); setDocExpiry(""); setRefresh(value => value + 1); flash("Document uploaded.");
    } catch (error) { flash((error as Error).message); }
    finally { setDocBusy(false); if (docInput.current) docInput.current.value = ""; }
  }

  async function openDocument(doc: any) {
    try {
      const result = await requiredData(await fetch(`/api/documents/${doc.id}/download`));
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (error) { flash((error as Error).message); }
  }

  async function restoreEmployee() {
    const reason = window.prompt("Reason for restoring this employee to People:", "Employee was removed by mistake");
    if (!reason) return;
    try {
      await requiredData(await fetch(`/api/employees/${encodeURIComponent(person.id)}/restore`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) }));
      flash("Employee restored to People."); onRestored?.();
    } catch (error) { flash((error as Error).message); }
  }

  async function changePhoto(file: File | undefined, remove = false) {
    if (!remove && !file) return;
    setPhotoBusy(true);
    try {
      const url = `/api/employees/${encodeURIComponent(person.id)}/photo`;
      if (remove) await requiredData(await fetch(url, { method: "DELETE" }));
      else { const body = new FormData(); body.set("photo", file!); await requiredData(await fetch(url, { method: "POST", body })); }
      photoChanged.current = true; setRefresh(value => value + 1); flash(remove ? "Photo removed." : "Photo saved.");
    } catch (error) { flash((error as Error).message); }
    finally { setPhotoBusy(false); if (photoInput.current) photoInput.current.value = ""; }
  }

  async function decideLetter(letter: any) {
    if (letter.status !== "pending") return flash(`This letter is already ${friendly(letter.status).toLowerCase()}.`);
    const decision = window.confirm(`Approve the ${friendly(letter.letter_type).toLowerCase()} letter?`) ? "approve" : "reject";
    const reason = window.prompt(`Reason to ${decision} this letter:`, decision === "approve" ? "Employee record and effective date verified" : "Letter request needs correction");
    if (!reason) return;
    try {
      await requiredData(await fetch(`/api/employee-letters/${letter.id}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, reason }) }));
      setRefresh(value => value + 1); flash(`Letter ${decision}d.`);
    } catch (error) { flash((error as Error).message); }
  }

  async function decidePlan(plan: any) {
    const action = ["draft", "rejected"].includes(plan.status) ? "submit" : plan.status === "pending" ? "approve" : plan.status === "approved" ? "complete" : null;
    if (!action) return flash(`This plan is ${friendly(plan.status).toLowerCase()}.`);
    const reason = window.prompt(`Reason to ${action} this development plan:`, action === "approve" ? "Development actions and ownership verified" : "Development plan progressed");
    if (!reason) return;
    try {
      await requiredData(await fetch(`/api/development-plans/${plan.id}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, reason }) }));
      setRefresh(value => value + 1); flash(`Development plan ${friendly(action).toLowerCase()}d.`);
    } catch (error) { flash((error as Error).message); }
  }

  async function downloadLetter(letter: any) {
    if (!letter.document_id) return decideLetter(letter);
    try {
      const result = await requiredData(await fetch(`/api/documents/${letter.document_id}/download`));
      window.open(result.url, "_blank", "noopener,noreferrer"); flash("A private five-minute download link was opened.");
    } catch (error) { flash((error as Error).message); }
  }

  return <div className="record-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !form) closeRecord(); }}>
    <section className="employee-record" role="dialog" aria-modal="true" aria-label={`${person.name} employee record`}>
      <header className="record-header">
        <button className="record-close" onClick={closeRecord} aria-label="Close employee record">×</button>
        <div className="record-identity"><div className="record-photo"><EmployeePhoto id={person.id} version={employee?.photo_updated_at} initials={initials} className="record-avatar" /><input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={event => changePhoto(event.target.files?.[0])} /><div className="record-photo-actions"><button type="button" disabled={photoBusy || !employee} onClick={() => photoInput.current?.click()}>{photoBusy ? "Saving…" : employee?.photo_updated_at ? "Change photo" : "Add photo"}</button>{employee?.photo_updated_at && <button type="button" disabled={photoBusy} onClick={() => changePhoto(undefined, true)}>Remove</button>}</div></div><div><span className="eyebrow">EMPLOYEE RECORD · {person.code}</span><h2>{employee ? [employee.first_name, employee.last_name].filter(Boolean).join(" ") : person.name}</h2><p>{employee?.position || "Loading…"} · {employee?.department || employee?.business_head || "Velite"}</p></div></div>
        <div className="record-summary"><div><span>Record complete</span><strong>{completion}%</strong></div><i><b style={{ width: `${completion}%` }} /></i><em className={`status ${String(employee?.status || "active").replaceAll("_", "-")}`}>{friendly(employee?.status || "active")}</em></div>
      </header>
      <nav className="record-tabs" aria-label="Employee record sections">
        {(["employment", "personal", "pay", "growth", "letters", "documents", "timeline"] as Tab[]).map(item => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item === "pay" ? "Pay, PF & bank" : item === "growth" ? "Growth & skills" : item === "timeline" ? "History" : friendly(item)}</button>)}
      </nav>
      <div className="record-body">
        {busy ? <div className="record-loading">Loading the secured employee record…</div> : !employee ? <div className="record-loading">This record is not available in your authorised scope.</div> : <>
          {tab === "employment" && <div className="record-grid">
            <RecordCard title="Employment" action="Edit employment" onAction={() => setForm("employment")}><DefinitionGrid values={[
              ["Employee code", employee.employee_code], ["Business head", employee.business_head], ["Department", employee.department], ["Position", employee.position], ["Parent / spouse", employee.guardian_name], ["Grade", employee.grade], ["Employment type", friendly(employee.employment_type)], ["Reporting manager", employee.reporting_manager], ["Work location", employee.work_location || employee.work_location_name],
            ]} /></RecordCard>
            <RecordCard title="Lifecycle dates" subtitle="Drives reminders in the HR calendar"><DefinitionGrid values={[
              ["Date joined", dateOnly(employee.date_joined)], ["Probation end", dateOnly(employee.probation_end_date)], ["Confirmation", dateOnly(employee.confirmation_date)], ["Next salary revision", dateOnly(employee.next_salary_revision_date)], ["Notice started", dateOnly(employee.notice_start_date)], ["Last working day", dateOnly(employee.last_working_date)],
            ]} /></RecordCard>
            <RecordCard title="Work contact"><DefinitionGrid values={[["Work email", employee.work_email], ["Work phone", employee.phone], ["Record created", dateOnly(employee.created_at)], ["Last updated", dateOnly(employee.updated_at)]]} /></RecordCard>
            {canChangeCompany && employee.status !== "archived" && <RecordCard title="Company" subtitle={`Currently ${employee.business_head}`} action="Change company" onAction={() => setCompanyOpen(true)}><Unavailable text="Use this only to correct a company entered by mistake. Attendance and other personal records move with the person." /></RecordCard>}
            {employee.status === "archived" ? <RecordCard title="Restore to People" subtitle="This employee was removed from People. Restoring brings them back to the staff list with their earlier status." action="Restore employee" onAction={restoreEmployee}><Unavailable text="Payroll, attendance and audit history were kept. Anyone who reported to this person will need a new reporting manager. This action is audited." /></RecordCard> : <RecordCard title="Remove from People" subtitle="Hides the employee from active directories while preserving payroll, attendance and audit history" action="Delete employee" danger onAction={() => setForm("delete")}><Unavailable text="Use this only when an employee record should no longer appear in People. This action is audited." /></RecordCard>}
          </div>}
          {tab === "personal" && <div className="record-grid">
            <RecordCard title="Personal details" action={personal ? "Edit details" : undefined} onAction={() => setForm("personal")}>
              {personal ? <DefinitionGrid values={[["Personal email", personal.personalEmail], ["Phone", personal.phone], ["Preferred name", personal.personalDetails?.preferredName], ["Date of birth", dateOnly(personal.personalDetails?.dateOfBirth)], ["Blood group", personal.personalDetails?.bloodGroup], ["Nationality", personal.personalDetails?.nationality], ["Address", personal.personalDetails?.address ? [personal.personalDetails.address.line1, personal.personalDetails.address.city, personal.personalDetails.address.state, personal.personalDetails.address.postalCode].filter(Boolean).join(", ") : null]]} /> : <Unavailable text="Personal details are protected for this role." />}
            </RecordCard>
            <RecordCard title="Emergency contacts" action={emergency ? "Add contact" : undefined} onAction={() => setForm("emergency")}>
              {emergency ? <div className="record-list">{(emergency.contacts || []).map((contact: any) => <div key={contact.id}><span>{contact.priority}</span><div><strong>{contact.fullName}</strong><small>{contact.relationship || "Emergency contact"} · {contact.phone}</small></div></div>)}{!emergency.contacts?.length && <Unavailable text="No emergency contacts have been recorded." />}</div> : <Unavailable text="Emergency contacts are not available for this role." />}
            </RecordCard>
          </div>}
          {tab === "pay" && <div className="record-grid">
            <RecordCard title="Compensation history" action={record.fieldAccess?.compensation ? "Add revision" : undefined} onAction={() => setForm("compensation")}>
              {record.fieldAccess?.compensation ? <div className="record-list financial">{(record.compensation || []).map((item: any) => <div key={item.id}><span>₹</span><div><strong>{money(item.monthly_gross)} monthly gross</strong><small>{money(item.annual_ctc)} annual CTC · {dateOnly(item.effective_from)} to {dateOnly(item.effective_to)}</small></div></div>)}{!record.compensation?.length && <Unavailable text="No effective compensation has been recorded." />}</div> : <Unavailable text="Compensation is hidden because this role does not have payroll access." />}
            </RecordCard>
            <RecordCard title="Imported salary registers" subtitle="Attendance, dues, deductions and net payable from verified source sheets">
              {record.fieldAccess?.compensation ? <div className="record-list financial">{(record.salaryRegisterLines || []).map((item: any) => <div key={item.id}><span>₹</span><div><strong>{money(item.net_payable)} net payable</strong><small>{dateOnly(item.period_month).slice(0, 7)} · {item.attendance_days} attendance days · {money(item.total_dues)} dues · {money(item.total_deductions)} deductions · {friendly(item.register_type)}</small></div></div>)}{!record.salaryRegisterLines?.length && <Unavailable text="No salary-register rows have been imported." />}</div> : <Unavailable text="Salary registers are hidden because this role does not have payroll access." />}
            </RecordCard>
            <RecordCard title="Bank & statutory" action={sensitive ? "Update protected fields" : undefined} onAction={() => setForm("sensitive")}>
              {sensitive ? <><DefinitionGrid values={[["Account holder", sensitive.bankDetails?.accountHolder], ["Bank", sensitive.bankDetails?.bankName], ["Account", sensitive.bankDetails?.accountNumber], ["IFSC", sensitive.bankDetails?.ifsc]]} /><div className="statutory-chips">{Object.entries(sensitive.statutoryDetails || {}).map(([key, value]) => <span key={key}><b>{friendly(key)}</b>{String(value)}</span>)}</div></> : <Unavailable text="Bank and statutory data is protected for this role." />}
            </RecordCard>
          </div>}
          {tab === "growth" && <div className="record-grid">
            <RecordCard title="Skills & proficiency" action={skills && catalogue ? "Assess skill" : undefined} onAction={() => setForm("skill")}>
              {skills ? <div className="skill-list">{skills.map(skill => <div key={skill.id}><div><strong>{skill.name}</strong><small>{skill.category || skill.code} · target {skill.target_proficiency ?? "—"}/5</small></div><div className="skill-level" aria-label={`${skill.proficiency || 0} of 5`}>{[1, 2, 3, 4, 5].map(level => <i className={level <= Number(skill.proficiency || 0) ? "filled" : ""} key={level} />)}</div></div>)}{!skills.length && <Unavailable text="No skills have been assessed." />}</div> : <Unavailable text="Skills require learning access." />}
            </RecordCard>
            <RecordCard title="Development plans" action={plans ? "Create plan" : undefined} onAction={() => setForm("plan")}>
              {plans ? <div className="record-list plans">{plans.map(plan => <button key={plan.id} onClick={() => decidePlan(plan)}><span>☆</span><div><strong>{plan.title}</strong><small>{plan.actions?.length || 0} action(s) · due {dateOnly(plan.due_date)} · {plan.owner_name || "Owner pending"}</small></div><em className={`status ${String(plan.status).replaceAll("_", "-")}`}>{friendly(plan.status)}</em></button>)}{!plans.length && <Unavailable text="No development plans have been created." />}</div> : <Unavailable text="Development plans require performance access." />}
            </RecordCard>
          </div>}
          {tab === "letters" && <RecordCard title="Employee letters" subtitle="Snapshot-based, independently approved and privately generated" action={letters ? "Request letter" : undefined} onAction={() => setForm("letter")}>
            {letters ? <div className="record-list letters">{letters.map(letter => <button key={letter.id} onClick={() => downloadLetter(letter)}><span>▤</span><div><strong>{friendly(letter.letter_type)}</strong><small>Effective {dateOnly(letter.effective_date)} · template {letter.template_version} · requested by {letter.requested_by_name}</small></div><em className={`status ${String(letter.status).replaceAll("_", "-")}`}>{letter.document_id ? "Download" : friendly(letter.generation_status || letter.status)}</em></button>)}{!letters.length && <Unavailable text="No employee letters have been requested." />}</div> : <Unavailable text="Letters are not available for this role." />}
          </RecordCard>}
          {tab === "documents" && <RecordCard title="Documents" subtitle="Private files. Each one is virus-checked before it can be opened.">
            {documents ? <>
              <div className="doc-upload"><select value={docCategory} onChange={event => setDocCategory(event.target.value)} aria-label="Document type"><option value="">What kind of document?</option>{DOCUMENT_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><label>Expires on (optional)<input type="date" value={docExpiry} onChange={event => setDocExpiry(event.target.value)} /></label><input ref={docInput} type="file" hidden accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp" onChange={event => uploadDocument(event.target.files?.[0])} /><button type="button" disabled={docBusy} onClick={() => docInput.current?.click()}>{docBusy ? "Uploading…" : "Choose file and upload"}</button></div>
              {documents.length ? <div className="record-list">{documents.map((doc: any) => <button key={doc.id} onClick={() => openDocument(doc)}><span>▤</span><div><strong>{doc.file_name}</strong><small>{friendly(doc.category)} · {(Number(doc.size_bytes) / 1024 / 1024).toFixed(1)} MB · added {String(doc.created_at).slice(0, 10)}{doc.expires_on ? ` · expires ${String(doc.expires_on).slice(0, 10)}` : ""}</small></div><em className={`status ${doc.scan_status === "clean" ? "approved" : doc.scan_status === "infected" ? "rejected" : "pending"}`}>{doc.scan_status === "clean" ? "Checked" : doc.scan_status === "infected" ? "Blocked" : "Awaiting check"}</em></button>)}</div> : <div className="record-empty">No documents yet.</div>}
            </> : <div className="record-empty">You do not have access to this employee's documents.</div>}
          </RecordCard>}
          {tab === "timeline" && <RecordCard title="Employment timeline" subtitle="Dated employee events cannot be silently overwritten"><div className="timeline-list">{(record.events || []).map((event: any) => <div key={event.id}><i /><span>{dateOnly(event.effective_date)}</span><div><strong>{friendly(event.event_type)}</strong><p>{event.reason}</p><small>Recorded by {event.created_by_name} · {new Date(event.created_at).toLocaleString("en-IN")}</small></div></div>)}{!record.events?.length && <Unavailable text="No employee events have been recorded yet." />}</div></RecordCard>}
        </>}
      </div>
    </section>
    {companyOpen && employee && <ChangeCompanyModal employeeId={person.id} name={[employee.first_name, employee.last_name].filter(Boolean).join(" ")} current={employee.business_head} currentId={employee.business_head_id} heads={heads} onClose={() => setCompanyOpen(false)} onMoved={() => { setCompanyOpen(false); flash("Company corrected."); onMoved?.(); }} />}
    {form && employee && <EmployeeRecordForm kind={form} employee={employee} personal={personal} sensitive={sensitive} catalogue={catalogue || []} cycles={cycles || []} people={people} departments={departments} onClose={() => setForm(null)} onSaved={() => { const removed=form === "delete"; setForm(null); if(removed){flash("Employee removed from People. Historical HR records were preserved.");onDeleted();return;} setRefresh(value => value + 1); onChanged(); flash("Saved."); }} />}
  </div>;
}

type MovePreview = { from: string; to: string; moves: { label: string; count: number }[]; blocked: string[]; warnings: string[]; canMove: boolean; cleared: { department: { was: string; now: string | null } | null; reportingManager: boolean; directReports: number; companyDetails: boolean } };

function ChangeCompanyModal({ employeeId, name, current, currentId, heads, onClose, onMoved }: { employeeId: string; name: string; current: string; currentId: string; heads: { id: string; name: string }[]; onClose: () => void; onMoved: () => void }) {
  const [target, setTarget] = useState("");
  const [preview, setPreview] = useState<MovePreview | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const options = heads.filter(head => head.id !== currentId);
  async function call(body: object) {
    const response = await fetch(`/api/employees/${encodeURIComponent(employeeId)}/company`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return requiredData(response);
  }
  async function choose(id: string) {
    setTarget(id); setPreview(null); setError("");
    if (!id) return;
    try { setPreview(await call({ businessHeadId: id, reason: "Preview of a company correction", dryRun: true })); }
    catch (problem) { setError((problem as Error).message); }
  }
  async function submit() {
    setBusy(true); setError("");
    try { await call({ businessHeadId: target, reason }); onMoved(); }
    catch (problem) { setError((problem as Error).message); setBusy(false); }
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="change-company-title">
    <div className="modal-head"><div><span className="eyebrow">{name}</span><h2 id="change-company-title">Change company</h2></div><button onClick={onClose} aria-label="Close">×</button></div>
    <div className="form-grid">
      <p className="span-two">Currently in <b>{current}</b>. Use this only to correct a company that was entered by mistake. Their history moves with them, as if they had always been in the new company.</p>
      <label className="span-two">Move to<select value={target} onChange={event => choose(event.target.value)}><option value="">Choose the correct company…</option>{options.map(head => <option key={head.id} value={head.id}>{head.name}</option>)}</select></label>
      {preview && <div className="span-two company-preview">
        {preview.moves.length ? <p><b>Moves with {name}:</b> {preview.moves.map(item => countLabel(item.count, item.label)).join(", ")}.</p> : <p><b>Moves with {name}:</b> nothing recorded yet.</p>}
        <p><b>Set again after the move:</b> {[preview.cleared.department ? `department (${preview.cleared.department.was}${preview.cleared.department.now ? ` → ${preview.cleared.department.now}` : " → none, choose again"})` : null, preview.cleared.reportingManager ? "reporting manager" : null, preview.cleared.companyDetails ? "legal entity, work location, cost centre, job position" : null, preview.cleared.directReports ? `${preview.cleared.directReports} people who report to them will have no manager` : null].filter(Boolean).join("; ") || "nothing"}.</p>
        {preview.warnings.map(item => <p key={item} className="company-warning">{item}</p>)}
        {preview.blocked.length > 0 && <div className="form-error">This cannot be done automatically: {preview.blocked.join("; ")}.</div>}
      </div>}
      {preview?.canMove && <label className="span-two">Reason<input value={reason} onChange={event => setReason(event.target.value)} placeholder="For example Entered under the wrong company by mistake" /></label>}
      {error && <div className="form-error span-two">{error}</div>}
      <div className="modal-actions span-two"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !preview?.canMove || reason.trim().length < 5} onClick={submit}>{busy ? "Moving…" : `Move to ${options.find(head => head.id === target)?.name || "…"}`}</button></div>
    </div>
  </section></div>;
}

function RecordCard({ title, subtitle, action, danger, onAction, children }: { title: string; subtitle?: string; action?: string; danger?: boolean; onAction?: () => void; children: React.ReactNode }) {
  return <section className="record-card"><header><div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>{action && <button className={danger ? "danger" : ""} onClick={onAction}>{action}</button>}</header>{children}</section>;
}

function DefinitionGrid({ values }: { values: [string, unknown][] }) {
  return <dl className="definition-grid">{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value === null || value === undefined || value === "" || value === "—" ? "Not recorded" : String(value)}</dd></div>)}</dl>;
}

function Unavailable({ text }: { text: string }) { return <div className="record-empty">{text}</div>; }

function EmployeeRecordForm({ kind, employee, personal, sensitive, catalogue, cycles, people, departments, onClose, onSaved }: {
  kind: FormKind; employee: any; personal: any; sensitive: any; catalogue: any[]; cycles: any[]; people: DirectoryPerson[]; departments: any[]; onClose: () => void; onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const titles: Record<FormKind, string> = { employment: "Update employment", personal: "Update personal details", emergency: "Add emergency contact", sensitive: "Update bank & statutory data", compensation: "Create compensation revision", skill: "Assess employee skill", plan: "Create development plan", letter: "Request employee letter", delete: "Delete employee from People" };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); const data = new FormData(event.currentTarget); let path = ""; let method = "POST"; let payload: any = {};
    if (kind === "employment") { path = `/api/employees/${employee.id}`; method = "PATCH"; payload = { position: data.get("position"), guardianName: data.get("guardianName") || null, dateJoined: data.get("dateJoined"), departmentId: data.get("departmentId") || null, reportingManagerId: data.get("reportingManagerId") || null, grade: data.get("grade") || null, workLocation: data.get("workLocation") || null, workEmail: data.get("workEmail") || null, phone: data.get("phone") || null, status: data.get("status"), probationEndDate: data.get("probationEndDate") || null, confirmationDate: data.get("confirmationDate") || null, nextSalaryRevisionDate: data.get("nextSalaryRevisionDate") || null, effectiveDate: data.get("effectiveDate"), reason: data.get("reason") }; }
    if (kind === "personal") { path = `/api/employees/${employee.id}/personal-details`; method = "PATCH"; const addressPresent = data.get("addressLine1"); payload = { personalEmail: data.get("personalEmail") || null, phone: data.get("phone") || null, personalDetails: { preferredName: data.get("preferredName") || null, dateOfBirth: data.get("dateOfBirth") || null, gender: data.get("gender") || null, maritalStatus: data.get("maritalStatus") || null, nationality: data.get("nationality") || null, bloodGroup: data.get("bloodGroup") || null, ...(addressPresent ? { address: { line1: data.get("addressLine1"), line2: data.get("addressLine2") || null, city: data.get("city"), state: data.get("state"), postalCode: data.get("postalCode"), country: "India" } } : {}) }, reason: data.get("reason") }; }
    if (kind === "emergency") { path = `/api/employees/${employee.id}/emergency-contacts`; payload = { fullName: data.get("fullName"), relationship: data.get("relationship") || null, phone: data.get("phone"), priority: Number(data.get("priority")), reason: data.get("reason") }; }
    if (kind === "sensitive") { path = `/api/employees/${employee.id}/sensitive`; method = "PATCH"; const account = data.get("accountNumber"); const uan = data.get("uan"); const esi = data.get("esi"); const pan = data.get("pan"); payload = { ...(account ? { bankDetails: { accountHolder: data.get("accountHolder"), bankName: data.get("bankName"), accountNumber: account, ifsc: data.get("ifsc") } } : {}), ...((uan || esi || pan) ? { statutoryDetails: { ...(uan ? { UAN: uan } : {}), ...(esi ? { ESI: esi } : {}), ...(pan ? { PAN: pan } : {}) } } : {}), reason: data.get("reason") }; }
    if (kind === "compensation") { path = `/api/employees/${employee.id}/compensation`; const monthlyGross = Number(data.get("monthlyGross")); payload = { effectiveFrom: data.get("effectiveFrom"), annualCtc: Number(data.get("annualCtc")), monthlyGross, structure: { basic: Number(data.get("basic")), allowances: Number(data.get("allowances")), overtimeRate: Number(data.get("overtimeRate") || 0), divisorDays: Number(data.get("divisorDays") || 30) }, reason: data.get("reason"), nextSalaryRevisionDate: data.get("nextSalaryRevisionDate") || null }; }
    if (kind === "skill") { path = `/api/employees/${employee.id}/skills`; payload = { skillId: data.get("skillId"), proficiency: Number(data.get("proficiency")), targetProficiency: Number(data.get("targetProficiency")), evidence: data.get("evidence") || null, reason: data.get("reason") }; }
    if (kind === "plan") { path = "/api/development-plans"; const actionTitle = String(data.get("actionTitle") || ""); payload = { employeeId: employee.id, cycleId: data.get("cycleId") || null, title: data.get("title"), actions: actionTitle ? [{ id: `action-${Date.now()}`, title: actionTitle, description: data.get("actionDescription") || null, type: data.get("actionType"), dueDate: data.get("actionDueDate") || null, status: "not_started" }] : [], dueDate: data.get("dueDate") || null, submit: data.get("submit") === "on", reason: data.get("reason") }; }
    if (kind === "letter") { path = "/api/employee-letters"; payload = { employeeId: employee.id, letterType: data.get("letterType"), templateVersion: data.get("templateVersion"), effectiveDate: data.get("effectiveDate"), reason: data.get("reason") }; }
    if (kind === "delete") { path = `/api/employees/${employee.id}`; method = "DELETE"; payload = { confirmationCode: data.get("confirmationCode"), reason: data.get("reason") }; }
    try { await requiredData(await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })); onSaved(); } catch (submissionError) { setError((submissionError as Error).message); setBusy(false); }
  }
  const pd = personal?.personalDetails || {}; const address = pd.address || {}; const today = new Date().toISOString().slice(0, 10);
  return <div className="modal-backdrop record-form-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="modal employee-form-modal" role="dialog" aria-modal="true"><div className="modal-head"><div><span className="eyebrow">Staff record</span><h2>{titles[kind]}</h2></div><button onClick={onClose} aria-label="Close">×</button></div><form className="form-grid" onSubmit={submit}>
    {kind === "employment" && <><label>Position<input name="position" defaultValue={employee.position || ""} required /></label><label>Parent / spouse<input name="guardianName" defaultValue={employee.guardian_name || ""} /></label><label>Date joined<input name="dateJoined" type="date" defaultValue={dateOnly(employee.date_joined)} required /></label><label>Department<select name="departmentId" defaultValue={employee.department_id || ""}><option value="">Not assigned</option>{departments.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Reporting manager<select name="reportingManagerId" defaultValue={employee.reporting_manager_id || ""}><option value="">Not assigned</option>{people.filter(item => item.id !== employee.id && item.businessHeadId === employee.business_head_id).map(item => <option value={item.id} key={item.id}>{item.name} · {item.code}</option>)}</select></label><label>Grade<input name="grade" defaultValue={employee.grade || ""} /></label><label>Work location<input name="workLocation" defaultValue={employee.work_location || ""} /></label><label>Status<select name="status" defaultValue={employee.status}><option value="probation">Probation</option><option value="active">Active</option><option value="notice_period">Notice period</option><option value="separated">Separated</option><option value="archived">Archived</option></select></label><label>Work email<input name="workEmail" type="email" defaultValue={employee.work_email || ""} /></label><label>Work phone<input name="phone" defaultValue={employee.phone || ""} /></label><label>Probation end<input name="probationEndDate" type="date" defaultValue={dateOnly(employee.probation_end_date) === "—" ? "" : dateOnly(employee.probation_end_date)} /></label><label>Confirmation date<input name="confirmationDate" type="date" defaultValue={dateOnly(employee.confirmation_date) === "—" ? "" : dateOnly(employee.confirmation_date)} /></label><label>Next salary revision<input name="nextSalaryRevisionDate" type="date" defaultValue={dateOnly(employee.next_salary_revision_date) === "—" ? "" : dateOnly(employee.next_salary_revision_date)} /></label><label>Effective date<input name="effectiveDate" type="date" defaultValue={today} required /></label></>}
    {kind === "personal" && <><label>Personal email<input name="personalEmail" type="email" defaultValue={personal?.personalEmail || ""} /></label><label>Phone<input name="phone" defaultValue={personal?.phone || ""} /></label><label>Preferred name<input name="preferredName" defaultValue={pd.preferredName || ""} /></label><label>Date of birth<input name="dateOfBirth" type="date" defaultValue={pd.dateOfBirth || ""} /></label><label>Gender<input name="gender" defaultValue={pd.gender || ""} /></label><label>Marital status<input name="maritalStatus" defaultValue={pd.maritalStatus || ""} /></label><label>Nationality<input name="nationality" defaultValue={pd.nationality || "Indian"} /></label><label>Blood group<select name="bloodGroup" defaultValue={pd.bloodGroup || ""}><option value="">Not recorded</option>{["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map(value => <option key={value}>{value}</option>)}</select></label><label className="span-two">Address line 1<input name="addressLine1" defaultValue={address.line1 || ""} /></label><label className="span-two">Address line 2<input name="addressLine2" defaultValue={address.line2 || ""} /></label><label>City<input name="city" defaultValue={address.city || ""} /></label><label>State<input name="state" defaultValue={address.state || ""} /></label><label>Postal code<input name="postalCode" defaultValue={address.postalCode || ""} /></label></>}
    {kind === "emergency" && <><label>Full name<input name="fullName" required /></label><label>Relationship<input name="relationship" required /></label><label>Phone<input name="phone" required /></label><label>Priority<input name="priority" type="number" min="1" max="20" defaultValue="1" required /></label></>}
    {kind === "sensitive" && <><div className="form-section span-two">Bank details</div><label>Account holder<input name="accountHolder" defaultValue={sensitive?.bankDetails?.accountHolder || ""} /></label><label>Bank name<input name="bankName" defaultValue={sensitive?.bankDetails?.bankName || ""} /></label><label>Full account number<input name="accountNumber" autoComplete="off" /></label><label>IFSC<input name="ifsc" /></label><div className="form-section span-two">Statutory identifiers</div><label>UAN<input name="uan" autoComplete="off" /></label><label>ESI number<input name="esi" autoComplete="off" /></label><label>PAN<input name="pan" autoComplete="off" /></label><div className="form-hint span-two">Protected values are encrypted. Existing identifiers stay unchanged unless full replacement values are entered.</div></>}
    {kind === "compensation" && <><label>Effective from<input name="effectiveFrom" type="date" required /></label><label>Next salary revision<input name="nextSalaryRevisionDate" type="date" /></label><label>Annual CTC<input name="annualCtc" type="number" min="0" step="1" required /></label><label>Monthly gross<input name="monthlyGross" type="number" min="0" step="1" required /></label><label>Monthly basic<input name="basic" type="number" min="0" step="1" required /></label><label>Monthly allowances<input name="allowances" type="number" min="0" step="1" required /></label><label>Overtime hourly rate<input name="overtimeRate" type="number" min="0" step="0.01" defaultValue="0" /></label><label>Salary divisor days<input name="divisorDays" type="number" min="1" max="366" defaultValue="30" required /></label></>}
    {kind === "skill" && <><label className="span-two">Skill<select name="skillId" required>{catalogue.map(skill => <option value={skill.id} key={skill.id}>{skill.name} · {skill.category || skill.code}</option>)}</select></label><label>Current proficiency<input name="proficiency" type="number" min="0" max="5" step="0.5" defaultValue="3" required /></label><label>Target proficiency<input name="targetProficiency" type="number" min="0" max="5" step="0.5" defaultValue="4" required /></label><label className="span-two">Evidence<input name="evidence" placeholder="Assessment, project, certification or observed evidence" /></label></>}
    {kind === "plan" && <><label className="span-two">Plan title<input name="title" required /></label><label>Performance cycle<select name="cycleId"><option value="">Not cycle-linked</option>{cycles.map(cycle => <option value={cycle.id} key={cycle.id}>{cycle.name}</option>)}</select></label><label>Plan due date<input name="dueDate" type="date" /></label><div className="form-section span-two">First development action</div><label className="span-two">Action title<input name="actionTitle" required /></label><label>Action type<select name="actionType" defaultValue="course"><option value="course">Course</option><option value="coaching">Coaching</option><option value="project">Project</option><option value="reading">Reading</option><option value="certification">Certification</option><option value="other">Other</option></select></label><label>Action due date<input name="actionDueDate" type="date" /></label><label className="span-two">Action description<input name="actionDescription" /></label><label className="check-label span-two"><input name="submit" type="checkbox" /> Submit immediately for independent approval</label></>}
    {kind === "letter" && <><label>Letter type<select name="letterType" defaultValue="employment_verification"><option value="appointment">Appointment</option><option value="confirmation">Confirmation</option><option value="salary_revision">Salary revision</option><option value="employment_verification">Employment verification</option><option value="experience">Experience</option><option value="relieving">Relieving</option></select></label><label>Effective date<input name="effectiveDate" type="date" defaultValue={today} required /></label><label className="span-two">Template version<input name="templateVersion" defaultValue="VELITE-2026.1" required /></label></>}
    {kind === "delete" && <><div className="form-hint danger-hint span-two">This employee will disappear from People and employee selectors. Payroll, attendance, salary registers and audit history will remain preserved.</div><label className="span-two">Enter employee code {employee.employee_code} to confirm<input name="confirmationCode" autoComplete="off" required /></label></>}
    <label className="span-two">Reason<input name="reason" placeholder="Required for the audit history" required /></label>
    {error && <div className="form-error span-two">{error}</div>}<div className="modal-actions span-two"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className={kind === "delete" ? "danger-action" : "primary"} disabled={busy}>{busy ? "Saving…" : kind === "delete" ? "Delete from People" : "Save record"}</button></div>
  </form></section></div>;
}
