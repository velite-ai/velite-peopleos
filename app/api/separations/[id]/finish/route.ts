import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";

const schema = z.object({ reason: z.string().trim().min(3).max(2000), regrettable: z.boolean().optional(), rehireEligible: z.boolean().optional() });

// Finishes an exit in one step: approves it if it was still waiting, checks that every exit step is ticked and that the last working day has come,
// then completes it. The person becomes "separated" (Left the company) with their last working day. Same entries as approving and completing separately.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = schema.parse(await request.json());
    const sql = db();
    const [record] = await sql<{ id: string; status: string; employee_id: string; business_head_id: string; department_id: string | null; proposed: string; approved: string | null; name: string }[]>`
      SELECT s.id,s.status::text AS status,s.employee_id,e.business_head_id,e.department_id,s.proposed_last_working_date::text AS proposed,s.approved_last_working_date::text AS approved,concat_ws(' ',e.first_name,e.last_name) AS name
      FROM separations s JOIN employees e ON e.id=s.employee_id WHERE s.id=${id}`;
    if (!record) return fail("Exit not found", 404);
    const user = await requireApiUser("separation:write", record.business_head_id, record.department_id);
    if (user instanceof Response) return user;
    const result = await sql.begin(async tx => {
      const [locked] = await tx<{ status: string }[]>`SELECT status::text AS status FROM separations WHERE id=${id} FOR UPDATE`;
      if (!["pending", "approved"].includes(locked.status)) return { error: `This exit is already ${locked.status}.`, code: 409 };
      const [open] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM separation_tasks WHERE separation_id=${id} AND status<>'completed'`;
      if (open.n) return { error: `${open.n} exit step${open.n === 1 ? " is" : "s are"} still not done. Tick them first.`, code: 409 };
      const lastDay = record.approved || record.proposed;
      const [today] = await tx<{ d: string }[]>`SELECT current_date::text AS d`;
      if (lastDay > today.d) return { error: `The last working day is ${lastDay}. Finish the exit on or after that day.`, code: 409 };
      const [before] = await tx`SELECT * FROM employees WHERE id=${record.employee_id} FOR UPDATE`;
      await tx`UPDATE separations SET status='completed',approved_last_working_date=${lastDay}::date,approved_by=coalesce(approved_by,${user.id}),regrettable=coalesce(${input.regrettable ?? null},regrettable),rehire_eligible=coalesce(${input.rehireEligible ?? null},rehire_eligible) WHERE id=${id}`;
      const [after] = await tx`UPDATE employees SET status='separated',last_working_date=${lastDay}::date,updated_at=now() WHERE id=${record.employee_id} RETURNING *`;
      await tx`INSERT INTO employee_events (employee_id,event_type,effective_date,previous_values,new_values,reason,approved_by,created_by) VALUES (${record.employee_id},'separation',${lastDay}::date,${tx.json({ status: before.status })},${tx.json({ status: "separated", lastWorkingDate: lastDay })},${input.reason},${user.id},${user.id})`;
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason) VALUES (${user.id},'separation.complete','separation',${id},${record.business_head_id},${tx.json({ status: locked.status })},${tx.json({ status: "completed", lastWorkingDate: lastDay, employeeStatus: after.status })},${input.reason})`;
      return { done: { id, status: "completed", lastWorkingDate: lastDay } };
    });
    if ("error" in result) return fail(result.error as string, result.code as number);
    return ok(result.done);
  } catch (error) { return apiError(error); }
}
