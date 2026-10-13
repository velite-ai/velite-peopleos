import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("a real photo can be clicked to see it large, in the staff list and in the staff record", async () => {
  const photo = await read("components/employee-photo.tsx");
  assert.match(photo, /Click to enlarge/);
  assert.match(photo, /createPortal/); // drawn above the record panel
  assert.match(photo, /event\.stopPropagation\(\)/); // does not also open the record when clicked in the list
  assert.match(photo, /key === "Escape"/);
  assert.match(photo, /showing \?/); // only when there is a photo (initials are not clickable)
  const list = await read("app/page.tsx");
  assert.match(list, /<EmployeePhoto id=\{p\.id\}[^>]*name=\{nice\(p\.name\)\}/);
  const record = await read("components/employee-record-drawer.tsx");
  assert.match(record, /<EmployeePhoto id=\{person\.id\}[^>]*name=\{person\.name\} keyboard/);
});

test("the large photo is sized to fit the screen and sits above everything else", async () => {
  const css = await read("app/globals.css");
  assert.match(css, /\.photo-lightbox\{[^}]*z-index:2000/);
  assert.match(css, /\.photo-lightbox img\{[^}]*max-height:78vh/);
  assert.match(css, /\.photo-lightbox img\{[^}]*object-fit:contain/);
});
