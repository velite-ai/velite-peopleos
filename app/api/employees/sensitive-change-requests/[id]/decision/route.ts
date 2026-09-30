import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";
import { openJson, sealJson } from "@/lib/encryption";

const decisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().min(5).max(1000),
}).strict();

type RequestedChanges = {
  bankDetails?: Record<string, unknown> | null;
  statutoryDetails?: Record<string, unknown> | null;
};

type ChangeScope = {
  id: string;
  employee_id: string;
  business_head_id: string;
  department_id: string | null;
  status: string;
  requested_by: string;
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = decisionSchema.parse(await request.json());
    const [scope] = await db()<ChangeScope[]>`
      SELECT r.id,r.employee_id,e.business_head_id,e.department_id,r.status,r.requested_by
      FROM employee_sensitive_change_requests r
      JOIN employees e ON e.id=r.employee_id
      WHERE r.id=${id}
    `;
    if (!scope) return fail("Sensitive profile change request not found", 404);
    const actor = await requireApiUser("people:write", scope.business_head_id, scope.department_id);
    if (actor instanceof Response) return actor;
    if (scope.requested_by === actor.id) return fail("The requester cannot approve or reject their own change", 409);

    const [decided] = await db().begin(async tx => {
      const [change] = await tx<{
        employee_id: string; status: string; requested_by: string; requested_changes_encrypted: Uint8Array;
        changed_fields: string[];
      }[]>`
        SELECT employee_id,status,requested_by,requested_changes_encrypted,changed_fields
        FROM employee_sensitive_change_requests WHERE id=${id} FOR UPDATE
      `;
      if (!change || change.status !== "pending") return [];
      if (change.requested_by === actor.id) throw new Error("Requester cannot decide their own sensitive change request");

      const changes = openJson<RequestedChanges>(change.requested_changes_encrypted);
      const hasBank = Object.prototype.hasOwnProperty.call(changes, "bankDetails");
      const hasStatutory = Object.prototype.hasOwnProperty.call(changes, "statutoryDetails");
      if (input.decision === "approve") {
        await tx`
          UPDATE employees
          SET bank_details_encrypted=CASE WHEN ${hasBank}
                THEN ${changes.bankDetails ? sealJson(changes.bankDetails) : null} ELSE bank_details_encrypted END,
              statutory_details_encrypted=CASE WHEN ${hasStatutory}
                THEN ${changes.statutoryDetails ? sealJson(changes.statutoryDetails) : null} ELSE statutory_details_encrypted END,
              updated_at=now()
          WHERE id=${change.employee_id}
        `;
        await tx`
          INSERT INTO employee_events (employee_id,event_type,effective_date,new_values,reason,approved_by,created_by)
          VALUES (${change.employee_id},'sensitive_profile_change',current_date,
            ${JSON.stringify({ changedFields: change.changed_fields, valuesStoredEncrypted: true })}::jsonb,
            ${input.reason},${actor.id},${change.requested_by})
        `;
      }
      const rows = await tx`
        UPDATE employee_sensitive_change_requests
        SET status=${input.decision === "approve" ? "approved" : "rejected"},decided_by=${actor.id},
          decision_reason=${input.reason},decided_at=now()
        WHERE id=${id}
        RETURNING id,employee_id,changed_fields,status,requested_by,decided_by,decision_reason,decided_at
      `;
      await tx`
        INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason)
        VALUES (${actor.id},${`employee.sensitive_change_${input.decision}`},'employee_sensitive_change_request',${id},${scope.business_head_id},
          ${JSON.stringify({ status: "pending", changedFields: change.changed_fields })}::jsonb,
          ${JSON.stringify({ status: rows[0].status, changedFields: change.changed_fields, valuesStoredEncrypted: true })}::jsonb,
          ${input.reason})
      `;
      return rows;
    });
    if (!decided) return fail("Only a pending sensitive profile change can be decided", 409);
    return ok(decided);
  } catch (error) {
    return apiError(error);
  }
}
