// Velite's paid-days rule (companies with business_heads.paid_days_rule = 'velite_table'; Others 1 from Nov 2026). Pure and unit tested.
//
// Paid days = days present + Sundays granted + national holidays granted + paid leave, never more than the days employed.
// Sundays and holidays granted come from the days present, using a table (October 2026: 31 days, 25 working days, 4 Sundays, 2 holidays):
//   22 to 25 present -> 4 Sundays + 2 holidays      17.5 to 21.5 -> 3 + 2      13.5 to 17 -> 2 + 1      10 to 13 -> 1 + 0      8 to 9.5 -> 0 + 0
// The cut-offs are fractions of the month's working days (88%, 70%, 54%, 40%, 32% of 25), rounded to the nearest half day, so they scale to other months.
// Granted per band: Sundays all, one fewer per lower band, none in the lowest; holidays all in the top two bands, one fewer in the third, none below.
// Only Sundays and holidays that fall inside the person's employment count. Joined after the 7th, or left before the end of the month: working days only.
// Paid leave (from attendance and from Salary inputs) is added on top and is not counted as a day present.

const FRACTIONS = [0.88, 0.7, 0.54, 0.4, 0.32];
const half = (value: number) => Math.round(value * 2) / 2;
const pad = (value: number) => String(value).padStart(2, "0");
const iso = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;

export type MonthCalendar = { calendarDays: number; monthStart: string; monthEnd: string; sundays: string[]; holidays: string[]; workingDays: number };
export type Band = { index: number; from: number; sundays: number; holidays: number };

/** Sundays, the national holidays that are not Sundays, and the working days of a month (month 1 to 12). */
export function monthCalendar(year: number, month: number, holidayDates: string[] = []): MonthCalendar {
  const calendarDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const sundays: string[] = [];
  for (let day = 1; day <= calendarDays; day++) if (new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 0) sundays.push(iso(year, month, day));
  const prefix = `${year}-${pad(month)}-`;
  const holidays = [...new Set(holidayDates.map(value => String(value).slice(0, 10)))].filter(value => value.startsWith(prefix) && !sundays.includes(value)).sort();
  return { calendarDays, monthStart: iso(year, month, 1), monthEnd: iso(year, month, calendarDays), sundays, holidays, workingDays: calendarDays - sundays.length - holidays.length };
}

/** The five bands for a month: the days present each starts at, and the Sundays and holidays it grants. */
export function bandsFor(calendar: MonthCalendar): Band[] {
  const s = calendar.sundays.length, h = calendar.holidays.length;
  return FRACTIONS.map((fraction, index) => ({
    index,
    from: half(fraction * calendar.workingDays),
    sundays: index === 0 ? s : index <= 3 ? Math.max(0, s - index) : 0,
    holidays: index <= 1 ? h : index === 2 ? Math.max(0, h - 1) : 0,
  }));
}

export type PaidDaysInput = {
  year: number; month: number;
  joinDate: string; lastWorkingDate: string | null;
  presentDays: number;          // present + work from home + on duty + half days at 0.5, inside the person's employment
  paidLeaveMarked: number;      // days marked paid leave in attendance
  paidLeaveInput: number;       // paid leave typed in Salary inputs
  holidays: string[];           // the month's national holidays
  noSalary: boolean;
};
export type PaidDays = {
  employedDays: number; eligible: boolean; reason: string; band: number | null; workingDays: number;
  presentDays: number; sundaysGranted: number; holidaysGranted: number; paidLeave: number; payableDays: number;
};

export function computePaidDays(input: PaidDaysInput): PaidDays {
  const calendar = monthCalendar(input.year, input.month, input.holidays);
  const join = String(input.joinDate).slice(0, 10);
  const last = input.lastWorkingDate ? String(input.lastWorkingDate).slice(0, 10) : null;
  const start = join > calendar.monthStart ? join : calendar.monthStart;
  const end = last && last < calendar.monthEnd ? last : calendar.monthEnd;
  const employedDays = start > end ? 0 : Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
  const present = Math.max(0, input.presentDays);
  const base = { employedDays, workingDays: calendar.workingDays, presentDays: present };

  if (input.noSalary) return { ...base, eligible: false, reason: "No salary", band: null, sundaysGranted: 0, holidaysGranted: 0, paidLeave: 0, payableDays: 0 };

  let eligible = true, reason = "Sundays and holidays by the attendance table";
  if (last && last < calendar.monthEnd) { eligible = false; reason = "Left during the month: working days only"; }
  else if (join >= calendar.monthStart && Number(join.slice(8, 10)) > 7) { eligible = false; reason = "Joined after the 7th: working days only"; }

  const bands = bandsFor(calendar);
  const band = bands.find(item => present >= item.from) || null;
  let sundaysGranted = 0, holidaysGranted = 0;
  if (eligible && band) {
    const sundaysInside = calendar.sundays.filter(day => day >= start && day <= end).length;
    const holidaysInside = calendar.holidays.filter(day => day >= start && day <= end).length;
    sundaysGranted = Math.min(band.sundays, sundaysInside);
    holidaysGranted = Math.min(band.holidays, holidaysInside);
  }
  const room = Math.max(0, employedDays - (present + sundaysGranted + holidaysGranted));
  const paidLeave = Math.min(half(Math.max(0, input.paidLeaveMarked) + Math.max(0, input.paidLeaveInput)), half(room));
  const payableDays = Math.min(employedDays, calendar.calendarDays, present + sundaysGranted + holidaysGranted + paidLeave);
  return { ...base, eligible, reason, band: band ? band.index : null, sundaysGranted, holidaysGranted, paidLeave, payableDays };
}
