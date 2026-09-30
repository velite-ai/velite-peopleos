import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";

type Requested={status?:string;firstIn?:string|null;lastOut?:string|null;workedMinutes?:number;overtimeMinutes?:number;remarks?:string|null};
const schema=z.object({decision:z.enum(['approve','reject']),reason:z.string().min(3).max(1000)});

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params;const input=schema.parse(await request.json());const sql=db();
    const [record]=await sql<{id:string;status:string;attendance_day_id:string;requested_values:Requested;requested_by:string;business_head_id:string;employee_id:string;attendance_date:string;month_status:string|null}[]>`
      SELECT c.id,c.status,c.attendance_day_id,c.requested_values,c.requested_by,e.business_head_id,a.employee_id,a.attendance_date,m.status AS month_status
      FROM attendance_corrections c
      JOIN attendance_days a ON a.id=c.attendance_day_id
      JOIN employees e ON e.id=a.employee_id
      LEFT JOIN attendance_months m ON m.business_head_id=e.business_head_id AND m.period_month=date_trunc('month',a.attendance_date)::date
      WHERE c.id=${id}`;
    if(!record)return fail('Attendance correction not found',404);
    const user=await requireApiUser('attendance:write',record.business_head_id);if(user instanceof Response)return user;
    if(record.status!=='pending')return fail('Only pending corrections can be decided',409);
    if(record.requested_by===user.id)return fail('The correction requester cannot decide the same request',409);
    const next=input.decision==='approve'?'approved':'rejected';
    const result=await sql.begin(async tx=>{
      const [before]=await tx`SELECT * FROM attendance_days WHERE id=${record.attendance_day_id} FOR UPDATE`;
      let adjustmentId:string|null=null;
      const immutable=record.month_status==='locked'||Boolean(before.locked_at);
      if(next==='approved'&&immutable){
        const [adjustment]=await tx`INSERT INTO attendance_post_lock_adjustments (attendance_correction_id,employee_id,original_period_month,requested_values,created_by) VALUES (${record.id},${record.employee_id},date_trunc('month',${record.attendance_date}::date)::date,${JSON.stringify(record.requested_values)}::jsonb,${user.id}) RETURNING id`;
        adjustmentId=adjustment.id;
      }else if(next==='approved'){
        const v=record.requested_values;
        await tx`UPDATE attendance_days SET status=coalesce(${v.status??null}::attendance_status,status),first_in=CASE WHEN ${v.firstIn!==undefined} THEN ${v.firstIn??null}::timestamptz ELSE first_in END,last_out=CASE WHEN ${v.lastOut!==undefined} THEN ${v.lastOut??null}::timestamptz ELSE last_out END,worked_minutes=coalesce(${v.workedMinutes??null},worked_minutes),overtime_minutes=coalesce(${v.overtimeMinutes??null},overtime_minutes),remarks=CASE WHEN ${v.remarks!==undefined} THEN ${v.remarks??null} ELSE remarks END,version=version+1 WHERE id=${record.attendance_day_id}`;
        await tx`UPDATE attendance_months SET status='open',reviewed_at=NULL,reviewed_by=NULL,updated_at=now() WHERE business_head_id=${record.business_head_id} AND period_month=date_trunc('month',${record.attendance_date}::date)::date AND status='review'`;
      }
      await tx`UPDATE attendance_corrections SET status=${next},decided_by=${user.id},decided_at=now() WHERE id=${record.id}`;
      const [after]=await tx`SELECT * FROM attendance_days WHERE id=${record.attendance_day_id}`;
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason) VALUES (${user.id},${immutable&&next==='approved'?'attendance_correction.schedule_adjustment':`attendance_correction.${input.decision}`},${immutable&&next==='approved'?'attendance_post_lock_adjustment':'attendance_day'},${adjustmentId||record.attendance_day_id},${record.business_head_id},${JSON.stringify(before)}::jsonb,${JSON.stringify(immutable&&next==='approved'?{requestedValues:record.requested_values,adjustmentId}:after)}::jsonb,${input.reason})`;
      return {adjustmentId,immutable};
    });
    return ok({id:record.id,status:next,postLockAdjustmentId:result.adjustmentId,sourceAttendanceUnchanged:result.immutable&&next==='approved'});
  }catch(e){return apiError(e);}
}
