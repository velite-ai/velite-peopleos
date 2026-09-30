import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";
import { developmentActionSchema } from "@/lib/development-plans";

const updateSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  actions: z.array(developmentActionSchema).max(50).optional(),
  dueDate: z.iso.date().nullable().optional(),
  ownerId: z.uuid().nullable().optional(),
  reason: z.string().min(3).max(1000),
}).strict().refine(
  input => input.title !== undefined || input.actions !== undefined || input.dueDate !== undefined || input.ownerId !== undefined,
  "At least one development plan field is required",
);

type PlanScope = {
  id: string;
  employee_id: string;
  business_head_id: string;
  department_id: string | null;
  status: string;
};

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = updateSchema.parse(await request.json());
    const sql = db();
    const [plan] = await sql<PlanScope[]>`
      SELECT p.id,p.employee_id,e.business_head_id,e.department_id,p.status
      FROM development_plans p JOIN employees e ON e.id=p.employee_id WHERE p.id=${id}
    `;
    if (!plan) return fail("Development plan not found", 404);
    const actor = await requireApiUser("performance:write", plan.business_head_id, plan.department_id);
    if (actor instanceof Response) return actor;
    if (!["draft", "rejected"].includes(plan.status)) return fail("Only a draft or rejected development plan can be edited", 409);
    if (input.ownerId) {
      const [owner] = await sql`
        SELECT u.id FROM users u LEFT JOIN employees e ON e.user_id=u.id
        WHERE u.id=${input.ownerId} AND u.active=true
          AND (e.business_head_id=${plan.business_head_id} OR EXISTS (
            SELECT 1 FROM user_roles ur WHERE ur.user_id=u.id
              AND (ur.business_head_id IS NULL OR ur.business_head_id=${plan.business_head_id})
              AND (ur.department_id IS NULL OR ur.department_id=${plan.department_id})
          ))
      `;
      if (!owner) return fail("Development plan owner is outside the employee scope", 422);
    }
    const changedFields = [
      ...(input.title !== undefined ? ["title"] : []),
      ...(input.actions !== undefined ? ["actions"] : []),
      ...(input.dueDate !== undefined ? ["dueDate"] : []),
      ...(input.ownerId !== undefined ? ["ownerId"] : []),
    ];
    const [updated] = await sql.begin(async tx => {
      const [previous] = await tx`SELECT * FROM development_plans WHERE id=${id} FOR UPDATE`;
      if (!previous || !["draft", "rejected"].includes(previous.status)) return [];
      const rows = await tx`
        UPDATE development_plans
        SET title=CASE WHEN ${input.title !== undefined} THEN ${input.title ?? null} ELSE title END,
          actions=CASE WHEN ${input.actions !== undefined} THEN ${input.actions ? JSON.stringify(input.actions) : null}::jsonb ELSE actions END,
          due_date=CASE WHEN ${input.dueDate !== undefined} THEN ${input.dueDate ?? null}::date ELSE due_date END,
          owner_id=CASE WHEN ${input.ownerId !== undefined} THEN ${input.ownerId ?? null}::uuid ELSE owner_id END,
          updated_at=now()
        WHERE id=${id} RETURNING *
      `;
      await tx`
        INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason)
        VALUES (${actor.id},'development_plan.update','development_plan',${id},${plan.business_head_id},
          ${JSON.stringify({ status: previous.status, changedFields })}::jsonb,
          ${JSON.stringify({ status: rows[0].status, changedFields })}::jsonb,${input.reason})
      `;
      return rows;
    });
    if (!updated) return fail("Development plan changed before it could be updated", 409);
    return ok(updated);
  } catch (error) {
    return apiError(error);
  }
}
