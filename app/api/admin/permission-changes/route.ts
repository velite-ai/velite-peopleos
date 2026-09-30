import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";

const querySchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "cancelled"]).default("pending"),
  targetUserId: z.uuid().optional(),
});

export async function GET(request: Request) {
  try {
    const actor = await requireApiUser("admin:users");
    if (actor instanceof Response) return actor;
    if (actor.apiKeyId || !actor.roles.some(role => role.code === "SUPER_ADMIN" && !role.businessHeadId && !role.departmentId)) {
      return fail("Only a signed-in super administrator can review permission changes", 403);
    }
    const url = new URL(request.url);
    const query = querySchema.parse({
      status: url.searchParams.get("status") || undefined,
      targetUserId: url.searchParams.get("targetUserId") || undefined,
    });
    const rows = await db()`
      SELECT p.id,p.target_user_id,p.proposed_roles,p.previous_roles,p.status,p.requested_by,
             p.request_reason,p.decided_by,p.decision_reason,p.decided_at,p.created_at,
             target.full_name AS target_name,target.email AS target_email,
             requester.full_name AS requested_by_name,decider.full_name AS decided_by_name
      FROM permission_change_requests p
      JOIN users target ON target.id=p.target_user_id
      JOIN users requester ON requester.id=p.requested_by
      LEFT JOIN users decider ON decider.id=p.decided_by
      WHERE p.status=${query.status}
        AND (${query.targetUserId || null}::uuid IS NULL OR p.target_user_id=${query.targetUserId || null}::uuid)
      ORDER BY p.created_at DESC
      LIMIT 200
    `;
    return ok(rows);
  } catch (error) {
    return apiError(error);
  }
}
