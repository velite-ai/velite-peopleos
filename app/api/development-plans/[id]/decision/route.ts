import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";

const schema = z.object({
  action: z.enum(["submit", "approve", "reject", "complete", "cancel"]),
  reason: z.string().min(5).max(1000),
}).strict();

const transitions: Record<string, { from: string[]; to: string }> = {
  submit: { from: ["draft", "rejected"], to: "pending" },
  approve: { from: ["pending"], to: "approved" },
  reject: { from: ["pending"], to: "rejected" },
  complete: { from: ["approved"], to: "completed" },
  cancel: { from: ["draft", "pending", "approved", "rejected"], to: "cancelled" },
};

type PlanScope = {
  id: string;
  business_head_id: string;
  department_id: string | null;
  status: string;
  created_by: string | null;
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = schema.parse(await request.json());
    const [plan] = await db()<PlanScope[]>`
      SELECT p.id,e.business_head_id,e.department_id,p.status,p.created_by
      FROM development_plans p JOIN employees e ON e.id=p.employee_id WHERE p.id=${id}
    `;
    if (!plan) return fail("Development plan not found", 404);
    const actor = await requireApiUser("performance:write", plan.business_head_id, plan.department_id);
    if (actor instanceof Response) return actor;
    if (input.action === "approve" && plan.created_by === actor.id) {
      return fail("The development plan creator cannot approve their own plan", 409);
    }
    const transition = transitions[input.action];
    if (!transition.from.includes(plan.status)) return fail(`A ${plan.status} plan cannot be ${input.action}d`, 409);

    const [decided] = await db().begin(async tx => {
      const [locked] = await tx<PlanScope[]>`
        SELECT p.id,e.business_head_id,e.department_id,p.status,p.created_by
        FROM development_plans p JOIN employees e ON e.id=p.employee_id
        WHERE p.id=${id} FOR UPDATE OF p
      `;
      if (!locked || !transition.from.includes(locked.status)) return [];
      if (input.action === "approve" && locked.created_by === actor.id) {
        throw new Error("Development plan creator cannot approve their own plan");
      }
      const rows = await tx`
        UPDATE development_plans
        SET status=${transition.to}::workflow_status,
          approved_by=CASE WHEN ${input.action}='approve' THEN ${actor.id}::uuid ELSE approved_by END,
          approved_at=CASE WHEN ${input.action}='approve' THEN now() ELSE approved_at END,
          decision_reason=${input.reason},updated_at=now()
        WHERE id=${id} RETURNING *
      `;
      await tx`
        INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason)
        VALUES (${actor.id},${`development_plan.${input.action}`},'development_plan',${id},${plan.business_head_id},
          ${JSON.stringify({ status: locked.status })}::jsonb,${JSON.stringify({ status: transition.to })}::jsonb,${input.reason})
      `;
      return rows;
    });
    if (!decided) return fail("Development plan changed before it could be decided", 409);
    return ok(decided);
  } catch (error) {
    return apiError(error);
  }
}
