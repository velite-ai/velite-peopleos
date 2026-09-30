import type { Sql } from "./database";

const DAY_MS = 86_400_000;
const weekdayNames: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export type DayFraction = "full" | "half";
export type WeeklyOffPattern = {
  weekdaysOff?: Array<number | string>;
  daysOff?: Array<number | string>;
  nthWeekdays?: Array<{ weekday: number | string; weeks: number[] }>;
};

export type LeaveCalendarResult = {
  days: number;
  workDates: string[];
  snapshot: {
    generatedAt: string;
    weeklyOffPatternId: string | null;
    weeklyOffPattern: WeeklyOffPattern;
    holidayIds: string[];
    holidayDates: string[];
    excludedDates: Array<{ date: string; reason: "weekly_off" | "holiday" }>;
  };
  employee: {
    id: string;
    businessHeadId: string;
    departmentId: string | null;
    workLocationId: string | null;
    employmentType: string;
    dateJoined: string;
    lastWorkingDate: string | null;
  };
};

function parseIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("INVALID_DATE");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== value) throw new Error("INVALID_DATE");
  return date;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function weekdayNumber(value: number | string) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6) return value;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 6) return numeric;
    return weekdayNames[value.toLowerCase()];
  }
  return undefined;
}

function normalizedWeeklyPattern(pattern: unknown): WeeklyOffPattern {
  if (!pattern || typeof pattern !== "object" || Array.isArray(pattern)) return { weekdaysOff: [0] };
  const source = pattern as WeeklyOffPattern;
  return {
    weekdaysOff: Array.isArray(source.weekdaysOff)
      ? source.weekdaysOff
      : Array.isArray(source.daysOff)
        ? source.daysOff
        : [0],
    nthWeekdays: Array.isArray(source.nthWeekdays) ? source.nthWeekdays : [],
  };
}

function isWeeklyOff(date: Date, pattern: WeeklyOffPattern) {
  const weekday = date.getUTCDay();
  const everyWeek = new Set((pattern.weekdaysOff || []).map(weekdayNumber).filter((value): value is number => value !== undefined));
  if (everyWeek.has(weekday)) return true;
  const weekOfMonth = Math.ceil(date.getUTCDate() / 7);
  return (pattern.nthWeekdays || []).some(entry =>
    weekdayNumber(entry.weekday) === weekday &&
    Array.isArray(entry.weeks) &&
    entry.weeks.some(week => Number.isInteger(week) && week === weekOfMonth),
  );
}

export function deriveWorkingDates(input: {
  startDate: string;
  endDate: string;
  startDayFraction?: DayFraction;
  endDayFraction?: DayFraction;
  weeklyOffPattern?: unknown;
  holidayDates?: string[];
}) {
  const start = parseIsoDate(input.startDate);
  const end = parseIsoDate(input.endDate);
  if (end < start) throw new Error("INVALID_DATE_RANGE");
  const span = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
  if (span > 366) throw new Error("DATE_RANGE_TOO_LARGE");
  const pattern = normalizedWeeklyPattern(input.weeklyOffPattern);
  const holidays = new Set(input.holidayDates || []);
  const workDates: string[] = [];
  const excludedDates: Array<{ date: string; reason: "weekly_off" | "holiday" }> = [];
  let days = 0;
  for (let offset = 0; offset < span; offset += 1) {
    const date = new Date(start.getTime() + offset * DAY_MS);
    const value = isoDate(date);
    if (isWeeklyOff(date, pattern)) {
      excludedDates.push({ date: value, reason: "weekly_off" });
      continue;
    }
    if (holidays.has(value)) {
      excludedDates.push({ date: value, reason: "holiday" });
      continue;
    }
    let fraction = 1;
    if (span === 1 && (input.startDayFraction === "half" || input.endDayFraction === "half")) fraction = 0.5;
    else if (value === input.startDate && input.startDayFraction === "half") fraction = 0.5;
    else if (value === input.endDate && input.endDayFraction === "half") fraction = 0.5;
    days += fraction;
    workDates.push(value);
  }
  return { days: Math.round(days * 100) / 100, workDates, excludedDates, weeklyOffPattern: pattern };
}

