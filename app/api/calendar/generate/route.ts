import { z } from "zod";
import { apiError, ok, requireApiUser } from "@/lib/api";
import { db } from "@/lib/database";

const schema = z.object({ businessHeadId: z.uuid().nullable().optional() }).strict();

type SyncCount = { inserted: number; updated: number };

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json().catch(() => ({})));
    const head = input.businessHeadId || null;
    const user = await requireApiUser("calendar:write", head);
    if (user instanceof Response) return user;

    const summary = await db().begin(async tx => {
      const counts: Record<string, SyncCount> = {};

      counts.probationReview = (await tx<SyncCount[]>`
        WITH source AS (
          SELECT e.id,e.business_head_id,e.id AS employee_id,'probation_review'::text AS event_type,
                 'Probation review: '||concat_ws(' ',e.first_name,e.last_name) AS title,
                 e.probation_end_date-15 AS event_date,
                 '[{"daysBefore":7,"roles":["MANAGER","HR_OPERATIONS"]}]'::jsonb AS rules
          FROM employees e WHERE e.status='probation' AND e.probation_end_date IS NOT NULL
            AND (${head}::uuid IS NULL OR e.business_head_id=${head}::uuid)
        ), updated AS (
          UPDATE hr_calendar_events c SET business_head_id=s.business_head_id,employee_id=s.employee_id,
            title=s.title,event_date=s.event_date,reminder_rules=s.rules,status='upcoming'
          FROM source s WHERE c.source_record_type='employee' AND c.source_record_id=s.id AND c.event_type=s.event_type
          RETURNING c.id
        ), inserted AS (
          INSERT INTO hr_calendar_events (business_head_id,employee_id,event_type,title,event_date,source_record_type,source_record_id,reminder_rules)
          SELECT s.business_head_id,s.employee_id,s.event_type,s.title,s.event_date,'employee',s.id,s.rules FROM source s
          WHERE NOT EXISTS (SELECT 1 FROM hr_calendar_events c WHERE c.source_record_type='employee' AND c.source_record_id=s.id AND c.event_type=s.event_type)
          RETURNING id
        ) SELECT (SELECT count(*)::int FROM inserted) AS inserted,(SELECT count(*)::int FROM updated) AS updated
      `)[0];

      counts.confirmationDue = (await tx<SyncCount[]>`
        WITH source AS (
          SELECT e.id,e.business_head_id,e.id AS employee_id,'confirmation_due'::text AS event_type,
                 'Confirmation due: '||concat_ws(' ',e.first_name,e.last_name) AS title,e.probation_end_date AS event_date,
                 '[{"daysBefore":15,"roles":["MANAGER","HR_OPERATIONS"]}]'::jsonb AS rules
          FROM employees e WHERE e.status='probation' AND e.probation_end_date IS NOT NULL
            AND (${head}::uuid IS NULL OR e.business_head_id=${head}::uuid)
        ), updated AS (
          UPDATE hr_calendar_events c SET business_head_id=s.business_head_id,employee_id=s.employee_id,title=s.title,event_date=s.event_date,reminder_rules=s.rules,status='upcoming'
          FROM source s WHERE c.source_record_type='employee' AND c.source_record_id=s.id AND c.event_type=s.event_type RETURNING c.id
        ), inserted AS (
          INSERT INTO hr_calendar_events (business_head_id,employee_id,event_type,title,event_date,source_record_type,source_record_id,reminder_rules)
          SELECT s.business_head_id,s.employee_id,s.event_type,s.title,s.event_date,'employee',s.id,s.rules FROM source s
          WHERE NOT EXISTS (SELECT 1 FROM hr_calendar_events c WHERE c.source_record_type='employee' AND c.source_record_id=s.id AND c.event_type=s.event_type) RETURNING id
        ) SELECT (SELECT count(*)::int FROM inserted) AS inserted,(SELECT count(*)::int FROM updated) AS updated
      `)[0];

      counts.salaryRevision = (await tx<SyncCount[]>`
        WITH source AS (
          SELECT e.id,e.business_head_id,e.id AS employee_id,'salary_revision'::text AS event_type,
                 'Salary revision eligibility: '||concat_ws(' ',e.first_name,e.last_name) AS title,e.next_salary_revision_date AS event_date,
                 '[{"daysBefore":30,"roles":["HR_ADMIN","PAYROLL_ADMIN"]}]'::jsonb AS rules
          FROM employees e WHERE e.status IN ('probation','active') AND e.next_salary_revision_date IS NOT NULL
            AND (${head}::uuid IS NULL OR e.business_head_id=${head}::uuid)
        ), updated AS (
          UPDATE hr_calendar_events c SET business_head_id=s.business_head_id,employee_id=s.employee_id,title=s.title,event_date=s.event_date,reminder_rules=s.rules,status='upcoming'
          FROM source s WHERE c.source_record_type='employee' AND c.source_record_id=s.id AND c.event_type=s.event_type RETURNING c.id
        ), inserted AS (
          INSERT INTO hr_calendar_events (business_head_id,employee_id,event_type,title,event_date,source_record_type,source_record_id,reminder_rules)
          SELECT s.business_head_id,s.employee_id,s.event_type,s.title,s.event_date,'employee',s.id,s.rules FROM source s
          WHERE NOT EXISTS (SELECT 1 FROM hr_calendar_events c WHERE c.source_record_type='employee' AND c.source_record_id=s.id AND c.event_type=s.event_type) RETURNING id
        ) SELECT (SELECT count(*)::int FROM inserted) AS inserted,(SELECT count(*)::int FROM updated) AS updated
      `)[0];

      counts.requisitionTarget = (await tx<SyncCount[]>`
        WITH source AS (
          SELECT r.id,r.business_head_id,NULL::uuid AS employee_id,'requisition_target'::text AS event_type,
                 'Hiring target: '||r.position||' ('||r.requisition_code||')' AS title,r.target_date AS event_date,
                 '[{"daysBefore":14,"roles":["RECRUITER","HR_ADMIN"]}]'::jsonb AS rules
          FROM job_requisitions r WHERE r.target_date IS NOT NULL AND r.status NOT IN ('completed','rejected','cancelled')
            AND (${head}::uuid IS NULL OR r.business_head_id=${head}::uuid)
        ), updated AS (
          UPDATE hr_calendar_events c SET business_head_id=s.business_head_id,title=s.title,event_date=s.event_date,reminder_rules=s.rules,status='upcoming'
          FROM source s WHERE c.source_record_type='job_requisition' AND c.source_record_id=s.id AND c.event_type=s.event_type RETURNING c.id
        ), inserted AS (
          INSERT INTO hr_calendar_events (business_head_id,employee_id,event_type,title,event_date,source_record_type,source_record_id,reminder_rules)
          SELECT s.business_head_id,s.employee_id,s.event_type,s.title,s.event_date,'job_requisition',s.id,s.rules FROM source s
          WHERE NOT EXISTS (SELECT 1 FROM hr_calendar_events c WHERE c.source_record_type='job_requisition' AND c.source_record_id=s.id AND c.event_type=s.event_type) RETURNING id
        ) SELECT (SELECT count(*)::int FROM inserted) AS inserted,(SELECT count(*)::int FROM updated) AS updated
      `)[0];

      counts.offerJoining = (await tx<SyncCount[]>`
        WITH source AS (
          SELECT o.id,c.business_head_id,NULL::uuid AS employee_id,'candidate_joining'::text AS event_type,
                 'Candidate joining: '||c.full_name AS title,o.proposed_joining_date AS event_date,
                 '[{"daysBefore":7,"roles":["RECRUITER","HR_OPERATIONS"]}]'::jsonb AS rules
          FROM candidate_offers o JOIN candidates c ON c.id=o.candidate_id
          WHERE o.status IN ('approved','issued','accepted') AND (${head}::uuid IS NULL OR c.business_head_id=${head}::uuid)
        ), updated AS (
          UPDATE hr_calendar_events c SET business_head_id=s.business_head_id,title=s.title,event_date=s.event_date,reminder_rules=s.rules,status='upcoming'
          FROM source s WHERE c.source_record_type='candidate_offer' AND c.source_record_id=s.id AND c.event_type=s.event_type RETURNING c.id
        ), inserted AS (
          INSERT INTO hr_calendar_events (business_head_id,employee_id,event_type,title,event_date,source_record_type,source_record_id,reminder_rules)
          SELECT s.business_head_id,s.employee_id,s.event_type,s.title,s.event_date,'candidate_offer',s.id,s.rules FROM source s
          WHERE NOT EXISTS (SELECT 1 FROM hr_calendar_events c WHERE c.source_record_type='candidate_offer' AND c.source_record_id=s.id AND c.event_type=s.event_type) RETURNING id
        ) SELECT (SELECT count(*)::int FROM inserted) AS inserted,(SELECT count(*)::int FROM updated) AS updated
      `)[0];

      counts.payrollCutoff = (await tx<SyncCount[]>`
        WITH source AS (
          SELECT p.id,p.business_head_id,NULL::uuid AS employee_id,'payroll_cutoff'::text AS event_type,
                 'Payroll attendance cut-off: '||to_char(p.period_month,'Mon YYYY') AS title,p.attendance_cutoff AS event_date,
                 '[{"daysBefore":3,"roles":["HR_OPERATIONS","PAYROLL_ADMIN"]}]'::jsonb AS rules
          FROM payroll_periods p WHERE p.status NOT IN ('paid','cancelled') AND (${head}::uuid IS NULL OR p.business_head_id=${head}::uuid)
        ), updated AS (
          UPDATE hr_calendar_events c SET business_head_id=s.business_head_id,title=s.title,event_date=s.event_date,reminder_rules=s.rules,status='upcoming'
          FROM source s WHERE c.source_record_type='payroll_period' AND c.source_record_id=s.id AND c.event_type=s.event_type RETURNING c.id
        ), inserted AS (
          INSERT INTO hr_calendar_events (business_head_id,employee_id,event_type,title,event_date,source_record_type,source_record_id,reminder_rules)
          SELECT s.business_head_id,s.employee_id,s.event_type,s.title,s.event_date,'payroll_period',s.id,s.rules FROM source s
          WHERE NOT EXISTS (SELECT 1 FROM hr_calendar_events c WHERE c.source_record_type='payroll_period' AND c.source_record_id=s.id AND c.event_type=s.event_type) RETURNING id
        ) SELECT (SELECT count(*)::int FROM inserted) AS inserted,(SELECT count(*)::int FROM updated) AS updated
      `)[0];

      counts.payDay = (await tx<SyncCount[]>`
        WITH source AS (
          SELECT p.id,p.business_head_id,NULL::uuid AS employee_id,'pay_day'::text AS event_type,
                 'Salary pay date: '||to_char(p.period_month,'Mon YYYY') AS title,p.pay_date AS event_date,
                 '[{"daysBefore":2,"roles":["PAYROLL_ADMIN","FINANCE_APPROVER"]}]'::jsonb AS rules
          FROM payroll_periods p WHERE p.status NOT IN ('paid','cancelled') AND (${head}::uuid IS NULL OR p.business_head_id=${head}::uuid)
        ), updated AS (
          UPDATE hr_calendar_events c SET business_head_id=s.business_head_id,title=s.title,event_date=s.event_date,reminder_rules=s.rules,status='upcoming'
          FROM source s WHERE c.source_record_type='payroll_period' AND c.source_record_id=s.id AND c.event_type=s.event_type RETURNING c.id
        ), inserted AS (
          INSERT INTO hr_calendar_events (business_head_id,employee_id,event_type,title,event_date,source_record_type,source_record_id,reminder_rules)
          SELECT s.business_head_id,s.employee_id,s.event_type,s.title,s.event_date,'payroll_period',s.id,s.rules FROM source s
          WHERE NOT EXISTS (SELECT 1 FROM hr_calendar_events c WHERE c.source_record_type='payroll_period' AND c.source_record_id=s.id AND c.event_type=s.event_type) RETURNING id
        ) SELECT (SELECT count(*)::int FROM inserted) AS inserted,(SELECT count(*)::int FROM updated) AS updated
      `)[0];

      counts.appraisalClose = (await tx<SyncCount[]>`
        WITH source AS (
          SELECT c.id,c.business_head_id,NULL::uuid AS employee_id,'appraisal_close'::text AS event_type,
                 'Appraisal cycle closes: '||c.name AS title,c.end_date AS event_date,
                 '[{"daysBefore":14,"roles":["MANAGER","DEPARTMENT_HEAD","HR_ADMIN"]}]'::jsonb AS rules
          FROM performance_cycles c WHERE c.status NOT IN ('completed','rejected','cancelled')
            AND (${head}::uuid IS NULL OR c.business_head_id=${head}::uuid OR c.business_head_id IS NULL)
        ), updated AS (
          UPDATE hr_calendar_events h SET business_head_id=s.business_head_id,title=s.title,event_date=s.event_date,reminder_rules=s.rules,status='upcoming'
          FROM source s WHERE h.source_record_type='performance_cycle' AND h.source_record_id=s.id AND h.event_type=s.event_type RETURNING h.id
        ), inserted AS (
          INSERT INTO hr_calendar_events (business_head_id,employee_id,event_type,title,event_date,source_record_type,source_record_id,reminder_rules)
          SELECT s.business_head_id,s.employee_id,s.event_type,s.title,s.event_date,'performance_cycle',s.id,s.rules FROM source s
          WHERE NOT EXISTS (SELECT 1 FROM hr_calendar_events h WHERE h.source_record_type='performance_cycle' AND h.source_record_id=s.id AND h.event_type=s.event_type) RETURNING id
        ) SELECT (SELECT count(*)::int FROM inserted) AS inserted,(SELECT count(*)::int FROM updated) AS updated
      `)[0];

      counts.separation = (await tx<SyncCount[]>`
        WITH source AS (
          SELECT s.id,e.business_head_id,e.id AS employee_id,'last_working_day'::text AS event_type,
                 'Last working day: '||concat_ws(' ',e.first_name,e.last_name) AS title,
                 coalesce(s.approved_last_working_date,s.proposed_last_working_date) AS event_date,
                 '[{"daysBefore":14,"roles":["HR_OPERATIONS","MANAGER","PAYROLL_ADMIN"]}]'::jsonb AS rules
          FROM separations s JOIN employees e ON e.id=s.employee_id WHERE s.status IN ('pending','approved')
            AND (${head}::uuid IS NULL OR e.business_head_id=${head}::uuid)
        ), updated AS (
          UPDATE hr_calendar_events h SET business_head_id=s.business_head_id,employee_id=s.employee_id,title=s.title,event_date=s.event_date,reminder_rules=s.rules,status='upcoming'
          FROM source s WHERE h.source_record_type='separation' AND h.source_record_id=s.id AND h.event_type=s.event_type RETURNING h.id
        ), inserted AS (
          INSERT INTO hr_calendar_events (business_head_id,employee_id,event_type,title,event_date,source_record_type,source_record_id,reminder_rules)
          SELECT s.business_head_id,s.employee_id,s.event_type,s.title,s.event_date,'separation',s.id,s.rules FROM source s
          WHERE NOT EXISTS (SELECT 1 FROM hr_calendar_events h WHERE h.source_record_type='separation' AND h.source_record_id=s.id AND h.event_type=s.event_type) RETURNING id
        ) SELECT (SELECT count(*)::int FROM inserted) AS inserted,(SELECT count(*)::int FROM updated) AS updated
      `)[0];

      counts.learningDue = (await tx<SyncCount[]>`
        WITH source AS (
          SELECT l.id,e.business_head_id,e.id AS employee_id,'learning_due'::text AS event_type,
                 'Learning due: '||c.title||' · '||concat_ws(' ',e.first_name,e.last_name) AS title,l.due_date AS event_date,
                 '[{"daysBefore":7,"roles":["MANAGER","HR_OPERATIONS"]}]'::jsonb AS rules
          FROM learning_enrolments l JOIN employees e ON e.id=l.employee_id JOIN learning_courses c ON c.id=l.course_id
          WHERE l.due_date IS NOT NULL AND l.status NOT IN ('completed','cancelled')
            AND (${head}::uuid IS NULL OR e.business_head_id=${head}::uuid)
        ), updated AS (
          UPDATE hr_calendar_events h SET business_head_id=s.business_head_id,employee_id=s.employee_id,title=s.title,event_date=s.event_date,reminder_rules=s.rules,status='upcoming'
          FROM source s WHERE h.source_record_type='learning_enrolment' AND h.source_record_id=s.id AND h.event_type=s.event_type RETURNING h.id
        ), inserted AS (
          INSERT INTO hr_calendar_events (business_head_id,employee_id,event_type,title,event_date,source_record_type,source_record_id,reminder_rules)
          SELECT s.business_head_id,s.employee_id,s.event_type,s.title,s.event_date,'learning_enrolment',s.id,s.rules FROM source s
          WHERE NOT EXISTS (SELECT 1 FROM hr_calendar_events h WHERE h.source_record_type='learning_enrolment' AND h.source_record_id=s.id AND h.event_type=s.event_type) RETURNING id
        ) SELECT (SELECT count(*)::int FROM inserted) AS inserted,(SELECT count(*)::int FROM updated) AS updated
      `)[0];

      counts.complianceDue = (await tx<SyncCount[]>`
        WITH source AS (
          SELECT c.id,c.business_head_id,NULL::uuid AS employee_id,'compliance_due'::text AS event_type,
                 'Compliance due: '||c.compliance_type||' · '||c.period AS title,c.due_date AS event_date,
                 '[{"daysBefore":14,"roles":["HR_ADMIN","PAYROLL_ADMIN","FINANCE_APPROVER"]}]'::jsonb AS rules
          FROM compliance_items c WHERE c.status NOT IN ('completed','cancelled')
            AND (${head}::uuid IS NULL OR c.business_head_id=${head}::uuid)
        ), updated AS (
          UPDATE hr_calendar_events h SET business_head_id=s.business_head_id,title=s.title,event_date=s.event_date,reminder_rules=s.rules,status='upcoming'
          FROM source s WHERE h.source_record_type='compliance_item' AND h.source_record_id=s.id AND h.event_type=s.event_type RETURNING h.id
        ), inserted AS (
          INSERT INTO hr_calendar_events (business_head_id,employee_id,event_type,title,event_date,source_record_type,source_record_id,reminder_rules)
          SELECT s.business_head_id,s.employee_id,s.event_type,s.title,s.event_date,'compliance_item',s.id,s.rules FROM source s
          WHERE NOT EXISTS (SELECT 1 FROM hr_calendar_events h WHERE h.source_record_type='compliance_item' AND h.source_record_id=s.id AND h.event_type=s.event_type) RETURNING id
        ) SELECT (SELECT count(*)::int FROM inserted) AS inserted,(SELECT count(*)::int FROM updated) AS updated
      `)[0];

      await tx`
        INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,business_head_id,after_data,reason)
        VALUES (${user.id},'calendar.generate','hr_calendar',${head||'all'},${head},${JSON.stringify(counts)}::jsonb,'Lifecycle and operations calendar synchronised')
      `;
      return counts;
    });
    return ok(summary);
  } catch (error) {
    return apiError(error);
  }
}
