import { z } from "zod";
import type postgres from "postgres";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";
import {
  findRoleScopeIssue,
  normalizeRoleAssignments,
  roleAssignmentsEqual,
  roleAssignmentsSchema,
  type RoleAssignment,
} from "@/lib/role-assignments";

const schema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().min(3).max(1000),
}).strict();

type PermissionChange = {
  id: string;
  target_user_id: string;
  proposed_roles: unknown;
  previous_roles: unknown;
  status: string;
  requested_by: string;
  request_reason: string;
};

type ExistingRole = { code: string; business_head_id: string | null; department_id: string | null };

async function cancelInvalidRequest(
  tx: postgres.TransactionSql,
  change: PermissionChange,
  actorId: string,
  reason: string,
  detail: string,
) {
  await tx`
    UPDATE permission_change_requests
    SET status='cancelled',decided_by=${actorId},decision_reason=${`${reason} (${detail})`},decided_at=now()
    WHERE id=${change.id} AND status='pending'
  `;
  await tx`
    INSERT INTO audit_events
      (actor_user_id,action,entity_type,entity_id,before_data,after_data,reason)
    VALUES
      (${actorId},'permission_change.cancel_stale','permission_change_request',${change.id},
       ${JSON.stringify({ status: "pending", targetUserId: change.target_user_id })}::jsonb,
       ${JSON.stringify({ status: "cancelled", targetUserId: change.target_user_id, detail })}::jsonb,
       ${reason})
  `;
}

