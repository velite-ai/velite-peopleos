// Velite PeopleOS - read-only data health report. Prints counts only (no names, no salaries of individuals).
import p from 'postgres';
const sql = p(process.env.DATABASE_URL, { max: 1, onnotice: () => {}, connection: { default_transaction_read_only: 'on' } });
const show = async (title, query) => {
  console.log('\n=== ' + title);
  try { const rows = await query(); if (!rows.length) console.log('(nothing)'); else console.table(rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])))); }
  catch (e) { console.log('(could not read: ' + e.message.split('\n')[0] + ')'); }
};
const live = `e.status IN ('probation','active','notice_period')`;

await show('1. Staff by company and status', () => sql`SELECT b.name company, e.status, count(*)::int n FROM employees e JOIN business_heads b ON b.id=e.business_head_id GROUP BY 1,2 ORDER BY 1,2`);
await show('2. Gaps in staff records (people currently working)', () => sql.unsafe(`SELECT b.name company, count(*)::int working,
  count(*) FILTER (WHERE e.department_id IS NULL)::int no_department,
  count(*) FILTER (WHERE e.reporting_manager_id IS NULL)::int no_manager,
  count(*) FILTER (WHERE coalesce(e.grade,'')='')::int no_grade,
  count(*) FILTER (WHERE coalesce(e.work_email,'')='')::int no_work_email,
  count(*) FILTER (WHERE coalesce(e.phone,'')='')::int no_phone,
  count(*) FILTER (WHERE e.photo_updated_at IS NULL)::int no_photo,
  count(*) FILTER (WHERE coalesce(e.position,'')='')::int no_position
  FROM employees e JOIN business_heads b ON b.id=e.business_head_id WHERE ${live} GROUP BY 1 ORDER BY 1`));
await show('3. Dates that look wrong or overdue', () => sql.unsafe(`SELECT
  count(*) FILTER (WHERE e.date_joined < date '2000-01-01' OR e.date_joined > current_date)::int joining_date_odd,
  count(*) FILTER (WHERE e.status='probation' AND coalesce(e.probation_end_date, e.date_joined + interval '6 months') < current_date)::int probation_overdue,
  count(*) FILTER (WHERE e.status='active' AND e.confirmation_date IS NULL)::int active_but_no_confirmation_date,
  count(*) FILTER (WHERE e.status='notice_period' AND e.last_working_date IS NULL)::int notice_but_no_last_day
  FROM employees e WHERE ${live}`));
