import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { currentUser, hasPermissionForScope, hasUnscopedPermission, SessionUser } from "./auth";
import { db } from "./database";

export function ok(data: unknown, init?: ResponseInit) { return NextResponse.json({ data }, init); }
export function fail(message: string, status = 400, details?: unknown) { return NextResponse.json({ error: { message, details } }, { status }); }

export async function requireApiUser(permission?: string, businessHeadId?: string | null, departmentId?: string | null): Promise<SessionUser | NextResponse> {
  const user = await currentUser();
  if (!user) return fail("Authentication required", 401);
  if (user.mustChangePassword) return fail("Password change required", 403, { code: "PASSWORD_CHANGE_REQUIRED" });
  if(permission&&user.mfaEnrollmentRequired)return fail("Multi-factor authentication enrollment is required",403,{code:"MFA_ENROLLMENT_REQUIRED"});
  if (permission && !businessHeadId && !departmentId && !hasUnscopedPermission(user, permission)) return fail("A business head or department is required for your scoped role", 403);
  if (permission && !hasPermissionForScope(user, permission, businessHeadId, departmentId)) return fail("You do not have permission for this action", 403);
  return user;
}

export async function requireAnyApiPermission(permissions: string[], businessHeadId?: string | null, departmentId?: string | null): Promise<SessionUser | NextResponse> {
  const user = await currentUser();
  if (!user) return fail("Authentication required", 401);
  if (user.mustChangePassword) return fail("Password change required", 403, { code: "PASSWORD_CHANGE_REQUIRED" });
  if(user.mfaEnrollmentRequired)return fail("Multi-factor authentication enrollment is required",403,{code:"MFA_ENROLLMENT_REQUIRED"});
  if (!permissions.some(permission => hasPermissionForScope(user, permission, businessHeadId, departmentId))) return fail("You do not have permission for this action", 403);
  return user;
}

export type EmployeeIdentity = {
  user: SessionUser;
  employee: {
    id: string;
    employeeCode: string;
    businessHeadId: string;
    departmentId: string | null;
  };
};

export async function requireEmployeeIdentity(): Promise<EmployeeIdentity | NextResponse> {
  const user = await currentUser();
  if (!user) return fail("Authentication required", 401);
  if (user.mustChangePassword) return fail("Password change required", 403, { code: "PASSWORD_CHANGE_REQUIRED" });
  const [employee] = await db()<{
    id: string;
    employee_code: string;
    business_head_id: string;
    department_id: string | null;
  }[]>`SELECT id, employee_code, business_head_id, department_id FROM employees WHERE user_id = ${user.id} LIMIT 1`;
  if (!employee) return fail("This account is not linked to an employee record", 403);
  return {
    user,
    employee: {
      id: employee.id,
      employeeCode: employee.employee_code,
      businessHeadId: employee.business_head_id,
      departmentId: employee.department_id,
    },
  };
}

export function apiError(error: unknown) {
  if (error instanceof ZodError) return fail("Validation failed", 422, error.flatten());
  const id = crypto.randomUUID();
  console.error(`[${id}]`, error);
  return fail("The request could not be completed", 500, { reference: id });
}
