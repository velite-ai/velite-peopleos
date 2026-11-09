import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";
import { cleanInput } from "@/lib/payroll-input-rules";

// Salary inputs for one salary month: paid leave granted, extra overtime hours, advance deducted, and "no salary".
// Editable until the month goes to review; the salary run reads them (app/api/payroll/run/route.ts).
const EDITABLE = ["open", "inputs_pending", "validating", "calculated", "review"];
type Period = { id: string; business_head_id: string; period_month: string; status: string };

const rowSchema = z.object({
  employeeId: z.uuid(),
  paidLeaveDays: z.coerce.number().min(0).max(31),
  overtimeHours: z.coerce.number().min(0).max(744),
  advanceDeducted: z.coerce.number().min(0).max(10000000),
  noSalary: z.boolean(),
  note: z.string().max(300).optional(),
});
const saveSchema = z.object({ payrollPeriodId: z.uuid(), rows: z.array(rowSchema).min(1).max(500), reason: z.string().min(3).max(300) });

async function loadPeriod(id: string) {
  const [period] = await db()<Period[]>`SELECT id,business_head_id,period_month::text AS period_month,status FROM payroll_periods WHERE id=${id}`;
  return period;
}

export async function GET(request: Request) {
  try {
    const periodId = new URL(request.url).searchParams.get("payrollPeriodId");
    if (!periodId || !z.uuid().safeParse(periodId).success) return fail("Choose a salary month", 422);
    const period = await loadPeriod(periodId);
    if (!period) return fail("Salary month not found", 404);
    const user = await requireApiUser("payroll:read", period.business_head_id);
    if (user instanceof Response) return user;
    const sql = db();
    const monthStart = period.period_month.slice(0, 10);
    const [year, month] = monthStart.split("-").map(Number);
    const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
    const [attendance] = await sql<{ status: string; summary: { employees?: { id: string; expected_days: number; present_days: number; half_days: number; unpaid_days: number | string }[] } | null }[]>`SELECT status,summary FROM attendance_months WHERE business_head_id=${period.business_head_id} AND period_month=${monthStart}::date`;
    const byEmployee = new Map((attendance?.summary?.employees || []).map(row => [row.id, row]));
    const people = await sql<{ id: string; employee_code: string; name: string; position: string | null; separation_type: string | null }[]>`
      SELECT e.id,e.employee_code,concat_ws(' ',e.first_name,e.last_name) AS name,e.position,
             (SELECT s.separation_type FROM separations s WHERE s.employee_id=e.id ORDER BY s.submitted_date DESC LIMIT 1) AS separation_type
      FROM employees e
      WHERE e.business_head_id=${period.business_head_id} AND e.date_joined<=${monthEnd}::date AND (e.last_working_date IS NULL OR e.last_working_date>=${monthStart}::date)
        AND e.status NOT IN ('candidate','preboarding','archived')
      ORDER BY e.employee_code`;
    const saved = await sql<{ employee_id: string; paid_leave_days: string; overtime_hours: string; advance_deducted: string; no_salary: boolean; note: string | null }[]>`SELECT employee_id,paid_leave_days,overtime_hours,advance_deducted,no_salary,note FROM payroll_inputs WHERE payroll_period_id=${period.id}`;
    const savedBy = new Map(saved.map(row => [row.employee_id, row]));
    return ok({
      status: period.status,
      editable: EDITABLE.includes(period.status),
      attendanceStatus: attendance?.status || null,
      rows: people.map(person => {
        const a = byEmployee.get(person.id);
        const s = savedBy.get(person.id);
        const unpaid = a ? Number(a.unpaid_days || 0) : null;
        return {
          employeeId: person.id, code: person.employee_code, name: person.name, position: person.position,
          expectedDays: a ? Number(a.expected_days) : null, presentDays: a ? Number(a.present_days) : null, halfDays: a ? Number(a.half_days) : null, unpaidDays: unpaid,
          paidLeaveDays: s ? Number(s.paid_leave_days) : 0, overtimeHours: s ? Number(s.overtime_hours) : 0, advanceDeducted: s ? Number(s.advance_deducted) : 0,
          // Someone who stopped coming without informing the company gets no salary: suggested until a row is saved.
          noSalary: s ? s.no_salary : person.separation_type === "abandonment", note: s?.note || "",
          stoppedComing: person.separation_type === "abandonment", saved: Boolean(s),
        };
      }),
    });
  } catch (error) { return apiError(error); }
}

