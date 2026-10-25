import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";

const schema = z.object({
  effectiveFrom: z.iso.date(), annualCtc: z.number().nonnegative(), monthlyGross: z.number().nonnegative(),
  structure: z.record(z.string(), z.number().nonnegative()),
  reason: z.string().trim().min(3).max(2000), // why it is being corrected; kept in the history and audit trail
}).refine(value => value.monthlyGross * 12 <= value.annualCtc * 1.25, { message: "Monthly gross is inconsistent with annual CTC" });

type Revision = { id: string; employee_id: string; effective_from: string; effective_to: string | null; annual_ctc: string; monthly_gross: string; structure: Record<string, number> };
const sameStructure = (a: Record<string, number>, b: Record<string, number>) => JSON.stringify(Object.entries(a).sort(([x], [y]) => x.localeCompare(y))) === JSON.stringify(Object.entries(b).sort(([x], [y]) => x.localeCompare(y)));

// Corrects one pay rate in the history. It must stay between its neighbours (so the periods keep following each other without gaps or overlaps),
// and a rate that a salary month under review, approved, locked or paid has already used cannot be changed: add a new revision instead.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; revisionId: string }> }) {
  try {
    const { id, revisionId } = await params;
    const input = schema.parse(await request.json());
    const sql = db();
    const [employee] = await sql<{ business_head_id: string }[]>`SELECT business_head_id FROM employees WHERE id=${id}`;
    if (!employee) return fail("Employee not found", 404);
    const user = await requireApiUser("payroll:write", employee.business_head_id);
    if (user instanceof Response) return user;

    const result = await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`employee-compensation:${id}`}))`;
      const [row] = await tx<Revision[]>`SELECT id,employee_id,effective_from::text AS effective_from,effective_to::text AS effective_to,annual_ctc::text AS annual_ctc,monthly_gross::text AS monthly_gross,structure FROM employee_compensation WHERE id=${revisionId} AND employee_id=${id} FOR UPDATE`;
      if (!row) return { error: "That pay entry was not found.", code: 404 };
      const [previous] = await tx<{ id: string; effective_from: string }[]>`SELECT id,effective_from::text AS effective_from FROM employee_compensation WHERE employee_id=${id} AND effective_from<${row.effective_from}::date ORDER BY effective_from DESC LIMIT 1`;
      const [next] = await tx<{ effective_from: string }[]>`SELECT effective_from::text AS effective_from FROM employee_compensation WHERE employee_id=${id} AND effective_from>${row.effective_from}::date ORDER BY effective_from LIMIT 1`;
      if (previous && input.effectiveFrom <= previous.effective_from) return { error: `The start date must be after the earlier entry's start (${previous.effective_from}).`, code: 422 };
      if (next && input.effectiveFrom >= next.effective_from) return { error: `The start date must be before the next entry's start (${next.effective_from}).`, code: 422 };
      const changed = input.effectiveFrom !== row.effective_from || Number(row.annual_ctc) !== input.annualCtc || Number(row.monthly_gross) !== input.monthlyGross || !sameStructure(row.structure, input.structure);
      if (!changed) return { error: "Nothing was changed.", code: 422 };
      // Salary months that already used this rate and are past the "calculated" stage.
      const used = await tx<{ month: string; status: string }[]>`
        SELECT to_char(p.period_month,'Mon YYYY') AS month,p.status::text AS status FROM payroll_results r JOIN payroll_periods p ON p.id=r.payroll_period_id
        WHERE r.employee_id=${id} AND p.status::text IN ('review','approved','locked','paid')
          AND p.period_month>=date_trunc('month',${row.effective_from}::date)::date
          AND (${row.effective_to}::date IS NULL OR p.period_month<=${row.effective_to}::date)
        ORDER BY p.period_month`;
      if (used.length) return { error: `This pay rate was already used for ${used.map(item => `${item.month} (${item.status})`).join(", ")}. Add a new revision instead, or reopen that salary month first.`, code: 409 };
      const [updated] = await tx`UPDATE employee_compensation SET effective_from=${input.effectiveFrom}::date,annual_ctc=${input.annualCtc},monthly_gross=${input.monthlyGross},structure=${tx.json(input.structure)} WHERE id=${revisionId} RETURNING *`;
      // Keep the earlier entry ending the day before this one starts.
      if (previous) await tx`UPDATE employee_compensation SET effective_to=${input.effectiveFrom}::date-1 WHERE id=${previous.id}`;
      const before = { effectiveFrom: row.effective_from, annualCtc: Number(row.annual_ctc), monthlyGross: Number(row.monthly_gross), structure: row.structure };
      const after = { effectiveFrom: input.effectiveFrom, annualCtc: input.annualCtc, monthlyGross: input.monthlyGross, structure: input.structure };
      await tx`INSERT INTO employee_events (employee_id,event_type,effective_date,previous_values,new_values,reason,approved_by,created_by) VALUES (${id},'compensation_revision',${input.effectiveFrom}::date,${tx.json(before)},${tx.json({ ...after, corrected: true })},${input.reason},${user.id},${user.id})`;
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason) VALUES (${user.id},'compensation.edit','employee_compensation',${revisionId},${employee.business_head_id},${tx.json(before)},${tx.json(after)},${input.reason})`;
      return { done: updated };
    });
    if ("error" in result) return fail(result.error as string, result.code as number);
    return ok(result.done);
  } catch (error) { return apiError(error); }
}
