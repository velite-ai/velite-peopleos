import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const inputPath = process.argv[2];
if (!inputPath) throw new Error("Usage: node scripts/import-salary-register.mjs <import.json>");

function encryptionKey() {
  const encoded = process.env.DATA_ENCRYPTION_KEY;
  if (!encoded) throw new Error("DATA_ENCRYPTION_KEY is required");
  const value = Buffer.from(encoded, "base64");
  if (value.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return value;
}

function sealJson(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]);
}

function openJson(value) {
  if (!value) return {};
  const bytes = Buffer.from(value);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), bytes.subarray(1, 13));
  decipher.setAuthTag(bytes.subarray(13, 29));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(29)), decipher.final()]).toString("utf8"));
}

const sum = values => values.reduce((total, value) => total + Number(value || 0), 0);
const exact = value => Math.round(Number(value) * 100);
const assertMoney = (actual, expected, label) => {
  if (exact(actual) !== exact(expected)) throw new Error(`${label}: expected ${expected}, got ${actual}`);
};

const payload = JSON.parse(await readFile(inputPath, "utf8"));
if (payload.periodMonth !== "2026-06-01") throw new Error("This import must identify June 2026 as 2026-06-01");
for (const source of payload.imports) {
  if (source.employees.length !== source.totals.recordCount) throw new Error(`${source.businessHead}: record count mismatch`);
  assertMoney(sum(source.employees.map(row => row.totalDues)), source.totals.totalDues, `${source.businessHead} dues`);
  assertMoney(sum(source.employees.map(row => row.totalDeductions)), source.totals.totalDeductions, `${source.businessHead} deductions`);
  assertMoney(sum(source.employees.map(row => row.netPayable)), source.totals.netPayable, `${source.businessHead} net payable`);
  for (const row of source.employees) {
    assertMoney(sum(Object.values(row.monthlyRates)), row.monthlyGross, `${source.businessHead}/${row.employeeCode} monthly gross`);
    assertMoney(sum(Object.values(row.earnedDues)), row.totalDues, `${source.businessHead}/${row.employeeCode} earned dues`);
    assertMoney(sum(Object.values(row.deductions)), row.totalDeductions, `${source.businessHead}/${row.employeeCode} deductions`);
    assertMoney(row.totalDues - row.totalDeductions, row.netPayable, `${source.businessHead}/${row.employeeCode} net`);
  }
}

