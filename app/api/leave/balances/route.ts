import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const employeeId = url.searchParams.get("employeeId");
    const asOf = url.searchParams.get("asOf") || new Date().toISOString().slice(0, 10);
    if (!employeeId) return fail("employeeId is required", 422);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return fail("asOf must be an ISO date", 422);
    const [employee] = await db()< { business_head_id: string; department_id: string | null }[]>`
      SELECT business_head_id,department_id FROM employees WHERE id=${employeeId}
    `;
    if (!employee) return fail("Employee not found", 404);
    const user = await requireApiUser("leave:read", employee.business_head_id, employee.department_id);
    if (user instanceof Response) return user;
    return ok(await db()`
      SELECT p.id AS policy_id,p.code,p.name,p.paid,p.annual_entitlement,p.accrual_frequency,
        p.carry_forward_limit,p.encashable,
        coalesce(sum(l.quantity) FILTER (WHERE l.transaction_date<=${asOf}::date),0)::numeric AS balance,
        coalesce((SELECT sum(r.days) FROM leave_requests r WHERE r.employee_id=${employeeId} AND r.leave_policy_id=p.id AND r.status='pending'),0)::numeric AS pending_days
      FROM leave_policies p
      LEFT JOIN leave_ledger l ON l.leave_policy_id=p.id AND l.employee_id=${employeeId}
      WHERE p.active=true AND p.status='approved' AND p.effective_from<=${asOf}::date
        AND (p.effective_to IS NULL OR p.effective_to>=${asOf}::date)
        AND (p.business_head_id IS NULL OR p.business_head_id=${employee.business_head_id})
      GROUP BY p.id ORDER BY p.name
    `);
  } catch (error) { return apiError(error); }
}
