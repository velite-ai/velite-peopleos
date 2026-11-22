import assert from "node:assert/strict";
import test from "node:test";
import { MOVES_WITH_PERSON } from "../lib/company-correction-rules.ts";
import { parseBulkGive, describeItems, eventFor, inStock, itemsCsv, itemsStillWithStaff, nextStatus, parseEdit, parseIssue, parseStatusChange, parseStockEntry, parseTypeName, stockCsv } from "../lib/staff-item-rules.ts";

const TYPE = "3b1f2c4e-5d6a-4b7c-8d9e-0a1b2c3d4e5f";
const TODAY = "2026-11-20";

test("giving an item: type, quantity, date and text are checked and cleaned", () => {
  const good = parseIssue({ itemTypeId: TYPE, details: "  Dell   Latitude \n 5420 ", quantity: "2", issuedOn: "2026-11-01", note: "" }, TODAY);
  assert.equal(good.ok, true);
  assert.deepEqual(good.value, { itemTypeId: TYPE, details: "Dell Latitude 5420", quantity: 2, issuedOn: "2026-11-01", note: null });
  assert.match(parseIssue({ itemTypeId: "x", quantity: 1, issuedOn: TODAY }, TODAY).message, /kind of item/i);
  for (const quantity of [0, -1, 1.5, 1000, "abc"]) assert.match(parseIssue({ itemTypeId: TYPE, quantity, issuedOn: TODAY }, TODAY).message, /Quantity/);
  assert.match(parseIssue({ itemTypeId: TYPE, quantity: 1, issuedOn: "2026-11-21" }, TODAY).message, /future/);
  assert.match(parseIssue({ itemTypeId: TYPE, quantity: 1, issuedOn: "2026-02-30" }, TODAY).message, /Enter the date/);
  assert.match(parseIssue({ itemTypeId: TYPE, quantity: 1, issuedOn: "1999-01-01" }, TODAY).message, /check the date/i);
  assert.equal(parseIssue({ itemTypeId: TYPE, quantity: 1, issuedOn: TODAY }, TODAY).value.quantity, 1);
});

test("status changes follow the allowed paths, including Damaged", () => {
  assert.equal(nextStatus("with_staff", "returned"), "returned");
  assert.equal(nextStatus("with_staff", "lost"), "lost");
  assert.equal(nextStatus("with_staff", "damaged"), "damaged");
  assert.equal(nextStatus("with_staff", "reopen"), null);
  assert.equal(nextStatus("damaged", "returned"), "returned"); // repaired and handed back
  assert.equal(nextStatus("damaged", "lost"), "lost");
  assert.equal(nextStatus("damaged", "reopen"), "with_staff");
  assert.equal(nextStatus("lost", "returned"), "returned"); // found
  assert.equal(nextStatus("lost", "damaged"), null);
  assert.equal(nextStatus("returned", "lost"), null);
  assert.equal(nextStatus("returned", "reopen"), "with_staff");
});

test("lost and damaged need a note; the date cannot be in the future or before the item was given", () => {
  const ok = parseStatusChange({ action: "damaged", note: "Screen broken" }, "with_staff", TODAY, "2026-10-01");
  assert.equal(ok.ok, true); assert.equal(ok.to, "damaged"); assert.deepEqual(ok.value, { action: "damaged", on: TODAY, note: "Screen broken" });
  assert.match(parseStatusChange({ action: "damaged", note: "" }, "with_staff", TODAY).message, /damaged/);
  assert.match(parseStatusChange({ action: "lost", note: "ab" }, "with_staff", TODAY).message, /lost/);
  assert.equal(parseStatusChange({ action: "returned" }, "with_staff", TODAY).ok, true);
  assert.match(parseStatusChange({ action: "returned", on: "2026-11-25" }, "with_staff", TODAY).message, /future/);
  assert.match(parseStatusChange({ action: "returned", on: "2026-09-01" }, "with_staff", TODAY, "2026-10-01").message, /before the item was given/);
  assert.match(parseStatusChange({ action: "lost", note: "gone" }, "returned", TODAY).message, /already/);
  assert.match(parseStatusChange({ action: "sell" }, "with_staff", TODAY).message, /what happened/i);
  assert.equal(parseStatusChange({ action: "reopen" }, "lost", TODAY).to, "with_staff");
  assert.equal(eventFor("reopen"), "reopened"); assert.equal(eventFor("damaged"), "damaged");
});

test("editing keeps the same checks as giving", () => {
  assert.equal(parseEdit({ details: "x", quantity: 3, issuedOn: "2026-11-02", note: "n" }, TODAY).ok, true);
  assert.match(parseEdit({ quantity: 0, issuedOn: TODAY }, TODAY).message, /Quantity/);
});

