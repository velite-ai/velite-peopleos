/*
 * Rules for the "Data check" screen: what counts as a missing detail, and how a probation end date is worked out.
 * Kept free of imports so it can be unit tested on its own and used by both the API and the screen.
 */

export type FixKey = "department" | "workEmail" | "phone" | "photo" | "manager" | "salary" | "documents";

export const FIX_LABELS: Record<FixKey, string> = {
  department: "Department", workEmail: "Work email", phone: "Phone", photo: "Photo", manager: "Reporting manager", salary: "Salary record", documents: "Documents",
};
export const FIX_KEYS = Object.keys(FIX_LABELS) as FixKey[];

export const DEFAULT_PROBATION_MONTHS = 6;

// "Misc." is the catch-all department, so it counts as not having a real department.
export const isPlaceholderDepartment = (name: string | null | undefined) => !name || !name.trim() || /^misc\.?$/i.test(name.trim()) || name.trim() === "—";

export type FixInput = {
  departmentName: string | null; workEmail: string | null; phone: string | null; hasPhoto: boolean; hasManager: boolean;
  hasSalary: boolean | null; // null = this login may not see pay, so it is not checked
  documentCount: number;
};

export function missingItems(row: FixInput): FixKey[] {
  const out: FixKey[] = [];
  if (isPlaceholderDepartment(row.departmentName)) out.push("department");
  if (!row.workEmail?.trim()) out.push("workEmail");
  if (!row.phone?.trim()) out.push("phone");
  if (!row.hasPhoto) out.push("photo");
  if (!row.hasManager) out.push("manager");
  if (row.hasSalary === false) out.push("salary");
  if (row.documentCount === 0) out.push("documents");
  return out;
}

// date + n months as YYYY-MM-DD; a 31st that does not exist in the target month becomes that month's last day (31 Aug + 6 months = 28 Feb).
export function addMonths(isoDate: string, months: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

// One CSV row; values with commas, quotes or line breaks are quoted. Values that start like a formula are made safe for Excel.
export function csvRow(values: (string | number | null | undefined)[]): string {
  return values.map(value => {
    let text = value === null || value === undefined ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(",");
}

// ---- Recording exits of people who were removed from the Staff list ----

export type ExitKind = "resignation" | "termination" | "contract_completion" | "retirement" | "abandonment" | "duplicate" | "skip";
export const EXIT_KIND_LABELS: Record<ExitKind, string> = {
  resignation: "Resigned (left on their own)", termination: "Dismissed", contract_completion: "Contract ended", retirement: "Retired", abandonment: "Stopped coming", duplicate: "Duplicate entry (keep removed)", skip: "Decide later",
};
export const EXIT_KINDS = Object.keys(EXIT_KIND_LABELS) as ExitKind[];
export const isRealExit = (kind: ExitKind) => kind !== "duplicate" && kind !== "skip";

// Why a last working day cannot be accepted (null = fine). Dates are YYYY-MM-DD.
export function exitDateProblem(lastWorkingDay: string | null | undefined, joined: string, today: string): string | null {
  if (!lastWorkingDay) return "Enter the last working day.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastWorkingDay)) return "The date is not valid.";
  if (lastWorkingDay < joined) return "The last working day is before the joining date.";
  if (lastWorkingDay > today) return "The last working day is in the future. Use Record resignation on the staff record for someone still working.";
  return null;
}
