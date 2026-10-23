import assert from "node:assert/strict";
import test from "node:test";
import { cleanName, deleteBlockers, departmentCode, movedCount, sameName } from "../lib/department-rules.ts";

const none = { employees: 0, candidates: 0, costCentres: 0, jobPositions: 0, requisitions: 0, loginsLimitedToIt: 0, appraisalCycles: 0, calibrationSessions: 0, subDepartments: 0 };

test("names are tidied and compared without caring about case or extra spaces", () => {
  assert.equal(cleanName("  Quality   Assurance "), "Quality Assurance");
  assert.equal(sameName("quality  assurance", "Quality Assurance"), true);
  assert.equal(sameName("Quality", "Quality Control"), false);
});

test("a department code comes from its name, stays short, and never repeats inside a company", () => {
  assert.equal(departmentCode("Quality Assurance", []), "QUALITY_ASSURANCE");
  assert.equal(departmentCode("Accounts & Finance", []), "ACCOUNTS_FINANCE");
  assert.equal(departmentCode("Dispatch", ["DISPATCH"]), "DISPATCH_2");
  assert.equal(departmentCode("dispatch", ["DISPATCH", "DISPATCH_2"]), "DISPATCH_3");
  assert.equal(departmentCode("A", []), "DEPT");
  assert.equal(departmentCode("हिंदी", []), "DEPT");
  assert.ok(departmentCode("A very long department name that goes on and on", []).length <= 30);
});

test("deleting is blocked for sub-departments, limited logins and appraisal cycles, with plain reasons", () => {
  assert.deepEqual(deleteBlockers(none, false), []);
  assert.match(deleteBlockers({ ...none, subDepartments: 2 }, false)[0], /sub-department/);
  assert.match(deleteBlockers({ ...none, loginsLimitedToIt: 1 }, false)[0], /login/);
  assert.match(deleteBlockers({ ...none, appraisalCycles: 1 }, false)[0], /Appraisal/);
});

test("open job requisitions need a department to move to; people alone can move to no department", () => {
  assert.equal(deleteBlockers({ ...none, requisitions: 1 }, false).length, 1);
  assert.deepEqual(deleteBlockers({ ...none, requisitions: 1 }, true), []);
  assert.deepEqual(deleteBlockers({ ...none, employees: 5 }, false), []);
  assert.equal(movedCount({ ...none, employees: 5, candidates: 2, jobPositions: 1 }), 8);
});
