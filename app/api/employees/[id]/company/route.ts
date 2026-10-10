import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { hasPermissionForScope } from "@/lib/auth";
import { monthBlockers, splitFootprint } from "@/lib/company-correction-rules";
import { db } from "@/lib/database";

const schema = z.object({ businessHeadId: z.uuid(), reason: z.string().trim().min(5).max(2000), dryRun: z.boolean().optional() });

type Query = ReturnType<typeof db>;
type Employee = { id: string; employee_code: string; business_head_id: string; department_id: string | null; reporting_manager_id: string | null; user_id: string | null; first_name: string; last_name: string | null; legal_entity_id: string | null; work_location_id: string | null; cost_centre_id: string | null; job_position_id: string | null };

// Works out what a move would do, and what stops it. Used for the preview and again inside the real move.
async function assess(q: Query, employee: Employee, newHeadId: string) {
  const [from] = await q<{ name: string }[]>`SELECT name FROM business_heads WHERE id=${employee.business_head_id}`;
  const [to] = await q<{ name: string; active: boolean }[]>`SELECT name,active FROM business_heads WHERE id=${newHeadId}`;
  if (!to || !to.active) return { error: "Company not found" as const };
  const tables = await q<{ table_name: string }[]>`SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='employee_id' ORDER BY 1`;
  const counts: Record<string, number> = {};
  for (const { table_name } of tables) {
    const [row] = await q.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${table_name}" WHERE employee_id=$1`, [employee.id]);
    counts[table_name] = row.n;
  }
  const { moves, blockers } = splitFootprint(counts);
  const months = await q<{ company: string; period: string; status: string }[]>`
    SELECT b.name AS company,to_char(m.period_month,'FMMonth YYYY') AS period,m.status
    FROM attendance_months m JOIN business_heads b ON b.id=m.business_head_id
    WHERE m.business_head_id IN (${employee.business_head_id},${newHeadId})
      AND m.period_month IN (SELECT DISTINCT date_trunc('month',attendance_date)::date FROM attendance_days WHERE employee_id=${employee.id})`;
  const blocked = [
    ...blockers.map(item => `${item.count} ${item.label} belong to ${from.name} and cannot be moved automatically`),
    ...monthBlockers(months),
  ];
  const [department] = employee.department_id ? await q<{ name: string }[]>`SELECT name FROM departments WHERE id=${employee.department_id}` : [];
  const [match] = department ? await q<{ id: string; name: string }[]>`SELECT id,name FROM departments WHERE business_head_id=${newHeadId} AND active=true AND lower(name)=lower(${department.name}) LIMIT 1` : [];
  const [reports] = await q<{ n: number }[]>`SELECT count(*)::int AS n FROM employees WHERE reporting_manager_id=${employee.id}`;
  const warnings: string[] = [];
  if (employee.user_id) {
    const [roles] = await q<{ n: number }[]>`SELECT count(*)::int AS n FROM user_roles WHERE user_id=${employee.user_id} AND business_head_id=${employee.business_head_id}`;
    if (roles.n) warnings.push(`This person has a login with ${roles.n} role(s) limited to ${from.name}. Review them in Settings.`);
  }
  return {
    from: from.name, to: to.name, moves, blocked, warnings,
    newDepartmentId: match?.id ?? null,
    cleared: { department: department ? { was: department.name, now: match?.name ?? null } : null, reportingManager: Boolean(employee.reporting_manager_id), directReports: reports.n, companyDetails: Boolean(employee.legal_entity_id || employee.work_location_id || employee.cost_centre_id || employee.job_position_id) },
  };
}

// Corrects the company a person was filed under by mistake. History moves with them, as if they had always been there.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = schema.parse(await request.json());
    const sql = db();
    const [record] = await sql<Employee[]>`SELECT id,employee_code,business_head_id,department_id,reporting_manager_id,user_id,first_name,last_name,legal_entity_id,work_location_id,cost_centre_id,job_position_id FROM employees WHERE id=${id}`;
    if (!record) return fail("Employee not found", 404);
    const user = await requireApiUser("people:write", record.business_head_id, record.department_id);
    if (user instanceof Response) return user;
    if (!user.roles.some(role => role.code === "SUPER_ADMIN" || role.code === "HR_ADMIN")) return fail("Only HR administrators can change a person's company", 403);
    if (!hasPermissionForScope(user, "people:write", input.businessHeadId)) return fail("You do not have permission for the new company", 403);
    if (input.businessHeadId === record.business_head_id) return fail("This person is already in that company", 409);

    if (input.dryRun) {
      const preview = await assess(sql, record, input.businessHeadId);
      if (preview.error) return fail(preview.error, 404);
      return ok({ ...preview, canMove: preview.blocked.length === 0 });
    }

    const result = await sql.begin(async tx => {
      const [locked] = await tx<Employee[]>`SELECT id,employee_code,business_head_id,department_id,reporting_manager_id,user_id,first_name,last_name,legal_entity_id,work_location_id,cost_centre_id,job_position_id FROM employees WHERE id=${id} FOR UPDATE`;
      if (locked.business_head_id !== record.business_head_id) return { error: "This person was changed by someone else. Reload and try again." as const };
      const plan = await assess(tx as unknown as Query, locked, input.businessHeadId);
      if (plan.error) return { error: plan.error };
      if (plan.blocked.length) return { error: plan.blocked.join("; ") };
      const before = { businessHead: plan.from, departmentId: locked.department_id, reportingManagerId: locked.reporting_manager_id };
      const unassigned = await tx`UPDATE employees SET reporting_manager_id=NULL,updated_at=now() WHERE reporting_manager_id=${id} RETURNING id`;
      await tx`UPDATE employees SET business_head_id=${input.businessHeadId},department_id=${plan.newDepartmentId},reporting_manager_id=NULL,legal_entity_id=NULL,work_location_id=NULL,cost_centre_id=NULL,job_position_id=NULL,updated_at=now() WHERE id=${id}`;
      await tx`INSERT INTO employee_events (employee_id,event_type,effective_date,previous_values,new_values,reason,approved_by,created_by) VALUES (${id},'company_corrected',current_date,${tx.json(before)},${tx.json({ businessHead: plan.to, departmentId: plan.newDepartmentId, directReportsUnassigned: unassigned.length })},${input.reason},${user.id},${user.id})`;
      for (const head of [locked.business_head_id, input.businessHeadId]) {
        await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason) VALUES (${user.id},'employee.company_correct','employee',${id},${head},${tx.json({ employeeCode: locked.employee_code, company: plan.from })},${tx.json({ employeeCode: locked.employee_code, company: plan.to, moved: plan.moves, directReportsUnassigned: unassigned.length })},${input.reason})`;
      }
      return { done: { from: plan.from, to: plan.to, moved: plan.moves, directReportsUnassigned: unassigned.length } };
    });
    if ("error" in result) return fail(result.error as string, 409);
    return ok(result.done);
  } catch (error) { return apiError(error); }
}
