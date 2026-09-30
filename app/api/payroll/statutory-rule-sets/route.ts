import { z } from "zod";
import { apiError, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";
import { finalSettlementRuleSchema } from "@/lib/final-settlement";

const schema = z.object({
  businessHeadId: z.uuid().nullable().optional(),
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),
  name: z.string().min(3).max(160),
  configuration: z.object({
    outputGroups: z.record(z.string(), z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/)).min(1)).default({}),
    notes: z.string().max(3000).optional(),
    finalSettlement: finalSettlementRuleSchema.optional(),
  }).passthrough(),
  effectiveFrom: z.iso.date(),
  effectiveTo: z.iso.date().nullable().optional(),
  changeReason: z.string().min(5).max(1000),
}).strict()
  .refine(value => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, { message: "Effective end cannot precede start" })
  .refine(value => value.code !== "FINAL_SETTLEMENT" || Boolean(value.configuration.finalSettlement), { message: "FINAL_SETTLEMENT requires a finalSettlement configuration", path: ["configuration", "finalSettlement"] });

export async function GET(request: Request) {
  try {
    const head = new URL(request.url).searchParams.get("businessHeadId");
    const user = await requireApiUser("payroll:read", head);
    if (user instanceof Response) return user;
    return ok(await db()`
      SELECT s.*,b.name AS business_head,cu.full_name AS created_by_name,au.full_name AS approved_by_name
      FROM statutory_rule_sets s LEFT JOIN business_heads b ON b.id=s.business_head_id
      JOIN users cu ON cu.id=s.created_by LEFT JOIN users au ON au.id=s.approved_by
      WHERE (${head}::uuid IS NULL OR s.business_head_id=${head}::uuid OR s.business_head_id IS NULL)
      ORDER BY s.code,s.version DESC
    `);
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const user = await requireApiUser("payroll:write", input.businessHeadId);
    if (user instanceof Response) return user;
    const [created] = await db().begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`statutory-rule:${input.code}:${input.businessHeadId || "global"}`}))`;
      const [latest] = await tx<{ version: number }[]>`
        SELECT version FROM statutory_rule_sets WHERE code=${input.code}
          AND business_head_id IS NOT DISTINCT FROM ${input.businessHeadId || null}::uuid
        ORDER BY version DESC LIMIT 1
      `;
      const rows = await tx`
        INSERT INTO statutory_rule_sets (business_head_id,code,name,version,configuration,effective_from,effective_to,change_reason,created_by)
        VALUES (${input.businessHeadId || null},${input.code},${input.name},${(latest?.version || 0) + 1},
          ${JSON.stringify(input.configuration)}::jsonb,${input.effectiveFrom},${input.effectiveTo || null},${input.changeReason},${user.id})
        RETURNING *
      `;
      await tx`
        INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason)
        VALUES (${user.id},'statutory_rule_set.create','statutory_rule_set',${rows[0].id},${input.businessHeadId || null},${JSON.stringify(rows[0])}::jsonb,${input.changeReason})
      `;
      return rows;
    });
    return ok(created, { status: 201 });
  } catch (error) { return apiError(error); }
}
