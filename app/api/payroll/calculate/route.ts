import { z } from "zod";
import { apiError, ok, requireApiUser } from "@/lib/api";
import { calculatePayroll, PayrollRule, standardMonthlyRules } from "@/lib/payroll-engine";

const schema=z.object({businessHeadId:z.uuid().nullable().optional(),context:z.record(z.string(),z.union([z.number(),z.string(),z.boolean()])),rules:z.array(z.unknown()).optional()});

export async function POST(request:Request){try{const input=schema.parse(await request.json());const user=await requireApiUser('payroll:write',input.businessHeadId);if(user instanceof Response)return user;const rules=(input.rules||standardMonthlyRules) as PayrollRule[];return ok(calculatePayroll(input.context,rules));}catch(e){return apiError(e);}}
