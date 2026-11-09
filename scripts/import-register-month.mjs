// Imports one company's monthly salary register (salary + wages register of the accountant's summary sheet) into
// "Imported salary registers" and brings each person's pay rate in line with the sheet.
//
// The data is NOT kept in the repository: it is piped in on stdin as JSON (see CLAUDE.md §41).
//   node import-register-month.mjs --validate   < data.json   no database; only checks the numbers add up to the printed totals
//   node import-register-month.mjs              < data.json   read-only look at the database: who matches, who is new, what would change
//   node import-register-month.mjs --apply      < data.json   writes everything in one transaction
// Row layout (arrays): [type,serial,page,code,name,guardian,position,department,joined(DD/MM/YYYY),esiNo,pfAccount,uan,days,
//   basic,hra,ca,oa, earnedWages,earnedHra,earnedCa,earnedOa, esi,epf,advance,lwf, totalDues,totalDeductions,net]
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import postgres from "postgres";

const mode = process.argv.includes("--apply") ? "apply" : process.argv.includes("--validate") ? "validate" : "dry";
const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);
const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const sum = values => values.reduce((total, value) => total + Number(value || 0), 0);
const cents = value => Math.round(Number(value) * 100);
const same = (a, b) => cents(a) === cents(b);
const problems = [];
const check = (actual, expected, label) => { if (!same(actual, expected)) problems.push(`${label}: sheet says ${expected}, rows add up to ${actual}`); };

const F = { type: 0, serial: 1, page: 2, code: 3, name: 4, guardian: 5, position: 6, department: 7, joined: 8, esiNo: 9, pfAccount: 10, uan: 11, days: 12, basic: 13, hra: 14, ca: 15, oa: 16, eW: 17, eH: 18, eC: 19, eO: 20, esi: 21, epf: 22, adv: 23, lwf: 24, dues: 25, ded: 26, net: 27 };
const rows = payload.rows;
if (payload.periodMonth !== "2026-10-01" && !/^\d{4}-\d{2}-01$/.test(payload.periodMonth)) problems.push("periodMonth must be the first day of a month");
for (const row of rows) {
  const label = `${payload.businessHead}/${row[F.code]} ${row[F.name]}`;
  check(row[F.eW] + row[F.eH] + row[F.eC] + row[F.eO], row[F.dues], `${label} earned dues`);
  check(row[F.esi] + row[F.epf] + row[F.adv] + row[F.lwf], row[F.ded], `${label} deductions`);
  check(row[F.dues] - row[F.ded], row[F.net], `${label} net`);
  if (!(row[F.basic] > 0)) problems.push(`${label}: no basic rate`);
}
const printedKeys = { wages: F.eW, hra: F.eH, ca: F.eC, oa: F.eO, esi: F.esi, epf: F.epf, adv: F.adv, lwf: F.lwf, dues: F.dues, ded: F.ded, net: F.net };
for (const type of ["salary", "wages"]) {
  const part = rows.filter(row => row[F.type] === type); const printed = payload.printed[type];
  if (part.length !== printed.n) problems.push(`${type} register: ${part.length} people, sheet says ${printed.n}`);
  for (const [key, column] of Object.entries(printedKeys)) check(sum(part.map(row => row[column])), printed[key], `${type} register ${key}`);
}
check(sum(rows.map(row => row[F.dues])), payload.grand.dues, "grand total dues"); check(sum(rows.map(row => row[F.ded])), payload.grand.ded, "grand total deductions"); check(sum(rows.map(row => row[F.net])), payload.grand.net, "grand total net");
if (rows.length !== payload.grand.n) problems.push(`${rows.length} people, sheet says ${payload.grand.n}`);
const codes = rows.map(row => row[F.code]); if (new Set(codes).size !== codes.length) problems.push("an employee code appears twice");
if (problems.length) { console.log(`STOP: ${problems.length} problem(s)\n- ${problems.join("\n- ")}`); process.exit(1); }
console.log(`Numbers check out: ${payload.businessHead}, ${rows.length} people, total dues ${payload.grand.dues}, deductions ${payload.grand.ded}, net ${payload.grand.net}`);
if (mode === "validate") process.exit(0);

const databaseUrl = process.env.DATABASE_URL; if (!databaseUrl) throw new Error("DATABASE_URL is required");
const key = () => { const value = Buffer.from(process.env.DATA_ENCRYPTION_KEY || "", "base64"); if (value.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key"); return value; };
const sealJson = value => { const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key(), iv); const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]); return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), body]); };
const openJson = value => { if (!value) return {}; const bytes = Buffer.from(value); const decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(1, 13)); decipher.setAuthTag(bytes.subarray(13, 29)); return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(29)), decipher.final()]).toString("utf8")); };
const isoDate = text => { if (!text) return null; const [d, m, y] = text.split("/"); return `${y}-${m}-${d}`; };
const rates = row => ({ basic: row[F.basic], hra: row[F.hra], ca: row[F.ca], oa: row[F.oa] });
const gross = row => row[F.basic] + row[F.hra] + row[F.ca] + row[F.oa];
const normalName = text => String(text || "").toUpperCase().replace(/[^A-Z]/g, "");

