import { z } from "zod";

export const ROLE_CODES = [
  "SUPER_ADMIN",
  "HR_ADMIN",
  "HR_OPERATIONS",
  "RECRUITER",
  "MANAGER",
  "DEPARTMENT_HEAD",
  "PAYROLL_ADMIN",
  "FINANCE_APPROVER",
  "LEADERSHIP",
  "AUDITOR",
  "EMPLOYEE",
  "IT_FACILITIES",
] as const;

export const roleAssignmentSchema = z.object({
  code: z.enum(ROLE_CODES),
  businessHeadId: z.uuid().nullable().optional(),
  departmentId: z.uuid().nullable().optional(),
}).strict()
  .refine(role => role.code !== "SUPER_ADMIN" || (!role.businessHeadId && !role.departmentId), {
    message: "Super administrators cannot be scope-limited",
  })
  .refine(role => !role.departmentId || Boolean(role.businessHeadId), {
    message: "A department scope must include its business head",
  });

export const roleAssignmentsSchema = z.array(roleAssignmentSchema).min(1).max(30).superRefine((roles, context) => {
  const seen = new Set<string>();
  for (const [index, role] of roles.entries()) {
    const key = `${role.code}:${role.businessHeadId || "*"}:${role.departmentId || "*"}`;
    if (seen.has(key)) context.addIssue({ code: "custom", message: "Duplicate role assignment", path: [index] });
    seen.add(key);
  }
});

export type RoleAssignment = {
  code: (typeof ROLE_CODES)[number];
  businessHeadId: string | null;
  departmentId: string | null;
};

export function normalizeRoleAssignments(roles: z.infer<typeof roleAssignmentsSchema>): RoleAssignment[] {
  return roles
    .map(role => ({
      code: role.code,
      businessHeadId: role.businessHeadId || null,
      departmentId: role.departmentId || null,
    }))
    .sort((left, right) =>
      left.code.localeCompare(right.code)
      || (left.businessHeadId || "").localeCompare(right.businessHeadId || "")
      || (left.departmentId || "").localeCompare(right.departmentId || ""));
}

export function roleAssignmentsEqual(left: RoleAssignment[], right: RoleAssignment[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export type RoleScopeDirectory = {
  businessHeadIds: Iterable<string>;
  departments: Iterable<{ id: string; businessHeadId: string }>;
};

export function findRoleScopeIssue(roles: RoleAssignment[], directory: RoleScopeDirectory) {
  const heads = new Set(directory.businessHeadIds);
  const departments = new Map([...directory.departments].map(department => [department.id, department.businessHeadId]));
  for (const role of roles) {
    if (role.businessHeadId && !heads.has(role.businessHeadId)) return "Business head not found or inactive";
    if (!role.departmentId) continue;
    const departmentHead = departments.get(role.departmentId);
    if (!departmentHead) return "Department not found or inactive";
    if (departmentHead !== role.businessHeadId) return "Department does not belong to the selected business head";
  }
  return null;
}
