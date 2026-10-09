import { z } from "zod";
import { db } from "@/lib/database";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { hasRoleForScope } from "@/lib/auth";
import { defaultWorkedMinutes, earlyMinutes, isTimeStatus, istMinutes, istMoment, lateMinutes, parseClock } from "@/lib/attendance-time-rules";

const clock=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/,'Use a time like 09:30').nullable().optional();
const upsertSchema=z.object({employeeId:z.uuid(),attendanceDate:z.iso.date(),status:z.enum(['present','absent','half_day','paid_leave','unpaid_leave','weekly_off','holiday','work_from_home','on_duty','not_employed']),inTime:clock,outTime:clock,firstIn:z.iso.datetime().nullable().optional(),lastOut:z.iso.datetime().nullable().optional(),workedMinutes:z.number().int().min(0).max(1440).optional(),overtimeMinutes:z.number().int().min(0).max(1440).optional(),remarks:z.string().max(500).optional()});

export async function GET(request:Request){try{const u=new URL(request.url);const date=u.searchParams.get('date')||new Date().toISOString().slice(0,10);const head=u.searchParams.get('businessHeadId');const department=u.searchParams.get('departmentId');const location=u.searchParams.get('locationId');const shift=u.searchParams.get('shiftId');const manager=u.searchParams.get('managerId');const employeeId=u.searchParams.get('employeeId');const user=await requireApiUser('attendance:read',head,department);if(user instanceof Response)return user;const broad=hasRoleForScope(user,['HR_ADMIN','HR_OPERATIONS','PAYROLL_ADMIN','AUDITOR'],head,department);const actorEmployees=broad?[]:await db()< {id:string}[]>`SELECT id FROM employees WHERE user_id=${user.id}`;const actorEmployee=actorEmployees[0];const rows=await db()`SELECT a.id,e.id AS employee_id,e.employee_code,e.first_name,e.last_name,e.position,e.business_head_id,e.department_id,e.work_location_id,b.name AS business_head,d.name AS department,w.name AS work_location,s.id AS shift_id,s.name AS shift,a.first_in,a.last_out,a.worked_minutes,a.late_minutes,a.early_minutes,a.overtime_minutes,a.remarks,a.locked_at,coalesce(a.status::text,CASE WHEN e.date_joined>${date}::date OR (e.last_working_date IS NOT NULL AND e.last_working_date<${date}::date) THEN 'not_employed' ELSE 'missing' END) AS status FROM employees e JOIN business_heads b ON b.id=e.business_head_id LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN work_locations w ON w.id=e.work_location_id LEFT JOIN shift_rosters sr ON sr.employee_id=e.id AND sr.roster_date=${date}::date LEFT JOIN shifts s ON s.id=sr.shift_id LEFT JOIN attendance_days a ON a.employee_id=e.id AND a.attendance_date=${date}::date WHERE e.status NOT IN ('candidate','preboarding','archived') AND (${head}::uuid IS NULL OR e.business_head_id=${head}::uuid) AND (${department}::uuid IS NULL OR e.department_id=${department}::uuid) AND (${location}::uuid IS NULL OR e.work_location_id=${location}::uuid) AND (${shift}::uuid IS NULL OR sr.shift_id=${shift}::uuid) AND (${manager}::uuid IS NULL OR e.reporting_manager_id=${manager}::uuid) AND (${employeeId}::uuid IS NULL OR e.id=${employeeId}::uuid) AND (${broad} OR e.id=${actorEmployee?.id||null}::uuid OR e.reporting_manager_id=${actorEmployee?.id||null}::uuid) ORDER BY e.first_name,e.last_name`;return ok(rows);}catch(e){return apiError(e);}}

