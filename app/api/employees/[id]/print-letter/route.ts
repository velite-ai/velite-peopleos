import { z } from "zod";
import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { hasPermissionForScope } from "@/lib/auth";
import { db } from "@/lib/database";
import { openJson } from "@/lib/encryption";
import { LETTER_LABELS, LETTER_TYPES, type LetterData, probationMonths, referenceNumber, titleFor } from "@/lib/letter-rules";

const schema = z.object({ type: z.enum(LETTER_TYPES as [string, ...string[]]) }).strict();
type PersonalDetails = { gender?: string | null; address?: { line1?: string; line2?: string | null; city?: string; state?: string; postalCode?: string } | null };

// Collects everything a printable letter needs and gives it its reference number. HR only.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = schema.parse(await request.json());
    const type = input.type as LetterData["type"];
    const sql = db();
    const [employee] = await sql<{
      id: string; employee_code: string; business_head_id: string; department_id: string | null; first_name: string; last_name: string | null; position: string; phone: string | null;
      date_joined: string; probation_end_date: string | null; notice_start_date: string | null; last_working_date: string | null; company: string; department: string | null; personal_details_encrypted: Uint8Array | null;
    }[]>`SELECT e.id,e.employee_code,e.business_head_id,e.department_id,e.first_name,e.last_name,e.position,e.phone,e.date_joined::text AS date_joined,e.probation_end_date::text AS probation_end_date,e.notice_start_date::text AS notice_start_date,e.last_working_date::text AS last_working_date,e.personal_details_encrypted,b.name AS company,d.name AS department FROM employees e JOIN business_heads b ON b.id=e.business_head_id LEFT JOIN departments d ON d.id=e.department_id WHERE e.id=${id}`;
    if (!employee) return fail("Employee not found", 404);
    const user = await requireApiUser("people:write", employee.business_head_id, employee.department_id);
    if (user instanceof Response) return user;

    const [exit] = await sql<{ submitted_date: string; proposed: string; approved: string | null; notice_days: number }[]>`SELECT submitted_date::text AS submitted_date,proposed_last_working_date::text AS proposed,approved_last_working_date::text AS approved,notice_days FROM separations WHERE employee_id=${id} AND status IN ('pending','approved','completed') ORDER BY created_at DESC LIMIT 1`;
    const lastWorkingDay = exit ? (exit.approved || exit.proposed) : employee.last_working_date;
    if (type !== "offer" && !lastWorkingDay) return fail("Record the resignation first: open the Lifecycle dates card and click Record resignation. The letter needs the last working day.", 409);

    const personal = employee.personal_details_encrypted ? openJson<PersonalDetails>(employee.personal_details_encrypted) : null;
    const address = personal?.address;
    const addressLines = address ? [address.line1, address.line2, [address.city, address.state].filter(Boolean).join(", ") + (address.postalCode ? ` - ${address.postalCode}` : "")].filter((line): line is string => Boolean(line && line.trim())) : [];

    let monthlySalary: number | null = null;
    if (type === "offer" && hasPermissionForScope(user, "payroll:read", employee.business_head_id, employee.department_id)) {
      const [pay] = await sql<{ monthly_gross: string }[]>`SELECT monthly_gross FROM employee_compensation WHERE employee_id=${id} AND effective_from<=greatest(current_date,${employee.date_joined}::date) ORDER BY effective_from DESC LIMIT 1`;
      if (pay) monthlySalary = Number(pay.monthly_gross);
    }

    const result = await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`printed-letters:${employee.business_head_id}`}))`;
      const [{ today }] = await tx<{ today: string }[]>`SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS today`;
      const [existing] = await tx<{ reference_no: string }[]>`SELECT reference_no FROM printed_letters WHERE employee_id=${id} AND letter_type=${type} AND letter_date=${today}::date`;
      let reference = existing?.reference_no;
      if (!reference) {
        const [{ next }] = await tx<{ next: number }[]>`SELECT coalesce(max(serial),0)::int+1 AS next FROM printed_letters WHERE business_head_id=${employee.business_head_id} AND letter_date=${today}::date`;
        reference = referenceNumber(employee.company, today, next);
        await tx`INSERT INTO printed_letters (employee_id,business_head_id,letter_type,letter_date,serial,reference_no,printed_by) VALUES (${id},${employee.business_head_id},${type},${today}::date,${next},${reference},${user.id})`;
      }
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason) VALUES (${user.id},'employee_letter.print','employee',${id},${employee.business_head_id},${tx.json({ type, reference })},${`${LETTER_LABELS[type]} opened for printing`})`;
      return { today, reference };
    });

    const letter: LetterData = {
      type, company: employee.company, reference: result.reference, date: result.today,
      name: [employee.first_name, employee.last_name].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().toLowerCase().replace(/(^|[\s.'-])\p{L}/gu, c => c.toUpperCase()),
      title: titleFor(personal?.gender), addressLines, mobile: employee.phone, employeeCode: employee.employee_code, position: employee.position, department: employee.department,
      joinedDate: employee.date_joined, probationMonths: probationMonths(employee.date_joined, employee.probation_end_date), monthlySalary,
      resignationDate: exit?.submitted_date ?? employee.notice_start_date, lastWorkingDay, noticeDays: exit ? exit.notice_days : null,
    };
    return ok(letter);
  } catch (error) { return apiError(error); }
}
