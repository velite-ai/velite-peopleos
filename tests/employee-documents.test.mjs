import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("employee documents are validated, scoped, scanned, audited and listed in the record", async () => {
  const [route, list, drawer] = await Promise.all([
    readFile(new URL("../app/api/employees/[id]/documents/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/documents/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/employee-record-drawer.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /requireApiUser\("documents:write"/);
  assert.match(route, /Use a PDF, Word document, JPG, PNG or WebP file/);
  assert.match(route, /scanObject\(/);
  assert.match(route, /document\.upload/);
  assert.match(list, /scan_status/);
  assert.match(drawer, /tab === "documents"/);
  assert.match(drawer, /\/api\/documents\/\$\{doc\.id\}\/download/);
});
