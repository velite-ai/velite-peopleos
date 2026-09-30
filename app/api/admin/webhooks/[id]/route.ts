import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";

const schema=z.object({active:z.boolean(),reason:z.string().min(5).max(1000)});
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){try{const {id}=await params;const input=schema.parse(await request.json());const user=await requireApiUser('admin:users');if(user instanceof Response)return user;const sql=db();const [webhook]=await sql`SELECT id,code,active FROM outbound_webhooks WHERE id=${id}`;if(!webhook)return fail('Webhook not found',404);const [updated]=await sql.begin(async tx=>{const rows=await tx`UPDATE outbound_webhooks SET active=${input.active} WHERE id=${id} RETURNING id,code,endpoint_url,event_types,active`;await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,before_data,after_data,reason) VALUES (${user.id},'webhook.set_active','outbound_webhook',${id},${JSON.stringify(webhook)}::jsonb,${JSON.stringify(rows[0])}::jsonb,${input.reason})`;return rows;});return ok(updated);}catch(error){return apiError(error);}}
