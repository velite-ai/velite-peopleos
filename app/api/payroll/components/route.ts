import { z } from "zod";
import { apiError, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";

const schema=z.object({code:z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),name:z.string().min(2).max(120),category:z.enum(['earning','deduction','employer_contribution','reimbursement']),taxable:z.boolean().default(true)});
export async function GET(){try{const user=await requireApiUser('payroll:read');if(user instanceof Response)return user;return ok(await db()`SELECT * FROM salary_components WHERE active=true ORDER BY category,name`);}catch(e){return apiError(e);}}
export async function POST(request:Request){try{const input=schema.parse(await request.json());const user=await requireApiUser('payroll:write');if(user instanceof Response)return user;const [row]=await db().begin(async tx=>{const rows=await tx`INSERT INTO salary_components (code,name,category,taxable) VALUES (${input.code},${input.name},${input.category},${input.taxable}) RETURNING *`;await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,after_data,reason) VALUES (${user.id},'salary_component.create','salary_component',${rows[0].id},${JSON.stringify(rows[0])}::jsonb,'Salary component created')`;return rows;});return ok(row,{status:201});}catch(e){return apiError(e);}}
