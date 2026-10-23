import { apiError, ok, requireApiUser } from "@/lib/api";
import { hasPermissionForScope } from "@/lib/auth";
import { db } from "@/lib/database";
import { missingItems } from "@/lib/data-cleanup-rules";

// People currently working, each with the details still missing from their record (department, work email, phone, photo, manager, salary record, documents).
// Only people the login may read are listed; the salary check is skipped (not reported) when the login cannot see pay.
export async function GET(request: Request) {
  try {
    const head = new URL(request.url).searchParams.get("businessHeadId") || null;
    const user = await requireApiUser("people:read", head);
    if (user instanceof Response) return user;
    const rows = await db()<{
      id: string; employee_code: string; name: string; position: string | null; status: string; date_joined: string; business_head_id: string; business_head: string; department_id: string | null;
      department: string | null; work_email: string | null; phone: string | null; has_photo: boolean; has_manager: boolean; has_salary: boolean; document_count: number;
    }[]>`
      SELECT e.id,e.employee_code,concat_ws(' ',e.first_name,e.last_name) AS name,e.position,e.status,e.date_joined::text AS date_joined,e.business_head_id,b.name AS business_head,e.department_id,
        d.name AS department,e.work_email,e.phone,(e.photo_updated_at IS NOT NULL) AS has_photo,(e.reporting_manager_id IS NOT NULL) AS has_manager,
        EXISTS (SELECT 1 FROM employee_compensation c WHERE c.employee_id=e.id) AS has_salary,
        (SELECT count(*)::int FROM documents x WHERE x.employee_id=e.id) AS document_count
      FROM employees e JOIN business_heads b ON b.id=e.business_head_id LEFT JOIN departments d ON d.id=e.department_id
      WHERE e.status IN ('probation','active','notice_period') AND (${head}::uuid IS NULL OR e.business_head_id=${head}::uuid)
      ORDER BY b.name,e.first_name,e.last_name`;
    const people = rows.filter(row => hasPermissionForScope(user, "people:read", row.business_head_id, row.department_id)).map(row => {
      const salaryVisible = hasPermissionForScope(user, "payroll:read", row.business_head_id, row.department_id);
      const missing = missingItems({ departmentName: row.department, workEmail: row.work_email, phone: row.phone, hasPhoto: row.has_photo, hasManager: row.has_manager, hasSalary: salaryVisible ? row.has_salary : null, documentCount: row.document_count });
      return { id: row.id, code: row.employee_code, name: row.name.replace(/\s+/g, " ").trim(), position: row.position, status: row.status, joined: row.date_joined, company: row.business_head, department: row.department, missing };
    });
    return ok(people);
  } catch (error) { return apiError(error); }
}
