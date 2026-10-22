import type { Sql } from "./database";
import { referenceNumber } from "./letter-rules";

// Gives a printed letter its reference number (company / financial year / month / day / serial of that company's letters that day).
// Printing the same letter again the same day keeps the same number. Call inside a transaction.
export async function registerLetter(tx: Sql, input: { owner: { employeeId: string } | { offerId: string }; businessHeadId: string; company: string; type: string; userId: string }) {
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`printed-letters:${input.businessHeadId}`}))`;
  const [{ today }] = await tx<{ today: string }[]>`SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS today`;
  const employeeId = "employeeId" in input.owner ? input.owner.employeeId : null;
  const offerId = "offerId" in input.owner ? input.owner.offerId : null;
  const [existing] = employeeId
    ? await tx<{ reference_no: string }[]>`SELECT reference_no FROM printed_letters WHERE employee_id=${employeeId} AND letter_type=${input.type} AND letter_date=${today}::date`
    : await tx<{ reference_no: string }[]>`SELECT reference_no FROM printed_letters WHERE offer_id=${offerId} AND letter_type=${input.type} AND letter_date=${today}::date`;
  let reference = existing?.reference_no;
  if (!reference) {
    const [{ next }] = await tx<{ next: number }[]>`SELECT coalesce(max(serial),0)::int+1 AS next FROM printed_letters WHERE business_head_id=${input.businessHeadId} AND letter_date=${today}::date`;
    reference = referenceNumber(input.company, today, next);
    await tx`INSERT INTO printed_letters (employee_id,offer_id,business_head_id,letter_type,letter_date,serial,reference_no,printed_by) VALUES (${employeeId},${offerId},${input.businessHeadId},${input.type},${today}::date,${next},${reference},${input.userId})`;
  }
  return { today, reference };
}
