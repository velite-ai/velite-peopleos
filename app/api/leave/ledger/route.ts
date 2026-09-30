import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { hasRoleForScope } from "@/lib/auth";
import { db } from "@/lib/database";

const schema = z.object({
  employeeId: z.uuid(),
  leavePolicyId: z.uuid(),
  action: z.enum(["opening_balance", "manual_adjustment", "reversal"]),
  transactionDate: z.iso.date(),
  quantity: z.number().min(-365).max(365).optional(),
  reversesEntryId: z.uuid().optional(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9:_-]{8,120}$/),
  reason: z.string().min(5).max(1000),
}).superRefine((value, context) => {
  if (value.action === "opening_balance" && (!value.quantity || value.quantity <= 0)) context.addIssue({ code: "custom", message: "Opening balance must be positive", path: ["quantity"] });
  if (value.action === "manual_adjustment" && (!value.quantity || value.quantity === 0)) context.addIssue({ code: "custom", message: "Manual adjustment must be non-zero", path: ["quantity"] });
  if (value.action === "reversal" && !value.reversesEntryId) context.addIssue({ code: "custom", message: "The entry being reversed is required", path: ["reversesEntryId"] });
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const employeeId = url.searchParams.get("employeeId");
    const policyId = url.searchParams.get("leavePolicyId");
    if (!employeeId) return fail("employeeId is required", 422);
    const [employee] = await db()< { business_head_id: string; department_id: string | null }[]>`SELECT business_head_id,department_id FROM employees WHERE id=${employeeId}`;
    if (!employee) return fail("Employee not found", 404);
    const user = await requireApiUser("leave:read", employee.business_head_id, employee.department_id);
    if (user instanceof Response) return user;
    return ok(await db()`
      SELECT l.id,l.employee_id,l.leave_policy_id,p.code AS leave_code,p.name AS leave_name,
        l.transaction_date,l.quantity,l.transaction_type,l.reference_type,l.reference_id,l.remarks,
        l.reverses_entry_id,l.idempotency_key,l.created_at,u.full_name AS created_by_name,
        sum(l.quantity) OVER (PARTITION BY l.employee_id,l.leave_policy_id ORDER BY l.transaction_date,l.created_at,l.id ROWS UNBOUNDED PRECEDING)::numeric AS running_balance
      FROM leave_ledger l JOIN leave_policies p ON p.id=l.leave_policy_id LEFT JOIN users u ON u.id=l.created_by
      WHERE l.employee_id=${employeeId} AND (${policyId}::uuid IS NULL OR l.leave_policy_id=${policyId}::uuid)
      ORDER BY l.transaction_date DESC,l.created_at DESC
    `);
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const sql = db();
    const [scope] = await sql<{ business_head_id: string; department_id: string | null }[]>`
      SELECT e.business_head_id,e.department_id FROM employees e JOIN leave_policies p ON p.id=${input.leavePolicyId}
      WHERE e.id=${input.employeeId} AND p.status='approved' AND p.active=true
        AND (p.business_head_id IS NULL OR p.business_head_id=e.business_head_id)
    `;
    if (!scope) return fail("Employee or approved leave policy not found for this business head", 404);
    const user = await requireApiUser("leave:write", scope.business_head_id, scope.department_id);
    if (user instanceof Response) return user;
    if (!hasRoleForScope(user, ["HR_ADMIN", "HR_OPERATIONS"], scope.business_head_id, scope.department_id)) return fail("Only HR administrators or HR operations can post leave ledger adjustments", 403);
    const reversalTargetId = input.action === "reversal" ? input.reversesEntryId : null;
    if (input.action === "reversal" && !reversalTargetId) return fail("The entry being reversed is required", 422);
    const result = await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`leave:${input.employeeId}:${input.leavePolicyId}`}))`;
      const [existing] = await tx`SELECT * FROM leave_ledger WHERE idempotency_key=${input.idempotencyKey}`;
      if (existing) return { entry: existing, idempotent: true };
      let quantity = Number(input.quantity || 0);
      let reversesEntryId: string | null = null;
      if (input.action === "reversal") {
        const [original] = await tx<{ id: string; quantity: number; employee_id: string; leave_policy_id: string }[]>`
          SELECT id,quantity,employee_id,leave_policy_id FROM leave_ledger WHERE id=${reversalTargetId!} FOR UPDATE
        `;
        if (!original || original.employee_id !== input.employeeId || original.leave_policy_id !== input.leavePolicyId) return { error: "reversal_target" as const };
        const alreadyReversed = await tx`SELECT 1 FROM leave_ledger WHERE reverses_entry_id=${original.id} LIMIT 1`;
        if (alreadyReversed.length) return { error: "already_reversed" as const };
        quantity = -Number(original.quantity);
        reversesEntryId = original.id;
      }
      const [entry] = await tx`
        INSERT INTO leave_ledger (
          employee_id,leave_policy_id,transaction_date,quantity,transaction_type,reference_type,reference_id,
          remarks,created_by,idempotency_key,reverses_entry_id
        ) VALUES (
          ${input.employeeId},${input.leavePolicyId},${input.transactionDate},${quantity},${input.action},
          ${input.action === "reversal" ? "leave_ledger_reversal" : "manual_leave_accounting"},${reversesEntryId},
          ${input.reason},${user.id},${input.idempotencyKey},${reversesEntryId}
        ) RETURNING *
      `;
      await tx`
        INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason)
        VALUES (${user.id},${`leave_ledger.${input.action}`},'leave_ledger',${entry.id},${scope.business_head_id},${JSON.stringify(entry)}::jsonb,${input.reason})
      `;
      return { entry, idempotent: false };
    });
    if ("error" in result && result.error === "reversal_target") return fail("The ledger entry to reverse was not found in this employee policy account", 404);
    if ("error" in result && result.error === "already_reversed") return fail("This ledger entry has already been reversed", 409);
    return ok(result, { status: result.idempotent ? 200 : 201 });
  } catch (error) { return apiError(error); }
}
