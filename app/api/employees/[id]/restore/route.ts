import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";

const schema = z.object({ reason: z.string().min(5).max(2000) });
const RESTORABLE = ["probation", "active", "notice_period", "separated"];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = schema.parse(await request.json());
    const sql = db();
    const [record] = await sql<any[]>`SELECT * FROM employees WHERE id=${id}`;
    if (!record) return fail("Employee not found", 404);
    const user = await requireApiUser("people:write", record.business_head_id, record.department_id);
    if (user instanceof Response) return user;
    if (record.status !== "archived") return fail("Only a removed employee can be restored", 409);
    const result = await sql.begin(async tx => {
      // The status held before removal is kept on the removal event; fall back to active if it cannot be read.
      const [removal] = await tx<{ status: string | null }[]>`SELECT previous_values->>'status' AS status FROM employee_events WHERE employee_id=${id} AND event_type='removed_from_people' ORDER BY created_at DESC LIMIT 1`;
      const status = removal?.status && RESTORABLE.includes(removal.status) ? removal.status : "active";
      const [restored] = await tx`
        UPDATE employees SET
          status=${status}::employment_status,
          source_metadata=coalesce(source_metadata,'{}'::jsonb) - 'removedFromPeopleAt' - 'removedFromPeopleBy',
          updated_at=now()
        WHERE id=${id} AND status='archived'
        RETURNING id,employee_code,status
      `;
      if (!restored) return null;
      await tx`INSERT INTO employee_events (employee_id,event_type,effective_date,previous_values,new_values,reason,approved_by,created_by) VALUES (${id},'restored_to_people',current_date,${tx.json({ status: "archived" })},${tx.json({ status })},${input.reason},${user.id},${user.id})`;
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason) VALUES (${user.id},'employee.restore_to_people','employee',${id},${record.business_head_id},${tx.json({ employeeCode: record.employee_code, status: "archived" })},${tx.json({ employeeCode: record.employee_code, status })},${input.reason})`;
      return { id: restored.id, employeeCode: restored.employee_code, status: restored.status };
    });
    if (!result) return fail("Only a removed employee can be restored", 409);
    return ok(result);
  } catch (error) { return apiError(error); }
}