const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {}, ...(mode === "dry" ? { connection: { default_transaction_read_only: "on" } } : {}) });
try {
  const [head] = await sql`SELECT id,name FROM business_heads WHERE name=${payload.businessHead}`;
  if (!head) throw new Error(`Company not found: ${payload.businessHead}`);
  const [already] = await sql`SELECT id,period_month::text AS period_month FROM salary_register_imports WHERE source_sha256=${payload.sourceSha256}`;
  if (already) { console.log(`This sheet is already imported (${already.period_month}). Nothing to do.`); process.exit(0); }
  const [actor] = await sql`SELECT id,email FROM users WHERE lower(email)=lower(${process.env.IMPORT_ACTOR_EMAIL || "velite@velite.in"}) AND active=true`;
  if (!actor) throw new Error("Active login not found (set IMPORT_ACTOR_EMAIL)");
  const staff = await sql`SELECT id,employee_code,first_name,last_name,guardian_name,status::text AS status,position,department_id,statutory_details_encrypted FROM employees WHERE business_head_id=${head.id}`;
  const byCode = new Map(staff.map(person => [person.employee_code, person]));
  const byTrimmed = new Map(staff.map(person => [person.employee_code.replace(/^0+/, ""), person]));
  const plan = rows.map(row => {
    const person = byCode.get(row[F.code]) || byTrimmed.get(row[F.code].replace(/^0+/, "")) || null;
    const fullName = normalName(`${person?.first_name || ""}${person?.last_name || ""}`);
    const nameMatches = person ? fullName === normalName(row[F.name]) : null;
    return { row, person, nameMatches };
  });
  console.log(`\n${payload.businessHead}: ${plan.filter(item => item.person).length} found by staff code, ${plan.filter(item => !item.person).length} new`);
  for (const { row, person, nameMatches } of plan) {
    const note = !person ? "NEW (will be added)" : nameMatches ? `exists as ${person.employee_code} (${person.status})` : `CODE FOUND BUT NAME DIFFERS: app has "${person.first_name} ${person.last_name || ""}" (${person.status})`;
    console.log(`  ${String(row[F.code]).padStart(3)}  ${row[F.name].padEnd(22)} net ${String(row[F.net]).padStart(6)}  ${note}`);
  }
  const mismatched = plan.filter(item => item.person && !item.nameMatches);
  if (mismatched.length && mode === "apply") throw new Error(`${mismatched.length} staff code(s) match a different name; check them before applying`);
  if (mode === "dry") { console.log("\nDry run only: nothing was changed. Add --apply to write it."); process.exit(0); }

  const outcome = await sql.begin(async tx => {
    const departmentIds = {};
    for (const name of [...new Set(rows.map(row => row[F.department]).filter(Boolean))]) {
      const [existing] = await tx`SELECT id FROM departments WHERE business_head_id=${head.id} AND upper(name)=${name.toUpperCase()} ORDER BY active DESC LIMIT 1`;
      if (existing) { await tx`UPDATE departments SET active=true WHERE id=${existing.id}`; departmentIds[name] = existing.id; continue; }
      const code = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
      const [created] = await tx`INSERT INTO departments (business_head_id,name,code) VALUES (${head.id},${name},${code}) ON CONFLICT (business_head_id,code) DO UPDATE SET name=excluded.name,active=true RETURNING id`;
      departmentIds[name] = created.id;
    }
    const totals = { recordCount: rows.length, totalDues: payload.grand.dues, totalDeductions: payload.grand.ded, netPayable: payload.grand.net };
    const [registerImport] = await tx`INSERT INTO salary_register_imports (business_head_id,period_month,source_file_name,source_sha256,imported_by,record_count,totals) VALUES (${head.id},${payload.periodMonth},${payload.sourceFileName},${payload.sourceSha256},${actor.id},${rows.length},${tx.json(totals)}) RETURNING id`;
    let created = 0, updated = 0, newRates = 0, sameRates = 0;
    for (const { row, person } of plan) {
      const statutory = Object.fromEntries(Object.entries({ ESI: row[F.esiNo], UAN: row[F.uan], PFAccountNumber: row[F.pfAccount] }).filter(([, value]) => value));
      const joined = isoDate(row[F.joined]);
      const [first, ...rest] = row[F.name].trim().split(/\s+/);
      const metadata = { salarySheetImport: { periodMonth: payload.periodMonth, sourceFileName: payload.sourceFileName, sourceSha256: payload.sourceSha256 }, dateJoinedBasis: joined ? "salary_sheet_joining_date" : "first_known_payroll_month", dateJoinedEstimated: !joined && !person };
      let employee;
      if (person) {
        const old = openJson(person.statutory_details_encrypted);
        [employee] = await tx`UPDATE employees SET guardian_name=coalesce(guardian_name,${row[F.guardian] || null}),department_id=coalesce(department_id,${row[F.department] ? departmentIds[row[F.department]] : null}::uuid),position=CASE WHEN ${Boolean(row[F.position])} AND (position IS NULL OR position IN ('Employee','Worker')) THEN ${row[F.position] || null} ELSE position END,statutory_details_encrypted=${Object.keys(statutory).length ? sealJson({ ...old, ...statutory }) : person.statutory_details_encrypted},source_metadata=coalesce(source_metadata,'{}'::jsonb) || ${tx.json(metadata)},updated_at=now() WHERE id=${person.id} RETURNING id`;
        updated++;
      } else {
        [employee] = await tx`INSERT INTO employees (employee_code,business_head_id,department_id,first_name,last_name,guardian_name,position,employment_type,status,date_joined,statutory_details_encrypted,source_metadata) VALUES (${row[F.code]},${head.id},${row[F.department] ? departmentIds[row[F.department]] : null},${first},${rest.join(" ") || null},${row[F.guardian] || null},${row[F.position] || "Employee"},'permanent','active',${joined || payload.periodMonth},${Object.keys(statutory).length ? sealJson(statutory) : null},${tx.json(metadata)}) RETURNING id`;
        await tx`INSERT INTO employee_events (employee_id,event_type,effective_date,new_values,reason,approved_by,created_by) VALUES (${employee.id},'employee_imported',${payload.periodMonth},${tx.json({ employeeCode: row[F.code], businessHead: payload.businessHead, sourceFileName: payload.sourceFileName })},'Imported from the accountant salary register',${actor.id},${actor.id})`;
        created++;
      }
      // Pay rate: only add a new revision when it differs from what is in force for that month.
      const [current] = await tx`SELECT id,effective_from::text AS effective_from,monthly_gross,structure FROM employee_compensation WHERE employee_id=${employee.id} AND effective_from<=${payload.periodMonth}::date ORDER BY effective_from DESC LIMIT 1`;
      const wantAllowances = row[F.hra] + row[F.ca] + row[F.oa];
      const sameAsNow = current && Number(current.structure?.basic) === row[F.basic] && Number(current.structure?.allowances || 0) === wantAllowances && same(current.monthly_gross, gross(row));
      if (sameAsNow) sameRates++;
      else {
        const structure = { basic: row[F.basic], hra: row[F.hra], ca: row[F.ca], oa: row[F.oa], allowances: wantAllowances, overtimeRate: 0, divisorDays: 31, source: `Salary register ${payload.periodMonth.slice(0, 7)}` };
        await tx`UPDATE employee_compensation SET effective_to=${payload.periodMonth}::date-1 WHERE employee_id=${employee.id} AND effective_from<${payload.periodMonth}::date AND (effective_to IS NULL OR effective_to>=${payload.periodMonth}::date)`;
        await tx`INSERT INTO employee_compensation (employee_id,effective_from,annual_ctc,monthly_gross,structure,reason,approved_by) VALUES (${employee.id},${payload.periodMonth},${gross(row) * 12},${gross(row)},${tx.json(structure)},'Monthly rate taken from the accountant salary register; annual value is monthly gross x 12',${actor.id}) ON CONFLICT (employee_id,effective_from) DO UPDATE SET annual_ctc=excluded.annual_ctc,monthly_gross=excluded.monthly_gross,structure=excluded.structure,reason=excluded.reason,approved_by=excluded.approved_by`;
        newRates++;
      }
      const earned = { wages: row[F.eW], hra: row[F.eH], ca: row[F.eC], oa: row[F.eO] };
      const deductions = { esi: row[F.esi], epf: row[F.epf], advance: row[F.adv], labourWelfareFund: row[F.lwf] };
      await tx`INSERT INTO salary_register_lines (import_id,employee_id,register_type,source_page,source_serial,attendance_days,monthly_rates,earned_dues,deductions,total_dues,total_deductions,net_payable,raw_source) VALUES (${registerImport.id},${employee.id},${row[F.type]},${row[F.page]},${row[F.serial]},${row[F.days]},${tx.json(rates(row))},${tx.json(earned)},${tx.json(deductions)},${row[F.dues]},${row[F.ded]},${row[F.net]},${tx.json({ sheetName: row[F.name], guardian: row[F.guardian], position: row[F.position], department: row[F.department] })})`;
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason) VALUES (${actor.id},${person ? "salary_register.employee_updated" : "salary_register.employee_created"},'employee',${employee.id},${head.id},${tx.json({ employeeCode: row[F.code], importId: registerImport.id, periodMonth: payload.periodMonth })},'Salary register import')`;
    }
    await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason) VALUES (${actor.id},'salary_register.imported','salary_register_import',${registerImport.id},${head.id},${tx.json({ sourceFileName: payload.sourceFileName, sourceSha256: payload.sourceSha256, recordCount: rows.length, totals })},'Salary register import')`;
    return { importId: registerImport.id, created, updated, newRates, sameRates };
  });
  console.log(`\nDONE ${payload.businessHead}: ${outcome.created} people added, ${outcome.updated} existing updated, pay rates: ${outcome.newRates} added/changed, ${outcome.sameRates} already the same.`);
} finally { await sql.end(); }
