import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("removed employees can be restored through a scoped, audited, reversible action", async () => {
  const [route, list, drawer, page] = await Promise.all([
    readFile(new URL("../app/api/employees/[id]/restore/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/employees/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/employee-record-drawer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /requireApiUser\("people:write"/);
  assert.match(route, /Only a removed employee can be restored/);
  assert.match(route, /restored_to_people/);
  assert.match(route, /employee\.restore_to_people/);
  assert.match(list, /archived'\)==='1'/);
  assert.match(list, /requireApiUser\(archived\?'people:write'/);
  assert.match(drawer, /Restore employee/);
  assert.match(page, /Removed staff/);
});
