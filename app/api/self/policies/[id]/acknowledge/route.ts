import { apiError, fail, ok, requireEmployeeIdentity } from "@/lib/api";
import { db } from "@/lib/database";

export async function POST(_: Request, { params }: { params: Promise<{id:string}> }) {
  try {
    const { id } = await params;
    const identity = await requireEmployeeIdentity();
    if (identity instanceof Response) return identity;
    const [policy] = await db()`SELECT id,title FROM policy_documents WHERE id=${id} AND status='approved' AND (business_head_id IS NULL OR business_head_id=${identity.employee.businessHeadId})`;
    if (!policy) return fail("Policy not found", 404);
    const [row] = await db().begin(async tx => {
      const rows = await tx`INSERT INTO policy_acknowledgements (policy_document_id,employee_id) VALUES (${id},${identity.employee.id}) ON CONFLICT (policy_document_id,employee_id) DO UPDATE SET acknowledged_at=policy_acknowledgements.acknowledged_at RETURNING *`;
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason) VALUES (${identity.user.id},'self.policy_acknowledge','policy_acknowledgement',${rows[0].id},${identity.employee.businessHeadId},${JSON.stringify(rows[0])}::jsonb,${`Acknowledged ${policy.title}`})`;
      return rows;
    });
    return ok(row);
  } catch (error) { return apiError(error); }
}
