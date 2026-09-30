import { z } from "zod";
import { apiError, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";
import { openJson } from "@/lib/encryption";
import { maskIdentifier } from "@/lib/employee-records";

const querySchema = z.object({
  businessHeadId: z.uuid(),
  status: z.enum(["pending", "approved", "rejected", "cancelled"]).default("pending"),
}).strict();

type RequestedChanges = {
  bankDetails?: null | {
    accountHolder: string;
    bankName: string;
    accountNumber: string;
    ifsc: string;
    accountType: string;
  };
  statutoryDetails?: null | Record<string, string | null>;
};

function presentChanges(value: Uint8Array) {
  const changes = openJson<RequestedChanges>(value);
  return {
    bankDetails: changes.bankDetails ? {
      ...changes.bankDetails,
      accountNumber: maskIdentifier(changes.bankDetails.accountNumber),
    } : changes.bankDetails,
    statutoryDetails: changes.statutoryDetails ? Object.fromEntries(
      Object.entries(changes.statutoryDetails).map(([key, item]) => [
        key,
        item === null || key === "taxRegime" ? item : maskIdentifier(item),
      ]),
    ) : changes.statutoryDetails,
  };
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const input = querySchema.parse({
      businessHeadId: params.get("businessHeadId"),
      status: params.get("status") || undefined,
    });
    const actor = await requireApiUser("people:write", input.businessHeadId);
    if (actor instanceof Response) return actor;
    const rows = await db()<{
      id: string; employee_id: string; employee_code: string; employee_name: string;
      changed_fields: string[]; status: string; requested_by: string; requested_by_name: string;
      request_reason: string; decided_by: string | null; decision_reason: string | null;
      created_at: string; decided_at: string | null; requested_changes_encrypted: Uint8Array;
    }[]>`
      SELECT r.id,r.employee_id,e.employee_code,concat_ws(' ',e.first_name,e.last_name) AS employee_name,
        r.changed_fields,r.status,r.requested_by,u.full_name AS requested_by_name,r.request_reason,
        r.decided_by,r.decision_reason,r.created_at,r.decided_at,r.requested_changes_encrypted
      FROM employee_sensitive_change_requests r
      JOIN employees e ON e.id=r.employee_id
      JOIN users u ON u.id=r.requested_by
      WHERE e.business_head_id=${input.businessHeadId} AND r.status=${input.status}
      ORDER BY r.created_at DESC
      LIMIT 200
    `;
    const data = rows.map(({ requested_changes_encrypted, ...row }) => ({
      ...row,
      proposedChanges: presentChanges(requested_changes_encrypted),
    }));
    await db()`
      INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason)
      VALUES (${actor.id},'employee.sensitive_change_queue_view','employee_sensitive_change_request',${input.businessHeadId},
        ${input.businessHeadId},${JSON.stringify({ status: input.status, count: data.length, identifiersMasked: true })}::jsonb,
        'Authorised sensitive-profile change queue viewed')
    `;
    return ok(data);
  } catch (error) {
    return apiError(error);
  }
}
