import { apiError, fail, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";

/** One candidate with the website application behind them (if any) and their stage history. Needs recruitment:read for the candidate's company. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("Candidate not found", 404);
    const sql = db();
    const [candidate] = await sql<{ id: string; business_head_id: string }[]>`SELECT c.*, b.name AS business_head, d.name AS department FROM candidates c JOIN business_heads b ON b.id=c.business_head_id LEFT JOIN departments d ON d.id=c.department_id WHERE c.id=${id}::uuid`;
    if (!candidate) return fail("Candidate not found", 404);
    const user = await requireApiUser("recruitment:read", candidate.business_head_id);
    if (user instanceof Response) return user;
    const [application] = await sql`SELECT full_name, email, phone, position, city, message, resume_url, source_origin, consented_at, created_at FROM career_applications WHERE candidate_id=${id}::uuid ORDER BY created_at DESC LIMIT 1`;
    const history = await sql`SELECT e.from_stage, e.to_stage, e.notes, e.changed_at, u.full_name AS changed_by_name FROM candidate_stage_events e LEFT JOIN users u ON u.id=e.changed_by WHERE e.candidate_id=${id}::uuid ORDER BY e.changed_at DESC LIMIT 50`;
    return ok({ candidate, application: application || null, history });
  } catch (error) { return apiError(error); }
}
