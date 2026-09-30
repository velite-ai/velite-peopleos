import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";

const schema=z.object({reason:z.string().min(5).max(1000)});
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params;const input=schema.parse(await request.json());const sql=db();
    const [job]=await sql`SELECT * FROM import_jobs WHERE id=${id} AND import_type='attendance_punches'`;
    if(!job)return fail('Import job not found',404);
    const user=await requireApiUser('attendance:write',job.business_head_id);if(user instanceof Response)return user;
    if(job.status!=='committed')return fail('Only a committed import can be rolled back',409);
    const [blocked]=await sql`SELECT m.period_month,m.status FROM import_job_rows r JOIN raw_punches p ON p.id=r.committed_record_id JOIN employees e ON e.id=p.employee_id LEFT JOIN work_locations w ON w.id=e.work_location_id JOIN attendance_months m ON m.business_head_id=e.business_head_id AND m.period_month=date_trunc('month',(p.punched_at AT TIME ZONE coalesce(w.timezone,'Asia/Kolkata')))::date WHERE r.import_job_id=${id} AND m.status<>'open' LIMIT 1`;
    if(blocked)return fail('This import affects attendance that is under review or locked and cannot be rolled back',409,{periodMonth:blocked.period_month,status:blocked.status});
    const result=await sql.begin(async tx=>{
      const affected=await tx<{employee_id:string;attendance_date:string}[]>`SELECT DISTINCT p.employee_id,(p.punched_at AT TIME ZONE coalesce(w.timezone,'Asia/Kolkata'))::date AS attendance_date FROM import_job_rows r JOIN raw_punches p ON p.id=r.committed_record_id JOIN employees e ON e.id=p.employee_id LEFT JOIN work_locations w ON w.id=e.work_location_id WHERE r.import_job_id=${id}`;
      const removed=await tx`DELETE FROM raw_punches p USING import_job_rows r WHERE r.import_job_id=${id} AND r.committed_record_id=p.id RETURNING p.id`;
      let recomputed=0,deletedDays=0;
      for(const item of affected){
        const [remaining]=await tx`SELECT min(p.punched_at) AS first_in,max(p.punched_at) AS last_out,greatest(0,round(extract(epoch FROM (max(p.punched_at)-min(p.punched_at)))/60)::int) AS worked_minutes,count(*)::int AS punches FROM raw_punches p JOIN employees e ON e.id=p.employee_id LEFT JOIN work_locations w ON w.id=e.work_location_id WHERE p.employee_id=${item.employee_id} AND (p.punched_at AT TIME ZONE coalesce(w.timezone,'Asia/Kolkata'))::date=${item.attendance_date}::date`;
        if(Number(remaining.punches)>0){const changed=await tx`UPDATE attendance_days SET first_in=${remaining.first_in},last_out=${remaining.last_out},worked_minutes=${remaining.worked_minutes},version=version+1 WHERE employee_id=${item.employee_id} AND attendance_date=${item.attendance_date}::date AND locked_at IS NULL AND source LIKE 'biometric:%' RETURNING id`;recomputed+=changed.length;}
        else{const deleted=await tx`DELETE FROM attendance_days WHERE employee_id=${item.employee_id} AND attendance_date=${item.attendance_date}::date AND locked_at IS NULL AND source LIKE 'biometric:%' RETURNING id`;deletedDays+=deleted.length;}
      }
      await tx`UPDATE import_jobs SET status='rolled_back',rolled_back_at=now() WHERE id=${id}`;
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason) VALUES (${user.id},'attendance_import.rollback','import_job',${id},${job.business_head_id},${JSON.stringify({status:job.status})}::jsonb,${JSON.stringify({status:'rolled_back',removed:removed.length,recomputed,deletedDays})}::jsonb,${input.reason})`;
      return{removed:removed.length,recomputed,deletedDays};
    });
    return ok(result);
  }catch(error){return apiError(error);}
}
