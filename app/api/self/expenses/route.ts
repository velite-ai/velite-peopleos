import { z } from "zod";
import { apiError, ok, requireEmployeeIdentity } from "@/lib/api";
import { db } from "@/lib/database";

const schema = z.object({ category:z.string().min(2).max(80),claimDate:z.iso.date(),amount:z.number().positive().max(10000000),description:z.string().min(3).max(2000),receiptDocumentId:z.uuid().nullable().optional() });

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const identity = await requireEmployeeIdentity();
    if (identity instanceof Response) return identity;
    const claimNumber = `EXP-${new Date().getFullYear()}-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
    const [created] = await db().begin(async tx => {
      if (input.receiptDocumentId) {
        const document = await tx`SELECT 1 FROM documents WHERE id=${input.receiptDocumentId} AND employee_id=${identity.employee.id}`;
        if (!document.length) throw new Error("Receipt document does not belong to this employee");
      }
      const rows = await tx`INSERT INTO expense_claims (claim_number,employee_id,category,claim_date,amount,description,receipt_document_id) VALUES (${claimNumber},${identity.employee.id},${input.category},${input.claimDate},${input.amount},${input.description},${input.receiptDocumentId||null}) RETURNING *`;
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason) VALUES (${identity.user.id},'self.expense_create','expense_claim',${rows[0].id},${identity.employee.businessHeadId},${JSON.stringify(rows[0])}::jsonb,${input.description})`;
      return rows;
    });
    return ok(created, { status: 201 });
  } catch (error) { return apiError(error); }
}
