// Combines two records of the SAME person: keeps one, moves the imported salary-sheet rows and the missing pay rate / statutory numbers onto it,
// then removes the other from the Staff list (status archived, marked as a duplicate; nothing is erased). See CLAUDE.md section 43.
//   Preview (changes nothing): TARGET_COMPANY="Velite Healthcare" KEEP_CODE=VEL-110 DROP_CODE=63 node merge-duplicate-staff.mjs
//   Apply:                     ... node merge-duplicate-staff.mjs --apply
// Refused if the record to remove has attendance the kept record lacks, documents, leave, salary results or loans of its own (those would have to be moved by hand).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import postgres from "postgres";
const apply = process.argv.includes("--apply");
const { TARGET_COMPANY: company, KEEP_CODE: keepCode, DROP_CODE: dropCode } = process.env;
if (!company || !keepCode || !dropCode) throw new Error("Set TARGET_COMPANY, KEEP_CODE and DROP_CODE");
const key = () => { const value = Buffer.from(process.env.DATA_ENCRYPTION_KEY || "", "base64"); if (value.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key"); return value; };
const sealJson = value => { const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key(), iv); const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]); return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), body]); };
const openJson = value => { if (!value) return {}; const bytes = Buffer.from(value); const decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(1, 13)); decipher.setAuthTag(bytes.subarray(13, 29)); return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(29)), decipher.final()]).toString("utf8")); };
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {}, ...(apply ? {} : { connection: { default_transaction_read_only: "on" } }) });
const name = person => [person.first_name, person.last_name].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
try {
  const [head] = await sql`SELECT id FROM business_heads WHERE name=${company}`; if (!head) throw new Error(`Company not found: ${company}`);
  const [actor] = await sql`SELECT id FROM users WHERE lower(email)=lower(${process.env.ACTOR_EMAIL || "velite@velite.in"}) AND active=true`; if (!actor) throw new Error("Active login not found (set ACTOR_EMAIL)");
  const find = async code => { const [person] = await sql`SELECT id,employee_code,first_name,last_name,guardian_name,status::text AS status,date_joined::text AS joined,statutory_details_encrypted FROM employees WHERE business_head_id=${head.id} AND employee_code=${code}`; if (!person) throw new Error(`Not found in ${company}: ${code}`); return person; };
  const keep = await find(keepCode), drop = await find(dropCode);
  if (keep.id === drop.id) throw new Error("KEEP_CODE and DROP_CODE are the same person record");
  const counts = async id => (await sql`SELECT
    (SELECT count(*)::int FROM attendance_days WHERE employee_id=${id}) AS attendance,
    (SELECT count(*)::int FROM documents WHERE employee_id=${id}) AS documents,
    (SELECT count(*)::int FROM leave_requests WHERE employee_id=${id}) AS leave,
    (SELECT count(*)::int FROM payroll_results WHERE employee_id=${id}) AS salary_results,
    (SELECT count(*)::int FROM employee_loans WHERE employee_id=${id}) AS loans,
    (SELECT count(*)::int FROM salary_register_lines WHERE employee_id=${id}) AS register_rows,
    (SELECT count(*)::int FROM employee_compensation WHERE employee_id=${id}) AS pay_rates`)[0];
  const keepCounts = await counts(keep.id), dropCounts = await counts(drop.id);
  console.log(`KEEP  ${keep.employee_code}  ${name(keep)}  (${keep.status}, joined ${keep.joined})  `, JSON.stringify(keepCounts));
  console.log(`DROP  ${drop.employee_code}  ${name(drop)}  (${drop.status}, joined ${drop.joined})  `, JSON.stringify(dropCounts));
  // Attendance on the copy is fine when the kept record already has a mark for the same day (a double mark); any day only the copy has blocks the merge.
  const onlyOnCopy = dropCounts.attendance ? (await sql`SELECT count(*)::int AS n FROM attendance_days d WHERE d.employee_id=${drop.id} AND NOT EXISTS (SELECT 1 FROM attendance_days k WHERE k.employee_id=${keep.id} AND k.attendance_date=d.attendance_date)`)[0].n : 0;
  if (dropCounts.attendance && !onlyOnCopy) console.log(`  the ${dropCounts.attendance} attendance day(s) on the copy are all already marked on the kept record: left as they are on the archived copy`);
  const stuck = ["documents", "leave", "salary_results", "loans"].filter(field => dropCounts[field] > 0); if (onlyOnCopy) stuck.unshift("attendance (days the kept record does not have)");
  if (stuck.length) throw new Error(`The record to remove has its own ${stuck.join(", ")}; move those first (nothing was changed)`);
  const lines = await sql`SELECT l.id,l.import_id,l.register_type,l.net_payable,i.period_month::text AS month FROM salary_register_lines l JOIN salary_register_imports i ON i.id=l.import_id WHERE l.employee_id=${drop.id} ORDER BY i.period_month`;
  const clash = await sql`SELECT l.import_id FROM salary_register_lines l WHERE l.employee_id=${keep.id} AND l.import_id IN ${sql(lines.length ? lines.map(line => line.import_id) : [null])}`;
  if (clash.length) throw new Error("The record to keep already has a salary-sheet row in the same import; check by hand");
  for (const line of lines) console.log(`  moves salary-sheet row: ${line.month.slice(0, 7)} ${line.register_type} net ${line.net_payable}`);
  const rates = await sql`SELECT id,effective_from::text AS effective_from,effective_to::text AS effective_to,annual_ctc,monthly_gross,structure,reason FROM employee_compensation WHERE employee_id=${drop.id} ORDER BY effective_from`;
  const copy = [];
  for (const rate of rates) {
    if (!String(rate.reason).startsWith("Monthly rate taken from the accountant salary register")) continue;
    const [current] = await sql`SELECT id,monthly_gross,structure FROM employee_compensation WHERE employee_id=${keep.id} AND effective_from<=${rate.effective_from}::date ORDER BY effective_from DESC LIMIT 1`;
    const sameAsNow = current && Number(current.structure?.basic) === Number(rate.structure?.basic) && Number(current.structure?.allowances || 0) === Number(rate.structure?.allowances || 0) && Number(current.monthly_gross) === Number(rate.monthly_gross);
    console.log(`  pay rate from the sheet starting ${rate.effective_from}: gross ${rate.monthly_gross}, basic ${rate.structure?.basic}  ->  ${sameAsNow ? "already the same on the kept record" : "will be added to the kept record"}`);
    if (!sameAsNow) copy.push(rate);
  }
  const mine = openJson(keep.statutory_details_encrypted), theirs = openJson(drop.statutory_details_encrypted);
  const fill = Object.keys(theirs).filter(field => !mine[field]);
  if (fill.length) console.log(`  statutory numbers filled in on the kept record: ${fill.join(", ")}`);
  if (drop.guardian_name && !keep.guardian_name) console.log("  parent / spouse name filled in on the kept record");
  console.log(`  then ${drop.employee_code} is removed from the Staff list (archived, marked duplicate); nothing is erased`);
  if (!apply) { console.log("\nPreview only: nothing was changed. Add --apply to write it."); process.exit(0); }
  await sql.begin(async tx => {
    await tx`UPDATE salary_register_lines SET employee_id=${keep.id} WHERE employee_id=${drop.id}`;
    for (const rate of copy) {
      await tx`UPDATE employee_compensation SET effective_to=${rate.effective_from}::date-1 WHERE employee_id=${keep.id} AND effective_from<${rate.effective_from}::date AND (effective_to IS NULL OR effective_to>=${rate.effective_from}::date)`;
      await tx`INSERT INTO employee_compensation (employee_id,effective_from,annual_ctc,monthly_gross,structure,reason,approved_by) VALUES (${keep.id},${rate.effective_from},${rate.annual_ctc},${rate.monthly_gross},${tx.json(rate.structure)},${rate.reason},${actor.id}) ON CONFLICT (employee_id,effective_from) DO UPDATE SET annual_ctc=excluded.annual_ctc,monthly_gross=excluded.monthly_gross,structure=excluded.structure,reason=excluded.reason,approved_by=excluded.approved_by`;
    }
    await tx`UPDATE employees SET guardian_name=coalesce(guardian_name,${drop.guardian_name}),statutory_details_encrypted=${fill.length ? sealJson({ ...theirs, ...mine }) : keep.statutory_details_encrypted},updated_at=now() WHERE id=${keep.id}`;
    await tx`UPDATE employees SET status='archived',updated_at=now() WHERE id=${drop.id}`;
    const note = `Same person as ${keep.employee_code} (${name(keep)}); records combined, this copy removed from Staff`;
    await tx`INSERT INTO employee_events (employee_id,event_type,effective_date,new_values,reason,approved_by,created_by) VALUES (${drop.id},'profile_change',current_date,${tx.json({ duplicateEntry: true, keptEmployeeCode: keep.employee_code })},${note},${actor.id},${actor.id})`;
    await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason) VALUES (${actor.id},'employee.marked_duplicate','employee',${drop.id},${head.id},${tx.json({ employeeCode: drop.employee_code, keptEmployeeCode: keep.employee_code, movedRegisterRows: lines.length, copiedRates: copy.length })},${note})`;
    await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason) VALUES (${actor.id},'employee.records_combined','employee',${keep.id},${head.id},${tx.json({ fromEmployeeCode: drop.employee_code, movedRegisterRows: lines.length, copiedRates: copy.length, filledStatutory: fill })},${note})`;
  });
  console.log("\nDONE.");
} finally { await sql.end(); }
