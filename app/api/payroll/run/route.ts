import { createHash } from "node:crypto";
import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";
import { calculatePayroll, PayrollContext, PayrollRule } from "@/lib/payroll-engine";

const schema=z.object({payrollPeriodId:z.uuid(),action:z.enum(['calculate','lock','mark_paid']),paymentReference:z.string().min(3).max(120).optional()});
type Period={id:string;business_head_id:string;period_month:string;status:string;calculated_by:string|null};
type AttendanceSummary={id:string;employee_code:string;recorded_days:number;expected_days:number;missing_days:number;unpaid_days:number;overtime_minutes:number};

export async function POST(request:Request){
  try{
    const input=schema.parse(await request.json());const sql=db();
    const [period]=await sql<Period[]>`SELECT id,business_head_id,period_month,status,calculated_by FROM payroll_periods WHERE id=${input.payrollPeriodId}`;
    if(!period)return fail('Payroll period not found',404);
    const permission=input.action==='mark_paid'?'payroll:approve':'payroll:write';
    const user=await requireApiUser(permission,period.business_head_id);if(user instanceof Response)return user;

    if(input.action==='lock'){
      if(period.status!=='approved')return fail('Only reviewer- and finance-approved payroll can be locked',409);
      const approvals=await sql<{stage:string;actor_user_id:string}[]>`SELECT stage,actor_user_id FROM payroll_approval_steps WHERE payroll_period_id=${period.id} AND decision='approve' AND active=true ORDER BY created_at`;
      if(!approvals.some(step=>step.stage==='reviewer')||!approvals.some(step=>step.stage==='finance'))return fail('Reviewer and finance approvals are both required before lock',409);
      if(new Set(approvals.map(step=>step.actor_user_id)).size!==approvals.length)return fail('Payroll approval stages must use different people',409);
      if(period.calculated_by===user.id||approvals.some(step=>step.actor_user_id===user.id))return fail('The payroll maker or approver cannot perform the final lock',409);
      const payslips=await sql.begin(async tx=>{
        const updated=await tx`UPDATE payroll_periods SET status='locked',locked_at=now(),locked_by=${user.id} WHERE id=${period.id} AND status='approved' RETURNING id`;
        if(!updated.length)throw new Error('PAYROLL_STATUS_CHANGED');
        const generated=await tx`INSERT INTO payslips (payroll_result_id,snapshot) SELECT r.id,jsonb_build_object('periodMonth',p.period_month,'payDate',p.pay_date,'employee',jsonb_build_object('id',e.id,'employeeCode',e.employee_code,'name',concat_ws(' ',e.first_name,e.last_name),'position',e.position),'attendance',jsonb_build_object('calendarDays',r.calendar_days,'payableDays',r.payable_days,'absentDays',r.absent_days),'calculation',r.calculation_trace,'totals',jsonb_build_object('grossEarnings',r.gross_earnings,'deductions',r.deductions,'netPay',r.net_pay,'employerCost',r.employer_cost)) FROM payroll_results r JOIN payroll_periods p ON p.id=r.payroll_period_id JOIN employees e ON e.id=r.employee_id WHERE r.payroll_period_id=${period.id} ON CONFLICT (payroll_result_id) DO UPDATE SET snapshot=EXCLUDED.snapshot,generated_at=now() RETURNING id`;
        for(const payslip of generated)await tx`INSERT INTO document_generation_jobs (job_type,source_record_id,requested_by) VALUES ('payslip',${payslip.id},${user.id}) ON CONFLICT (job_type,source_record_id) DO UPDATE SET status=CASE WHEN document_generation_jobs.status='failed' THEN 'pending' ELSE document_generation_jobs.status END,attempts=CASE WHEN document_generation_jobs.status='failed' THEN 0 ELSE document_generation_jobs.attempts END,error_message=NULL,next_attempt_at=now(),lease_owner=NULL,leased_until=NULL,requested_by=EXCLUDED.requested_by`;
        await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason) VALUES (${user.id},'payroll.lock','payroll_period',${period.id},${period.business_head_id},${JSON.stringify({payslipsGenerated:generated.length})}::jsonb,'Approved payroll locked and document generation queued')`;
        return generated.length;
      }).catch(error=>{if(error instanceof Error&&error.message==='PAYROLL_STATUS_CHANGED')return null;throw error;});
      if(payslips===null)return fail('Payroll status changed; refresh and try again',409);
      return ok({locked:true,payslipsGenerated:payslips});
    }

    if(input.action==='mark_paid'){
      if(period.status!=='locked')return fail('Only locked payroll can be marked paid',409);
      if(!input.paymentReference)return fail('Payment reference is required',422);
      const paid=await sql.begin(async tx=>{
        const results=await tx`SELECT employee_id,coalesce((calculation_trace->'context'->>'ADVANCE_ADJUSTED')::numeric,0) AS recovery FROM payroll_results WHERE payroll_period_id=${period.id}`;let transactions=0;
        for(const result of results){let remaining=Number(result.recovery||0);if(remaining<=0)continue;const loans=await tx`SELECT id,outstanding FROM employee_loans WHERE employee_id=${result.employee_id} AND status='active' AND outstanding>0 ORDER BY start_month,id FOR UPDATE`;for(const loan of loans){if(remaining<=0)break;const amount=Math.min(remaining,Number(loan.outstanding));await tx`INSERT INTO loan_transactions (loan_id,payroll_period_id,transaction_date,amount,transaction_type) VALUES (${loan.id},${period.id},current_date,${amount},'payroll_recovery')`;await tx`UPDATE employee_loans SET outstanding=greatest(0,outstanding-${amount}),status=CASE WHEN outstanding-${amount}<=0 THEN 'closed' ELSE status END WHERE id=${loan.id}`;remaining-=amount;transactions++;}}
        const updated=await tx`UPDATE payroll_periods SET status='paid' WHERE id=${period.id} AND status='locked' RETURNING id`;if(!updated.length)throw new Error('PAYROLL_STATUS_CHANGED');
        const published=await tx`UPDATE payslips p SET published_at=now(),published_by=${user.id} FROM payroll_results r WHERE r.id=p.payroll_result_id AND r.payroll_period_id=${period.id} RETURNING p.id`;
        await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason) VALUES (${user.id},'payroll.mark_paid','payroll_period',${period.id},${period.business_head_id},${JSON.stringify({paymentReference:input.paymentReference,loanTransactions:transactions,payslipsPublished:published.length})}::jsonb,'Payment confirmed and payslips published')`;
        return{transactions,payslips:published.length};
      });
      return ok({paid:true,paymentReference:input.paymentReference,loanTransactions:paid.transactions,payslipsPublished:paid.payslips});
    }

    if(!['open','inputs_pending','validating','calculated','review'].includes(period.status))return fail(`Payroll cannot be recalculated while ${period.status}`,409);
    const [existingApproval]=await sql`SELECT id FROM payroll_approval_steps WHERE payroll_period_id=${period.id} AND decision='approve' AND active=true LIMIT 1`;
    if(existingApproval)return fail('Return the payroll through the approval workflow before recalculating',409);
    const [attendanceMonth]=await sql<{id:string;status:string;summary:{employees?:AttendanceSummary[]};locked_at:string|null;locked_by:string|null;employee_count:number;exception_count:number}[]>`SELECT id,status,summary,locked_at,locked_by,employee_count,exception_count FROM attendance_months WHERE business_head_id=${period.business_head_id} AND period_month=${period.period_month}`;
    if(!attendanceMonth||attendanceMonth.status!=='locked'||!attendanceMonth.locked_at)return fail('Lock the reviewed monthly attendance summary before calculating payroll',409);
    if(attendanceMonth.exception_count>0)return fail('The locked attendance summary contains unresolved missing-day exceptions',409,{exceptionCount:attendanceMonth.exception_count});
    const attendanceRows=attendanceMonth.summary?.employees||[];const attendanceByEmployee=new Map(attendanceRows.map(row=>[row.id,row]));
    const attendanceChecksum=createHash('sha256').update(JSON.stringify(attendanceMonth.summary)).digest('hex');
    const monthStart=period.period_month.slice(0,10);const [year,month]=monthStart.split('-').map(Number);const calendarDays=new Date(year,month,0).getDate();const monthEnd=`${year}-${String(month).padStart(2,'0')}-${String(calendarDays).padStart(2,'0')}`;
    const employees=await sql`SELECT e.id,e.employee_code,e.business_head_id,e.department_id,e.date_joined,e.last_working_date,e.grade,e.work_location,e.employment_type,c.id AS compensation_id,c.effective_from AS compensation_effective_from,c.effective_to AS compensation_effective_to,c.monthly_gross,c.structure FROM employees e LEFT JOIN LATERAL (SELECT * FROM employee_compensation ec WHERE ec.employee_id=e.id AND ec.effective_from<=${monthEnd}::date AND (ec.effective_to IS NULL OR ec.effective_to>=${monthStart}::date) ORDER BY ec.effective_from DESC LIMIT 1) c ON true WHERE e.business_head_id=${period.business_head_id} AND e.date_joined<=${monthEnd}::date AND (e.last_working_date IS NULL OR e.last_working_date>=${monthStart}::date) AND e.status NOT IN ('candidate','preboarding','archived') ORDER BY e.employee_code`;
    if(employees.length!==attendanceMonth.employee_count||attendanceRows.length!==attendanceMonth.employee_count)return fail('Employee population changed after attendance lock; reopen attendance before payroll calculation',409,{currentEmployees:employees.length,lockedEmployees:attendanceMonth.employee_count});
    const missingCompensation=employees.filter(employee=>!employee.compensation_id).map(employee=>employee.employee_code);if(missingCompensation.length)return fail('Active employees are missing effective compensation',409,{employeeCodes:missingCompensation});
    const invalidAttendance=employees.filter(employee=>{const row=attendanceByEmployee.get(employee.id);return !row||Number(row.missing_days)>0||Number(row.recorded_days)!==Number(row.expected_days);}).map(employee=>employee.employee_code);
    if(invalidAttendance.length)return fail('Locked attendance is incomplete for one or more employees',409,{employeeCodes:invalidAttendance});
    const dbRules=await sql`SELECT DISTINCT ON (r.code) r.id,r.code,r.name,r.version,r.business_head_id,r.component_id,c.category,r.priority,r.conditions,r.formula,r.rounding_method,r.effective_from,r.effective_to,r.approved_by FROM payroll_rules r JOIN salary_components c ON c.id=r.component_id WHERE r.status='approved' AND (r.business_head_id IS NULL OR r.business_head_id=${period.business_head_id}) AND r.effective_from<=${monthEnd}::date AND (r.effective_to IS NULL OR r.effective_to>=${monthStart}::date) ORDER BY r.code,(r.business_head_id IS NOT NULL) DESC,r.version DESC`;
    const rules=dbRules.map(rule=>({code:rule.code,name:rule.name,category:rule.category,priority:rule.priority,condition:Object.keys(rule.conditions||{}).length?rule.conditions:undefined,formula:rule.formula,rounding:rule.rounding_method}) as PayrollRule);
    if(!rules.length)return fail('No approved payroll rules apply to this period',409);
    let totalNet=0;
    const calculated=await sql.begin(async tx=>{
      await tx`UPDATE payroll_periods SET status='validating',rules_snapshot=${JSON.stringify({rules:dbRules,attendanceMonthId:attendanceMonth.id,attendanceChecksum,lockedAt:attendanceMonth.locked_at})}::jsonb WHERE id=${period.id}`;
      const results=[];
      for(const employee of employees){
        const attendance=attendanceByEmployee.get(employee.id)!;
        const [loans]=await tx`SELECT coalesce(sum(least(instalment_amount,outstanding)),0)::numeric AS recovery,coalesce(sum(outstanding),0)::numeric AS balance FROM employee_loans WHERE employee_id=${employee.id} AND status='active' AND start_month<=${monthStart}::date`;
        const [overtime]=await tx`SELECT coalesce(sum(minutes),0)::numeric/60 AS hours FROM overtime_requests WHERE employee_id=${employee.id} AND work_date>=${monthStart}::date AND work_date<=${monthEnd}::date AND status='approved'`;
        const adjustments=await tx<{component_code:string;amount:number;adjustment_type:string;id:string}[]>`SELECT id,component_code,amount,adjustment_type FROM payroll_adjustments WHERE employee_id=${employee.id} AND target_payroll_period_id=${period.id} AND status='approved'`;
        const prior=await tx<{net_pay:number}[]>`SELECT r.net_pay FROM payroll_results r JOIN payroll_periods p ON p.id=r.payroll_period_id WHERE r.employee_id=${employee.id} AND p.period_month<${monthStart}::date AND p.status IN ('locked','paid') ORDER BY p.period_month DESC LIMIT 1`;
        const structure=(employee.structure||{}) as Record<string,number>;const unpaidDays=Number(attendance.unpaid_days||0);const payableDays=Math.max(0,Number(attendance.expected_days)-unpaidDays);
        const context:PayrollContext={CALENDAR_DAYS:calendarDays,DIVISOR_DAYS:Number(structure.divisorDays||calendarDays),UNPAID_DAYS:unpaidDays,PAYABLE_DAYS:payableDays,MONTHLY_BASIC:Number(structure.basic||0),MONTHLY_ALLOWANCES:Number(structure.allowances||Number(employee.monthly_gross)-Number(structure.basic||0)),OVERTIME_HOURS:Number(overtime.hours||0),OVERTIME_RATE:Number(structure.overtimeRate||0),ADVANCE_ADJUSTED:Number(loans.recovery||0),ADVANCE_BALANCE:Number(loans.balance||0),OTHER_DEDUCTIONS_INPUT:adjustments.filter(row=>row.adjustment_type==='deduction').reduce((sum,row)=>sum+Number(row.amount),0),ONE_TIME_EARNINGS_INPUT:adjustments.filter(row=>row.adjustment_type!=='deduction').reduce((sum,row)=>sum+Number(row.amount),0),BUSINESS_HEAD_ID:employee.business_head_id,DEPARTMENT_ID:employee.department_id||'',GRADE:employee.grade||'',LOCATION:employee.work_location||'',EMPLOYMENT_TYPE:employee.employment_type,TENURE_MONTHS:Math.max(0,(year-new Date(`${employee.date_joined}T00:00:00Z`).getUTCFullYear())*12+month-(new Date(`${employee.date_joined}T00:00:00Z`).getUTCMonth()+1))};
        for(const adjustment of adjustments)if(/^[A-Z][A-Z0-9_]{0,79}$/.test(adjustment.component_code))context[adjustment.component_code]=Number(adjustment.amount);
        const result=calculatePayroll(context,rules);totalNet+=result.netPay;const trace={...result,provenance:{attendanceMonthId:attendanceMonth.id,attendanceChecksum,attendanceEmployeeSummary:attendance,compensationId:employee.compensation_id,compensationEffectiveFrom:employee.compensation_effective_from,compensationEffectiveTo:employee.compensation_effective_to,ruleIds:dbRules.map(rule=>({id:rule.id,code:rule.code,version:rule.version})),adjustmentIds:adjustments.map(row=>row.id),priorNetPay:prior[0]?Number(prior[0].net_pay):null,netVariance:prior[0]?result.netPay-Number(prior[0].net_pay):null}};
        const [saved]=await tx`INSERT INTO payroll_results (payroll_period_id,employee_id,calendar_days,payable_days,absent_days,gross_earnings,deductions,net_pay,employer_cost,calculation_trace) VALUES (${period.id},${employee.id},${calendarDays},${Number(result.context.PAYABLE_DAYS||payableDays)},${unpaidDays},${result.grossEarnings},${result.deductions},${result.netPay},${result.employerCost},${JSON.stringify(trace)}::jsonb) ON CONFLICT (payroll_period_id,employee_id) DO UPDATE SET calendar_days=EXCLUDED.calendar_days,payable_days=EXCLUDED.payable_days,absent_days=EXCLUDED.absent_days,gross_earnings=EXCLUDED.gross_earnings,deductions=EXCLUDED.deductions,net_pay=EXCLUDED.net_pay,employer_cost=EXCLUDED.employer_cost,calculation_trace=EXCLUDED.calculation_trace,created_at=now() RETURNING id,employee_id,net_pay`;
        results.push(saved);
      }
      await tx`UPDATE payroll_periods SET status='review',calculated_by=${user.id},calculated_at=now() WHERE id=${period.id}`;
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason) VALUES (${user.id},'payroll.calculate','payroll_period',${period.id},${period.business_head_id},${JSON.stringify({employees:results.length,totalNet,attendanceMonthId:attendanceMonth.id,attendanceChecksum,ruleVersions:dbRules.map(rule=>({id:rule.id,code:rule.code,version:rule.version}))})}::jsonb,'Payroll calculated from locked attendance snapshot')`;
      return results;
    });
    return ok({employees:calculated.length,totalNet,attendanceMonthId:attendanceMonth.id,attendanceChecksum,results:calculated});
  }catch(e){return apiError(e);}
}
