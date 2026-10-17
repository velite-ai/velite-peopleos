/*
 * One-click printable letters for the staff record: Offer letter, Acceptance of resignation, Experience letter.
 * The wording of the offer letter follows the company's own sample (Offer_letter_45.pdf); the other two are drafted in the same style.
 * The letters are printed on the company's own letterhead, so nothing here draws a letterhead - only blank space at the top.
 */

export type LetterType = "offer" | "acceptance" | "experience";
export const LETTER_TYPES: LetterType[] = ["offer", "acceptance", "experience"];
export const LETTER_LABELS: Record<LetterType, string> = { offer: "Offer letter", acceptance: "Acceptance of resignation", experience: "Experience letter" };

export type LetterData = {
  type: LetterType;
  company: string;
  reference: string;
  date: string; // YYYY-MM-DD
  name: string;
  title: string; // "Mr." | "Ms." | ""
  addressLines: string[];
  mobile: string | null;
  employeeCode: string;
  position: string;
  department: string | null;
  joinedDate: string;
  probationMonths: number;
  monthlySalary: number | null;
  resignationDate: string | null;
  lastWorkingDay: string | null;
  noticeDays: number | null;
};

export type LetterContent = {
  reference: string;
  dateText: string;
  addressee: string[];
  salutation: string | null;
  heading: string | null;
  subject: string;
  paragraphs: string[];
  closing: string[];
  signedFor: string;
  signatory: string;
  cc: string | null;
  checklist: string[] | null;
  warnings: string[];
};

const BLANK = "__________";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// "13 May 2026"
export function longDate(iso: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!match) return BLANK;
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

// Short company code used in the reference number: Velite Healthcare -> VH, Velite Sciences Pvt Ltd. -> VS, Others 1 -> O1
export function companyLetterCode(name: string): string {
  const words = name.split(/\s+/).filter(word => word && !/^(pvt|ltd|private|limited)\.?$/i.test(word));
  const code = words.map(word => (/^\d+$/.test(word) ? word : word[0].toUpperCase())).join("");
  return code || "VL";
}

