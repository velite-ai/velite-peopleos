import { z } from "zod";
import { apiError, ok, requireApiUser } from "@/lib/api";
import { hasPermissionForScope, hasUnscopedPermission } from "@/lib/auth";
import { db } from "@/lib/database";
import { buildSearchPermissionScope } from "@/lib/search-scope";

const inputSchema = z.object({
  q: z.string().trim().min(2).max(100),
  businessHeadId: z.uuid().nullable().optional(),
});

const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

type SearchModule =
  | "My Workspace"
  | "People"
  | "Recruitment"
  | "Daily Attendance"
  | "Leave & Shifts"
  | "Helpdesk"
  | "Separation";

type SearchItem = {
  id: string;
  kind: string;
  title: string;
  subtitle: string;
  status: string | null;
  module: SearchModule;
  businessHeadId: string | null;
};

type ScopedRow = {
  id: string;
  title: string;
  subtitle: string;
  status: string | null;
  business_head_id: string | null;
  department_id?: string | null;
  owner_employee_id?: string | null;
  occurred_at?: string | Date | null;
};

const item = (row: ScopedRow, kind: string, module: SearchModule): SearchItem => ({
  id: row.id,
  kind,
  title: row.title,
  subtitle: row.subtitle,
  status: row.status,
  module,
  businessHeadId: row.business_head_id,
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input = inputSchema.parse({
      q: url.searchParams.get("q") || "",
      businessHeadId: url.searchParams.get("businessHeadId") || null,
    });
    const user = await requireApiUser();
    if (user instanceof Response) return user;

    const sql = db();
    const [businessHeads, departmentRows, ownEmployees] = await Promise.all([
      sql<{id: string}[]>`SELECT id FROM business_heads WHERE active=true`,
      sql<{id: string;business_head_id: string}[]>`SELECT id,business_head_id FROM departments WHERE active=true`,
      sql<{id: string;business_head_id: string;department_id: string|null}[]>`
        SELECT id,business_head_id,department_id FROM employees WHERE user_id=${user.id} LIMIT 1
      `,
    ]);
    const departments = departmentRows.map(row => ({ id: row.id, businessHeadId: row.business_head_id }));
    const ownEmployee = ownEmployees[0] || null;
    const pattern = `%${input.q}%`;
    const requestedHead = input.businessHeadId || null;
    const ids = (values: string[]) => values.length ? values : [EMPTY_UUID];
    const permissionPolicy = { hasPermissionForScope, hasUnscopedPermission };

    const peopleScope = buildSearchPermissionScope(user, "people:read", businessHeads, departments, permissionPolicy);
    const recruitmentScope = buildSearchPermissionScope(user, "recruitment:read", businessHeads, departments, permissionPolicy);
    const leaveScope = buildSearchPermissionScope(user, "leave:read", businessHeads, departments, permissionPolicy);
    const expenseScope = buildSearchPermissionScope(user, "expenses:read", businessHeads, departments, permissionPolicy);
    const attendanceScope = buildSearchPermissionScope(user, "attendance:read", businessHeads, departments, permissionPolicy);
    const helpdeskScope = buildSearchPermissionScope(user, "helpdesk:read", businessHeads, departments, permissionPolicy);
    const separationScope = buildSearchPermissionScope(user, "separation:read", businessHeads, departments, permissionPolicy);
    const documentScope = buildSearchPermissionScope(user, "documents:read", businessHeads, departments, permissionPolicy);
    const policyScope = buildSearchPermissionScope(user, "policies:read", businessHeads, departments, permissionPolicy);

    const canSeeConfidentialCases = user.roles.some(role =>
      ["SUPER_ADMIN", "HR_ADMIN", "HR_OPERATIONS"].includes(role.code),
    );

    const [employees, candidates, leaveRequests, expenseClaims, corrections, cases, separations, documents, policies] = await Promise.all([
      peopleScope.any || ownEmployee ? sql<ScopedRow[]>`
        SELECT e.id,concat_ws(' ',e.first_name,e.last_name) AS title,
          concat_ws(' · ',e.employee_code,e.position,d.name,b.name) AS subtitle,
          e.status::text AS status,e.business_head_id,e.department_id
        FROM employees e
        JOIN business_heads b ON b.id=e.business_head_id
        LEFT JOIN departments d ON d.id=e.department_id
        WHERE (${requestedHead}::uuid IS NULL OR e.business_head_id=${requestedHead}::uuid)
          AND (
            e.id=${ownEmployee?.id || null}::uuid OR ${peopleScope.all}
            OR e.business_head_id IN ${sql(ids(peopleScope.businessHeadIds))}
            OR e.department_id IN ${sql(ids(peopleScope.departmentIds))}
          )
          AND concat_ws(' ',e.first_name,e.last_name,e.employee_code,e.position,d.name,b.name) ILIKE ${pattern}
        ORDER BY e.first_name,e.last_name NULLS LAST LIMIT 12
      ` : Promise.resolve([] as ScopedRow[]),
      recruitmentScope.any ? sql<ScopedRow[]>`
        SELECT c.id,c.full_name AS title,
          concat_ws(' · ',c.position,r.requisition_code,d.name,b.name) AS subtitle,
          c.stage AS status,c.business_head_id,c.department_id
        FROM candidates c
        JOIN business_heads b ON b.id=c.business_head_id
        LEFT JOIN departments d ON d.id=c.department_id
        LEFT JOIN job_requisitions r ON r.id=c.requisition_id
        WHERE (${requestedHead}::uuid IS NULL OR c.business_head_id=${requestedHead}::uuid)
          AND (
            ${recruitmentScope.all}
            OR c.business_head_id IN ${sql(ids(recruitmentScope.businessHeadIds))}
            OR c.department_id IN ${sql(ids(recruitmentScope.departmentIds))}
          )
          AND concat_ws(' ',c.full_name,c.position,r.requisition_code,d.name,b.name,c.stage) ILIKE ${pattern}
        ORDER BY c.updated_at DESC LIMIT 12
      ` : Promise.resolve([] as ScopedRow[]),
      leaveScope.any || ownEmployee ? sql<ScopedRow[]>`
        SELECT r.id,concat_ws(' · ',r.leave_type,concat_ws(' ',e.first_name,e.last_name)) AS title,
          concat_ws(' · ',e.employee_code,r.start_date::text||' to '||r.end_date::text,b.name) AS subtitle,
          r.status::text AS status,e.business_head_id,e.department_id,e.id AS owner_employee_id,r.created_at AS occurred_at
        FROM leave_requests r
        JOIN employees e ON e.id=r.employee_id
        JOIN business_heads b ON b.id=e.business_head_id
        WHERE (${requestedHead}::uuid IS NULL OR e.business_head_id=${requestedHead}::uuid)
          AND (
            e.id=${ownEmployee?.id || null}::uuid OR ${leaveScope.all}
            OR e.business_head_id IN ${sql(ids(leaveScope.businessHeadIds))}
            OR e.department_id IN ${sql(ids(leaveScope.departmentIds))}
          )
          AND concat_ws(' ',r.leave_type,e.first_name,e.last_name,e.employee_code,r.status::text) ILIKE ${pattern}
        ORDER BY r.created_at DESC LIMIT 10
      ` : Promise.resolve([] as ScopedRow[]),
      expenseScope.any || ownEmployee ? sql<ScopedRow[]>`
        SELECT c.id,concat_ws(' · ',c.claim_number,concat_ws(' ',e.first_name,e.last_name)) AS title,
          concat_ws(' · ',c.category,e.employee_code,b.name) AS subtitle,
          c.status::text AS status,e.business_head_id,e.department_id,e.id AS owner_employee_id,c.created_at AS occurred_at
        FROM expense_claims c
        JOIN employees e ON e.id=c.employee_id
        JOIN business_heads b ON b.id=e.business_head_id
        WHERE (${requestedHead}::uuid IS NULL OR e.business_head_id=${requestedHead}::uuid)
          AND (
            e.id=${ownEmployee?.id || null}::uuid OR ${expenseScope.all}
            OR e.business_head_id IN ${sql(ids(expenseScope.businessHeadIds))}
            OR e.department_id IN ${sql(ids(expenseScope.departmentIds))}
          )
          AND concat_ws(' ',c.claim_number,c.category,e.first_name,e.last_name,e.employee_code,c.status::text) ILIKE ${pattern}
        ORDER BY c.created_at DESC LIMIT 10
      ` : Promise.resolve([] as ScopedRow[]),
      attendanceScope.any || ownEmployee ? sql<ScopedRow[]>`
        SELECT c.id,concat_ws(' · ','Attendance correction',concat_ws(' ',e.first_name,e.last_name)) AS title,
          concat_ws(' · ',e.employee_code,a.attendance_date::text,b.name) AS subtitle,
          c.status AS status,e.business_head_id,e.department_id,e.id AS owner_employee_id,c.created_at AS occurred_at
        FROM attendance_corrections c
        JOIN attendance_days a ON a.id=c.attendance_day_id
        JOIN employees e ON e.id=a.employee_id
        JOIN business_heads b ON b.id=e.business_head_id
        WHERE (${requestedHead}::uuid IS NULL OR e.business_head_id=${requestedHead}::uuid)
          AND (
            e.id=${ownEmployee?.id || null}::uuid OR ${attendanceScope.all}
            OR e.business_head_id IN ${sql(ids(attendanceScope.businessHeadIds))}
            OR e.department_id IN ${sql(ids(attendanceScope.departmentIds))}
          )
          AND concat_ws(' ',e.first_name,e.last_name,e.employee_code,a.attendance_date::text,c.status) ILIKE ${pattern}
        ORDER BY c.created_at DESC LIMIT 10
      ` : Promise.resolve([] as ScopedRow[]),
      helpdeskScope.any || ownEmployee ? sql<ScopedRow[]>`
        SELECT c.id,
          CASE WHEN c.confidential AND NOT (${canSeeConfidentialCases} OR c.employee_id=${ownEmployee?.id || null}::uuid OR c.created_by=${user.id} OR c.assigned_to=${user.id})
            THEN 'Confidential case' ELSE concat_ws(' · ',c.case_number,c.subject) END AS title,
          concat_ws(' · ',c.category,b.name) AS subtitle,c.status,c.business_head_id,e.department_id,e.id AS owner_employee_id,c.created_at AS occurred_at
        FROM helpdesk_cases c
        JOIN business_heads b ON b.id=c.business_head_id
        LEFT JOIN employees e ON e.id=c.employee_id
        WHERE (${requestedHead}::uuid IS NULL OR c.business_head_id=${requestedHead}::uuid)
          AND (
            c.employee_id=${ownEmployee?.id || null}::uuid OR c.created_by=${user.id} OR c.assigned_to=${user.id}
            OR ${helpdeskScope.all}
            OR c.business_head_id IN ${sql(ids(helpdeskScope.businessHeadIds))}
            OR e.department_id IN ${sql(ids(helpdeskScope.departmentIds))}
          )
          AND (NOT c.confidential OR ${canSeeConfidentialCases} OR c.employee_id=${ownEmployee?.id || null}::uuid OR c.created_by=${user.id} OR c.assigned_to=${user.id})
          AND concat_ws(' ',c.case_number,c.subject,c.category,c.status) ILIKE ${pattern}
        ORDER BY c.created_at DESC LIMIT 10
      ` : Promise.resolve([] as ScopedRow[]),
      separationScope.any || ownEmployee ? sql<ScopedRow[]>`
        SELECT s.id,concat_ws(' · ','Separation',concat_ws(' ',e.first_name,e.last_name)) AS title,
          concat_ws(' · ',s.separation_type,e.employee_code,s.proposed_last_working_date::text,b.name) AS subtitle,
          s.status::text AS status,e.business_head_id,e.department_id,e.id AS owner_employee_id,s.created_at AS occurred_at
        FROM separations s
        JOIN employees e ON e.id=s.employee_id
        JOIN business_heads b ON b.id=e.business_head_id
        WHERE (${requestedHead}::uuid IS NULL OR e.business_head_id=${requestedHead}::uuid)
          AND (
            e.id=${ownEmployee?.id || null}::uuid OR ${separationScope.all}
            OR e.business_head_id IN ${sql(ids(separationScope.businessHeadIds))}
            OR e.department_id IN ${sql(ids(separationScope.departmentIds))}
          )
          AND concat_ws(' ',e.first_name,e.last_name,e.employee_code,s.separation_type,s.status::text) ILIKE ${pattern}
        ORDER BY s.created_at DESC LIMIT 10
      ` : Promise.resolve([] as ScopedRow[]),
      documentScope.any || ownEmployee ? sql<ScopedRow[]>`
        SELECT d.id,d.file_name AS title,
          concat_ws(' · ',d.category,coalesce(concat_ws(' ',e.first_name,e.last_name),c.full_name),b.name) AS subtitle,
          d.scan_status AS status,coalesce(e.business_head_id,c.business_head_id) AS business_head_id,
          coalesce(e.department_id,c.department_id) AS department_id,e.id AS owner_employee_id,d.created_at AS occurred_at
        FROM documents d
        LEFT JOIN employees e ON e.id=d.employee_id
        LEFT JOIN candidates c ON c.id=d.candidate_id
        JOIN business_heads b ON b.id=coalesce(e.business_head_id,c.business_head_id)
        WHERE (${requestedHead}::uuid IS NULL OR coalesce(e.business_head_id,c.business_head_id)=${requestedHead}::uuid)
          AND (
            d.employee_id=${ownEmployee?.id || null}::uuid OR ${documentScope.all}
            OR coalesce(e.business_head_id,c.business_head_id) IN ${sql(ids(documentScope.businessHeadIds))}
            OR coalesce(e.department_id,c.department_id) IN ${sql(ids(documentScope.departmentIds))}
          )
          AND concat_ws(' ',d.file_name,d.category,e.first_name,e.last_name,c.full_name,b.name) ILIKE ${pattern}
        ORDER BY d.created_at DESC LIMIT 12
      ` : Promise.resolve([] as ScopedRow[]),
      policyScope.any || ownEmployee ? sql<ScopedRow[]>`
        SELECT p.id,p.title,concat_ws(' · ',p.code,'Version '||p.version::text,b.name) AS subtitle,
          p.status::text AS status,p.business_head_id,p.created_at AS occurred_at
        FROM policy_documents p
        LEFT JOIN business_heads b ON b.id=p.business_head_id
        WHERE (${requestedHead}::uuid IS NULL OR p.business_head_id=${requestedHead}::uuid OR p.business_head_id IS NULL)
          AND (
            ${policyScope.all}
            OR (${policyScope.any} AND (p.business_head_id IS NULL OR p.business_head_id IN ${sql(ids(policyScope.applicableBusinessHeadIds))}))
            OR (${Boolean(ownEmployee)} AND p.status='approved' AND (p.business_head_id IS NULL OR p.business_head_id=${ownEmployee?.business_head_id || null}::uuid))
          )
          AND concat_ws(' ',p.code,p.title,p.version::text,b.name,p.status::text) ILIKE ${pattern}
        ORDER BY p.effective_from DESC,p.version DESC LIMIT 12
      ` : Promise.resolve([] as ScopedRow[]),
    ]);

    const moduleFor = (row: ScopedRow, fallback: SearchModule): SearchModule =>
      ownEmployee?.id === row.owner_employee_id ? "My Workspace" : fallback;
    const requestRecords: { row: ScopedRow; kind: string; fallback: SearchModule }[] = [
      ...leaveRequests.map(row => ({ row, kind: "leave_request", fallback: "Leave & Shifts" as const })),
      ...expenseClaims.map(row => ({ row, kind: "expense_claim", fallback: "Helpdesk" as const })),
      ...corrections.map(row => ({ row, kind: "attendance_correction", fallback: "Daily Attendance" as const })),
      ...cases.map(row => ({ row, kind: "helpdesk_case", fallback: "Helpdesk" as const })),
      ...separations.map(row => ({ row, kind: "separation", fallback: "Separation" as const })),
    ];
    const requestItems = requestRecords
      .sort((left, right) => new Date(right.row.occurred_at || 0).getTime() - new Date(left.row.occurred_at || 0).getTime())
      .slice(0, 15)
      .map(({ row, kind, fallback }) => item(row, kind, moduleFor(row, fallback)));

    const groups = [
      { key: "employees", label: "People", items: employees.map(row => item(row, "employee", ownEmployee?.id === row.id ? "My Workspace" : "People")) },
      { key: "candidates", label: "Candidates", items: candidates.map(row => item(row, "candidate", "Recruitment")) },
      { key: "requests", label: "Requests & cases", items: requestItems },
      { key: "documents", label: "Documents", items: documents.map(row => item(row, "document", moduleFor(row, row.owner_employee_id ? "People" : "Recruitment"))) },
      { key: "policies", label: "Policies", items: policies.map(row => item(row, "policy", ownEmployee ? "My Workspace" : "Helpdesk")) },
    ];

    return ok({ query: input.q, total: groups.reduce((sum, group) => sum + group.items.length, 0), groups });
  } catch (error) {
    return apiError(error);
  }
}
