import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";
import { developmentActionSchema } from "@/lib/development-plans";

const createSchema = z.object({
  employeeId: z.uuid(),
  cycleId: z.uuid().nullable().optional(),
  title: z.string().min(3).max(200),
  actions: z.array(developmentActionSchema).max(50).default([]),
  dueDate: z.iso.date().nullable().optional(),
  ownerId: z.uuid().nullable().optional(),
  submit: z.boolean().default(false),
  reason: z.string().min(3).max(1000),
}).strict();

const listSchema = z.object({
  businessHeadId: z.uuid(),
  departmentId: z.uuid().nullable().optional(),
  employeeId: z.uuid().nullable().optional(),
  cycleId: z.uuid().nullable().optional(),
  status: z.enum(["draft", "pending", "approved", "rejected", "cancelled", "completed"]).nullable().optional(),
}).strict();

type EmployeeScope = { business_head_id: string; department_id: string | null };

async function validateOwner(sql: ReturnType<typeof db>, ownerId: string, employee: EmployeeScope) {
  const [owner] = await sql`
    SELECT u.id
    FROM users u
    LEFT JOIN employees oe ON oe.user_id=u.id
    WHERE u.id=${ownerId} AND u.active=true
      AND (
        oe.business_head_id=${employee.business_head_id}
        OR EXISTS (
          SELECT 1 FROM user_roles ur
          WHERE ur.user_id=u.id
            AND (ur.business_head_id IS NULL OR ur.business_head_id=${employee.business_head_id})
            AND (ur.department_id IS NULL OR ur.department_id=${employee.department_id})
        )
      )
  `;
  return Boolean(owner);
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const input = listSchema.parse({
      businessHeadId: params.get("businessHeadId"),
      departmentId: params.get("departmentId"),
      employeeId: params.get("employeeId"),
      cycleId: params.get("cycleId"),
      status: params.get("status"),
    });
    const actor = await requireApiUser("performance:read", input.businessHeadId, input.departmentId);
    if (actor instanceof Response) return actor;
    return ok(await db()`
      SELECT p.id,p.employee_id,p.cycle_id,p.title,p.actions,p.due_date,p.status,p.owner_id,p.created_by,
        p.approved_by,p.decision_reason,p.created_at,p.approved_at,p.updated_at,e.employee_code,
        concat_ws(' ',e.first_name,e.last_name) AS employee_name,e.business_head_id,e.department_id,
        c.name AS cycle_name,ou.full_name AS owner_name,cu.full_name AS created_by_name,au.full_name AS approved_by_name
      FROM development_plans p
      JOIN employees e ON e.id=p.employee_id
      LEFT JOIN performance_cycles c ON c.id=p.cycle_id
      LEFT JOIN users ou ON ou.id=p.owner_id
      LEFT JOIN users cu ON cu.id=p.created_by
      LEFT JOIN users au ON au.id=p.approved_by
      WHERE e.business_head_id=${input.businessHeadId}
        AND (${input.departmentId || null}::uuid IS NULL OR e.department_id=${input.departmentId || null}::uuid)
        AND (${input.employeeId || null}::uuid IS NULL OR p.employee_id=${input.employeeId || null}::uuid)
        AND (${input.cycleId || null}::uuid IS NULL OR p.cycle_id=${input.cycleId || null}::uuid)
        AND (${input.status || null}::text IS NULL OR p.status=${input.status || null}::workflow_status)
      ORDER BY p.due_date NULLS LAST,p.created_at DESC
      LIMIT 300
    `);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = createSchema.parse(await request.json());
    const sql = db();
    const [employee] = await sql<EmployeeScope[]>`
      SELECT business_head_id,department_id FROM employees WHERE id=${input.employeeId}
    `;
    if (!employee) return fail("Employee not found", 404);
    const actor = await requireApiUser("performance:write", employee.business_head_id, employee.department_id);
    if (actor instanceof Response) return actor;
    if (input.cycleId) {
      const [cycle] = await sql`
        SELECT id FROM performance_cycles
        WHERE id=${input.cycleId}
          AND (business_head_id IS NULL OR business_head_id=${employee.business_head_id})
          AND (department_id IS NULL OR department_id=${employee.department_id})
      `;
      if (!cycle) return fail("Performance cycle does not apply to this employee", 422);
    }
    const ownerId = input.ownerId || actor.id;
    if (!(await validateOwner(sql, ownerId, employee))) return fail("Development plan owner is outside the employee scope", 422);
    const status = input.submit ? "pending" : "draft";
    const [created] = await sql.begin(async tx => {
      const rows = await tx`
        INSERT INTO development_plans (employee_id,cycle_id,title,actions,due_date,status,owner_id,created_by)
        VALUES (${input.employeeId},${input.cycleId || null},${input.title},${JSON.stringify(input.actions)}::jsonb,
          ${input.dueDate || null},${status}::workflow_status,${ownerId},${actor.id})
        RETURNING *
      `;
      await tx`
        INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason)
        VALUES (${actor.id},'development_plan.create','development_plan',${rows[0].id},${employee.business_head_id},
          ${JSON.stringify({ employeeId: input.employeeId, cycleId: input.cycleId || null, title: input.title, actionCount: input.actions.length, dueDate: input.dueDate || null, status })}::jsonb,
          ${input.reason})
      `;
      return rows;
    });
    return ok(created, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
