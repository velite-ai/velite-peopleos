import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";
import {
  findRoleScopeIssue,
  normalizeRoleAssignments,
  roleAssignmentsEqual,
  roleAssignmentsSchema,
} from "@/lib/role-assignments";

const schema = z.object({
  roles: roleAssignmentsSchema,
  reason: z.string().min(3).max(1000),
}).strict();

type ExistingRole = { code: string; business_head_id: string | null; department_id: string | null };

export async function PUT(request: Request, { params }: { params: Promise<{id:string}> }) {
  try {
    const { id } = await params;
    const input = schema.parse(await request.json());
    const actor = await requireApiUser("admin:users");
    if (actor instanceof Response) return actor;
    if (actor.apiKeyId || !actor.roles.some(role => role.code === "SUPER_ADMIN" && !role.businessHeadId && !role.departmentId)) {
      return fail("Only a signed-in super administrator can request permission changes", 403);
    }

    const proposed = normalizeRoleAssignments(input.roles);
    const sql = db();
    const result = await sql.begin(async tx => {
      const [target] = await tx<{ id: string; email: string }[]>`SELECT id,email FROM users WHERE id=${id} FOR UPDATE`;
      if (!target) return { kind: "not_found" } as const;

      const pending = await tx`SELECT id FROM permission_change_requests WHERE target_user_id=${id} AND status='pending' LIMIT 1`;
      if (pending.length) return { kind: "pending", requestId: pending[0].id as string } as const;

      const headIds = [...new Set(proposed.map(role => role.businessHeadId).filter((value): value is string => Boolean(value)))];
      const departmentIds = [...new Set(proposed.map(role => role.departmentId).filter((value): value is string => Boolean(value)))];
      const heads = headIds.length ? await tx<{ id: string }[]>`SELECT id FROM business_heads WHERE active=true AND id IN ${tx(headIds)}` : [];
      const departments = departmentIds.length ? await tx<{ id: string; business_head_id: string }[]>`SELECT id,business_head_id FROM departments WHERE active=true AND id IN ${tx(departmentIds)}` : [];
      const scopeIssue = findRoleScopeIssue(proposed, {
        businessHeadIds: heads.map(head => head.id),
        departments: departments.map(department => ({ id: department.id, businessHeadId: department.business_head_id })),
      });
      if (scopeIssue) return { kind: "invalid_scope", message: scopeIssue } as const;

      const currentRows = await tx<ExistingRole[]>`
        SELECT r.code,ur.business_head_id,ur.department_id
        FROM user_roles ur JOIN roles r ON r.id=ur.role_id
        WHERE ur.user_id=${id}
        FOR UPDATE OF ur
      `;
      const previous = normalizeRoleAssignments(roleAssignmentsSchema.parse(currentRows.map(role => ({
        code: role.code,
        businessHeadId: role.business_head_id,
        departmentId: role.department_id,
      }))));
      if (roleAssignmentsEqual(previous, proposed)) return { kind: "unchanged" } as const;

      const [changeRequest] = await tx<{ id: string; created_at: string }[]>`
        INSERT INTO permission_change_requests
          (target_user_id,proposed_roles,previous_roles,requested_by,request_reason)
        VALUES
          (${id},${JSON.stringify(proposed)}::jsonb,${JSON.stringify(previous)}::jsonb,${actor.id},${input.reason})
        RETURNING id,created_at
      `;
      await tx`
        INSERT INTO audit_events
          (actor_user_id,action,entity_type,entity_id,before_data,after_data,reason)
        VALUES
          (${actor.id},'permission_change.request','permission_change_request',${changeRequest.id},
           ${JSON.stringify({ targetUserId: id, roles: previous })}::jsonb,
           ${JSON.stringify({ targetUserId: id, roles: proposed, status: "pending" })}::jsonb,
           ${input.reason})
      `;
      return { kind: "created", requestId: changeRequest.id, createdAt: changeRequest.created_at, previous } as const;
    });

    if (result.kind === "not_found") return fail("User not found", 404);
    if (result.kind === "pending") return fail("A permission change is already pending for this user", 409, { requestId: result.requestId });
    if (result.kind === "invalid_scope") return fail(result.message, 422);
    if (result.kind === "unchanged") return fail("The proposed roles are unchanged", 409);
    return ok({
      requestId: result.requestId,
      targetUserId: id,
      status: "pending",
      previousRoles: result.previous,
      proposedRoles: proposed,
      requestedBy: actor.id,
      createdAt: result.createdAt,
    }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
