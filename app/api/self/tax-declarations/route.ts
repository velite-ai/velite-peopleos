import { z } from "zod";
import { apiError, fail, ok, requireEmployeeIdentity } from "@/lib/api";
import { db } from "@/lib/database";

const schema = z.object({
  financialYear: z.string().regex(/^20\d{2}-\d{2}$/),
  regime: z.enum(["old", "new"]),
  declarations: z.record(z.string().max(80), z.number().min(0).max(100000000)),
  submit: z.boolean().default(false),
  reason: z.string().min(3).max(1000),
}).strict();

export async function GET() {
  try {
    const identity = await requireEmployeeIdentity(); if (identity instanceof Response) return identity;
    return ok(await db()`SELECT d.*,COALESCE(jsonb_agg(jsonb_build_object('id',p.id,'sectionCode',p.section_code,'amount',p.amount,'documentId',p.document_id,'status',p.status,'remarks',p.remarks)) FILTER (WHERE p.id IS NOT NULL),'[]'::jsonb) AS proofs FROM tax_declarations d LEFT JOIN tax_proofs p ON p.tax_declaration_id=d.id WHERE d.employee_id=${identity.employee.id} GROUP BY d.id ORDER BY d.financial_year DESC`);
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json()); const identity = await requireEmployeeIdentity(); if (identity instanceof Response) return identity;
    const status = input.submit ? "pending" : "draft"; const sql = db();
    const [existing] = await sql`SELECT * FROM tax_declarations WHERE employee_id=${identity.employee.id} AND financial_year=${input.financialYear}`;
    if (existing && !["draft", "rejected"].includes(existing.status)) return fail("A submitted declaration cannot be edited", 409);
    const [saved] = await sql.begin(async tx => {
      const rows = existing
        ? await tx`UPDATE tax_declarations SET regime=${input.regime},declarations=${JSON.stringify(input.declarations)}::jsonb,status=${status}::workflow_status,submitted_at=CASE WHEN ${input.submit} THEN now() ELSE NULL END,reviewed_by=NULL,reviewed_at=NULL,decision_reason=NULL,created_by=COALESCE(created_by,${identity.user.id}),updated_at=now() WHERE id=${existing.id} AND status IN ('draft','rejected') RETURNING *`
        : await tx`INSERT INTO tax_declarations (employee_id,financial_year,regime,declarations,status,submitted_at,created_by) VALUES (${identity.employee.id},${input.financialYear},${input.regime},${JSON.stringify(input.declarations)}::jsonb,${status}::workflow_status,CASE WHEN ${input.submit} THEN now() ELSE NULL END,${identity.user.id}) RETURNING *`;
      if (!rows.length) return [];
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,before_data,after_data,reason) VALUES (${identity.user.id},${input.submit?'self.tax_declaration.submit':'self.tax_declaration.save'},'tax_declaration',${rows[0].id},${identity.employee.businessHeadId},${existing?JSON.stringify({status:existing.status,regime:existing.regime}):null}::jsonb,${JSON.stringify({status,regime:input.regime,financialYear:input.financialYear})}::jsonb,${input.reason})`;
      return rows;
    });
    if (!saved) return fail("Declaration changed; refresh and try again", 409); return ok(saved, { status: existing ? 200 : 201 });
  } catch (error) { return apiError(error); }
}
