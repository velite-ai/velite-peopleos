import { z } from "zod";
import { apiError, fail, ok, requireEmployeeIdentity } from "@/lib/api";
import { db } from "@/lib/database";

const schema = z.object({
  attendanceDayId: z.uuid(),
  requestedValues: z.object({
    status: z.enum(['present','absent','half_day','paid_leave','unpaid_leave','weekly_off','holiday','work_from_home','on_duty']).optional(),
    firstIn: z.iso.datetime().nullable().optional(),
    lastOut: z.iso.datetime().nullable().optional(),
    workedMinutes: z.number().int().min(0).max(1440).optional(),
    remarks: z.string().max(500).nullable().optional(),
  }),
  reason: z.string().min(3).max(1000),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const identity = await requireEmployeeIdentity();
    if (identity instanceof Response) return identity;
    const [day] = await db()`SELECT id,attendance_date FROM attendance_days WHERE id=${input.attendanceDayId} AND employee_id=${identity.employee.id}`;
    if (!day) return fail("Attendance record not found", 404);
    const pending = await db()`SELECT 1 FROM attendance_corrections WHERE attendance_day_id=${input.attendanceDayId} AND status='pending'`;
    if (pending.length) return fail("A correction request is already pending", 409);
    const [created] = await db().begin(async tx => {
      const rows = await tx`INSERT INTO attendance_corrections (attendance_day_id,requested_values,reason,requested_by) VALUES (${input.attendanceDayId},${JSON.stringify(input.requestedValues)}::jsonb,${input.reason},${identity.user.id}) RETURNING *`;
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason) VALUES (${identity.user.id},'self.attendance_correction','attendance_correction',${rows[0].id},${identity.employee.businessHeadId},${JSON.stringify(rows[0])}::jsonb,${input.reason})`;
      return rows;
    });
    return ok(created, { status: 201 });
  } catch (error) { return apiError(error); }
}
