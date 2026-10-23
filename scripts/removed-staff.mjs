// Read-only list of the people removed from the Staff list (status "archived"), to plan recording their exits.
// Shows who they are, what is on file for them (last day worked in attendance, pay record, documents) and whether
// someone with the same name is still working (likely duplicate entries). Changes nothing.
import p from 'postgres';
const sql = p(process.env.DATABASE_URL, { max: 1, onnotice: () => {}, connection: { default_transaction_read_only: 'on' } });
const rows = await sql`
  SELECT e.employee_code AS code, regexp_replace(concat_ws(' ', e.first_name, e.last_name), '\\s+', ' ', 'g') AS name, b.name AS company, e.position,
    e.date_joined::text AS joined, e.last_working_date::text AS last_working_day,
    (SELECT max(a.attendance_date)::text FROM attendance_days a WHERE a.employee_id=e.id) AS last_attendance,
    (SELECT count(*)::int FROM attendance_days a WHERE a.employee_id=e.id AND a.attendance_date >= date_trunc('month', current_date)) AS attendance_this_month,
    EXISTS (SELECT 1 FROM employee_compensation c WHERE c.employee_id=e.id) AS has_pay_record,
    (SELECT count(*)::int FROM documents d WHERE d.employee_id=e.id) AS documents,
    (SELECT max(au.occurred_at)::date::text FROM audit_events au WHERE au.entity_id=e.id::text AND au.action='employee.remove_from_people') AS removed_on,
    EXISTS (SELECT 1 FROM employees w WHERE w.id<>e.id AND w.status<>'archived' AND lower(regexp_replace(concat_ws(' ', w.first_name, w.last_name), '\\s+', ' ', 'g')) = lower(regexp_replace(concat_ws(' ', e.first_name, e.last_name), '\\s+', ' ', 'g'))) AS same_name_still_working,
    (SELECT count(*)::int FROM separations s WHERE s.employee_id=e.id) AS exits_recorded
  FROM employees e JOIN business_heads b ON b.id=e.business_head_id
  WHERE e.status='archived' ORDER BY b.name, e.employee_code::text`;
console.log(`${rows.length} people are removed from the Staff list.\n`);
console.table(rows);
process.exit(0);
