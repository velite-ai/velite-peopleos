import { z } from "zod";
import { apiError, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";

const createSchema = z.object({
  code: z.string().min(2).max(30).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().min(2).max(160),
  category: z.string().min(2).max(100).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  reason: z.string().min(3).max(1000),
}).strict();

export async function GET(request: Request) {
  try {
    const businessHeadId = new URL(request.url).searchParams.get("businessHeadId");
    const actor = await requireApiUser("learning:read", businessHeadId);
    if (actor instanceof Response) return actor;
    return ok(await db()`
      SELECT s.id,s.code,s.name,s.category,s.description,s.active,
        count(es.id) FILTER (WHERE es.active=true)::int AS employee_count
      FROM skill_catalogue s
      LEFT JOIN employee_skills es ON es.skill_id=s.id
      WHERE s.active=true
      GROUP BY s.id
      ORDER BY s.category NULLS LAST,s.name
    `);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = createSchema.parse(await request.json());
    const actor = await requireApiUser("learning:write");
    if (actor instanceof Response) return actor;
    const [created] = await db().begin(async tx => {
      const rows = await tx`
        INSERT INTO skill_catalogue (code,name,category,description)
        VALUES (${input.code.toUpperCase()},${input.name},${input.category || null},${input.description || null})
        RETURNING id,code,name,category,description,active
      `;
      await tx`
        INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,after_data,reason)
        VALUES (${actor.id},'skill_catalogue.create','skill_catalogue',${rows[0].id},${JSON.stringify(rows[0])}::jsonb,${input.reason})
      `;
      return rows;
    });
    return ok(created, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
