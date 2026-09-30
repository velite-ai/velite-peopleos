import { z } from "zod";
import { db } from "@/lib/database";
import { apiError, fail, ok } from "@/lib/api";
import { hashPassword } from "@/lib/password";

const schema = z.object({ setupKey: z.string().min(16), email: z.email(), fullName: z.string().min(2).max(120), password: z.string().min(12).max(128) });

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    if (!process.env.SETUP_KEY || body.setupKey !== process.env.SETUP_KEY) return fail("Invalid setup key", 403);
    const sql = db();
    const existing = await sql`SELECT 1 FROM users LIMIT 1`;
    if (existing.length) return fail("Initial setup has already been completed", 409);
    const hash = await hashPassword(body.password);
    await sql.begin(async tx => {
      const [role] = await tx<{ id: string }[]>`
        INSERT INTO roles (code, name, permissions) VALUES ('SUPER_ADMIN', 'Super Administrator', '["*"]'::jsonb)
        ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id
      `;
      const [user] = await tx<{ id: string }[]>`
        INSERT INTO users (email, password_hash, full_name, mfa_required)
        VALUES (${body.email.toLowerCase()}, ${hash}, ${body.fullName}, false) RETURNING id
      `;
      await tx`INSERT INTO user_roles (user_id, role_id, business_head_id, department_id) VALUES (${user.id}, ${role.id}, NULL, NULL)`;
      const defaults=[
        {code:'EARNED_BASIC',name:'Earned basic',category:'earning',priority:20,formula:{multiply:[{divide:[{var:'MONTHLY_BASIC'},{var:'DIVISOR_DAYS'}]},{var:'PAYABLE_DAYS'}]}},
        {code:'EARNED_ALLOWANCES',name:'Earned allowances',category:'earning',priority:30,formula:{multiply:[{divide:[{var:'MONTHLY_ALLOWANCES'},{var:'DIVISOR_DAYS'}]},{var:'PAYABLE_DAYS'}]}},
        {code:'OVERTIME_PAY',name:'Overtime pay',category:'earning',priority:40,formula:{multiply:[{var:'OVERTIME_HOURS'},{var:'OVERTIME_RATE'}]}},
        {code:'ADVANCE_RECOVERY',name:'Advance adjusted',category:'deduction',priority:100,formula:{min:[{var:'ADVANCE_ADJUSTED'},{var:'ADVANCE_BALANCE'}]}},
        {code:'OTHER_DEDUCTIONS',name:'Other deductions',category:'deduction',priority:110,formula:{var:'OTHER_DEDUCTIONS_INPUT'}},
      ];
      for(const item of defaults){const [component]=await tx<{id:string}[]>`INSERT INTO salary_components (code,name,category) VALUES (${item.code},${item.name},${item.category}) ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name RETURNING id`;await tx`INSERT INTO payroll_rules (code,name,component_id,version,priority,formula,effective_from,status,change_reason,created_by,approved_by) VALUES (${item.code},${item.name},${component.id},1,${item.priority},${JSON.stringify(item.formula)}::jsonb,'2000-01-01','approved','Secure installation defaults',${user.id},${user.id}) ON CONFLICT (code,version) DO NOTHING`;}
      await tx`INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, after_data, reason) VALUES (${user.id}, 'system.bootstrap', 'user', ${user.id}, ${JSON.stringify({ email: body.email })}::jsonb, 'Initial secure setup')`;
    });
    return ok({ created: true }, { status: 201 });
  } catch (error) { return apiError(error); }
}
