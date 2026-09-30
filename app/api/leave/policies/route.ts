import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { hasRoleForScope } from "@/lib/auth";
import { db } from "@/lib/database";

const schema = z.object({
  businessHeadId: z.uuid().nullable().optional(),
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,29}$/),
  name: z.string().min(2).max(100),
  paid: z.boolean().default(true),
  annualEntitlement: z.number().min(0).max(365),
  accrualFrequency: z.enum(["monthly", "quarterly", "annual", "none"]).default("monthly"),
  carryForwardLimit: z.number().min(0).max(365).default(0),
  encashable: z.boolean().default(false),
  eligibility: z.object({
    employmentTypes: z.array(z.string().min(1).max(50)).optional(),
    minimumServiceDays: z.number().int().min(0).max(36500).optional(),
    maximumConsecutiveDays: z.number().positive().max(366).optional(),
    negativeBalanceLimit: z.number().min(0).max(365).optional(),
  }).passthrough().default({}),
  effectiveFrom: z.iso.date(),
  effectiveTo: z.iso.date().nullable().optional(),
}).refine(value => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, { message: "Effective end cannot precede start" });

export async function GET(request: Request) {
  try {
    const head = new URL(request.url).searchParams.get("businessHeadId");
    const user = await requireApiUser("leave:read", head);
    if (user instanceof Response) return user;
    return ok(await db()`
      SELECT p.*,b.name AS business_head,creator.full_name AS created_by_name,
        submitter.full_name AS submitted_by_name,approver.full_name AS approved_by_name
      FROM leave_policies p
      LEFT JOIN business_heads b ON b.id=p.business_head_id
      JOIN users creator ON creator.id=p.created_by
      LEFT JOIN users submitter ON submitter.id=p.submitted_by
      LEFT JOIN users approver ON approver.id=p.approved_by
      WHERE (${head}::uuid IS NULL OR p.business_head_id=${head}::uuid OR p.business_head_id IS NULL)
      ORDER BY p.code,p.effective_from DESC
    `);
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const user = await requireApiUser("leave:write", input.businessHeadId);
    if (user instanceof Response) return user;
    if (!hasRoleForScope(user, ["HR_ADMIN", "HR_OPERATIONS"], input.businessHeadId)) return fail("Only HR administrators or HR operations can create leave policies", 403);
    const [created] = await db().begin(async tx => {
      const rows = await tx`
        INSERT INTO leave_policies (
          business_head_id,code,name,paid,annual_entitlement,accrual_frequency,carry_forward_limit,
          encashable,eligibility,effective_from,effective_to,created_by,status
        ) VALUES (
          ${input.businessHeadId || null},${input.code},${input.name},${input.paid},${input.annualEntitlement},${input.accrualFrequency},
          ${input.carryForwardLimit},${input.encashable},${JSON.stringify(input.eligibility)}::jsonb,${input.effectiveFrom},${input.effectiveTo || null},${user.id},'draft'
        ) RETURNING *
      `;
      await tx`
        INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason)
        VALUES (${user.id},'leave_policy.create','leave_policy',${rows[0].id},${input.businessHeadId || null},${JSON.stringify(rows[0])}::jsonb,'Leave policy version created as draft')
      `;
      return rows;
    });
    return ok(created, { status: 201 });
  } catch (error) { return apiError(error); }
}
