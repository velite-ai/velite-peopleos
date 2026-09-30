import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { createHash } from "node:crypto";
import { db } from "./database";

const COOKIE_NAME = "velite_hr_session";
const SESSION_HOURS = Number(process.env.SESSION_HOURS ?? 720);

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  mustChangePassword: boolean;
  mfaRequired: boolean;
  mfaEnrollmentRequired: boolean;
  sessionId?: string;
  roles: { code: string; businessHeadId: string | null; departmentId: string | null }[];
  apiPermissions?: string[];
  apiBusinessHeadId?: string | null;
  apiKeyId?: string;
};

const PERMISSION_ROLES: Record<string, string[]> = {
  "people:read": ["HR_ADMIN", "HR_OPERATIONS", "MANAGER", "LEADERSHIP", "AUDITOR"],
  "people:write": ["HR_ADMIN", "HR_OPERATIONS"],
  "attendance:read": ["HR_ADMIN", "HR_OPERATIONS", "MANAGER", "PAYROLL_ADMIN", "AUDITOR"],
  "attendance:write": ["HR_ADMIN", "HR_OPERATIONS", "MANAGER"],
  "payroll:read": ["HR_ADMIN", "PAYROLL_ADMIN", "FINANCE_APPROVER", "AUDITOR"],
  "payroll:write": ["PAYROLL_ADMIN"],
  "payroll:approve": ["FINANCE_APPROVER", "HR_ADMIN"],
  "performance:write": ["HR_ADMIN", "HR_OPERATIONS", "MANAGER", "DEPARTMENT_HEAD"],
  "recruitment:read": ["HR_ADMIN", "HR_OPERATIONS", "RECRUITER", "MANAGER", "DEPARTMENT_HEAD", "AUDITOR"],
  "recruitment:write": ["HR_ADMIN", "HR_OPERATIONS", "RECRUITER"],
  "recruitment:approve": ["HR_ADMIN", "DEPARTMENT_HEAD", "FINANCE_APPROVER"],
  "onboarding:read": ["HR_ADMIN", "HR_OPERATIONS", "MANAGER", "IT_FACILITIES", "AUDITOR"],
  "onboarding:write": ["HR_ADMIN", "HR_OPERATIONS", "IT_FACILITIES"],
  "performance:read": ["HR_ADMIN", "HR_OPERATIONS", "MANAGER", "DEPARTMENT_HEAD", "LEADERSHIP", "AUDITOR"],
  "calendar:read": ["HR_ADMIN", "HR_OPERATIONS", "MANAGER", "PAYROLL_ADMIN", "LEADERSHIP", "AUDITOR"],
  "calendar:write": ["HR_ADMIN", "HR_OPERATIONS"],
  "helpdesk:read": ["HR_ADMIN", "HR_OPERATIONS", "MANAGER", "IT_FACILITIES", "AUDITOR"],
  "helpdesk:write": ["HR_ADMIN", "HR_OPERATIONS", "IT_FACILITIES"],
  "separation:read": ["HR_ADMIN", "HR_OPERATIONS", "MANAGER", "FINANCE_APPROVER", "AUDITOR"],
  "separation:write": ["HR_ADMIN", "HR_OPERATIONS"],
  "leave:read": ["HR_ADMIN", "HR_OPERATIONS", "MANAGER", "PAYROLL_ADMIN", "AUDITOR"],
  "leave:write": ["HR_ADMIN", "HR_OPERATIONS", "MANAGER"],
  "learning:read": ["HR_ADMIN", "HR_OPERATIONS", "MANAGER", "AUDITOR"],
  "learning:write": ["HR_ADMIN", "HR_OPERATIONS"],
  "assets:read": ["HR_ADMIN", "HR_OPERATIONS", "IT_FACILITIES", "AUDITOR"],
  "assets:write": ["HR_ADMIN", "HR_OPERATIONS", "IT_FACILITIES"],
  "expenses:read": ["HR_ADMIN", "HR_OPERATIONS", "MANAGER", "FINANCE_APPROVER", "AUDITOR"],
  "expenses:write": ["HR_ADMIN", "HR_OPERATIONS", "MANAGER", "FINANCE_APPROVER"],
  "documents:read": ["HR_ADMIN", "HR_OPERATIONS", "MANAGER", "AUDITOR"],
  "documents:write": ["HR_ADMIN", "HR_OPERATIONS"],
  "policies:read": ["HR_ADMIN", "HR_OPERATIONS", "MANAGER", "AUDITOR"],
  "policies:write": ["HR_ADMIN", "HR_OPERATIONS"],
  "policies:approve": ["HR_ADMIN"],
  "workflows:read": ["HR_ADMIN", "HR_OPERATIONS", "AUDITOR"],
  "workflows:write": ["HR_ADMIN"],
  "reports:read": ["HR_ADMIN", "HR_OPERATIONS", "PAYROLL_ADMIN", "FINANCE_APPROVER", "LEADERSHIP", "AUDITOR"],
};

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters");
  return new TextEncoder().encode(value);
}

export async function createSession(userId: string) {
  const sessionId=crypto.randomUUID();
  const expiresAt=new Date(Date.now()+SESSION_HOURS*60*60*1000);
  await db()`INSERT INTO auth_sessions (id,user_id,expires_at) VALUES (${sessionId},${userId},${expiresAt})`;
  const token = await new SignJWT({ sub: userId, sid:sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret());
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 60 * 60,
  });
}

