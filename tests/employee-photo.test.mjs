import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("employee photos are validated, scoped, audited and shown in list and record", async () => {
  const [route, drawer, page, migration] = await Promise.all([
    readFile(new URL("../app/api/employees/[id]/photo/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/employee-record-drawer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../database/022_employee_photos.sql", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /photo_object_key/);
  assert.match(route, /requireApiUser\("people:write"/);
  assert.match(route, /requireApiUser\("people:read"/);
  assert.match(route, /Use a JPG, PNG or WebP photo/);
  assert.match(route, /employee\.photo_update/);
  assert.match(drawer, /Add photo/);
  assert.match(page, /<EmployeePhoto id=\{p\.id\}/);
});
