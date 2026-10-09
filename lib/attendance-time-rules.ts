// Working-hours rules for late arrivals and early departures. No imports, so they can be unit tested on their own.
// Hours are the same for every company for now; they live here until they become a setting.

export const WORK_START_MINUTES = 9 * 60; // 09:00
export const WORK_END_MINUTES = 18 * 60; // 18:00
export const GRACE_MINUTES = 15;
const IST_OFFSET_MINUTES = 330;

// Times only make sense when the person actually worked that day.
export const TIME_STATUSES = ["present", "half_day", "work_from_home", "on_duty"] as const;
export const isTimeStatus = (status: string) => (TIME_STATUSES as readonly string[]).includes(status);

export function defaultWorkedMinutes(status: string) {
  if (status === "half_day") return 240;
  return ["present", "work_from_home", "on_duty"].includes(status) ? 480 : 0;
}

// "09:25" -> 565 minutes after midnight. Anything else -> null.
export function parseClock(value: string | null | undefined) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value || "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function formatClock(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

// Arriving within the grace period is on time. Later than that, lateness is counted from the official start.
export const lateMinutes = (inMinutes: number) => (inMinutes > WORK_START_MINUTES + GRACE_MINUTES ? inMinutes - WORK_START_MINUTES : 0);

// Leaving within the grace period before the end is fine. Earlier than that, it is counted back from the official end.
export const earlyMinutes = (outMinutes: number) => (outMinutes < WORK_END_MINUTES - GRACE_MINUTES ? WORK_END_MINUTES - outMinutes : 0);

// A wall-clock time in India on a given date, as the exact moment it happened.
export const istMoment = (date: string, minutes: number) => new Date(`${date}T${formatClock(minutes)}:00+05:30`);

// The India wall-clock time of a moment, as minutes after midnight.
export function istMinutes(moment: Date) {
  const shifted = new Date(moment.getTime() + IST_OFFSET_MINUTES * 60000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}
