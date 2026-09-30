import { db } from "@/lib/database";
import { apiError, ok, requireApiUser } from "@/lib/api";

export async function GET() {
  try {
    const user = await requireApiUser();
    if (user instanceof Response) return user;
    const unrestricted = user.roles.some(role => role.code !== "EMPLOYEE" && (role.code === "SUPER_ADMIN" || (!role.businessHeadId && !role.departmentId)));
    if (unrestricted) return ok(await db()`SELECT id, code, name FROM business_heads WHERE active = true ORDER BY name`);
    const explicit = user.roles.map(role => role.businessHeadId).filter((id): id is string => Boolean(id));
    const departments = user.roles.map(role => role.departmentId).filter((id): id is string => Boolean(id));
    const departmentHeads = departments.length
      ? await db()<{ business_head_id: string }[]>`SELECT DISTINCT business_head_id FROM departments WHERE id IN ${db()(departments)}`
      : [];
    if (!explicit.length && !departmentHeads.length && user.roles.some(role => role.code === "EMPLOYEE")) {
      const own = await db()<{ id: string; code: string; name: string }[]>`
        SELECT b.id, b.code, b.name
        FROM employees e JOIN business_heads b ON b.id = e.business_head_id
        WHERE e.user_id = ${user.id} AND b.active = true
      `;
      return ok(own);
    }
    const scoped = [...new Set([...explicit, ...departmentHeads.map(row => row.business_head_id)])];
    if (!scoped.length) return ok([]);
    return ok(await db()`SELECT id, code, name FROM business_heads WHERE active = true AND id IN ${db()(scoped)} ORDER BY name`);
  } catch (error) {
    return apiError(error);
  }
}