export async function destroySession() {
  const store = await cookies();
  const token=store.get(COOKIE_NAME)?.value;
  if(token)try{const verified=await jwtVerify(token,secret());if(typeof verified.payload.sid==='string')await db()`UPDATE auth_sessions SET revoked_at=coalesce(revoked_at,now()) WHERE id=${verified.payload.sid}`;}catch{}
  store.set(COOKIE_NAME, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
}

export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  try {
    if(!token){const authorization=(await headers()).get('authorization');if(!authorization?.startsWith('Bearer vel_'))return null;const supplied=authorization.slice(7);const hash=createHash('sha256').update(supplied).digest('hex');const sql=db();const [key]=await sql<{id:string;name:string;permissions:string[];business_head_id:string|null;created_by:string;email:string}[]>`SELECT k.id,k.name,k.permissions,k.business_head_id,k.created_by,u.email FROM api_keys k JOIN users u ON u.id=k.created_by AND u.active=true WHERE k.token_hash=${hash} AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at>now())`;if(!key)return null;await sql`UPDATE api_keys SET last_used_at=now() WHERE id=${key.id}`;return{id:key.created_by,email:key.email,fullName:`Integration: ${key.name}`,mustChangePassword:false,mfaRequired:false,mfaEnrollmentRequired:false,roles:[{code:'API_KEY',businessHeadId:key.business_head_id,departmentId:null}],apiPermissions:key.permissions,apiBusinessHeadId:key.business_head_id,apiKeyId:key.id};}
    const verified = await jwtVerify(token, secret());
    if (!verified.payload.sub || typeof verified.payload.sid!=='string') return null;
    const sql = db();
    const users = await sql<{ id: string; email: string; full_name: string; must_change_password: boolean; mfa_required: boolean;mfa_active:boolean }[]>`
      SELECT u.id,u.email,u.full_name,u.must_change_password,u.mfa_required,coalesce(m.active,false) AS mfa_active
      FROM users u JOIN auth_sessions s ON s.user_id=u.id AND s.id=${verified.payload.sid} AND s.revoked_at IS NULL AND s.expires_at>now()
      LEFT JOIN user_mfa m ON m.user_id=u.id
      WHERE u.id=${verified.payload.sub} AND u.active=true LIMIT 1
    `;
    if (!users[0]) return null;
    const roles = await sql<{ code: string; business_head_id: string | null; department_id: string | null }[]>`
      SELECT r.code, ur.business_head_id, ur.department_id
      FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ${users[0].id}
    `;
    await sql`UPDATE auth_sessions SET last_seen_at=now() WHERE id=${verified.payload.sid}`;
    const privileged=new Set(['SUPER_ADMIN','HR_ADMIN','HR_OPERATIONS','RECRUITER','MANAGER','DEPARTMENT_HEAD','PAYROLL_ADMIN','FINANCE_APPROVER','LEADERSHIP','AUDITOR','IT_FACILITIES']);
    return {
      id: users[0].id,
      email: users[0].email,
      fullName: users[0].full_name,
      mustChangePassword: users[0].must_change_password,
      mfaRequired: users[0].mfa_required,
      mfaEnrollmentRequired: process.env.REQUIRE_MFA === 'true' && roles.some(role=>privileged.has(role.code))&&!users[0].mfa_active,
      sessionId:verified.payload.sid,
      roles: roles.map(r => ({ code: r.code, businessHeadId: r.business_head_id, departmentId: r.department_id })),
    };
  } catch {
    return null;
  }
}

export function hasPermission(user: SessionUser, permission: string, businessHeadId?: string | null) {
  return hasPermissionForScope(user, permission, businessHeadId);
}

export function hasUnscopedPermission(user: SessionUser, permission: string) {
  if (user.roles.some(role => role.code === "SUPER_ADMIN")) return true;
  if(user.apiPermissions?.some(item=>item==='*'||item===permission))return !user.apiBusinessHeadId;
  const allowed = PERMISSION_ROLES[permission] || [];
  return user.roles.some(role => allowed.includes(role.code) && !role.businessHeadId && !role.departmentId);
}

export function hasPermissionForScope(
  user: SessionUser,
  permission: string,
  businessHeadId?: string | null,
  departmentId?: string | null,
) {
  if (user.roles.some(role => role.code === "SUPER_ADMIN")) return true;
  if(user.apiPermissions?.some(item=>item==='*'||item===permission)){if(!businessHeadId&&!departmentId)return !user.apiBusinessHeadId;return !user.apiBusinessHeadId||user.apiBusinessHeadId===businessHeadId;}
  const allowed = PERMISSION_ROLES[permission] || [];
  return user.roles.some(role => {
    if (!allowed.includes(role.code)) return false;
    if (!businessHeadId && !departmentId) return !role.businessHeadId && !role.departmentId;
    if (role.departmentId) return Boolean(departmentId) && role.departmentId === departmentId;
    if (role.businessHeadId) return Boolean(businessHeadId) && role.businessHeadId === businessHeadId;
    return true;
  });
}

export function hasRoleForScope(user:SessionUser,codes:string[],businessHeadId?:string|null,departmentId?:string|null){
  if(user.roles.some(role=>role.code==='SUPER_ADMIN'))return true;
  return user.roles.some(role=>{
    if(!codes.includes(role.code))return false;
    if(role.departmentId)return Boolean(departmentId)&&role.departmentId===departmentId;
    if(role.businessHeadId)return Boolean(businessHeadId)&&role.businessHeadId===businessHeadId;
    return true;
  });
}
