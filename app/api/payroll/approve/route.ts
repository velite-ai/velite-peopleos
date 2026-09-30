import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { hasRoleForScope } from "@/lib/auth";
import { db } from "@/lib/database";

const schema=z.object({payrollPeriodId:z.uuid(),decision:z.enum(['approve','return']),reason:z.string().min(3).max(1000)});

export async function POST(request:Request){
  try{
    const input=schema.parse(await request.json());const sql=db();
    const [period]=await sql<{business_head_id:string;status:string;calculated_by:string|null}[]>`SELECT business_head_id,status,calculated_by FROM payroll_periods WHERE id=${input.payrollPeriodId}`;
    if(!period)return fail('Payroll period not found',404);
    const user=await requireApiUser('payroll:approve',period.business_head_id);if(user instanceof Response)return user;
    if(!['review','approved'].includes(period.status))return fail('Payroll is not ready for an approval decision',409);
    const result=await sql.begin(async tx=>{
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`payroll-approval:${input.payrollPeriodId}`}))`;
      const approvals=await tx<{stage:string;actor_user_id:string}[]>`SELECT stage,actor_user_id FROM payroll_approval_steps WHERE payroll_period_id=${input.payrollPeriodId} AND decision='approve' AND active=true ORDER BY created_at`;
      if(input.decision==='return'){
        const stage=approvals.some(step=>step.stage==='reviewer')?'finance':'reviewer';
        await tx`INSERT INTO payroll_approval_steps (payroll_period_id,stage,decision,actor_user_id,reason) VALUES (${input.payrollPeriodId},${stage},'return',${user.id},${input.reason})`;
        await tx`UPDATE payroll_approval_steps SET active=false WHERE payroll_period_id=${input.payrollPeriodId} AND decision='approve' AND active=true`;
        await tx`UPDATE payroll_periods SET status='open' WHERE id=${input.payrollPeriodId} AND status IN ('review','approved')`;
        await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,reason,after_data) VALUES (${user.id},'payroll.return','payroll_period',${input.payrollPeriodId},${period.business_head_id},${input.reason},${JSON.stringify({stage,previousApprovals:approvals})}::jsonb)`;
        return{status:'open',stage,decision:'return'};
      }
      if(period.calculated_by===user.id)return null;
      const reviewer=approvals.find(step=>step.stage==='reviewer');const finance=approvals.find(step=>step.stage==='finance');
      const stage=reviewer?'finance':'reviewer';
      if(stage==='reviewer'&&!hasRoleForScope(user,['HR_ADMIN'],period.business_head_id))throw new Error('REVIEWER_ROLE_REQUIRED');
      if(stage==='finance'&&!hasRoleForScope(user,['FINANCE_APPROVER'],period.business_head_id))throw new Error('FINANCE_ROLE_REQUIRED');
      if(finance)return{status:'approved',stage:'finance',decision:'approve',alreadyApproved:true};
      if(reviewer?.actor_user_id===user.id)return null;
      await tx`INSERT INTO payroll_approval_steps (payroll_period_id,stage,decision,actor_user_id,reason) VALUES (${input.payrollPeriodId},${stage},'approve',${user.id},${input.reason})`;
      const next=stage==='finance'?'approved':'review';
      await tx`UPDATE payroll_periods SET status=${next} WHERE id=${input.payrollPeriodId}`;
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,reason,after_data) VALUES (${user.id},${`payroll.${stage}_approve`},'payroll_period',${input.payrollPeriodId},${period.business_head_id},${input.reason},${JSON.stringify({stage,status:next})}::jsonb)`;
      return{status:next,stage,decision:'approve'};
    }).catch(error=>{if(error instanceof Error&&['REVIEWER_ROLE_REQUIRED','FINANCE_ROLE_REQUIRED'].includes(error.message))return error.message;throw error;});
    if(result==='REVIEWER_ROLE_REQUIRED')return fail('An HR administrator must perform the reviewer approval',403);
    if(result==='FINANCE_ROLE_REQUIRED')return fail('A finance approver must perform the finance approval',403);
    if(!result)return fail('Payroll maker and approvers must be different people',409);
    return ok(result);
  }catch(e){return apiError(e);}
}
