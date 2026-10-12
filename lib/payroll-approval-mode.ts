/*
 * "simple": one person prepares, a different person reviews, then the month is locked (two logins are enough).
 * "strict": prepare, HR review, finance approval and a separate final lock, each by a different person.
 * Set PAYROLL_APPROVAL_MODE=strict once there are enough logins.
 */
export type PayrollApprovalMode = "simple" | "strict";

export const payrollApprovalMode = (value: string | undefined = process.env.PAYROLL_APPROVAL_MODE): PayrollApprovalMode => (value?.trim().toLowerCase() === "strict" ? "strict" : "simple");
