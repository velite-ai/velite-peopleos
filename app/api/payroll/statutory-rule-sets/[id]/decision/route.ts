import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";

const schema = z.object({ action: z.enum(["submit", "approve", "reject"]), reason: z.string().min(3).max(1000) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = schema.parse(await request.json());
    const sql = db();
    const [rule] = await sql`SELECT * FROM statutory_rule_sets WHERE id=${id}`;
    if (!rule) return fail("Statutory rule set not found", 404);
    const permission = input.action === "submit" ? "payroll:write" : "payroll:approve";
    const user = await requireApiUser(permission, rule.business_head_id);
    if (user instanceof Response) return user;
    if (input.action === "submit" && !["draft", "rejected"].includes(rule.status)) return fail("Only a draft or rejected rule set can be submitted", 409);
    if (["approve", "reject"].includes(input.action) && rule.status !== "pending") return fail("Only a pending rule set can be decided", 409);
    if (["approve", "reject"].includes(input.action) && rule.created_by === user.id) return fail("The rule-set maker cannot decide the same version", 409);
    if (input.action === "approve") {
      const overlap = await sql`
        SELECT id FROM statutory_rule_sets
        WHERE id<>${id} AND code=${rule.code} AND status='approved'
          AND business_head_id IS NOT DISTINCT FROM ${rule.business_head_id}::uuid
          AND daterange(effective_from,coalesce(effective_to,'infinity'::date),'[]')
              && daterange(${rule.effective_from}::date,coalesce(${rule.effective_to}::date,'infinity'::date),'[]')
        LIMIT 1
      `;
      if (overlap.length) return fail("An approved rule-set version overlaps these effective dates", 409, { conflictingRuleSetId: overlap[0].id });
    }
    const next = input.action === "submit" ? "pending" : input.action === "approve" ? "approved" : "rejected";
    const [updated] = await sql.begin(async tx => {
      const rows = await tx`
        UPDATE statutory_rule_sets SET status=${next}::workflow_status,
          approved_by=CASE WHEN ${input.action}='approve' THEN ${user.id} ELSE NULL END
        WHERE id=${id} AND status=${rule.status}::workflow_status RETURNING *
      `;
      if (!rows.length) return [];
      await tx`
        INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason)
        VALUES (${user.id},${`statutory_rule_set.${input.action}`},'statutory_rule_set',${id},${rule.business_head_id},
          ${JSON.stringify(rule)}::jsonb,${JSON.stringify(rows[0])}::jsonb,${input.reason})
      `;
      return rows;
    });
    if (!updated) return fail("Rule-set status changed; refresh and try again", 409);
    return ok(updated);
  } catch (error) { return apiError(error); }
}
