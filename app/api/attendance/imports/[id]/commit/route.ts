import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";

export async function POST(_:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params;const sql=db();
    const [job]=await sql`SELECT * FROM import_jobs WHERE id=${id} AND import_type='attendance_punches'`;
    if(!job)return fail('Import job not found',404);
    const user=await requireApiUser('attendance:write',job.business_head_id);if(user instanceof Response)return user;
    if(job.status!=='previewed')return fail('Only a previewed import can be committed',409);
    const [invalid]=await sql`SELECT 1 FROM import_job_rows WHERE import_job_id=${id} AND jsonb_array_length(errors)>0 LIMIT 1`;
    if(invalid)return fail('Resolve all preview errors before committing the import',409);
    const [blocked]=await sql`SELECT m.period_month,m.status FROM import_job_rows r JOIN employees e ON e.id=(r.normalized_data->>'employeeId')::uuid LEFT JOIN work_locations w ON w.id=e.work_location_id JOIN attendance_months m ON m.business_head_id=e.business_head_id AND m.period_month=date_trunc('month',((r.normalized_data->>'punchedAt')::timestamptz AT TIME ZONE coalesce(w.timezone,'Asia/Kolkata')))::date WHERE r.import_job_id=${id} AND m.status<>'open' LIMIT 1`;
    if(blocked)return fail('The import includes attendance that is under review or locked',409,{periodMonth:blocked.period_month,status:blocked.status});
    const result=await sql.begin(async tx=>{
      const rows=await tx`SELECT * FROM import_job_rows WHERE import_job_id=${id} ORDER BY row_number FOR UPDATE`;
      let committed=0;
      for(const row of rows){const value=row.normalized_data;const [punch]=await tx`INSERT INTO raw_punches (employee_id,punched_at,direction,device_id,source,external_id,payload) VALUES (${value.employeeId},${value.punchedAt},${value.direction},${value.deviceId},${value.source},${value.externalId},${JSON.stringify(value.payload||{})}::jsonb) ON CONFLICT (source,external_id) DO NOTHING RETURNING id`;if(punch){await tx`UPDATE import_job_rows SET committed_record_type='raw_punch',committed_record_id=${punch.id} WHERE id=${row.id}`;committed++;}}
      const interpreted=await tx`INSERT INTO attendance_days (employee_id,attendance_date,status,first_in,last_out,worked_minutes,source) SELECT p.employee_id,(p.punched_at AT TIME ZONE coalesce(w.timezone,'Asia/Kolkata'))::date,'present',min(p.punched_at),max(p.punched_at),greatest(0,round(extract(epoch FROM (max(p.punched_at)-min(p.punched_at)))/60)::int),${`biometric:${job.mapping.source||'import'}`} FROM raw_punches p JOIN employees e ON e.id=p.employee_id LEFT JOIN work_locations w ON w.id=e.work_location_id JOIN import_job_rows r ON r.committed_record_id=p.id WHERE r.import_job_id=${id} GROUP BY p.employee_id,(p.punched_at AT TIME ZONE coalesce(w.timezone,'Asia/Kolkata'))::date ON CONFLICT (employee_id,attendance_date) DO UPDATE SET first_in=least(attendance_days.first_in,EXCLUDED.first_in),last_out=greatest(attendance_days.last_out,EXCLUDED.last_out),worked_minutes=greatest(attendance_days.worked_minutes,EXCLUDED.worked_minutes),version=attendance_days.version+1 WHERE attendance_days.locked_at IS NULL AND attendance_days.source LIKE 'biometric:%' RETURNING id`;
      await tx`UPDATE import_jobs SET status='committed',committed_at=now(),summary=summary||${JSON.stringify({committed:true})}::jsonb WHERE id=${id}`;
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason) VALUES (${user.id},'attendance_import.commit','import_job',${id},${job.business_head_id},${JSON.stringify({committed,attendanceDays:interpreted.length})}::jsonb,'Validated attendance punches committed and interpreted')`;
      return{committed,attendanceDays:interpreted.length};
    });
    return ok(result);
  }catch(error){return apiError(error);}
}
