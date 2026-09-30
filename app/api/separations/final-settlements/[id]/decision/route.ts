import { createHash } from "node:crypto";
import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { hasRoleForScope } from "@/lib/auth";
import { db } from "@/lib/database";

const schema = z.object({
  action: z.enum(["submit", "approve", "return", "mark_paid"]),
  reason: z.string().min(5).max(2000),
  paymentReference: z.string().min(3).max(160).optional(),
}).strict().superRefine((value, context) => {
  if (value.action === "mark_paid" && !value.paymentReference) context.addIssue({ code: "custom", path: ["paymentReference"], message: "Payment or collection reference is required" });
});

type Settlement = {
  id: string; status: string; separation_id: string; calculation: {
    attendance?: { summaryChecksum?: string };
  }; calculation_checksum: string | null; calculated_by: string | null; submitted_by: string | null;
  approved_by: string | null; attendance_month_id: string | null; statutory_rule_set_id: string | null;
  compensation_id: string | null; gross_payable: number; recoveries: number; net_payable: number;
  business_head_id: string; department_id: string | null;
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = schema.parse(await request.json());
    const sql = db();
    const [scope] = await sql<Settlement[]>`
      SELECT f.*,e.business_head_id,e.department_id
      FROM final_settlements f JOIN separations s ON s.id=f.separation_id JOIN employees e ON e.id=s.employee_id
      WHERE f.id=${id}
    `;
    if (!scope) return fail("Final settlement not found", 404);
    const permission = input.action === "submit" ? "payroll:write" : "payroll:approve";
    const actor = await requireApiUser(permission, scope.business_head_id, scope.department_id);
    if (actor instanceof Response) return actor;
    if (input.action === "mark_paid" && !hasRoleForScope(actor, ["FINANCE_APPROVER"], scope.business_head_id, scope.department_id)) {
      return fail("Only a finance approver can record final-settlement payment or collection", 403);
    }

    const result = await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`final-settlement:${scope.separation_id}`}))`;
      const [settlement] = await tx<Settlement[]>`
        SELECT f.*,e.business_head_id,e.department_id
        FROM final_settlements f JOIN separations s ON s.id=f.separation_id JOIN employees e ON e.id=s.employee_id
        WHERE f.id=${id} FOR UPDATE OF f
      `;
      if (!settlement) return { error: "missing" as const };
      const allowed = input.action === "submit" ? ["draft", "rejected"].includes(settlement.status)
        : input.action === "approve" ? settlement.status === "pending"
        : input.action === "return" ? ["pending", "approved"].includes(settlement.status)
        : settlement.status === "approved";
      if (!allowed) return { error: "state" as const, status: settlement.status };
      if (input.action === "approve" && (actor.id === settlement.calculated_by || actor.id === settlement.submitted_by)) return { error: "maker_checker" as const };
      if (input.action === "mark_paid" && (actor.id === settlement.calculated_by || actor.id === settlement.submitted_by)) return { error: "maker_payment" as const };

      if (["submit", "approve"].includes(input.action)) {
        if (!settlement.attendance_month_id || !settlement.statutory_rule_set_id || !settlement.compensation_id || !settlement.calculation_checksum) return { error: "legacy" as const };
        const [attendance] = await tx<{ status: string; summary: unknown }[]>`SELECT status,summary FROM attendance_months WHERE id=${settlement.attendance_month_id}`;
        if (!attendance || attendance.status !== "locked") return { error: "attendance_unlocked" as const };
        const currentChecksum = createHash("sha256").update(JSON.stringify(attendance.summary)).digest("hex");
        if (!settlement.calculation.attendance?.summaryChecksum || settlement.calculation.attendance.summaryChecksum !== currentChecksum) return { error: "attendance_changed" as const };
        const [rule] = await tx`SELECT id FROM statutory_rule_sets WHERE id=${settlement.statutory_rule_set_id} AND status='approved'`;
        if (!rule) return { error: "rule_changed" as const };
      }

      if (input.action === "mark_paid") {
        const [openTasks] = await tx<{ count: number }[]>`
          SELECT count(*)::int AS count FROM separation_tasks
          WHERE separation_id=${settlement.separation_id} AND status<>'completed' AND lower(category)<>'finance'
        `;
        if (openTasks.count > 0) return { error: "tasks" as const, count: openTasks.count };
      }

      const nextStatus = input.action === "submit" ? "pending" : input.action === "approve" ? "approved" : input.action === "return" ? "rejected" : "completed";
      const [updated] = await tx`
        UPDATE final_settlements SET status=${nextStatus}::workflow_status,
          submitted_by=CASE WHEN ${input.action}='submit' THEN ${actor.id} WHEN ${input.action}='return' THEN NULL ELSE submitted_by END,
          submitted_at=CASE WHEN ${input.action}='submit' THEN now() WHEN ${input.action}='return' THEN NULL ELSE submitted_at END,
          approved_by=CASE WHEN ${input.action}='approve' THEN ${actor.id} WHEN ${input.action}='return' THEN NULL ELSE approved_by END,
          approved_at=CASE WHEN ${input.action}='approve' THEN now() WHEN ${input.action}='return' THEN NULL ELSE approved_at END,
          paid_by=CASE WHEN ${input.action}='mark_paid' THEN ${actor.id} ELSE paid_by END,
          paid_at=CASE WHEN ${input.action}='mark_paid' THEN now() ELSE paid_at END,
          payment_reference=CASE WHEN ${input.action}='mark_paid' THEN ${input.paymentReference || null} ELSE payment_reference END,
          updated_at=now()
        WHERE id=${settlement.id} RETURNING *
      `;
      if (input.action === "mark_paid") {
        await tx`
          UPDATE separation_tasks SET status='completed',completed_at=coalesce(completed_at,now())
          WHERE separation_id=${settlement.separation_id} AND lower(category)='finance' AND status<>'completed'
        `;
        await tx`
          INSERT INTO document_generation_jobs (job_type,source_record_id,requested_by)
          VALUES ('final_settlement',${settlement.id},${actor.id})
          ON CONFLICT (job_type,source_record_id) DO UPDATE
          SET status='pending',attempts=0,error_message=NULL,next_attempt_at=now(),
            lease_owner=NULL,leased_until=NULL,requested_by=EXCLUDED.requested_by
        `;
      }
      await tx`
        INSERT INTO final_settlement_actions (final_settlement_id,action,actor_user_id,reason,snapshot)
        VALUES (${settlement.id},${input.action},${actor.id},${input.reason},
          ${JSON.stringify({ beforeStatus: settlement.status, afterStatus: nextStatus, totals: { grossPayable: Number(settlement.gross_payable), recoveries: Number(settlement.recoveries), netPayable: Number(settlement.net_payable) }, paymentReference: input.action === "mark_paid" ? input.paymentReference : null })}::jsonb)
      `;
      await tx`
        INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason)
        VALUES (${actor.id},${`final_settlement.${input.action}`},'final_settlement',${settlement.id},${settlement.business_head_id},
          ${JSON.stringify({ status: settlement.status })}::jsonb,
          ${JSON.stringify({ status: nextStatus, paymentReference: input.action === "mark_paid" ? input.paymentReference : null })}::jsonb,${input.reason})
      `;
      return { updated };
    });
    if (result.error === "missing") return fail("Final settlement not found", 404);
    if (result.error === "state") return fail(`Cannot ${input.action.replace("_", " ")} a ${result.status} final settlement`, 409);
    if (result.error === "maker_checker") return fail("The calculator or submitter cannot approve the same final settlement", 409);
    if (result.error === "maker_payment") return fail("The calculator or submitter cannot record payment for the same final settlement", 409);
    if (result.error === "legacy") return fail("This settlement has no immutable source snapshot and must be recalculated", 409);
    if (result.error === "attendance_unlocked") return fail("The source attendance month is no longer locked; recalculate the settlement", 409);
    if (result.error === "attendance_changed") return fail("The locked attendance snapshot changed; recalculate the settlement", 409);
    if (result.error === "rule_changed") return fail("The source rule set is no longer approved; return and recalculate the settlement", 409);
    if (result.error === "tasks") return fail(`${result.count} non-finance offboarding task(s) must be completed before payment`, 409);
    return ok(result.updated);
  } catch (error) { return apiError(error); }
}
