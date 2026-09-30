import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { hasPermissionForScope } from "@/lib/auth";
import { db } from "@/lib/database";

const schema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().min(5).max(1000),
}).strict();

type LetterScope = {
  id: string;
  letter_type: string;
  status: string;
  requested_by: string;
  business_head_id: string;
  department_id: string | null;
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = schema.parse(await request.json());
    const [letter] = await db()<LetterScope[]>`
      SELECT l.id,l.letter_type,l.status,l.requested_by,e.business_head_id,e.department_id
      FROM generated_letters l JOIN employees e ON e.id=l.employee_id WHERE l.id=${id}
    `;
    if (!letter) return fail("Employee letter not found", 404);
    const actor = await requireApiUser("people:write", letter.business_head_id, letter.department_id);
    if (actor instanceof Response) return actor;
    if (letter.requested_by === actor.id) return fail("The letter requester cannot decide their own request", 409);
    if (letter.letter_type === "salary_revision" && !hasPermissionForScope(actor, "payroll:read", letter.business_head_id, letter.department_id)) {
      return fail("Payroll read permission is required to approve a salary revision letter", 403);
    }

    const [decided] = await db().begin(async tx => {
      const [locked] = await tx<LetterScope[]>`
        SELECT l.id,l.letter_type,l.status,l.requested_by,e.business_head_id,e.department_id
        FROM generated_letters l JOIN employees e ON e.id=l.employee_id
        WHERE l.id=${id} FOR UPDATE OF l
      `;
      if (!locked || locked.status !== "pending") return [];
      if (locked.requested_by === actor.id) throw new Error("Letter requester cannot decide their own request");
      const nextStatus = input.decision === "approve" ? "approved" : "rejected";
      const rows = await tx`
        UPDATE generated_letters
        SET status=${nextStatus},approved_by=CASE WHEN ${input.decision}='approve' THEN ${actor.id}::uuid ELSE NULL END,
          decision_reason=${input.reason},decided_at=now(),updated_at=now()
        WHERE id=${id}
        RETURNING id,employee_id,letter_type,template_version,effective_date,status,approved_by,decision_reason,decided_at
      `;
      if (input.decision === "approve") {
        await tx`
          INSERT INTO document_generation_jobs (job_type,source_record_id,requested_by)
          VALUES ('letter',${id},${actor.id})
          ON CONFLICT (job_type,source_record_id) DO UPDATE
          SET status='pending',attempts=0,error_message=NULL,next_attempt_at=now(),lease_owner=NULL,leased_until=NULL,requested_by=EXCLUDED.requested_by
        `;
      }
      await tx`
        INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason)
        VALUES (${actor.id},${`employee_letter.${input.decision}`},'generated_letter',${id},${letter.business_head_id},
          ${JSON.stringify({ status: "pending", requestedBy: locked.requested_by })}::jsonb,
          ${JSON.stringify({ status: nextStatus, documentGenerationQueued: input.decision === "approve" })}::jsonb,
          ${input.reason})
      `;
      return rows;
    });
    if (!decided) return fail("Only a pending employee letter can be decided", 409);
    return ok(decided);
  } catch (error) {
    return apiError(error);
  }
}
