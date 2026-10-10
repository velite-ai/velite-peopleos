// Rules for correcting the company an employee was filed under by mistake. No imports, so they can be unit tested alone.
// Only records that belong to the person, and say nothing about a company, move with them. Anything tied to a company
// (leave policies, payroll periods, shifts, performance cycles, courses, assets…) blocks the move instead of being moved silently.

export const MOVES_WITH_PERSON: Record<string, string> = {
  attendance_days: "attendance days",
  employee_compensation: "salary records",
  employee_events: "history entries",
  documents: "documents",
  employee_dependants: "dependants",
  employee_emergency_contacts: "emergency contacts",
  employee_qualifications: "qualifications",
  employee_experience: "previous jobs",
  employee_sensitive_change_requests: "bank / statutory change requests",
  tax_declarations: "tax declarations",
  raw_punches: "machine punches",
  generated_letters: "letters",
};

const FRIENDLY_BLOCKERS: Record<string, string> = {
  leave_requests: "leave requests", leave_ledger: "leave balances", payroll_results: "salary runs", payroll_adjustments: "salary adjustments",
  salary_register_lines: "salary register lines", shift_rosters: "shift rosters", performance_reviews: "appraisals", performance_goals: "goals",
  development_plans: "development plans", learning_enrolments: "training enrolments", benefit_enrolments: "benefit enrolments",
  policy_acknowledgements: "policy acknowledgements", asset_transactions: "assets", survey_responses: "survey answers", hr_calendar_events: "calendar events",
  helpdesk_cases: "help desk cases", document_upload_intents: "pending uploads", separations: "leaving records", onboarding_cases: "joining records",
  timesheets: "timesheets", overtime_requests: "overtime requests", employee_loans: "loans", expense_claims: "expense claims",
  employee_skills: "skills", continuous_feedback: "feedback", attendance_post_lock_adjustments: "post-lock attendance adjustments",
};

export const friendlyTable = (table: string) => MOVES_WITH_PERSON[table] || FRIENDLY_BLOCKERS[table] || table.replaceAll("_", " ");

// `counts` = how many rows the person has in each table that has an employee_id column (tables with none are left out).
export function splitFootprint(counts: Record<string, number>) {
  const moves: { table: string; label: string; count: number }[] = [];
  const blockers: { table: string; label: string; count: number }[] = [];
  for (const [table, count] of Object.entries(counts)) {
    if (!count) continue;
    (table in MOVES_WITH_PERSON ? moves : blockers).push({ table, label: friendlyTable(table), count });
  }
  return { moves, blockers };
}

// A month that is under checking or locked in either company cannot have a person's days moved in or out.
export function monthBlockers(months: { company: string; period: string; status: string }[]) {
  return months.filter(month => month.status !== "open").map(month => `${month.period} is ${month.status === "review" ? "under checking" : "locked"} for ${month.company}`);
}

// "1 attendance day", "2 attendance days", "1 history entry", "3 history entries".
export function countLabel(count: number, label: string) {
  if (count !== 1) return `${count} ${label}`;
  const singular = label.endsWith("ies") ? `${label.slice(0, -3)}y` : label.endsWith("s") ? label.slice(0, -1) : label;
  return `1 ${singular}`;
}
