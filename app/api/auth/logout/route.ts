import { currentUser,destroySession } from "@/lib/auth";
import { db } from "@/lib/database";
import { ok } from "@/lib/api";
export async function POST(){const user=await currentUser();if(user)await db()`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,reason) VALUES (${user.id},'auth.logout','user',${user.id},'User signed out')`;await destroySession();return ok({authenticated:false});}
