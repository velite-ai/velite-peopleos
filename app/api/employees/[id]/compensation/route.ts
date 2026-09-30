import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";

const schema=z.object({effectiveFrom:z.iso.date(),annualCtc:z.number().nonnegative(),monthlyGross:z.number().nonnegative(),structure:z.record(z.string(),z.number().nonnegative()),reason:z.string().min(3).max(2000),nextSalaryRevisionDate:z.iso.date().nullable().optional()}).refine(value=>value.monthlyGross*12<=value.annualCtc*1.25,{message:'Monthly gross is inconsistent with annual CTC'});
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params;const input=schema.parse(await request.json());const sql=db();
    const [employee]=await sql<{business_head_id:string}[]>`SELECT business_head_id FROM employees WHERE id=${id}`;
    if(!employee)return fail('Employee not found',404);
    const user=await requireApiUser('payroll:write',employee.business_head_id);if(user instanceof Response)return user;
    const row=await sql.begin(async tx=>{
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`employee-compensation:${id}`}))`;
      const [sameStart]=await tx`SELECT id FROM employee_compensation WHERE employee_id=${id} AND effective_from=${input.effectiveFrom}::date`;
      if(sameStart)throw new Error('COMPENSATION_START_EXISTS');
      const [next]=await tx<{effective_from:string}[]>`SELECT effective_from FROM employee_compensation WHERE employee_id=${id} AND effective_from>${input.effectiveFrom}::date ORDER BY effective_from LIMIT 1`;
      await tx`UPDATE employee_compensation SET effective_to=${input.effectiveFrom}::date-1 WHERE employee_id=${id} AND effective_from<${input.effectiveFrom}::date AND (effective_to IS NULL OR effective_to>=${input.effectiveFrom}::date)`;
      const effectiveTo=next?new Date(new Date(`${next.effective_from}T00:00:00Z`).getTime()-86400000).toISOString().slice(0,10):null;
      const [created]=await tx`INSERT INTO employee_compensation (employee_id,effective_from,effective_to,annual_ctc,monthly_gross,structure,reason,approved_by) VALUES (${id},${input.effectiveFrom},${effectiveTo},${input.annualCtc},${input.monthlyGross},${JSON.stringify(input.structure)}::jsonb,${input.reason},${user.id}) RETURNING *`;
      if(input.nextSalaryRevisionDate!==undefined)await tx`UPDATE employees SET next_salary_revision_date=${input.nextSalaryRevisionDate||null},updated_at=now() WHERE id=${id}`;
      await tx`INSERT INTO employee_events (employee_id,event_type,effective_date,new_values,reason,approved_by,created_by) VALUES (${id},'compensation_revision',${input.effectiveFrom},${JSON.stringify({annualCtc:input.annualCtc,monthlyGross:input.monthlyGross,nextSalaryRevisionDate:input.nextSalaryRevisionDate})}::jsonb,${input.reason},${user.id},${user.id})`;
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason) VALUES (${user.id},'compensation.revise','employee_compensation',${created.id},${employee.business_head_id},${JSON.stringify(created)}::jsonb,${input.reason})`;
      return created;
    }).catch(error=>{if(error instanceof Error&&error.message==='COMPENSATION_START_EXISTS')return null;throw error;});
    if(!row)return fail('A compensation revision already starts on this date',409);
    return ok(row,{status:201});
  }catch(e){return apiError(e);}
}
