import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";

// Who this person can report to: anyone currently working in any Velite company, except themselves and the people who already report
// (directly or through others) to them, who would make a loop. The Reporting manager box in the record uses this list.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sql = db();
    const [record] = await sql<{ business_head_id: string; department_id: string | null }[]>`SELECT business_head_id,department_id FROM employees WHERE id=${id}`;
    if (!record) return fail("Employee not found", 404);
    const user = await requireApiUser("people:write", record.business_head_id, record.department_id);
    if (user instanceof Response) return user;
    const rows = await sql`
      WITH RECURSIVE below AS (
        SELECT id FROM employees WHERE reporting_manager_id=${id}
        UNION
        SELECT e.id FROM employees e JOIN below ON e.reporting_manager_id=below.id
      )
      SELECT e.id,e.employee_code,e.first_name,e.last_name,e.position,e.business_head_id,b.name AS business_head
      FROM employees e JOIN business_heads b ON b.id=e.business_head_id
      WHERE e.id<>${id} AND e.status IN ('probation','active','notice_period') AND e.id NOT IN (SELECT id FROM below)
      ORDER BY b.name,e.first_name,e.last_name LIMIT 2000`;
    return ok(rows);
  } catch (error) { return apiError(error); }
}
