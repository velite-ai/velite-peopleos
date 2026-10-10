import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the attendance cards account for weekly off and holiday days", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /const dayOff=rows\.filter\(row=>\['weekly_off','holiday'\]\.includes\(rawStatus\(row\)\)\)\.length/);
  assert.match(page, /label="OFF \/ HOLIDAY" value=\{String\(dayOff\)\}/);
  assert.match(page, /className="metrics compact five"/);
  assert.match(css, /\.metrics\.five\{grid-template-columns:repeat\(5,1fr\)\}/);
});
