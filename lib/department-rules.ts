/*
 * Rules for adding, renaming and deleting departments (Settings > Company setup > Departments).
 * Kept free of imports so it can be unit tested on its own and used by both the API and the screen.
 */

export const cleanName = (value: string) => value.replace(/\s+/g, " ").trim();
export const sameName = (a: string, b: string) => cleanName(a).toLowerCase() === cleanName(b).toLowerCase();

// The short code behind a department name ("Quality Assurance" -> QUALITY_ASSURANCE, at most 30 characters).
// If that code is already used in the company, a number is added (QUALITY_ASSURANCE_2).
export function departmentCode(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(code => code.toUpperCase()));
  let base = cleanName(name).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 26).replace(/_+$/, "");
  if (base.length < 2) base = "DEPT";
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n++) { const candidate = `${base}_${n}`; if (!used.has(candidate)) return candidate; }
  return `${base}_${Date.now() % 100000}`;
}

export type Usage = { employees: number; candidates: number; costCentres: number; jobPositions: number; requisitions: number; loginsLimitedToIt: number; appraisalCycles: number; calibrationSessions: number; subDepartments: number };

// What stops a department being deleted, in plain words (nothing listed = it can go, once any people have been moved).
export function deleteBlockers(usage: Usage, hasTarget: boolean): string[] {
  const out: string[] = [];
  if (usage.subDepartments) out.push(`It has ${usage.subDepartments} sub-department(s). Delete or move those first.`);
  if (usage.loginsLimitedToIt) out.push(`${usage.loginsLimitedToIt} login(s) are limited to this department. Change those logins first (Settings > Logins & roles).`);
  if (usage.appraisalCycles || usage.calibrationSessions) out.push("Appraisal cycles for this department exist, so it cannot be deleted.");
  if (usage.requisitions && !hasTarget) out.push(`${usage.requisitions} open job requisition(s) belong to it. Choose another department to move them to.`);
  return out;
}

export const movedCount = (usage: Usage) => usage.employees + usage.candidates + usage.costCentres + usage.jobPositions + usage.requisitions;
