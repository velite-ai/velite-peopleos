import { z } from "zod";
import { apiError, fail, ok, requireAnyApiPermission, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";

const upsertSchema = z.object({
  skillId: z.uuid(),
  proficiency: z.number().min(0).max(5).nullable().optional(),
  targetProficiency: z.number().min(0).max(5).nullable().optional(),
  evidence: z.string().max(3000).nullable().optional(),
  reason: z.string().min(3).max(1000),
}).strict();

const archiveSchema = z.object({
  skillId: z.uuid(),
  reason: z.string().min(3).max(1000),
}).strict();

type EmployeeScope = { business_head_id: string; department_id: string | null };

async function scopeFor(employeeId: string) {
  const [employee] = await db()<EmployeeScope[]>`
    SELECT business_head_id,department_id FROM employees WHERE id=${employeeId}
  `;
  return employee;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const scope = await scopeFor(id);
    if (!scope) return fail("Employee not found", 404);
    const actor = await requireApiUser("learning:read", scope.business_head_id, scope.department_id);
    if (actor instanceof Response) return actor;
    return ok(await db()`
      SELECT es.id,es.employee_id,es.skill_id,s.code,s.name,s.category,es.proficiency,es.target_proficiency,
        es.evidence,es.assessed_at,es.assessed_by,u.full_name AS assessed_by_name,es.updated_at
      FROM employee_skills es
      JOIN skill_catalogue s ON s.id=es.skill_id
      LEFT JOIN users u ON u.id=es.assessed_by
      WHERE es.employee_id=${id} AND es.active=true
      ORDER BY s.category NULLS LAST,s.name
    `);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = upsertSchema.parse(await request.json());
    const scope = await scopeFor(id);
    if (!scope) return fail("Employee not found", 404);
    const actor = await requireAnyApiPermission(
      ["learning:write", "performance:write"],
      scope.business_head_id,
      scope.department_id,
    );
    if (actor instanceof Response) return actor;
    const [skill] = await db()`SELECT id,active FROM skill_catalogue WHERE id=${input.skillId}`;
    if (!skill || !skill.active) return fail("Active skill not found", 404);
    const [record] = await db().begin(async tx => {
      const [previous] = await tx`
        SELECT id,proficiency,target_proficiency,evidence,active FROM employee_skills
        WHERE employee_id=${id} AND skill_id=${input.skillId}
      `;
      const rows = await tx`
        INSERT INTO employee_skills
          (employee_id,skill_id,proficiency,target_proficiency,evidence,assessed_at,assessed_by,active,updated_at)
        VALUES (${id},${input.skillId},${input.proficiency ?? null},${input.targetProficiency ?? null},
          ${input.evidence ?? null},now(),${actor.id},true,now())
        ON CONFLICT (employee_id,skill_id) DO UPDATE
        SET proficiency=EXCLUDED.proficiency,target_proficiency=EXCLUDED.target_proficiency,evidence=EXCLUDED.evidence,
          assessed_at=now(),assessed_by=EXCLUDED.assessed_by,active=true,updated_at=now()
        RETURNING id,employee_id,skill_id,proficiency,target_proficiency,evidence,assessed_at,assessed_by,active,updated_at
      `;
      await tx`
        INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason)
        VALUES (${actor.id},${previous ? "employee_skill.update" : "employee_skill.create"},'employee_skill',${rows[0].id},
          ${scope.business_head_id},${previous ? JSON.stringify(previous) : null}::jsonb,${JSON.stringify(rows[0])}::jsonb,${input.reason})
      `;
      return rows;
    });
    return ok(record, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = archiveSchema.parse(await request.json());
    const scope = await scopeFor(id);
    if (!scope) return fail("Employee not found", 404);
    const actor = await requireAnyApiPermission(
      ["learning:write", "performance:write"],
      scope.business_head_id,
      scope.department_id,
    );
    if (actor instanceof Response) return actor;
    const [archived] = await db().begin(async tx => {
      const rows = await tx`
        UPDATE employee_skills SET active=false,updated_at=now()
        WHERE employee_id=${id} AND skill_id=${input.skillId} AND active=true
        RETURNING id,employee_id,skill_id,proficiency,target_proficiency,active,updated_at
      `;
      if (!rows[0]) return [];
      await tx`
        INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason)
        VALUES (${actor.id},'employee_skill.archive','employee_skill',${rows[0].id},${scope.business_head_id},
          ${JSON.stringify({ employeeId: id, skillId: input.skillId, active: true })}::jsonb,
          ${JSON.stringify({ employeeId: id, skillId: input.skillId, active: false })}::jsonb,${input.reason})
      `;
      return rows;
    });
    if (!archived) return fail("Active employee skill not found", 404);
    return ok(archived);
  } catch (error) {
    return apiError(error);
  }
}
