import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { apiError, fail, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";
import { openJson } from "@/lib/encryption";

const safe=(value:unknown)=>{const text=value==null?'':String(value);const protectedValue=/^[=+\-@]/.test(text)?`'${text}`:text;return /[",\n\r]/.test(protectedValue)?`"${protectedValue.replaceAll('"','""')}"`:protectedValue;};
const csv=(rows:Record<string,unknown>[])=>{if(!rows.length)return '';const columns=Object.keys(rows[0]);return `\uFEFF${columns.map(safe).join(',')}\n${rows.map(row=>columns.map(column=>safe(row[column])).join(',')).join('\n')}\n`;};

export async function POST(_:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params;const sql=db();const [record]=await sql`SELECT q.*,p.business_head_id,p.period_month,p.status AS payroll_status FROM payroll_export_requests q JOIN payroll_periods p ON p.id=q.payroll_period_id WHERE q.id=${id}`;
    if(!record)return fail('Payroll export request not found',404);
    const user=await requireApiUser('payroll:approve',record.business_head_id);if(user instanceof Response)return user;
    if(record.status!=='approved')return fail('Only an approved export request can be generated',409);
    if(record.requested_by===user.id)return fail('The export requester cannot generate the same controlled export',409);
    if(!['locked','paid'].includes(record.payroll_status))return fail('Payroll is no longer exportable',409);
    const base=await sql`SELECT e.employee_code,concat_ws(' ',e.first_name,e.last_name) AS employee_name,e.bank_details_encrypted,r.gross_earnings,r.deductions,r.net_pay,r.employer_cost,r.calculation_trace FROM payroll_results r JOIN employees e ON e.id=r.employee_id WHERE r.payroll_period_id=${record.payroll_period_id} ORDER BY e.employee_code`;
    let rows:Record<string,unknown>[]=[];
    if(record.export_type==='bank')rows=base.map(item=>{let bank:Record<string,unknown>={};if(item.bank_details_encrypted)try{bank=openJson<Record<string,unknown>>(item.bank_details_encrypted);}catch{bank={};}return{employee_code:item.employee_code,employee_name:item.employee_name,account_name:bank.accountName||bank.account_name||'',account_number:bank.accountNumber||bank.account_number||'',ifsc:bank.ifsc||bank.IFSC||'',net_pay:item.net_pay};});
    else if(record.export_type==='accounting')rows=base.flatMap(item=>(item.calculation_trace?.lines||[]).map((line:{code:string;name:string;category:string;amount:number})=>({employee_code:item.employee_code,employee_name:item.employee_name,component_code:line.code,component_name:line.name,category:line.category,amount:line.amount,period_month:String(record.period_month).slice(0,10)})));
    else if(record.export_type==='statutory')rows=base.flatMap(item=>(item.calculation_trace?.lines||[]).filter((line:{code:string})=>/PF|ESI|PT|LWF|TDS|TAX|GRATUITY|BONUS/.test(line.code)).map((line:{code:string;name:string;amount:number})=>({employee_code:item.employee_code,employee_name:item.employee_name,statutory_code:line.code,statutory_name:line.name,amount:line.amount,period_month:String(record.period_month).slice(0,10)})));
    else rows=base.map(item=>({employee_code:item.employee_code,employee_name:item.employee_name,gross_earnings:item.gross_earnings,deductions:item.deductions,net_pay:item.net_pay,employer_cost:item.employer_cost,period_month:String(record.period_month).slice(0,10)}));
    const content=csv(rows);const checksum=createHash('sha256').update(content).digest('hex');const fileName=`velite-${record.export_type}-${String(record.period_month).slice(0,7)}.csv`;
    await sql.begin(async tx=>{const [generated]=await tx`INSERT INTO payroll_exports (payroll_period_id,export_type,file_name,row_count,checksum,generated_by) VALUES (${record.payroll_period_id},${record.export_type},${fileName},${rows.length},${checksum},${user.id}) RETURNING id`;await tx`UPDATE payroll_export_requests SET status='generated',payroll_export_id=${generated.id} WHERE id=${id} AND status='approved'`;await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason) VALUES (${user.id},'payroll_export.generate','payroll_export_request',${id},${record.business_head_id},${JSON.stringify({exportType:record.export_type,rowCount:rows.length,checksum,fileName})}::jsonb,'Approved controlled payroll export generated')`;});
    return new NextResponse(content,{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="${fileName}"`,'x-content-sha256':checksum}});
  }catch(e){return apiError(e);}
}
