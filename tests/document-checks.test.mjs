import assert from "node:assert/strict";
import { deflateRawSync, crc32 } from "node:zlib";
import test from "node:test";
import { BASIC_ENGINE, checkDocument } from "../lib/document-checks.mjs";

const bytes = text => new Uint8Array(Buffer.from(text, "latin1"));
const pdf = body => bytes(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n${body}\n%%EOF\n`);
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

// A small zip file with the given entry names (stored, not compressed), enough for the central-directory check.
function zip(names) {
  const parts = []; const central = []; let offset = 0;
  for (const name of names) {
    const data = Buffer.from("x"); const nameBytes = Buffer.from(name); const crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(1, 18); local.writeUInt32LE(1, 22); local.writeUInt16LE(nameBytes.length, 26);
    parts.push(local, nameBytes, data);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(1, 20); entry.writeUInt32LE(1, 24); entry.writeUInt16LE(nameBytes.length, 28); entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes); offset += 30 + nameBytes.length + 1;
  }
  const directory = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, directory, end]));
}

test("ordinary PDFs, pictures and Word files pass", () => {
  assert.equal(checkDocument({ bytes: pdf("") }).clean, true);
  assert.equal(checkDocument({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]) }).clean, true);
  assert.equal(checkDocument({ bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]) }).clean, true);
  assert.equal(checkDocument({ bytes: bytes("RIFF\0\0\0\0WEBPVP8 ") }).clean, true);
  assert.equal(checkDocument({ bytes: zip(["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/media/image1.png"]) }).clean, true);
  const old = new Uint8Array(Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.from("WordDocument 1Table SummaryInformation")]));
  assert.equal(checkDocument({ bytes: old }).clean, true);
  const verdict = checkDocument({ bytes: pdf("") });
  assert.equal(verdict.engine, BASIC_ENGINE); assert.match(verdict.note, /not an antivirus/); assert.deepEqual(verdict.reasons, []);
});

test("a big scanned PDF is not blocked by chance bytes in its pictures", () => {
  const noise = Buffer.alloc(4_000_000); for (let index = 0; index < noise.length; index += 3) { noise[index] = 0x2f; noise[index + 1] = 0x4a; noise[index + 2] = 0x53; } // "/JS" everywhere
  assert.equal(checkDocument({ bytes: new Uint8Array(Buffer.concat([Buffer.from("%PDF-1.4\n"), noise, Buffer.from("\n%%EOF\n")])) }).clean, true);
});

test("the standard antivirus test file is caught, whatever file it hides in", () => {
  for (const file of [pdf(EICAR), bytes(`${EICAR}`)]) { const verdict = checkDocument({ bytes: file }); assert.equal(verdict.clean, false); assert.match(verdict.reasons.join(" "), /EICAR/); }
  assert.equal(checkDocument({ bytes: new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(EICAR)])) }).clean, false);
});

test("PDFs with scripts, launch actions or attached files are blocked", () => {
  for (const action of ["/S /JavaScript /JS (app.alert(1))", "<< /S /Launch /F (cmd.exe) >>", "/Type /EmbeddedFile", "/RichMedia", "/XFA [ ]"]) {
    const verdict = checkDocument({ bytes: pdf(action) });
    assert.equal(verdict.clean, false, action); assert.match(verdict.reasons[0], /hidden action/);
  }
});

test("files that are not PDFs, pictures or Word documents are blocked", () => {
  for (const file of [bytes("MZ\x90\0 program"), bytes("#!/bin/sh\nrm -rf /"), bytes("plain text"), bytes("\x7fELF....")]) { const verdict = checkDocument({ bytes: file }); assert.equal(verdict.clean, false); assert.match(verdict.reasons.join(" "), /not a PDF/); }
});

test("Word files with macros or programs, and other zip files, are blocked", () => {
  assert.match(checkDocument({ bytes: zip(["word/document.xml", "word/vbaProject.bin"]) }).reasons.join(" "), /macros/);
  assert.match(checkDocument({ bytes: zip(["word/document.xml", "word/embeddings/setup.exe"]) }).reasons.join(" "), /program file/);
  assert.match(checkDocument({ bytes: zip(["a.txt", "b.txt"]) }).reasons.join(" "), /not a Word document/);
  assert.match(checkDocument({ bytes: bytes("PK\x03\x04 broken") }).reasons.join(" "), /damaged/);
  const doc = new Uint8Array(Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), Buffer.from("_VBA_PROJECT_CUR", "utf16le")]));
  assert.match(checkDocument({ bytes: doc }).reasons.join(" "), /macros/);
});

test("pictures hiding program code are blocked", () => {
  const verdict = checkDocument({ bytes: new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("<?php system($_GET[1]); ?>")])) });
  assert.equal(verdict.clean, false); assert.match(verdict.reasons[0], /program code/);
});

test("the upload, the worker and the screen all use the same checks", async () => {
  const { readFile } = await import("node:fs/promises"); const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  assert.match(await read("lib/malware-scan.ts"), /checkDocument\(\{bytes:data\}\)/);
  assert.match(await read("lib/malware-scan.ts"), /if\(!endpoint\)return basicChecks\(objectKey,bytes\)/);
  assert.match(await read("scripts/worker.mjs"), /import \{ checkDocument \} from "\.\.\/lib\/document-checks\.mjs"/);
  assert.match(await read("scripts/worker.mjs"), /endpoint \? processScan\(item, endpoint\) : processBasicScan\(item\)/);
  assert.match(await read("app/api/employees/[id]/documents/route.ts"), /scanObject\(objectKey, file\.name, contentType, bytes\)/);
  assert.match(await read("components/employee-record-drawer.tsx"), /Upload a clean copy instead/);
});