export async function calculateEmployeeLeaveCalendar(
  sql: Sql,
  input: {
    employeeId: string;
    startDate: string;
    endDate: string;
    startDayFraction?: DayFraction;
    endDayFraction?: DayFraction;
  },
): Promise<LeaveCalendarResult> {
  const [employee] = await sql<{
    id: string;
    business_head_id: string;
    department_id: string | null;
    work_location_id: string | null;
    employment_type: string;
    date_joined: string;
    last_working_date: string | null;
    weekly_off_pattern_id: string | null;
    weekly_off_pattern: WeeklyOffPattern | null;
  }[]>`
    SELECT e.id,e.business_head_id,e.department_id,e.work_location_id,e.employment_type,
      e.date_joined,e.last_working_date,e.weekly_off_pattern_id,w.pattern AS weekly_off_pattern
    FROM employees e
    LEFT JOIN weekly_off_patterns w ON w.id=e.weekly_off_pattern_id AND w.active=true
    WHERE e.id=${input.employeeId} AND e.status NOT IN ('candidate','preboarding','separated','archived')
  `;
  if (!employee) throw new Error("EMPLOYEE_NOT_FOUND");
  if (input.startDate < employee.date_joined) throw new Error("LEAVE_BEFORE_JOINING");
  if (employee.last_working_date && input.endDate > employee.last_working_date) throw new Error("LEAVE_AFTER_LAST_WORKING_DATE");
  const holidays = await sql<{ id: string; holiday_date: string }[]>`
    SELECT id,holiday_date
    FROM holidays
    WHERE active=true AND optional=false
      AND holiday_date BETWEEN ${input.startDate}::date AND ${input.endDate}::date
      AND (business_head_id IS NULL OR business_head_id=${employee.business_head_id})
      AND (work_location_id IS NULL OR work_location_id=${employee.work_location_id}::uuid)
    ORDER BY holiday_date,id
  `;
  const derived = deriveWorkingDates({
    startDate: input.startDate,
    endDate: input.endDate,
    startDayFraction: input.startDayFraction,
    endDayFraction: input.endDayFraction,
    weeklyOffPattern: employee.weekly_off_pattern || { weekdaysOff: [0] },
    holidayDates: holidays.map(holiday => holiday.holiday_date),
  });
  return {
    days: derived.days,
    workDates: derived.workDates,
    snapshot: {
      generatedAt: new Date().toISOString(),
      weeklyOffPatternId: employee.weekly_off_pattern_id,
      weeklyOffPattern: derived.weeklyOffPattern,
      holidayIds: holidays.map(holiday => holiday.id),
      holidayDates: holidays.map(holiday => holiday.holiday_date),
      excludedDates: derived.excludedDates,
    },
    employee: {
      id: employee.id,
      businessHeadId: employee.business_head_id,
      departmentId: employee.department_id,
      workLocationId: employee.work_location_id,
      employmentType: employee.employment_type,
      dateJoined: employee.date_joined,
      lastWorkingDate: employee.last_working_date,
    },
  };
}

export function leaveEligibilityIssue(
  eligibility: unknown,
  employee: LeaveCalendarResult["employee"],
  startDate: string,
  days: number,
) {
  if (!eligibility || typeof eligibility !== "object" || Array.isArray(eligibility)) return null;
  const rules = eligibility as Record<string, unknown>;
  if (Array.isArray(rules.employmentTypes) && !rules.employmentTypes.includes(employee.employmentType)) {
    return "This leave policy does not apply to the employee's employment type";
  }
  const serviceDays = Math.floor((parseIsoDate(startDate).getTime() - parseIsoDate(employee.dateJoined).getTime()) / DAY_MS);
  if (typeof rules.minimumServiceDays === "number" && serviceDays < rules.minimumServiceDays) {
    return `This leave policy requires ${rules.minimumServiceDays} days of service`;
  }
  if (typeof rules.maximumConsecutiveDays === "number" && days > rules.maximumConsecutiveDays) {
    return `This leave policy allows at most ${rules.maximumConsecutiveDays} consecutive working days`;
  }
  return null;
}

export function negativeBalanceLimit(eligibility: unknown) {
  if (!eligibility || typeof eligibility !== "object" || Array.isArray(eligibility)) return 0;
  const value = (eligibility as Record<string, unknown>).negativeBalanceLimit;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export function accrualPeriod(frequency: string, periodStart: string) {
  const start = parseIsoDate(periodStart);
  const month = start.getUTCMonth();
  if (start.getUTCDate() !== 1) throw new Error("ACCRUAL_PERIOD_MUST_START_ON_FIRST");
  let months: number;
  if (frequency === "monthly") months = 1;
  else if (frequency === "quarterly") {
    if (month % 3 !== 0) throw new Error("ACCRUAL_PERIOD_MUST_START_ON_QUARTER");
    months = 3;
  } else if (frequency === "annual") {
    if (month !== 0) throw new Error("ACCRUAL_PERIOD_MUST_START_ON_YEAR");
    months = 12;
  } else throw new Error("POLICY_DOES_NOT_ACCRUE");
  const end = new Date(Date.UTC(start.getUTCFullYear(), month + months, 0));
  return { start: periodStart, end: isoDate(end), months };
}

export function proratedAccrual(input: {
  annualEntitlement: number;
  periodStart: string;
  periodEnd: string;
  employmentStart: string;
  employmentEnd?: string | null;
  frequencyMonths: number;
}) {
  const periodStart = parseIsoDate(input.periodStart);
  const periodEnd = parseIsoDate(input.periodEnd);
  const employmentStart = parseIsoDate(input.employmentStart);
  const employmentEnd = input.employmentEnd ? parseIsoDate(input.employmentEnd) : periodEnd;
  const eligibleStart = employmentStart > periodStart ? employmentStart : periodStart;
  const eligibleEnd = employmentEnd < periodEnd ? employmentEnd : periodEnd;
  if (eligibleEnd < eligibleStart) return 0;
  const periodDays = Math.floor((periodEnd.getTime() - periodStart.getTime()) / DAY_MS) + 1;
  const eligibleDays = Math.floor((eligibleEnd.getTime() - eligibleStart.getTime()) / DAY_MS) + 1;
  const fullPeriodAccrual = input.annualEntitlement * input.frequencyMonths / 12;
  return Math.round(fullPeriodAccrual * eligibleDays / periodDays * 100) / 100;
}
