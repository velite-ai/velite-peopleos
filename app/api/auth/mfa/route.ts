import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";
import { openJson, sealJson } from "@/lib/encryption";
import { verifyPassword } from "@/lib/password";
import { createTotpSecret, verifyTotp } from "@/lib/totp";

const verifySchema=z.object({code:z.string().regex(/^\d{6}$/)});
const resetSchema=z.object({currentPassword:z.string().min(1).optional(),currentCode:z.string().regex(/^\d{6}$/).optional()});
export async function GET(){try{const user=await requireApiUser();if(user instanceof Response)return user;const [mfa]=await db()`SELECT active,verified_at,(pending_secret_encrypted IS NOT NULL) AS setup_pending FROM user_mfa WHERE user_id=${user.id}`;return ok({required:user.mfaRequired,enrollmentRequired:user.mfaEnrollmentRequired,active:Boolean(mfa?.active),setupPending:Boolean(mfa?.setup_pending),verifiedAt:mfa?.verified_at||null});}catch(error){return apiError(error);}}
export async function POST(request:Request){
  try{
    const user=await requireApiUser();if(user instanceof Response)return user;const sql=db();
    const input=resetSchema.parse(await request.json().catch(()=>({})));
    const [existing]=await sql<{active:boolean;secret_encrypted:Uint8Array;last_counter:number|null;password_hash:string|null}[]>`SELECT m.active,m.secret_encrypted,m.last_counter,u.password_hash FROM users u LEFT JOIN user_mfa m ON m.user_id=u.id WHERE u.id=${user.id}`;
    if(existing?.active){
      if(!input.currentPassword||!input.currentCode)return fail('Current password and authenticator code are required to replace an active factor',422);
      if(!existing.password_hash||!await verifyPassword(existing.password_hash,input.currentPassword))return fail('Current password is incorrect',401);
      const currentSecret=openJson<{secret:string}>(existing.secret_encrypted).secret;const counter=verifyTotp(currentSecret,input.currentCode,existing.last_counter);
      if(counter===null)return fail('Current authenticator code is invalid or already used',401);
      await sql`UPDATE user_mfa SET last_counter=${counter},updated_at=now() WHERE user_id=${user.id}`;
    }
    const secret=createTotpSecret();const encrypted=sealJson({secret});
    await sql.begin(async tx=>{await tx`INSERT INTO user_mfa (user_id,secret_encrypted,pending_secret_encrypted,pending_created_at,active,last_counter) VALUES (${user.id},${encrypted},${encrypted},now(),false,NULL) ON CONFLICT (user_id) DO UPDATE SET pending_secret_encrypted=EXCLUDED.pending_secret_encrypted,pending_created_at=now(),updated_at=now()`;await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,after_data,reason) VALUES (${user.id},'auth.mfa_setup_start','user',${user.id},${JSON.stringify({pending:true,replacing:Boolean(existing?.active)})}::jsonb,'Authenticator enrolment started')`;});
    const issuer='Velite PeopleOS';const account=encodeURIComponent(user.email);return ok({secret,otpauthUrl:`otpauth://totp/${encodeURIComponent(issuer)}:${account}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`});
  }catch(error){return apiError(error);}
}
export async function PUT(request:Request){try{const input=verifySchema.parse(await request.json());const user=await requireApiUser();if(user instanceof Response)return user;const sql=db();const [mfa]=await sql<{pending_secret_encrypted:Uint8Array|null}[]>`SELECT pending_secret_encrypted FROM user_mfa WHERE user_id=${user.id}`;if(!mfa?.pending_secret_encrypted)return fail('Start authenticator setup first',409);const secret=openJson<{secret:string}>(mfa.pending_secret_encrypted).secret;const counter=verifyTotp(secret,input.code);if(counter===null)return fail('Authenticator code is invalid',422);await sql.begin(async tx=>{await tx`UPDATE user_mfa SET secret_encrypted=pending_secret_encrypted,pending_secret_encrypted=NULL,pending_created_at=NULL,active=true,verified_at=now(),last_counter=${counter},updated_at=now() WHERE user_id=${user.id}`;await tx`UPDATE users SET mfa_required=true,updated_at=now() WHERE id=${user.id}`;await tx`UPDATE auth_sessions SET revoked_at=now() WHERE user_id=${user.id} AND id<>${user.sessionId||null}::uuid AND revoked_at IS NULL`;await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,after_data,reason) VALUES (${user.id},'auth.mfa_enable','user',${user.id},${JSON.stringify({mfaRequired:true,otherSessionsRevoked:true})}::jsonb,'Authenticator verified and enabled')`;});return ok({enabled:true,otherSessionsRevoked:true});}catch(error){return apiError(error);}}
