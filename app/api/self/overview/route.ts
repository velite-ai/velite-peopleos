import { apiError, ok, requireEmployeeIdentity } from "@/lib/api";
import { db } from "@/lib/database";

export async function GET() {
  try {
    const identity = await requireEmployeeIdentity();
    if (identity instanceof Response) return identity;
    const sql = db();
    const id = identity.employee.id;
    const [profileRows, attendance, leaveRequests, leaveBalances, payroll, goals, reviews, assets, learning, benefits, expenses, policies] = await Promise.all([
      sql`SELECT e.id,e.employee_code,e.first_name,e.last_name,e.work_email,e.personal_email,e.phone,e.position,e.grade,e.work_location,e.employment_type,e.status,e.date_joined,e.probation_end_date,e.confirmation_date,e.next_salary_revision_date,b.name AS business_head,d.name AS department,concat_ws(' ',m.first_name,m.last_name) AS reporting_manager FROM employees e JOIN business_heads b ON b.id=e.business_head_id LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN employees m ON m.id=e.reporting_manager_id WHERE e.id=${id}`,
      sql`SELECT id,attendance_date,status,first_in,last_out,worked_minutes,overtime_minutes,late_minutes,remarks,locked_at FROM attendance_days WHERE employee_id=${id} AND attendance_date>=current_date-interval '31 days' ORDER BY attendance_date DESC`,
      sql`SELECT r.id,r.start_date,r.end_date,r.days,r.reason,r.status,r.created_at,p.name AS leave_type,p.paid FROM leave_requests r LEFT JOIN leave_policies p ON p.id=r.leave_policy_id WHERE r.employee_id=${id} ORDER BY r.created_at DESC LIMIT 20`,
      sql`SELECT p.id AS policy_id,p.code,p.name,p.paid,p.annual_entitlement,coalesce(sum(l.quantity),0)::numeric AS balance FROM leave_policies p LEFT JOIN leave_ledger l ON l.leave_policy_id=p.id AND l.employee_id=${id} WHERE p.active=true AND (p.business_head_id IS NULL OR p.business_head_id=${identity.employee.businessHeadId}) GROUP BY p.id ORDER BY p.name`,
      sql`SELECT r.id,r.calendar_days,r.payable_days,r.absent_days,r.gross_earnings,r.deductions,r.net_pay,p.period_month,p.pay_date,p.status,ps.id AS payslip_id,ps.published_at FROM payroll_results r JOIN payroll_periods p ON p.id=r.payroll_period_id JOIN payslips ps ON ps.payroll_result_id=r.id AND ps.published_at IS NOT NULL WHERE r.employee_id=${id} AND p.status='paid' ORDER BY p.period_month DESC LIMIT 12`,
      sql`SELECT g.id,g.title,g.description,g.weight,g.target_value,g.actual_value,g.progress,g.status,c.name AS cycle_name,c.start_date,c.end_date FROM performance_goals g JOIN performance_cycles c ON c.id=g.cycle_id WHERE g.employee_id=${id} ORDER BY c.start_date DESC,g.created_at`,
      sql`SELECT r.id,r.review_type,r.ratings,r.overall_rating,r.comments,r.status,r.submitted_at,c.name AS cycle_name FROM performance_reviews r JOIN performance_cycles c ON c.id=r.cycle_id WHERE r.employee_id=${id} ORDER BY c.start_date DESC,r.review_type`,
      sql`SELECT id,asset_code,category,description,serial_number,status,assigned_at,condition_notes FROM assets WHERE assigned_employee_id=${id} ORDER BY assigned_at DESC`,
      sql`SELECT e.id,e.status,e.progress,e.due_date,e.completed_at,e.certificate_expires_on,c.code,c.title,c.mandatory FROM learning_enrolments e JOIN learning_courses c ON c.id=e.course_id WHERE e.employee_id=${id} ORDER BY e.due_date NULLS LAST`,
      sql`SELECT e.id,e.effective_from,e.effective_to,e.nominees,e.status,p.code,p.name,p.employer_cost,p.employee_cost FROM benefit_enrolments e JOIN benefit_plans p ON p.id=e.benefit_plan_id WHERE e.employee_id=${id} ORDER BY e.effective_from DESC`,
      sql`SELECT id,claim_number,category,claim_date,amount,description,status,approved_amount,created_at FROM expense_claims WHERE employee_id=${id} ORDER BY created_at DESC LIMIT 20`,
      sql`SELECT p.id,p.code,p.title,p.version,p.effective_from,p.mandatory,a.acknowledged_at FROM policy_documents p LEFT JOIN policy_acknowledgements a ON a.policy_document_id=p.id AND a.employee_id=${id} WHERE p.status='approved' AND (p.business_head_id IS NULL OR p.business_head_id=${identity.employee.businessHeadId}) ORDER BY p.effective_from DESC`,
    ]);
    return ok({
      profile: profileRows[0], attendance, leaveRequests, leaveBalances, payroll,
      performance: { goals, reviews }, assets, learning, benefits, expenses, policies,
    });
  } catch (error) {
    return apiError(error);
  }
}