export async function PUT(request: Request) {
  try {
    const input = saveSchema.parse(await request.json());
    const period = await loadPeriod(input.payrollPeriodId);
    if (!period) return fail("Salary month not found", 404);
    const user = await requireApiUser("payroll:write", period.business_head_id);
    if (user instanceof Response) return user;
    if (!EDITABLE.includes(period.status)) return fail(`The salary inputs cannot be changed while the month is ${period.status.replaceAll("_", " ")}`, 409);
    const sql = db();
    const monthStart = period.period_month.slice(0, 10);
    const allowed = await sql<{ id: string }[]>`SELECT id FROM employees WHERE business_head_id=${period.business_head_id} AND id = ANY(${input.rows.map(row => row.employeeId)}::uuid[])`;
    const allowedIds = new Set(allowed.map(row => row.id));
    const stranger = input.rows.find(row => !allowedIds.has(row.employeeId));
    if (stranger) return fail("One of the people is not in this company", 422);
    const changed = await sql.begin(async tx => {
      let count = 0;
      for (const row of input.rows) {
        const clean = cleanInput(row);
        const [before] = await tx<{ paid_leave_days: string; overtime_hours: string; advance_deducted: string; no_salary: boolean }[]>`SELECT paid_leave_days,overtime_hours,advance_deducted,no_salary FROM payroll_inputs WHERE payroll_period_id=${period.id} AND employee_id=${row.employeeId}`;
        const isEmpty = clean.paidLeaveDays === 0 && clean.overtimeHours === 0 && clean.advanceDeducted === 0 && !clean.noSalary && !(row.note || "").trim();
        if (!before && isEmpty) continue;
        if (before && Number(before.paid_leave_days) === clean.paidLeaveDays && Number(before.overtime_hours) === clean.overtimeHours && Number(before.advance_deducted) === clean.advanceDeducted && before.no_salary === clean.noSalary) {
          await tx`UPDATE payroll_inputs SET note=${(row.note || "").trim() || null} WHERE payroll_period_id=${period.id} AND employee_id=${row.employeeId}`;
          continue;
        }
        await tx`INSERT INTO payroll_inputs (payroll_period_id,employee_id,paid_leave_days,overtime_hours,advance_deducted,no_salary,note,updated_by,updated_at)
                 VALUES (${period.id},${row.employeeId},${clean.paidLeaveDays},${clean.overtimeHours},${clean.advanceDeducted},${clean.noSalary},${(row.note || "").trim() || null},${user.id},now())
                 ON CONFLICT (payroll_period_id,employee_id) DO UPDATE SET paid_leave_days=EXCLUDED.paid_leave_days,overtime_hours=EXCLUDED.overtime_hours,advance_deducted=EXCLUDED.advance_deducted,no_salary=EXCLUDED.no_salary,note=EXCLUDED.note,updated_by=EXCLUDED.updated_by,updated_at=now()`;
        await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason)
                 VALUES (${user.id},'payroll.inputs',${"payroll_period"},${period.id},${period.business_head_id},${JSON.stringify(before ? { paidLeaveDays: Number(before.paid_leave_days), overtimeHours: Number(before.overtime_hours), advanceDeducted: Number(before.advance_deducted), noSalary: before.no_salary } : null)}::jsonb,${JSON.stringify({ employeeId: row.employeeId, periodMonth: monthStart, ...clean })}::jsonb,${input.reason})`;
        count++;
      }
      return count;
    });
    return ok({ changed });
  } catch (error) { return apiError(error); }
}
