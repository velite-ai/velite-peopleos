import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";
import { hashPassword } from "@/lib/password";
const schema=z.object({temporaryPassword:z.string().min(12).max(128),reason:z.string().min(3).max(1000)});
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{const {id}=await params;const input=schema.parse(await request.json());const actor=await requireApiUser('admin:users');if(actor instanceof Response)return actor;const sql=db();const [target]=await sql`SELECT id FROM users WHERE id=${id}`;if(!target)return fail('User not found',404);const hash=await hashPassword(input.temporaryPassword);await sql.begin(async tx=>{await tx`UPDATE users SET password_hash=${hash},must_change_password=true,password_changed_at=now(),updated_at=now() WHERE id=${id}`;await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,reason) VALUES (${actor.id},'user.password_reset','user',${id},${input.reason})`;});return ok({id,mustChangePassword:true});}catch(e){return apiError(e);}}
