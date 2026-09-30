import { z } from "zod";
import { apiError, ok, requireEmployeeIdentity } from "@/lib/api";
import { db } from "@/lib/database";

const schema = z.object({
  personalEmail: z.email().nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  reason: z.string().min(3).max(500).default("Employee self-service profile update"),
});

export async function PATCH(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const identity = await requireEmployeeIdentity();
    if (identity instanceof Response) return identity;
    const [updated] = await db().begin(async tx => {
      const previous = await tx`SELECT personal_email,phone FROM employees WHERE id=${identity.employee.id} FOR UPDATE`;
      const rows = await tx`UPDATE employees SET personal_email=CASE WHEN ${input.personalEmail!==undefined} THEN ${input.personalEmail??null} ELSE personal_email END,phone=CASE WHEN ${input.phone!==undefined} THEN ${input.phone??null} ELSE phone END,updated_at=now() WHERE id=${identity.employee.id} RETURNING id,personal_email,phone,updated_at`;
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason) VALUES (${identity.user.id},'self.profile_update','employee',${identity.employee.id},${identity.employee.businessHeadId},${JSON.stringify(previous[0])}::jsonb,${JSON.stringify(rows[0])}::jsonb,${input.reason})`;
      return rows;
    });
    return ok(updated);
  } catch (error) {
    return apiError(error);
  }
}
