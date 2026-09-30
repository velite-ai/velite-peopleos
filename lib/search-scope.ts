import type { SessionUser } from "./auth";

export type SearchBusinessHead = { id: string };
export type SearchDepartment = { id: string; businessHeadId: string };

export type SearchPermissionScope = {
  all: boolean;
  businessHeadIds: string[];
  departmentIds: string[];
  applicableBusinessHeadIds: string[];
  any: boolean;
};

export type SearchScopePolicy = {
  hasUnscopedPermission: (user: SessionUser, permission: string) => boolean;
  hasPermissionForScope: (
    user: SessionUser,
    permission: string,
    businessHeadId?: string | null,
    departmentId?: string | null,
  ) => boolean;
};

/**
 * Converts the existing role/scope policy into database-friendly allowlists.
 * Search routes use these allowlists in SQL so disallowed records never leave
 * PostgreSQL merely to be filtered in application memory.
 */
export function buildSearchPermissionScope(
  user: SessionUser,
  permission: string,
  businessHeads: SearchBusinessHead[],
  departments: SearchDepartment[],
  policy: SearchScopePolicy,
): SearchPermissionScope {
  const all = policy.hasUnscopedPermission(user, permission);
  if (all) {
    return {
      all: true,
      businessHeadIds: businessHeads.map(head => head.id),
      departmentIds: departments.map(department => department.id),
      applicableBusinessHeadIds: businessHeads.map(head => head.id),
      any: true,
    };
  }

  const businessHeadIds = businessHeads
    .filter(head => policy.hasPermissionForScope(user, permission, head.id, null))
    .map(head => head.id);
  const departmentIds = departments
    .filter(department => policy.hasPermissionForScope(user, permission, department.businessHeadId, department.id))
    .map(department => department.id);
  const departmentHeadIds = departments
    .filter(department => departmentIds.includes(department.id))
    .map(department => department.businessHeadId);
  const applicableBusinessHeadIds = [...new Set([...businessHeadIds, ...departmentHeadIds])];

  return {
    all: false,
    businessHeadIds,
    departmentIds,
    applicableBusinessHeadIds,
    any: businessHeadIds.length > 0 || departmentIds.length > 0,
  };
}
