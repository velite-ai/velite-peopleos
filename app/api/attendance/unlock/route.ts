import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";

const schema = z.object({
  businessHeadId: z.uuid(),
  date: z.iso.date(),
  employeeId: z.uuid().optional(),
  reason: z.string().trim().min(3).max(500),
});

// Unlocks a locked day for one person, or for the whole company if no person is given, so a mistake can be corrected.
// Only a Super Administrator or HR Administrator may do it. The day is locked again with "Lock this day".
export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const user = await requireApiUser("attendance:write", input.businessHeadId);
    if (user instanceof Response) return user;
    if (!user.roles.some(role => role.code === "SUPER_ADMIN" || role.code === "HR_ADMIN")) return fail("Only HR administrators can unlock a day", 403);
    const sql = db();
    const [month] = await sql<{ status: string }[]>`SELECT status FROM attendance_months WHERE business_head_id=${input.businessHeadId} AND period_month=date_trunc('month',${input.date}::date)::date`;
    if (month?.status === "locked") return fail("This month is locked. Use “Reopen month” first.", 409);
    if (month?.status === "review") return fail("This month is under checking. Use “Return month to open” first.", 409);
    const result = await sql.begin(async tx => {
      if (input.employeeId) {
        const [owner] = await tx<{ business_head_id: string }[]>`SELECT business_head_id FROM employees WHERE id=${input.employeeId}`;
        if (!owner || owner.business_head_id !== input.businessHeadId) return "not-found" as const;
      }
      const unlocked = await tx`
        UPDATE attendance_days a SET locked_at=NULL,locked_by=NULL
        FROM employees e
        WHERE e.id=a.employee_id AND e.business_head_id=${input.businessHeadId} AND a.attendance_date=${input.date}::date
          AND a.locked_at IS NOT NULL AND (${input.employeeId ?? null}::uuid IS NULL OR a.employee_id=${input.employeeId ?? null}::uuid)
        RETURNING a.id,a.employee_id`;
      if (!unlocked.length) return "nothing" as const;
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason) VALUES (${user.id},'attendance.unlock','attendance_register',${`${input.businessHeadId}:${input.date}`},${input.businessHeadId},${tx.json({ date: input.date, employeeId: input.employeeId ?? null, records: unlocked.length })},${input.reason})`;
      return unlocked.length;
    });
    if (result === "not-found") return fail("Employee not found in this company", 404);
    if (result === "nothing") return fail("Nothing is locked here", 409);
    return ok({ unlocked: result });
  } catch (error) { return apiError(error); }
}
