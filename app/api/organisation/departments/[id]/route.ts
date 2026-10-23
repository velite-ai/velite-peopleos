import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";
import { cleanName, deleteBlockers, movedCount, sameName, type Usage } from "@/lib/department-rules";

type Dept = { id: string; business_head_id: string; name: string; code: string; active: boolean };

const renameSchema = z.object({ name: z.string().min(2).max(160) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = renameSchema.parse(await request.json());
    const name = cleanName(input.name);
    if (name.length < 2) return fail("Type the department name.", 422);
    const sql = db();
    const [dept] = await sql<Dept[]>`SELECT id,business_head_id,name,code,active FROM departments WHERE id=${id}`;
    if (!dept || !dept.active) return fail("Department not found", 404);
    const user = await requireApiUser("people:write", dept.business_head_id);
    if (user instanceof Response) return user;
    const others = await sql<{ name: string }[]>`SELECT name FROM departments WHERE business_head_id=${dept.business_head_id} AND active=true AND id<>${id}`;
    if (others.some(row => sameName(row.name, name))) return fail(`There is already a department called "${name}" in this company.`, 409);
    await sql.begin(async tx => {
      await tx`UPDATE departments SET name=${name} WHERE id=${id}`;
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason) VALUES (${user.id},'department.rename','department',${id},${dept.business_head_id},${tx.json({ name: dept.name })},${tx.json({ name })},'Department renamed')`;
    });
    return ok({ id, name });
  } catch (error) { return apiError(error); }
}

// moveToDepartmentId: where the people (and hiring records) go; null = no department; left out = nothing to move.
const deleteSchema = z.object({ moveToDepartmentId: z.uuid().nullable().optional(), dryRun: z.boolean().optional() });

async function usageOf(q: ReturnType<typeof db>, id: string): Promise<Usage> {
  const [row] = await q<Usage[]>`SELECT
    (SELECT count(*)::int FROM employees WHERE department_id=${id}) AS employees,
    (SELECT count(*)::int FROM candidates WHERE department_id=${id}) AS candidates,
    (SELECT count(*)::int FROM cost_centres WHERE department_id=${id}) AS "costCentres",
    (SELECT count(*)::int FROM job_positions WHERE department_id=${id}) AS "jobPositions",
    (SELECT count(*)::int FROM job_requisitions WHERE department_id=${id}) AS requisitions,
    (SELECT count(*)::int FROM user_roles WHERE department_id=${id}) AS "loginsLimitedToIt",
    (SELECT count(*)::int FROM performance_cycles WHERE department_id=${id}) AS "appraisalCycles",
    (SELECT count(*)::int FROM calibration_sessions WHERE department_id=${id}) AS "calibrationSessions",
    (SELECT count(*)::int FROM departments WHERE parent_id=${id} AND active=true) AS "subDepartments"`;
  return row;
}

// Deleting hides the department (history keeps its name) after moving the people who are in it. dryRun only reports what would happen.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = deleteSchema.parse(await request.json().catch(() => ({})));
    const sql = db();
    const [dept] = await sql<Dept[]>`SELECT id,business_head_id,name,code,active FROM departments WHERE id=${id}`;
    if (!dept || !dept.active) return fail("Department not found", 404);
    const user = await requireApiUser("people:write", dept.business_head_id);
    if (user instanceof Response) return user;

    const plan = async (q: ReturnType<typeof db>) => {
      const usage = await usageOf(q, id);
      const hasTarget = typeof input.moveToDepartmentId === "string";
      const blockers = deleteBlockers(usage, hasTarget);
      const needsMove = usage.employees + usage.candidates + usage.costCentres + usage.jobPositions + usage.requisitions > 0;
      if (needsMove && input.moveToDepartmentId === undefined) blockers.push(`${movedCount(usage)} record(s) are in this department. Choose where to move them.`);
      let target: Dept | undefined;
      if (typeof input.moveToDepartmentId === "string") {
        if (input.moveToDepartmentId === id) blockers.push("Choose a different department to move people to.");
        else { [target] = await q<Dept[]>`SELECT id,business_head_id,name,code,active FROM departments WHERE id=${input.moveToDepartmentId}`; if (!target || !target.active || target.business_head_id !== dept.business_head_id) blockers.push("The department to move people to must be another active department in the same company."); }
      }
      return { usage, blockers, target };
    };

    if (input.dryRun) { const { usage, blockers } = await plan(sql); return ok({ name: dept.name, usage, blockers, canDelete: blockers.length === 0 }); }

    const result = await sql.begin(async tx => {
      await tx`SELECT id FROM departments WHERE id=${id} FOR UPDATE`;
      const { usage, blockers, target } = await plan(tx as unknown as ReturnType<typeof db>);
      if (blockers.length) return { error: blockers.join(" ") };
      const to = target?.id ?? null;
      const movedPeople = await tx`UPDATE employees SET department_id=${to}::uuid,updated_at=now() WHERE department_id=${id} RETURNING id`;
      for (const person of movedPeople) await tx`INSERT INTO employee_events (employee_id,event_type,effective_date,previous_values,new_values,reason,approved_by,created_by) VALUES (${person.id},'profile_change',current_date,${tx.json({ departmentId: id, department: dept.name })},${tx.json({ departmentId: to, department: target?.name ?? null })},${`Department "${dept.name}" was deleted`},${user.id},${user.id})`;
      await tx`UPDATE candidates SET department_id=${to}::uuid WHERE department_id=${id}`;
      await tx`UPDATE cost_centres SET department_id=${to}::uuid WHERE department_id=${id}`;
      await tx`UPDATE job_positions SET department_id=${to}::uuid WHERE department_id=${id}`;
      await tx`UPDATE job_requisitions SET department_id=${to}::uuid WHERE department_id=${id}`;
      await tx`UPDATE departments SET active=false WHERE id=${id}`;
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason) VALUES (${user.id},'department.delete','department',${id},${dept.business_head_id},${tx.json({ name: dept.name, code: dept.code })},${tx.json({ movedTo: target?.name ?? null, moved: usage })},'Department deleted')`;
      return { done: { name: dept.name, movedTo: target?.name ?? null, people: movedPeople.length } };
    });
    if ("error" in result) return fail(result.error as string, 409);
    return ok(result.done);
  } catch (error) { return apiError(error); }
}