export async function POST(request: Request, { params }: { params: Promise<{id:string}> }) {
  try {
    const { id } = await params;
    const input = schema.parse(await request.json());
    const actor = await requireApiUser("admin:users");
    if (actor instanceof Response) return actor;
    if (actor.apiKeyId || !actor.roles.some(role => role.code === "SUPER_ADMIN" && !role.businessHeadId && !role.departmentId)) {
      return fail("Only a signed-in super administrator can decide permission changes", 403);
    }

    const sql = db();
    const result = await sql.begin(async tx => {
      // All permission decisions take this lock so concurrent removals cannot eliminate the final active super administrator.
      const [superRole] = await tx<{ id: string }[]>`SELECT id FROM roles WHERE code='SUPER_ADMIN' FOR UPDATE`;
      if (!superRole) throw new Error("The SUPER_ADMIN role is not seeded");

      const [change] = await tx<PermissionChange[]>`SELECT * FROM permission_change_requests WHERE id=${id} FOR UPDATE`;
      if (!change) return { kind: "not_found" } as const;
      if (change.status !== "pending") return { kind: "already_decided", status: change.status } as const;
      if (change.requested_by === actor.id) return { kind: "same_actor" } as const;

      if (input.decision === "reject") {
        await tx`
          UPDATE permission_change_requests
          SET status='rejected',decided_by=${actor.id},decision_reason=${input.reason},decided_at=now()
          WHERE id=${change.id} AND status='pending'
        `;
        await tx`
          INSERT INTO audit_events
            (actor_user_id,action,entity_type,entity_id,before_data,after_data,reason)
          VALUES
            (${actor.id},'permission_change.reject','permission_change_request',${change.id},
             ${JSON.stringify({ status: "pending", targetUserId: change.target_user_id, requestedBy: change.requested_by })}::jsonb,
             ${JSON.stringify({ status: "rejected", targetUserId: change.target_user_id, decidedBy: actor.id })}::jsonb,
             ${input.reason})
        `;
        return { kind: "rejected", targetUserId: change.target_user_id } as const;
      }

      const proposed = normalizeRoleAssignments(roleAssignmentsSchema.parse(change.proposed_roles));
      const previous = normalizeRoleAssignments(roleAssignmentsSchema.parse(change.previous_roles));
      const [target] = await tx<{ id: string; active: boolean }[]>`SELECT id,active FROM users WHERE id=${change.target_user_id} FOR UPDATE`;
      if (!target) throw new Error("Permission change target no longer exists");

      const currentRows = await tx<ExistingRole[]>`
        SELECT r.code,ur.business_head_id,ur.department_id
        FROM user_roles ur JOIN roles r ON r.id=ur.role_id
        WHERE ur.user_id=${change.target_user_id}
        FOR UPDATE OF ur
      `;
      const current = normalizeRoleAssignments(roleAssignmentsSchema.parse(currentRows.map(role => ({
        code: role.code,
        businessHeadId: role.business_head_id,
        departmentId: role.department_id,
      }))));
      if (!roleAssignmentsEqual(current, previous)) {
        await cancelInvalidRequest(tx, change, actor.id, input.reason, "Target roles changed after this request was created");
        return { kind: "stale", targetUserId: change.target_user_id } as const;
      }

      const headIds = [...new Set(proposed.map(role => role.businessHeadId).filter((value): value is string => Boolean(value)))];
      const departmentIds = [...new Set(proposed.map(role => role.departmentId).filter((value): value is string => Boolean(value)))];
      const heads = headIds.length ? await tx<{ id: string }[]>`SELECT id FROM business_heads WHERE active=true AND id IN ${tx(headIds)}` : [];
      const departments = departmentIds.length ? await tx<{ id: string; business_head_id: string }[]>`SELECT id,business_head_id FROM departments WHERE active=true AND id IN ${tx(departmentIds)}` : [];
      const scopeIssue = findRoleScopeIssue(proposed, {
        businessHeadIds: heads.map(head => head.id),
        departments: departments.map(department => ({ id: department.id, businessHeadId: department.business_head_id })),
      });
      if (scopeIssue) {
        await cancelInvalidRequest(tx, change, actor.id, input.reason, scopeIssue);
        return { kind: "invalid_scope", message: scopeIssue, targetUserId: change.target_user_id } as const;
      }

      const currentlySuper = current.some(role => role.code === "SUPER_ADMIN");
      const proposedSuper = proposed.some(role => role.code === "SUPER_ADMIN");
      if (target.active && currentlySuper && !proposedSuper) {
        const [remaining] = await tx<{ count: number }[]>`
          SELECT count(DISTINCT u.id)::int AS count
          FROM users u
          JOIN user_roles ur ON ur.user_id=u.id
          WHERE u.active=true AND ur.role_id=${superRole.id} AND u.id<>${target.id}
        `;
        if (remaining.count < 1) return { kind: "final_super" } as const;
      }

      const codes = [...new Set(proposed.map(role => role.code))];
      const roleRows = await tx<{ id: string; code: string }[]>`SELECT id,code FROM roles WHERE code IN ${tx(codes)}`;
      const roleIds = new Map(roleRows.map(role => [role.code, role.id]));
      if (roleIds.size !== codes.length) throw new Error("A proposed role is not seeded");

      await tx`DELETE FROM user_roles WHERE user_id=${target.id}`;
      for (const role of proposed as RoleAssignment[]) {
        await tx`
          INSERT INTO user_roles (user_id,role_id,business_head_id,department_id)
          VALUES (${target.id},${roleIds.get(role.code)!},${role.businessHeadId},${role.departmentId})
        `;
      }
      await tx`
        UPDATE permission_change_requests
        SET status='approved',decided_by=${actor.id},decision_reason=${input.reason},decided_at=now()
        WHERE id=${change.id} AND status='pending'
      `;
      await tx`
        INSERT INTO audit_events
          (actor_user_id,action,entity_type,entity_id,before_data,after_data,reason)
        VALUES
          (${actor.id},'permission_change.approve','permission_change_request',${change.id},
           ${JSON.stringify({ status: "pending", targetUserId: target.id, requestedBy: change.requested_by })}::jsonb,
           ${JSON.stringify({ status: "approved", targetUserId: target.id, decidedBy: actor.id })}::jsonb,
           ${input.reason})
      `;
      await tx`
        INSERT INTO audit_events
          (actor_user_id,action,entity_type,entity_id,before_data,after_data,reason)
        VALUES
          (${actor.id},'user.roles_replace','user',${target.id},${JSON.stringify(current)}::jsonb,
           ${JSON.stringify(proposed)}::jsonb,${`Approved permission request ${change.id}: ${input.reason}`})
      `;
      return { kind: "approved", targetUserId: target.id, roles: proposed } as const;
    });

    if (result.kind === "not_found") return fail("Permission change request not found", 404);
    if (result.kind === "already_decided") return fail(`Permission change request is already ${result.status}`, 409);
    if (result.kind === "same_actor") return fail("The requester cannot decide their own permission change", 403);
    if (result.kind === "final_super") return fail("The final active super administrator must retain that role", 409);
    if (result.kind === "stale") return fail("The target user's roles changed after this request was created; the request was cancelled", 409, { code: "STALE_PERMISSION_CHANGE" });
    if (result.kind === "invalid_scope") return fail(`${result.message}; the request was cancelled`, 409, { code: "INVALID_PERMISSION_SCOPE" });
    if (result.kind === "rejected") return ok({ requestId: id, targetUserId: result.targetUserId, status: "rejected", decidedBy: actor.id });
    return ok({ requestId: id, targetUserId: result.targetUserId, status: "approved", roles: result.roles, decidedBy: actor.id });
  } catch (error) {
    return apiError(error);
  }
}