const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
const result = { created: 0, updated: 0, compensationUpserts: 0, lines: 0, imports: [], skipped: [] };
try {
  const [actor] = await sql`SELECT id,email FROM users WHERE lower(email)='admin@velite.in' AND active=true`;
  if (!actor) throw new Error("Active admin@velite.in user not found");
  for (const source of payload.imports) {
    const [already] = await sql`SELECT id FROM salary_register_imports WHERE source_sha256=${source.sourceSha256}`;
    if (already) { result.skipped.push({ businessHead: source.businessHead, reason: "already imported", importId: already.id }); continue; }
    const sourceResult = await sql.begin(async tx => {
      const [head] = await tx`SELECT id,name FROM business_heads WHERE name=${source.businessHead}`;
      if (!head) throw new Error(`Business head not found: ${source.businessHead}`);
      const departmentIds = {};
      for (const name of [...new Set(source.employees.map(row => row.department).filter(Boolean))]) {
        const code = name.toUpperCase().replace(/[^A-Z0-9]+/g, "-");
        const [department] = await tx`
          INSERT INTO departments (business_head_id,name,code)
          VALUES (${head.id},${name},${code})
          ON CONFLICT (business_head_id,code) DO UPDATE SET name=excluded.name,active=true
          RETURNING id
        `;
        departmentIds[name] = department.id;
      }
      const [registerImport] = await tx`
        INSERT INTO salary_register_imports (business_head_id,period_month,source_file_name,source_sha256,imported_by,record_count,totals)
        VALUES (${head.id},${payload.periodMonth},${source.sourceFileName},${source.sourceSha256},${actor.id},${source.employees.length},${tx.json(source.totals)})
        RETURNING id
      `;
      let created = 0; let updated = 0; let compensationUpserts = 0; let lines = 0;
      for (const row of source.employees) {
        const [existing] = await tx`SELECT * FROM employees WHERE business_head_id=${head.id} AND employee_code=${row.employeeCode} FOR UPDATE`;
        const inferredJoinDate = !row.dateJoinedConfirmed;
        const metadata = {
          salarySheetImport: { periodMonth: payload.periodMonth, sourceFileName: source.sourceFileName, sourceSha256: source.sourceSha256 },
          dateJoinedBasis: inferredJoinDate ? (existing ? "pre_existing_employee_master" : "first_known_payroll_month") : "salary_sheet_joining_date",
          dateJoinedEstimated: inferredJoinDate && !existing,
          positionBasis: row.positionConfirmed ? "salary_sheet" : (existing ? "pre_existing_employee_master" : "register_category_inference"),
          positionEstimated: !row.positionConfirmed && !existing,
        };
        const statutory = Object.fromEntries(Object.entries({ ESI: row.esi, UAN: row.uan, PFAccountNumber: row.pfAccountNumber }).filter(([,value]) => value));
        let employee;
        if (existing) {
          const existingStatutory = openJson(existing.statutory_details_encrypted);
          [employee] = await tx`
            UPDATE employees SET
              guardian_name=coalesce(${row.guardianName},guardian_name),
              department_id=coalesce(department_id,${row.department ? departmentIds[row.department] : null}::uuid),
              position=CASE WHEN ${row.positionConfirmed} AND (position IS NULL OR position IN ('Employee','Worker')) THEN ${row.position} ELSE position END,
              statutory_details_encrypted=${Object.keys(statutory).length ? sealJson({ ...existingStatutory, ...statutory }) : existing.statutory_details_encrypted},
              source_metadata=coalesce(source_metadata,'{}'::jsonb) || ${tx.json(metadata)},
              updated_at=now()
            WHERE id=${existing.id} RETURNING *
          `;
          updated++;
        } else {
          [employee] = await tx`
            INSERT INTO employees (employee_code,business_head_id,department_id,first_name,last_name,guardian_name,position,employment_type,status,date_joined,statutory_details_encrypted,source_metadata)
            VALUES (${row.employeeCode},${head.id},${row.department ? departmentIds[row.department] : null},${row.firstName},${row.lastName || null},${row.guardianName || null},${row.position},'permanent','active',${row.dateJoined},${Object.keys(statutory).length ? sealJson(statutory) : null},${tx.json(metadata)})
            RETURNING *
          `;
          await tx`
            INSERT INTO employee_events (employee_id,event_type,effective_date,new_values,reason,approved_by,created_by)
            VALUES (${employee.id},'employee_imported',${payload.periodMonth},${tx.json({ employeeCode: row.employeeCode, businessHead: source.businessHead, sourceFileName: source.sourceFileName })},'Imported from verified June 2026 salary register',${actor.id},${actor.id})
          `;
          created++;
        }
        const structure = { ...row.monthlyRates, allowances: Number(row.monthlyRates.hra || 0) + Number(row.monthlyRates.ca || 0) + Number(row.monthlyRates.oa || 0), overtimeRate: 0, divisorDays: 30, source: "June 2026 salary register" };
        await tx`
          INSERT INTO employee_compensation (employee_id,effective_from,annual_ctc,monthly_gross,structure,reason,approved_by)
          VALUES (${employee.id},${payload.periodMonth},${Number(row.monthlyGross) * 12},${row.monthlyGross},${tx.json(structure)},'Monthly salary rate imported from June 2026 register; annual value is monthly gross × 12 because employer-side CTC was not supplied',${actor.id})
          ON CONFLICT (employee_id,effective_from) DO UPDATE SET annual_ctc=excluded.annual_ctc,monthly_gross=excluded.monthly_gross,structure=excluded.structure,reason=excluded.reason,approved_by=excluded.approved_by
        `;
        compensationUpserts++;
        await tx`
          INSERT INTO salary_register_lines (import_id,employee_id,register_type,source_page,source_serial,attendance_days,monthly_rates,earned_dues,deductions,total_dues,total_deductions,net_payable,raw_source)
          VALUES (${registerImport.id},${employee.id},${row.registerType},${row.sourcePage},${row.sourceSerial},${row.attendanceDays},${tx.json(row.monthlyRates)},${tx.json(row.earnedDues)},${tx.json(row.deductions)},${row.totalDues},${row.totalDeductions},${row.netPayable},${tx.json({ guardianName: row.guardianName, esi: row.esi, uan: row.uan, pfAccountNumber: row.pfAccountNumber })})
        `;
        lines++;
        await tx`
          INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason)
          VALUES (${actor.id},${existing ? 'salary_register.employee_updated' : 'salary_register.employee_created'},'employee',${employee.id},${head.id},${tx.json({ employeeCode: row.employeeCode, importId: registerImport.id, periodMonth: payload.periodMonth })},'Verified salary-sheet import')
        `;
      }
      await tx`
        INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason)
        VALUES (${actor.id},'salary_register.imported','salary_register_import',${registerImport.id},${head.id},${tx.json({ sourceFileName: source.sourceFileName, sourceSha256: source.sourceSha256, recordCount: source.employees.length, totals: source.totals })},'Verified June 2026 salary register imported')
      `;
      return { importId: registerImport.id, businessHead: source.businessHead, created, updated, compensationUpserts, lines, totals: source.totals };
    });
    result.created += sourceResult.created; result.updated += sourceResult.updated;
    result.compensationUpserts += sourceResult.compensationUpserts; result.lines += sourceResult.lines;
    result.imports.push(sourceResult);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await sql.end();
}
