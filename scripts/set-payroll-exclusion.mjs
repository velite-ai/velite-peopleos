// Leaves people out of (or puts them back into) salary calculation. See CLAUDE.md section 42.
//   Preview (changes nothing):  TARGET_COMPANY="Velite Healthcare" TARGET_CODES=001,053 node set-payroll-exclusion.mjs
//   Apply:                      ... node set-payroll-exclusion.mjs --apply
//   Put back:                   ... EXCLUDE=false node set-payroll-exclusion.mjs --apply
// Refused while the person is in a locked attendance month or a salary month that is approved, locked or paid (reopen it first).
import postgres from "postgres";
const apply = process.argv.includes("--apply");
const company = process.env.TARGET_COMPANY; const codes = (process.env.TARGET_CODES || "").split(",").map(c => c.trim()).filter(Boolean);
const exclude = process.env.EXCLUDE !== "false";
if (!company || !codes.length) throw new Error("Set TARGET_COMPANY and TARGET_CODES (comma separated staff codes)");
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {}, ...(apply ? {} : { connection: { default_transaction_read_only: "on" } }) });
try {
  const [head] = await sql`SELECT id FROM business_heads WHERE name=${company}`; if (!head) throw new Error(`Company not found: ${company}`);
  const [actor] = await sql`SELECT id FROM users WHERE lower(email)=lower(${process.env.ACTOR_EMAIL || "velite@velite.in"}) AND active=true`; if (!actor) throw new Error("Active login not found (set ACTOR_EMAIL)");
  const people = await sql`SELECT id,employee_code,first_name,last_name,status::text AS status,payroll_excluded FROM employees WHERE business_head_id=${head.id} AND employee_code IN ${sql(codes)}`;
  const missing = codes.filter(code => !people.some(person => person.employee_code === code)); if (missing.length) throw new Error(`Not found in ${company}: ${missing.join(", ")}`);
  const blocked = await sql`SELECT 'attendance ' || to_char(m.period_month,'Mon YYYY') AS what FROM attendance_months m WHERE m.business_head_id=${head.id} AND m.status='locked' AND m.period_month>=date_trunc('month',now())-interval '1 month'
    UNION ALL SELECT 'salary ' || to_char(p.period_month,'Mon YYYY') || ' (' || p.status || ')' FROM payroll_periods p WHERE p.business_head_id=${head.id} AND p.status IN ('approved','locked','paid') AND p.period_month>=date_trunc('month',now())-interval '1 month'`;
  for (const person of people) console.log(`${person.employee_code}  ${[person.first_name, person.last_name].filter(Boolean).join(" ")}  (${person.status})  ->  ${exclude ? "LEFT OUT of salary" : "back IN salary"}${person.payroll_excluded === exclude ? "  [already so]" : ""}`);
  if (blocked.length) console.log(`\nNote: these recent months are already locked/approved and keep their old list of people: ${blocked.map(row => row.what).join("; ")}. Reopen a month, then calculate again, for the change to count there.`);
  if (!apply) { console.log("\nPreview only: nothing was changed. Add --apply to write it."); process.exit(0); }
  await sql.begin(async tx => {
    for (const person of people) {
      if (person.payroll_excluded === exclude) continue;
      await tx`UPDATE employees SET payroll_excluded=${exclude},updated_at=now() WHERE id=${person.id}`;
      await tx`INSERT INTO employee_events (employee_id,event_type,effective_date,new_values,reason,approved_by,created_by) VALUES (${person.id},'payroll_exclusion',now()::date,${tx.json({ payrollExcluded: exclude })},${exclude ? "Left out of salary calculation (not paid through the app)" : "Put back into salary calculation"},${actor.id},${actor.id})`;
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason) VALUES (${actor.id},${exclude ? "employee.payroll_excluded" : "employee.payroll_included"},'employee',${person.id},${head.id},${tx.json({ employeeCode: person.employee_code })},'Payroll exclusion')`;
    }
  });
  console.log("\nDONE.");
} finally { await sql.end(); }
