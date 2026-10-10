import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the attendance list can only show the day and company named on the screen", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  // The list used to be overwritten by the app-wide reload of TODAY's attendance whenever the company changed,
  // so a Sunday's date could be shown next to today's statuses.
  assert.doesNotMatch(page, /useEffect\(\(\)=>\{setRows\(initialRows\)\},\[initialRows\]\)/);
  assert.match(page, /const loading=loadedKey!==viewKey/);
  assert.match(page, /const rows=loading\?\[\]:rowsState/);
  assert.match(page, /setLoadedKey\(`\$\{day\}\|\$\{businessHeadId\}`\)/);
  assert.match(page, /return\(\)=>\{current=false\}/);
  assert.match(page, /Loading attendance for \{day\}/);
});

test("today is the date in India, not the UTC date", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const istToday = \(\) => new Intl\.DateTimeFormat\("en-CA", \{ timeZone: "Asia\/Kolkata" \}\)/);
  assert.doesNotMatch(page, /new Date\(\)\.toISOString\(\)\.slice\(0,10\)/);
});
