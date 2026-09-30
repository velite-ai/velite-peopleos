import { z } from "zod";
import { apiError, fail, ok, requireEmployeeIdentity } from "@/lib/api";
import { db } from "@/lib/database";
import { openJson, sealJson } from "@/lib/encryption";
import { maskIdentifier } from "@/lib/employee-records";

const bankSchema = z.object({
  accountHolder: z.string().min(2).max(160),
  bankName: z.string().min(2).max(160),
  accountNumber: z.string().regex(/^[A-Za-z0-9-]{4,40}$/),
  ifsc: z.string().regex(/^[A-Za-z0-9-]{4,30}$/),
  accountType: z.enum(["savings", "current", "salary", "other"]).default("salary"),
}).strict();

const statutorySchema = z.object({
  pan: z.string().regex(/^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/).nullable().optional(),
  uan: z.string().regex(/^\d{12}$/).nullable().optional(),
  esiNumber: z.string().regex(/^\d{10,17}$/).nullable().optional(),
  aadhaarLast4: z.string().regex(/^\d{4}$/).nullable().optional(),
  taxRegime: z.enum(["old", "new"]).nullable().optional(),
}).strict();

const updateSchema = z.object({
  bankDetails: bankSchema.nullable().optional(),
  statutoryDetails: statutorySchema.nullable().optional(),
  reason: z.string().min(3).max(1000),
}).strict().refine(
  input => input.bankDetails !== undefined || input.statutoryDetails !== undefined,
  "Bank details or statutory details are required",
);

type BankDetails = z.infer<typeof bankSchema>;
type StatutoryDetails = z.infer<typeof statutorySchema>;

function decrypt<T>(value: Uint8Array | null) {
  return value ? openJson<T>(value) : null;
}

function presentBank(bank: BankDetails | null) {
  return bank ? { ...bank, accountNumber: maskIdentifier(bank.accountNumber) } : null;
}

function presentStatutory(details: StatutoryDetails | null) {
  if (!details) return null;
  return Object.fromEntries(Object.entries(details).map(([key, value]) => {
    if (value === null || value === undefined || key === "taxRegime") return [key, value];
    return [key, maskIdentifier(value)];
  }));
}

export async function GET() {
  try {
    const identity = await requireEmployeeIdentity();
    if (identity instanceof Response) return identity;
    const [employee] = await db()<{
      bank_details_encrypted: Uint8Array | null;
      statutory_details_encrypted: Uint8Array | null;
    }[]>`
      SELECT bank_details_encrypted,statutory_details_encrypted
      FROM employees WHERE id=${identity.employee.id}
    `;
    if (!employee) return fail("Employee not found", 404);
    const bank = decrypt<BankDetails>(employee.bank_details_encrypted);
    const statutory = decrypt<StatutoryDetails>(employee.statutory_details_encrypted);
    await db()`
      INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason)
      VALUES (${identity.user.id},'self.sensitive_profile_view','employee',${identity.employee.id},${identity.employee.businessHeadId},
        ${JSON.stringify({ masked: true, hasBankDetails: Boolean(bank), hasStatutoryDetails: Boolean(statutory) })}::jsonb,
        'Employee viewed own masked bank and statutory profile')
    `;
    return ok({
      bankDetails: presentBank(bank),
      statutoryDetails: presentStatutory(statutory),
      fieldAccess: { bankAccountNumber: "masked", statutoryIdentifiers: "masked" },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const input = updateSchema.parse(await request.json());
    const identity = await requireEmployeeIdentity();
    if (identity instanceof Response) return identity;
    const changedFields = [
      ...(input.bankDetails !== undefined ? ["bankDetails"] : []),
      ...(input.statutoryDetails !== undefined ? ["statutoryDetails"] : []),
    ];
    const [changeRequest] = await db().begin(async tx => {
      const rows = await tx`
        INSERT INTO employee_sensitive_change_requests
          (employee_id,requested_changes_encrypted,changed_fields,requested_by,request_reason)
        VALUES (${identity.employee.id},${sealJson({ bankDetails: input.bankDetails, statutoryDetails: input.statutoryDetails })},
          ${changedFields},${identity.user.id},${input.reason})
        RETURNING id,employee_id,changed_fields,status,created_at
      `;
      await tx`
        INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason)
        VALUES (${identity.user.id},'self.sensitive_profile_change_request','employee_sensitive_change_request',${rows[0].id},
          ${identity.employee.businessHeadId},
          ${JSON.stringify({ employeeId: identity.employee.id, changedFields, valuesStoredEncrypted: true, status: "pending" })}::jsonb,
          ${input.reason})
      `;
      return rows;
    });
    return ok(changeRequest, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
