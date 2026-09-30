import { z } from "zod";
import { apiError, fail, ok } from "@/lib/api";
import { createSession, currentUser } from "@/lib/auth";
import { db } from "@/lib/database";
import { hashPassword, verifyPassword } from "@/lib/password";

const schema=z.object({currentPassword:z.string().min(1),newPassword:z.string().min(12).max(128)}).refine(value=>value.currentPassword!==value.newPassword,{message:'New password must be different'});
export async function POST(request:Request){try{const input=schema.parse(await request.json());const user=await currentUser();if(!user)return fail('Authentication required',401);const sql=db();const [record]=await sql<{password_hash:string}[]>`SELECT password_hash FROM users WHERE id=${user.id}`;if(!record?.password_hash||!await verifyPassword(record.password_hash,input.currentPassword))return fail('Current password is incorrect',401);const hash=await hashPassword(input.newPassword);await sql.begin(async tx=>{await tx`UPDATE users SET password_hash=${hash},must_change_password=false,password_changed_at=now(),updated_at=now() WHERE id=${user.id}`;await tx`UPDATE auth_sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=${user.id}`;await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,reason) VALUES (${user.id},'auth.password_change','user',${user.id},'User changed password and revoked prior sessions')`;});await createSession(user.id);return ok({changed:true,sessionsRevoked:true});}catch(e){return apiError(e);}}
