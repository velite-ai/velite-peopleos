import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";

const schema = z.object({ cycleId:z.uuid(),employeeId:z.uuid(),parentGoalId:z.uuid().nullable().optional(),title:z.string().min(3).max(200),description:z.string().max(3000).nullable().optional(),weight:z.number().positive().max(100),targetValue:z.number().nullable().optional() });

export async function GET(request: Request) {
  try {
    const params=new URL(request.url).searchParams;const head=params.get('businessHeadId');const department=params.get('departmentId');const cycle=params.get('cycleId');const employee=params.get('employeeId');
    const user=await requireApiUser('performance:read',head,department);if(user instanceof Response)return user;
    return ok(await db()`SELECT g.*,c.name AS cycle_name,e.employee_code,concat_ws(' ',e.first_name,e.last_name) AS employee_name,e.business_head_id,e.department_id FROM performance_goals g JOIN performance_cycles c ON c.id=g.cycle_id JOIN employees e ON e.id=g.employee_id WHERE (${head}::uuid IS NULL OR e.business_head_id=${head}::uuid) AND (${department}::uuid IS NULL OR e.department_id=${department}::uuid) AND (${cycle}::uuid IS NULL OR g.cycle_id=${cycle}::uuid) AND (${employee}::uuid IS NULL OR g.employee_id=${employee}::uuid) ORDER BY c.start_date DESC,e.employee_code,g.created_at`);
  } catch(error){return apiError(error);}
}

export async function POST(request: Request) {
  try {
    const input=schema.parse(await request.json());const sql=db();const [employee]=await sql<{business_head_id:string;department_id:string|null}[]>`SELECT business_head_id,department_id FROM employees WHERE id=${input.employeeId}`;if(!employee)return fail('Employee not found',404);
    const user=await requireApiUser('performance:write',employee.business_head_id,employee.department_id);if(user instanceof Response)return user;
    const [cycle]=await sql`SELECT id FROM performance_cycles WHERE id=${input.cycleId} AND (business_head_id IS NULL OR business_head_id=${employee.business_head_id}) AND (department_id IS NULL OR department_id=${employee.department_id})`;if(!cycle)return fail('Performance cycle does not apply to this employee',422);
    const [total]=await sql<{weight:number}[]>`SELECT coalesce(sum(weight),0)::numeric AS weight FROM performance_goals WHERE cycle_id=${input.cycleId} AND employee_id=${input.employeeId}`;if(Number(total.weight)+input.weight>100)return fail('Goal weights cannot exceed 100 for an employee in a cycle',409);
    const [created]=await sql.begin(async tx=>{const rows=await tx`INSERT INTO performance_goals (cycle_id,employee_id,parent_goal_id,title,description,weight,target_value) VALUES (${input.cycleId},${input.employeeId},${input.parentGoalId||null},${input.title},${input.description||null},${input.weight},${input.targetValue??null}) RETURNING *`;await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason) VALUES (${user.id},'performance_goal.create','performance_goal',${rows[0].id},${employee.business_head_id},${JSON.stringify(rows[0])}::jsonb,'Weighted performance goal created')`;return rows;});return ok(created,{status:201});
  }catch(error){return apiError(error);}
}