await show('4. Duplicate staff codes inside a company', () => sql`SELECT b.name company, e.employee_code, count(*)::int n FROM employees e JOIN business_heads b ON b.id=e.business_head_id WHERE e.status<>'archived' GROUP BY 1,2 HAVING count(*)>1 ORDER BY 3 DESC LIMIT 15`);
await show('5. How long people have been with Velite (working staff)', () => sql.unsafe(`SELECT CASE WHEN e.date_joined > current_date - interval '6 months' THEN 'a. under 6 months' WHEN e.date_joined > current_date - interval '1 year' THEN 'b. 6-12 months' WHEN e.date_joined > current_date - interval '3 years' THEN 'c. 1-3 years' WHEN e.date_joined > current_date - interval '5 years' THEN 'd. 3-5 years' ELSE 'e. over 5 years' END tenure, count(*)::int n FROM employees e WHERE ${live} GROUP BY 1 ORDER BY 1`));
await show('6. Who reports to whom: managers with the most direct reports', () => sql`SELECT concat_ws(' ', m.first_name, m.last_name) manager, b.name company, count(*)::int direct_reports FROM employees e JOIN employees m ON m.id=e.reporting_manager_id JOIN business_heads b ON b.id=m.business_head_id WHERE e.status IN ('probation','active','notice_period') GROUP BY 1,2 ORDER BY 3 DESC LIMIT 10`);
await show('7. Staff by department (working)', () => sql.unsafe(`SELECT coalesce(d.name,'(none)') department, count(*)::int n FROM employees e LEFT JOIN departments d ON d.id=e.department_id WHERE ${live} GROUP BY 1 ORDER BY 2 DESC LIMIT 25`));
await show('8. Attendance: months with data', () => sql`SELECT to_char(date_trunc('month',attendance_date),'YYYY-MM') AS "month", count(*)::int day_records, count(DISTINCT employee_id)::int people FROM attendance_days WHERE attendance_date > current_date - interval '6 months' GROUP BY 1 ORDER BY 1`);
await show('9. Attendance: status mix, last 90 days', () => sql`SELECT status::text, count(*)::int n FROM attendance_days WHERE attendance_date > current_date - interval '90 days' GROUP BY 1 ORDER BY 2 DESC`);
await show('10. Working staff with no attendance at all in the last 30 days', () => sql.unsafe(`SELECT b.name company, count(*)::int n FROM employees e JOIN business_heads b ON b.id=e.business_head_id WHERE ${live} AND NOT EXISTS (SELECT 1 FROM attendance_days a WHERE a.employee_id=e.id AND a.attendance_date > current_date - interval '30 days') GROUP BY 1 ORDER BY 1`));
await show('11. Leave requests by type and status (last 12 months)', () => sql`SELECT leave_type, status::text, count(*)::int requests, round(sum(days),1)::float days FROM leave_requests WHERE start_date > current_date - interval '12 months' GROUP BY 1,2 ORDER BY 1,2`);
await show('12. Pay on file: working staff with and without a salary record', () => sql.unsafe(`SELECT b.name company, count(*)::int working, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM employee_compensation c WHERE c.employee_id=e.id))::int with_salary_record, round(avg((SELECT c.monthly_gross FROM employee_compensation c WHERE c.employee_id=e.id ORDER BY c.effective_from DESC LIMIT 1)))::int average_monthly_gross FROM employees e JOIN business_heads b ON b.id=e.business_head_id WHERE ${live} GROUP BY 1 ORDER BY 1`));
await show('13. Salary months run in the app', () => sql`SELECT to_char(p.period_month,'YYYY-MM') AS "month", b.name company, p.status::text, (SELECT count(*)::int FROM payroll_results r WHERE r.payroll_period_id=p.id) pay_lines FROM payroll_periods p JOIN business_heads b ON b.id=p.business_head_id ORDER BY p.period_month DESC, 2 LIMIT 18`);
await show('14. Imported salary registers', () => sql`SELECT to_char(period_month,'YYYY-MM') AS "month", count(*)::int files FROM salary_register_imports GROUP BY 1 ORDER BY 1 DESC LIMIT 12`);
await show('15. Documents by type and check status', () => sql`SELECT category, scan_status::text, count(*)::int n FROM documents GROUP BY 1,2 ORDER BY 1,2`);
await show('16. Working staff with no document uploaded', () => sql.unsafe(`SELECT b.name company, count(*)::int n FROM employees e JOIN business_heads b ON b.id=e.business_head_id WHERE ${live} AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.employee_id=e.id) GROUP BY 1 ORDER BY 1`));
await show('17. Documents that expire in the next 90 days', () => sql`SELECT category, count(*)::int n FROM documents WHERE expires_on BETWEEN current_date AND current_date + interval '90 days' GROUP BY 1 ORDER BY 2 DESC`);
await show('18. Hiring: candidates by stage', () => sql`SELECT b.name company, c.stage, count(*)::int n FROM candidates c JOIN business_heads b ON b.id=c.business_head_id GROUP BY 1,2 ORDER BY 1,2`);
await show('19. Joiners and leavers by month (last 12 months)', () => sql`SELECT to_char(date_trunc('month', m), 'YYYY-MM') AS "month", (SELECT count(*) FROM employees e WHERE date_trunc('month', e.date_joined)=m)::int joined, (SELECT count(*) FROM employees e WHERE date_trunc('month', e.last_working_date)=m)::int left_company FROM generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month') m ORDER BY 1`);
await show('20. Exits recorded: type and status', () => sql`SELECT separation_type::text, status::text, count(*)::int n FROM separations GROUP BY 1,2 ORDER BY 1,2`);
await show('21. Which parts of the app hold data (tables with rows)', async () => {
  const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1`;
  const out = [];
  for (const { table_name } of tables) { const [r] = await sql.unsafe(`SELECT count(*)::int n FROM "${table_name}"`); if (r.n > 0) out.push({ table: table_name, rows: r.n }); }
  return out.sort((a, b) => b.rows - a.rows).slice(0, 45);
});
await show('22. Who used the app in the last 30 days (by action)', () => sql`SELECT action, count(*)::int n FROM audit_events WHERE occurred_at > now() - interval '30 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 20`);
await show('23. Logins with access (by role)', () => sql`SELECT r.code role, count(DISTINCT ur.user_id)::int logins FROM user_roles ur JOIN roles r ON r.id=ur.role_id JOIN users u ON u.id=ur.user_id AND u.active GROUP BY 1 ORDER BY 2 DESC`);
console.log('\nDone. Nothing was changed.');
process.exit(0);