test("stock: returned items are back in stock; lost, damaged and with-staff are not", () => {
  assert.equal(inStock({ added: 50, removed: 0, withStaff: 30, lost: 0, damaged: 0 }), 20);
  assert.equal(inStock({ added: 50, removed: 5, withStaff: 30, lost: 2, damaged: 3 }), 10);
  assert.equal(inStock({ added: 0, removed: 0, withStaff: 2, lost: 0, damaged: 0 }), -2); // given before stock was entered: shown as negative, not hidden
});

test("stock entries: quantity and date are checked; taking stock out needs a reason", () => {
  assert.equal(parseStockEntry({ entryType: "added", quantity: "10", entryOn: TODAY, note: "Bill 45" }, TODAY).ok, true);
  assert.match(parseStockEntry({ entryType: "gift", quantity: 1, entryOn: TODAY }, TODAY).message, /added or taken out/);
  assert.match(parseStockEntry({ entryType: "added", quantity: 0, entryOn: TODAY }, TODAY).message, /Quantity/);
  assert.match(parseStockEntry({ entryType: "added", quantity: 1, entryOn: "2026-12-01" }, TODAY).message, /future/);
  assert.match(parseStockEntry({ entryType: "removed", quantity: 1, entryOn: TODAY, note: "" }, TODAY).message, /why/i);
  assert.equal(parseStockEntry({ entryType: "removed", quantity: 1, entryOn: TODAY, note: "Scrapped" }, TODAY).ok, true);
});

test("item type names", () => {
  assert.deepEqual(parseTypeName("  Safety   helmet "), { ok: true, name: "Safety helmet" });
  assert.equal(parseTypeName("a").ok, false);
  assert.equal(parseTypeName(undefined).ok, false);
  assert.equal(parseTypeName("x".repeat(200)).name.length, 60);
});

test("what a person still holds, written for the exit warning", () => {
  const items = [{ status: "with_staff", type_name: "Laptop", details: "Dell 5420", quantity: 1 }, { status: "with_staff", type_name: "SIM card", quantity: 2 }, { status: "returned", type_name: "Lab coat", quantity: 1 }, { status: "damaged", type_name: "Phone", quantity: 1 }];
  const holding = itemsStillWithStaff(items);
  assert.equal(holding.length, 2);
  assert.equal(describeItems(holding), "Laptop (Dell 5420), SIM card x2");
});

test("CSV downloads: BOM, header, status words, formulas made safe", () => {
  const csv = itemsCsv([{ employee_code: "VEL-1", employee_name: "A, B", business_head: "Velite Healthcare", type_name: "Laptop", details: "=cmd()", quantity: 1, issued_on: "2026-11-01T00:00:00Z", status: "damaged", status_on: "2026-11-10", note: "Screen \"cracked\"" }]);
  assert.ok(csv.startsWith("﻿Staff code,Name,Company,Item,Details,Quantity,Given on,Status,Status date,Note"));
  assert.match(csv, /"A, B"/); assert.match(csv, /'=cmd\(\)/); assert.match(csv, /,Damaged,2026-11-10,/); assert.match(csv, /"Screen ""cracked"""/);
  const stock = stockCsv([{ business_head: "Velite India", type_name: "Laptop", added: 10, removed: 1, withStaff: 5, lost: 1, damaged: 1 }]);
  assert.match(stock, /Velite India,Laptop,10,1,5,1,1,2/);
});

test("changing a person's company is not blocked by their company items: the items move with them", () => {
  assert.ok("staff_items" in MOVES_WITH_PERSON);
});

test("giving one item to many people: the people list and the item are both checked", () => {
  const other = "4c2d3e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";
  const good = parseBulkGive({ employeeIds: [TYPE, other, TYPE], itemTypeId: TYPE, quantity: 2, issuedOn: TODAY, details: "Size M" }, TODAY);
  assert.equal(good.ok, true); assert.deepEqual(good.employeeIds, [TYPE, other]); assert.equal(good.value.quantity, 2);
  assert.match(parseBulkGive({ employeeIds: [], itemTypeId: TYPE, quantity: 1, issuedOn: TODAY }, TODAY).message, /at least one/);
  assert.match(parseBulkGive({ itemTypeId: TYPE, quantity: 1, issuedOn: TODAY }, TODAY).message, /at least one/);
  assert.match(parseBulkGive({ employeeIds: ["nope"], itemTypeId: TYPE, quantity: 1, issuedOn: TODAY }, TODAY).message, /not valid/);
  assert.match(parseBulkGive({ employeeIds: Array.from({ length: 201 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`), itemTypeId: TYPE, quantity: 1, issuedOn: TODAY }, TODAY).message, /200/);
  assert.match(parseBulkGive({ employeeIds: [TYPE], itemTypeId: TYPE, quantity: 0, issuedOn: TODAY }, TODAY).message, /Quantity/);
});
