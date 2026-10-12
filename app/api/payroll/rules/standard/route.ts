import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";
import { standardStatutoryRules } from "@/lib/payroll-standard-rules";

const schema=z.discriminatedUnion('action',[
  z.object({action:z.literal('create'),businessHeadId:z.uuid(),effectiveFrom:z.iso.date()}),
  z.object({action:z.literal('approve'),businessHeadId:z.uuid(),reason:z.string().min(3).max(1000)}),
]);

// Adds (or approves) the PF, ESI and welfare-fund rules for ONE company. Never global.
export async function POST(request:Request){
  try{
    const input=schema.parse(await request.json());const sql=db();
    const [head]=await sql<{id:string;name:string}[]>`SELECT id,name FROM business_heads WHERE id=${input.businessHeadId}`;
    if(!head)return fail('Company not found',404);
    const definitions=standardStatutoryRules();const codes=definitions.map(rule=>rule.code);

    if(input.action==='create'){
      const user=await requireApiUser('payroll:write',head.id);if(user instanceof Response)return user;
      const result=await sql.begin(async tx=>{
        const created:string[]=[];const skipped:string[]=[];
        for(const definition of definitions){
          const [existing]=await tx`SELECT id FROM payroll_rules WHERE code=${definition.code} AND business_head_id=${head.id} AND status IN ('draft','pending','approved') LIMIT 1`;
          if(existing){skipped.push(definition.code);continue;}
          await tx`INSERT INTO salary_components (code,name,category,taxable) VALUES (${definition.code},${definition.componentName},${definition.category},false) ON CONFLICT (code) DO NOTHING`;
          const [component]=await tx<{id:string}[]>`SELECT id FROM salary_components WHERE code=${definition.code}`;
          const [latest]=await tx<{version:number}[]>`SELECT version FROM payroll_rules WHERE code=${definition.code} ORDER BY version DESC LIMIT 1`;
          const [row]=await tx`INSERT INTO payroll_rules (code,name,business_head_id,component_id,version,priority,conditions,formula,rounding_method,effective_from,status,change_reason,created_by) VALUES (${definition.code},${definition.name},${head.id},${component.id},${(latest?.version||0)+1},${definition.priority},${JSON.stringify(definition.condition)}::jsonb,${JSON.stringify(definition.formula)}::jsonb,${definition.rounding||'nearest_rupee'},${input.effectiveFrom},'pending','Standard PF, ESI and welfare-fund rules for this company',${user.id}) RETURNING id`;
          await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason) VALUES (${user.id},'payroll_rule.create_standard','payroll_rule',${row.id},${head.id},${JSON.stringify({code:definition.code,effectiveFrom:input.effectiveFrom,submitted:true})}::jsonb,'Standard statutory rule created and submitted for approval')`;
          created.push(definition.code);
        }
        return {created,skipped};
      });
      return ok({company:head.name,...result},{status:201});
    }

    const user=await requireApiUser('payroll:approve',head.id);if(user instanceof Response)return user;
    const pending=await sql<{id:string;code:string;created_by:string;effective_from:string;effective_to:string|null;version:number}[]>`SELECT id,code,created_by,effective_from,effective_to,version FROM payroll_rules WHERE business_head_id=${head.id} AND status='pending' AND code=ANY(${codes})`;
    if(!pending.length)return fail('There are no waiting PF, ESI or welfare-fund rules for this company',409);
    const own=pending.filter(rule=>rule.created_by===user.id);
    if(own.length===pending.length)return fail('The person who added these rules cannot approve them. Ask the other login to approve.',409);
    const approved=await sql.begin(async tx=>{
      const done:string[]=[];
      for(const rule of pending){
        if(rule.created_by===user.id)continue;
        const [overlap]=await tx`SELECT id FROM payroll_rules WHERE id<>${rule.id} AND code=${rule.code} AND status='approved' AND business_head_id=${head.id} AND effective_from<=coalesce(${rule.effective_to}::date,'9999-12-31'::date) AND coalesce(effective_to,'9999-12-31'::date)>=${rule.effective_from}::date LIMIT 1`;
        if(overlap)throw new Error(`RULE_OVERLAP:${rule.code}`);
        await tx`UPDATE payroll_rules SET status='approved',approved_by=${user.id} WHERE id=${rule.id} AND status='pending'`;
        await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason) VALUES (${user.id},'payroll_rule.approve','payroll_rule',${rule.id},${head.id},${JSON.stringify({status:'pending',code:rule.code,version:rule.version})}::jsonb,${JSON.stringify({status:'approved'})}::jsonb,${input.reason})`;
        done.push(rule.code);
      }
      return done;
    }).catch(error=>{if(error instanceof Error&&error.message.startsWith('RULE_OVERLAP:'))return error.message;throw error;});
    if(typeof approved==='string')return fail(`An approved version of ${approved.split(':')[1]} already covers these dates. Retire it first.`,409);
    return ok({company:head.name,approved,leftForSomeoneElse:own.map(rule=>rule.code)});
  }catch(e){return apiError(e);}
}