// Indian financial year: 2026-05-13 -> "2026-27", 2027-02-01 -> "2026-27"
export function financialYear(iso: string): string {
  const year = Number(iso.slice(0, 4)); const month = Number(iso.slice(5, 7));
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

// VH/2026-27/05/13/1: company, financial year, month, day, and the number of the letter issued by the company that day
export function referenceNumber(companyName: string, iso: string, serial: number): string {
  return `${companyLetterCode(companyName)}/${financialYear(iso)}/${iso.slice(5, 7)}/${iso.slice(8, 10)}/${serial}`;
}

export function titleFor(gender: string | null | undefined): string {
  const value = (gender || "").trim().toLowerCase();
  if (["male", "m", "man", "mr", "mr."].includes(value)) return "Mr.";
  if (["female", "f", "woman", "ms", "ms.", "mrs", "mrs.", "miss"].includes(value)) return "Ms.";
  return "";
}

// Months of probation from the dates on the record; the standard six months when no probation end is recorded.
export function probationMonths(joined: string | null | undefined, probationEnd: string | null | undefined): number {
  if (!joined || !probationEnd) return 6;
  const months = (Number(probationEnd.slice(0, 4)) - Number(joined.slice(0, 4))) * 12 + Number(probationEnd.slice(5, 7)) - Number(joined.slice(5, 7));
  return months >= 1 && months <= 24 ? months : 6;
}

const OFFER_CHECKLIST = ["*Passport Size (3 Nos) Photographs", "Permanent Income Tax Number – Pan (if any)", "*Aadhar Card Copy", "*Academic Mark Sheets and Certificates"];

export function buildLetter(data: LetterData): LetterContent {
  const warnings: string[] = [];
  const who = [data.title, data.name].filter(Boolean).join(" ");
  const common = { reference: data.reference, dateText: longDate(data.date), signedFor: `For ${data.company},`, signatory: "Authorized Signatory" };

  if (data.type === "offer") {
    if (data.addressLines.length === 0) warnings.push("No address is recorded for this person, so the address lines are blank. Add it under Personal, or write it in by hand.");
    if (!data.mobile) warnings.push("No mobile number is recorded.");
    if (data.monthlySalary === null) warnings.push("No salary is recorded (or you cannot see salaries), so the amount is blank. Fill it in by hand or add the pay record first.");
    const salary = data.monthlySalary === null ? BLANK : String(Math.round(data.monthlySalary));
    return {
      ...common,
      addressee: [`${who},`, ...data.addressLines.map(line => `${line.replace(/,$/, "")},`), ...(data.mobile ? [`Mobile - ${data.mobile}`] : [])],
      salutation: `Dear ${who},`,
      heading: null,
      subject: "Offer Letter for Employment",
      paragraphs: [
        `Further to your application & subsequent interview you had with us, we are pleased to offer you an appointment as ${data.position} in our organisation. You will report to duty on ${longDate(data.joinedDate)}. Please note that if you fail to join duty on this date without prior information, the Management reserves the right to withdraw this offer letter.`,
        `Initially you will be on probation for a period of ${data.probationMonths} months from the date of appointment. Should your capabilities and conduct during the probation, not be satisfactory, the Management may, at its sole discretion, extend the period of probation to a maximum of One year or subject to review or termination of services.`,
        `Your salary will be fixed as discussed and agreed @ Rs. ${salary}/- per month during probation.`,
        "Wishing you all the best and welcoming you to our organisation for a long-standing relationship.",
      ],
      closing: ["Yours faithfully,"],
      cc: "cc: Employee file",
      checklist: OFFER_CHECKLIST,
      warnings,
    };
  }

  if (data.type === "acceptance") {
    if (!data.lastWorkingDay) warnings.push("No last working day is recorded. Use Record resignation first.");
    if (!data.resignationDate) warnings.push("The date of the resignation letter is not recorded, so it is blank. Use Record resignation, or write it in by hand.");
    const notice = data.noticeDays && data.noticeDays > 0 ? `, in accordance with the notice period of ${data.noticeDays} days` : "";
    return {
      ...common,
      addressee: [`${who},`, `${data.position}${data.department ? `, ${data.department}` : ""},`, `Employee Code: ${data.employeeCode}`],
      salutation: `Dear ${who},`,
      heading: null,
      subject: "Acceptance of Resignation",
      paragraphs: [
        `This is with reference to your resignation letter dated ${longDate(data.resignationDate)} from the position of ${data.position} in ${data.company}. We hereby accept your resignation.`,
        `Your last working day with the organisation will be ${longDate(data.lastWorkingDay)}${notice}. You will be relieved from the services of the organisation at the close of working hours on that date.`,
        "You are requested to hand over all documents, work and company property in your possession and to complete the no-dues clearance before your last working day. Your full and final settlement will be processed as per the Company's policy after the completion of the exit formalities.",
        "We thank you for the services rendered by you and wish you all the best for your future endeavours.",
      ],
      closing: ["Yours faithfully,"],
      cc: "cc: Employee file",
      checklist: null,
      warnings,
    };
  }

  if (!data.lastWorkingDay) warnings.push("No last working day is recorded. Use Record resignation first.");
  return {
    ...common,
    addressee: [],
    salutation: null,
    heading: "TO WHOM IT MAY CONCERN",
    subject: "Experience Letter",
    paragraphs: [
      `This is to certify that ${who} (Employee Code ${data.employeeCode}) was employed with ${data.company} as ${data.position}${data.department ? ` in the ${data.department} department` : ""} from ${longDate(data.joinedDate)} to ${longDate(data.lastWorkingDay)}.`,
      `During the period of employment, the conduct and performance of ${who} were found to be satisfactory.`,
      `We wish ${who} all the best for future endeavours.`,
    ],
    closing: ["Yours faithfully,"],
    cc: null,
    checklist: null,
    warnings,
  };
}
