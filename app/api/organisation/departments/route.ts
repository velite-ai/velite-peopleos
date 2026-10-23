import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { hasPermissionForScope } from "@/lib/auth";
import { db } from "@/lib/database";
import { cleanName, departmentCode, sameName } from "@/lib/department-rules";

const WORKING = ["probation", "active", "notice_period"];

// Departments of one company (or all the companies the login may read), each with how many people are in it.
export async function GET(request: Request) {
  try {
    const head = new URL(request.url).searchParams.get("businessHeadId") || null;
    const user = await requireApiUser("people:read", head);
    if (user instanceof Response) return user;
    const rows = await db()<{ id: string; business_head_id: string; company: string; code: string; name: string; working: number; former: number }[]>`
      SELECT d.id,d.business_head_id,b.name AS company,d.code,d.name,
        (SELECT count(*)::int FROM employees e WHERE e.department_id=d.id AND e.status::text=ANY(${WORKING})) AS working,
        (SELECT count(*)::int FROM employees e WHERE e.department_id=d.id AND NOT (e.status::text=ANY(${WORKING}))) AS former
      FROM departments d JOIN business_heads b ON b.id=d.business_head_id
      WHERE d.active=true AND (${head}::uuid IS NULL OR d.business_head_id=${head}::uuid)
      ORDER BY b.name,d.name`;
    return ok(rows.filter(row => hasPermissionForScope(user, "people:read", row.business_head_id)));
  } catch (error) { return apiError(error); }
}

const createSchema = z.object({ businessHeadId: z.uuid(), name: z.string().min(2).max(160) });

export async function POST(request: Request) {
  try {
    const input = createSchema.parse(await request.json());
    const name = cleanName(input.name);
    if (name.length < 2) return fail("Type the department name.", 422);
    const user = await requireApiUser("people:write", input.businessHeadId);
    if (user instanceof Response) return user;
    const sql = db();
    const result = await sql.begin(async tx => {
      const existing = await tx<{ id: string; code: string; name: string; active: boolean }[]>`SELECT id,code,name,active FROM departments WHERE business_head_id=${input.businessHeadId}`;
      if (existing.some(row => row.active && sameName(row.name, name))) return { conflict: `There is already a department called "${name}" in this company.` };
      // A department that was deleted earlier under this name comes back, with its old history, instead of a second copy being made.
      const old = existing.find(row => !row.active && sameName(row.name, name));
      let row;
      if (old) [row] = await tx`UPDATE departments SET active=true,name=${name} WHERE id=${old.id} RETURNING *`;
      else [row] = await tx`INSERT INTO departments (business_head_id,code,name) VALUES (${input.businessHeadId},${departmentCode(name, existing.map(item => item.code))},${name}) RETURNING *`;
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason) VALUES (${user.id},'department.create','department',${row.id},${input.businessHeadId},${tx.json({ name: row.name, code: row.code, restored: Boolean(old) })},'Department added')`;
      return { row };
    });
    if ("conflict" in result) return fail(result.conflict as string, 409);
    return ok(result.row, { status: 201 });
  } catch (error) { return apiError(error); }
}
