import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { giftTotal, isUnrestrictedSuperAdmin } from "../lib/diwali-gift-rules.ts";

const role = (code, businessHeadId = null, departmentId = null) => ({ code, businessHeadId, departmentId });

test("only an unrestricted Super Administrator signed in as a person may use the gift register", () => {
  assert.equal(isUnrestrictedSuperAdmin({ roles: [role("SUPER_ADMIN")] }), true);
  assert.equal(isUnrestrictedSuperAdmin({ roles: [role("HR_ADMIN"), role("SUPER_ADMIN")] }), true);
  assert.equal(isUnrestrictedSuperAdmin({ roles: [role("SUPER_ADMIN", "bh-1")] }), false);
  assert.equal(isUnrestrictedSuperAdmin({ roles: [role("SUPER_ADMIN", null, "dept-1")] }), false);
  for (const code of ["HR_ADMIN", "HR_OPERATIONS", "PAYROLL_ADMIN", "FINANCE_APPROVER", "AUDITOR", "LEADERSHIP", "MANAGER", "EMPLOYEE"]) {
    assert.equal(isUnrestrictedSuperAdmin({ roles: [role(code)] }), false, code);
  }
  assert.equal(isUnrestrictedSuperAdmin({ apiKeyId: "key-1", roles: [role("SUPER_ADMIN")] }), false);
  assert.equal(isUnrestrictedSuperAdmin({ roles: [] }), false);
  assert.equal(isUnrestrictedSuperAdmin({}), false);
  assert.equal(isUnrestrictedSuperAdmin(null), false);
});

test("gift totals are worked out to the paisa", () => {
  assert.equal(giftTotal(3, 499.99), 1499.97);
  assert.equal(giftTotal(10, 0.1), 1);
  assert.equal(giftTotal(1, 0), 0);
});

test("every gift route checks for a Super Administrator, and nothing leaks into shared logs or search", async () => {
  const base = new URL("../app/api/diwali-gifts/", import.meta.url);
  const files = [new URL("route.ts", base), new URL("[id]/route.ts", base)];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const handlers = source.split(/export async function /).slice(1);
    assert.ok(handlers.length >= 2);
    for (const handler of handlers) assert.match(handler, /await requireSuperAdmin\(\)/, `${file.pathname}: ${handler.slice(0, 20)}`);
    assert.doesNotMatch(source, /audit_events/);
  }
  const lib = await readFile(new URL("../lib/diwali-gifts.ts", import.meta.url), "utf8");
  assert.match(lib, /isUnrestrictedSuperAdmin/);
  assert.match(lib, /fail\("Not found", 404\)/);
  assert.doesNotMatch(lib, /audit_events/);
  const migration = await readFile(new URL("../database/023_diwali_gifts.sql", import.meta.url), "utf8");
  assert.match(migration, /details_encrypted bytea NOT NULL/);
  const columns = migration.replace(/--.*$/gm, "");
  for (const name of ["recipient", "gift_item", "unit_value", "total_value", "vendor", "bill_no", "employee_id", "notes"]) assert.doesNotMatch(columns, new RegExp(name), `${name} must live inside the encrypted details`);
  // Nothing outside the gift files reads the gift tables.
  const roots = ["../app/", "../lib/", "../components/"];
  const walk = async dir => (await readdir(dir, { withFileTypes: true })).flatMap(entry => entry.isDirectory() ? [walk(new URL(`${entry.name}/`, dir))] : [Promise.resolve([new URL(entry.name, dir)])]);
  for (const root of roots) {
    for (const group of await Promise.all(await walk(new URL(root, import.meta.url)))) {
      for (const file of group) {
        if (!/\.(ts|tsx)$/.test(file.pathname) || /diwali/i.test(file.pathname)) continue;
        assert.doesNotMatch(await readFile(file, "utf8"), /diwali_gift/, file.pathname);
      }
    }
  }
});
