import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { hasRoleForScope } from "@/lib/auth";
import { db } from "@/lib/database";

const schema = z.object({ action: z.enum(["submit", "approve", "reject"]), reason: z.string().min(3).max(1000) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = schema.parse(await request.json());
    const sql = db();
    const [policy] = await sql`
      SELECT * FROM leave_policies WHERE id=${id}
    `;
    if (!policy) return fail("Leave policy not found", 404);
    const user = await requireApiUser("leave:write", policy.business_head_id);
    if (user instanceof Response) return user;
    if (!hasRoleForScope(user, ["HR_ADMIN", "HR_OPERATIONS"], policy.business_head_id)) return fail("Only HR administrators or HR operations can manage leave policies", 403);
    if (input.action === "submit" && !["draft", "rejected"].includes(policy.status)) return fail("Only a draft or rejected policy can be submitted", 409);
    if (["approve", "reject"].includes(input.action) && policy.status !== "pending") return fail("Only a pending policy can be decided", 409);
    if (["approve", "reject"].includes(input.action) && policy.submitted_by === user.id) return fail("The policy submitter cannot decide the same policy", 409);
    if (input.action === "approve") {
      const overlap = await sql`
        SELECT id FROM leave_policies
        WHERE id<>${id} AND code=${policy.code} AND status='approved' AND active=true
          AND business_head_id IS NOT DISTINCT FROM ${policy.business_head_id}::uuid
          AND daterange(effective_from,coalesce(effective_to,'infinity'::date),'[]') && daterange(${policy.effective_from}::date,coalesce(${policy.effective_to}::date,'infinity'::date),'[]')
        LIMIT 1
      `;
      if (overlap.length) return fail("An approved policy version already overlaps these effective dates", 409, { conflictingPolicyId: overlap[0].id });
    }
    const next = input.action === "submit" ? "pending" : input.action === "approve" ? "approved" : "rejected";
    const [updated] = await sql.begin(async tx => {
      const rows = await tx`
        UPDATE leave_policies SET status=${next}::workflow_status,
          submitted_by=CASE WHEN ${input.action}='submit' THEN ${user.id} ELSE submitted_by END,
          submitted_at=CASE WHEN ${input.action}='submit' THEN now() ELSE submitted_at END,
          approved_by=CASE WHEN ${input.action}='approve' THEN ${user.id} ELSE NULL END,
          approved_at=CASE WHEN ${input.action}='approve' THEN now() ELSE NULL END
        WHERE id=${id} RETURNING *
      `;
      await tx`
        INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason)
        VALUES (${user.id},${`leave_policy.${input.action}`},'leave_policy',${id},${policy.business_head_id},${JSON.stringify(policy)}::jsonb,${JSON.stringify(rows[0])}::jsonb,${input.reason})
      `;
      return rows;
    });
    return ok(updated);
  } catch (error) { return apiError(error); }
}
