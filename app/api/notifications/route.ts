import { z } from "zod";
import { apiError,ok,requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";
const schema=z.object({ids:z.array(z.uuid()).min(1).max(100)});
export async function GET(){try{const user=await requireApiUser();if(user instanceof Response)return user;const rows=await db()`SELECT id,title,body,action_path,deliver_on,read_at,created_at FROM notifications WHERE recipient_user_id=${user.id} ORDER BY read_at NULLS FIRST,created_at DESC LIMIT 100`;return ok({unread:rows.filter(row=>!row.read_at).length,items:rows});}catch(e){return apiError(e);}}
export async function PATCH(request:Request){try{const input=schema.parse(await request.json());const user=await requireApiUser();if(user instanceof Response)return user;const rows=await db()`UPDATE notifications SET read_at=coalesce(read_at,now()) WHERE recipient_user_id=${user.id} AND id IN ${db()(input.ids)} RETURNING id`;return ok({markedRead:rows.length});}catch(e){return apiError(e);}}
