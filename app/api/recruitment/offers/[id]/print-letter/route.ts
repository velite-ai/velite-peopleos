import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db, type Sql } from "@/lib/database";
import { LETTER_LABELS, type LetterData, titleFor } from "@/lib/letter-rules";
import { registerLetter } from "@/lib/letter-register";

type Terms = { title?: string; address?: string; probationMonths?: number | string; monthlySalary?: number | string };

// Collects what the offer letter for a candidate (Hiring screen) needs and gives it its reference number.
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sql = db();
    const [offer] = await sql<{
      id: string; offered_position: string; offered_ctc: string; proposed_joining_date: string; terms: Terms | null;
      full_name: string; phone: string | null; business_head_id: string; department_id: string | null; company: string; department: string | null;
    }[]>`SELECT o.id,o.offered_position,o.offered_ctc,o.proposed_joining_date::text AS proposed_joining_date,o.terms,c.full_name,c.phone,c.business_head_id,c.department_id,b.name AS company,d.name AS department FROM candidate_offers o JOIN candidates c ON c.id=o.candidate_id JOIN business_heads b ON b.id=c.business_head_id LEFT JOIN departments d ON d.id=c.department_id WHERE o.id=${id}`;
    if (!offer) return fail("Offer not found", 404);
    const user = await requireApiUser("recruitment:write", offer.business_head_id, offer.department_id);
    if (user instanceof Response) return user;

    const terms = (offer.terms && typeof offer.terms === "object" ? offer.terms : {}) as Terms;
    const monthly = Number(terms.monthlySalary) > 0 ? Number(terms.monthlySalary) : Math.round(Number(offer.offered_ctc) / 12);
    const months = Number(terms.probationMonths);
    const addressLines = String(terms.address || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);

    const result = await sql.begin(async tx => {
      const registered = await registerLetter(tx as unknown as Sql, { owner: { offerId: id }, businessHeadId: offer.business_head_id, company: offer.company, type: "offer", userId: user.id });
      await tx`INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason) VALUES (${user.id},'employee_letter.print','candidate_offer',${id},${offer.business_head_id},${tx.json({ type: "offer", reference: registered.reference })},${`${LETTER_LABELS.offer} opened for printing`})`;
      return registered;
    });

    const letter: LetterData = {
      type: "offer", company: offer.company, reference: result.reference, date: result.today,
      name: offer.full_name.replace(/\s+/g, " ").trim().toLowerCase().replace(/(^|[\s.'-])\p{L}/gu, c => c.toUpperCase()),
      title: titleFor(terms.title), addressLines, mobile: offer.phone, employeeCode: "", position: offer.offered_position, department: offer.department,
      joinedDate: offer.proposed_joining_date, probationMonths: months >= 1 && months <= 24 ? months : 6, monthlySalary: monthly > 0 ? monthly : null,
      resignationDate: null, lastWorkingDay: null, noticeDays: null, confirmationDate: null, salaryEffectiveDate: null, employmentEnded: false, endDateAssumed: false,
    };
    return ok(letter);
  } catch (error) { return apiError(error); }
}
