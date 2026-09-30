import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";

const schema=z.object({reason:z.string().min(5).max(1000)});
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{const {id}=await params;const input=schema.parse(await request.json());const user=await requireApiUser('admin:users');if(user instanceof Response)return user;const sql=db();const [key]=await sql`SELECT id,name,business_head_id,revoked_at FROM api_keys WHERE id=${id}`;if(!key)return fail('API key not found',404);if(key.revoked_at)return fail('API key is already revoked',409);await sql.begin(async tx=>{await tx`UPDATE api_keys SET revoked_at=now() WHERE id=${id}`;await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason) VALUES (${user.id},'api_key.revoke','api_key',${id},${key.business_head_id},${JSON.stringify(key)}::jsonb,${JSON.stringify({revoked:true})}::jsonb,${input.reason})`;});return ok({revoked:true});}catch(error){return apiError(error);}}
