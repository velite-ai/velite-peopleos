import { z } from "zod";
import { db } from "@/lib/database";
import { apiError, fail, ok } from "@/lib/api";
import { createSession } from "@/lib/auth";
import { openJson } from "@/lib/encryption";
import { verifyTotp } from "@/lib/totp";
import { hashPassword, passwordNeedsUpgrade, verifyPassword } from "@/lib/password";

const schema = z.object({ email: z.email(), password: z.string().min(1), otp: z.string().regex(/^\d{6}$/).optional() });

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const sql = db();
    const email=input.email.toLowerCase();const forwarded=request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();const ip=forwarded&&/^[0-9a-fA-F:.]{3,45}$/.test(forwarded)?forwarded:null;
    const [guard]=await sql<{failures:number}[]>`SELECT count(*)::int AS failures FROM login_attempts WHERE email=${email} AND succeeded=false AND attempted_at>now()-interval '15 minutes' AND attempted_at>coalesce((SELECT max(attempted_at) FROM login_attempts WHERE email=${email} AND succeeded=true),'-infinity'::timestamptz)`;
    if(guard.failures>=5)return fail("Too many sign-in attempts. Try again in 15 minutes",429);
    const [user] = await sql<{ id:string; password_hash:string | null; active:boolean;must_change_password:boolean;mfa_required:boolean }[]>`SELECT id,password_hash,active,must_change_password,mfa_required FROM users WHERE email=${email} LIMIT 1`;
    if (!user?.active || !user.password_hash || !(await verifyPassword(user.password_hash,input.password))){await sql`INSERT INTO login_attempts (email,ip_address,succeeded) VALUES (${email},${ip}::inet,false)`;return fail("Invalid email or password", 401);}
    if(user.mfa_required){const [mfa]=await sql<{secret_encrypted:Uint8Array;last_counter:number|null}[]>`SELECT secret_encrypted,last_counter FROM user_mfa WHERE user_id=${user.id} AND active=true`;if(!mfa||!input.otp){await sql`INSERT INTO login_attempts (email,ip_address,succeeded) VALUES (${email},${ip}::inet,false)`;return fail('A six-digit authenticator code is required',401,{code:'MFA_REQUIRED'});}const secret=openJson<{secret:string}>(mfa.secret_encrypted).secret;const counter=verifyTotp(secret,input.otp,mfa.last_counter);if(counter===null){await sql`INSERT INTO login_attempts (email,ip_address,succeeded) VALUES (${email},${ip}::inet,false)`;return fail('Invalid or already-used authenticator code',401,{code:'MFA_INVALID'});}await sql`UPDATE user_mfa SET last_counter=${counter},updated_at=now() WHERE user_id=${user.id}`;}
    if(passwordNeedsUpgrade(user.password_hash))await sql`UPDATE users SET password_hash=${await hashPassword(input.password)},password_changed_at=now(),updated_at=now() WHERE id=${user.id}`;
    await createSession(user.id);
    await sql`UPDATE users SET last_login_at = now() WHERE id = ${user.id}`;
    await sql`INSERT INTO login_attempts (email,ip_address,succeeded) VALUES (${email},${ip}::inet,true)`;
    await sql`INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id) VALUES (${user.id}, 'auth.login', 'user', ${user.id})`;
    return ok({ authenticated: true,mustChangePassword:user.must_change_password });
  } catch (error) { return apiError(error); }
}