export async function POST(request:Request){
  try{
    const input=upsertSchema.parse(await request.json());
    const sql=db();
    const [employee]=await sql<{business_head_id:string;department_id:string|null}[]>`SELECT business_head_id,department_id FROM employees WHERE id=${input.employeeId}`;
    if(!employee)return fail('Employee not found',404);
    const user=await requireApiUser('attendance:write',employee.business_head_id,employee.department_id);
    if(user instanceof Response)return user;
    const [month]=await sql<{status:string}[]>`SELECT status FROM attendance_months WHERE business_head_id=${employee.business_head_id} AND period_month=date_trunc('month',${input.attendanceDate}::date)::date`;
    if(month&&month.status!=='open')return fail(month.status==='locked'?'Attendance is locked for this month; submit a correction request':'Attendance is under review for this company. Choose the company, then use "Return month to open" on the Attendance screen before editing',409);
    // Times: sent as India clock times ("09:25"). Leaving them out keeps what is already recorded; null clears them.
    const inMinutes=input.inTime?parseClock(input.inTime):null;
    const outMinutes=input.outTime?parseClock(input.outTime):null;
    if(inMinutes!==null&&outMinutes!==null&&outMinutes<=inMinutes)return fail('The leaving time must be after the arrival time',422);
    const timesGiven=input.inTime!==undefined||input.outTime!==undefined||input.firstIn!==undefined||input.lastOut!==undefined;
    const result=await sql.begin(async tx=>{
      const previous=await tx`SELECT * FROM attendance_days WHERE employee_id=${input.employeeId} AND attendance_date=${input.attendanceDate} FOR UPDATE`;
      const before=previous[0];
      if(before?.locked_at)return null;
      let firstIn:Date|null=before?.first_in??null,lastOut:Date|null=before?.last_out??null,late=Number(before?.late_minutes??0),early=Number(before?.early_minutes??0);
      if(!isTimeStatus(input.status)){firstIn=null;lastOut=null;late=0;early=0;}
      else if(timesGiven){
        if(input.inTime!==undefined)firstIn=inMinutes===null?null:istMoment(input.attendanceDate,inMinutes);
        else if(input.firstIn!==undefined)firstIn=input.firstIn?new Date(input.firstIn):null;
        if(input.outTime!==undefined)lastOut=outMinutes===null?null:istMoment(input.attendanceDate,outMinutes);
        else if(input.lastOut!==undefined)lastOut=input.lastOut?new Date(input.lastOut):null;
        late=firstIn?lateMinutes(istMinutes(firstIn)):0;
        early=lastOut?earlyMinutes(istMinutes(lastOut)):0;
        if(firstIn&&lastOut&&lastOut<=firstIn)return 'bad-times' as const;
      }
      const gap=firstIn&&lastOut?Math.round((lastOut.getTime()-firstIn.getTime())/60000):null;
      // Hours: what was typed by hand, else the real gap between arriving and leaving, else what was already there, else the usual for the status.
      const worked=input.workedMinutes!==undefined?input.workedMinutes:gap!==null&&isTimeStatus(input.status)?gap:before&&before.first_in&&before.last_out&&isTimeStatus(input.status)?Number(before.worked_minutes):defaultWorkedMinutes(input.status);
      const overtime=input.overtimeMinutes!==undefined?input.overtimeMinutes:Number(before?.overtime_minutes??0);
      const rows=await tx`INSERT INTO attendance_days (employee_id,attendance_date,status,first_in,last_out,late_minutes,early_minutes,worked_minutes,overtime_minutes,remarks,source) VALUES (${input.employeeId},${input.attendanceDate},${input.status},${firstIn},${lastOut},${late},${early},${Math.min(1440,Math.max(0,worked))},${overtime},${input.remarks??before?.remarks??null},'hrms') ON CONFLICT (employee_id,attendance_date) DO UPDATE SET status=EXCLUDED.status,first_in=EXCLUDED.first_in,last_out=EXCLUDED.last_out,late_minutes=EXCLUDED.late_minutes,early_minutes=EXCLUDED.early_minutes,worked_minutes=EXCLUDED.worked_minutes,overtime_minutes=EXCLUDED.overtime_minutes,remarks=EXCLUDED.remarks,version=attendance_days.version+1 WHERE attendance_days.locked_at IS NULL RETURNING *`;
      if(!rows[0])return null;
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason) VALUES (${user.id},'attendance.upsert','attendance_day',${rows[0].id},${employee.business_head_id},${before?JSON.stringify(before):null}::jsonb,${JSON.stringify(rows[0])}::jsonb,${input.remarks||'Attendance updated'})`;
      return rows[0];
    });
    if(result==='bad-times')return fail('The leaving time must be after the arrival time',422);
    if(!result)return fail('Attendance is locked for this day',409);
    return ok(result);
  }catch(e){return apiError(e);}
}
