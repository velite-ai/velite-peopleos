// Basic safety checks for uploaded documents, used when no antivirus scanner (MALWARE_SCAN_URL) is configured.
// This is NOT an antivirus. It makes sure a file really is a PDF, JPG, PNG, WebP or Word document, and blocks the usual ways such files
// carry programs: scripts and launch actions inside PDFs, macros and programs inside Word files, and the standard antivirus test file.
// Plain JavaScript so that both the app and the background worker (scripts/worker.mjs) use the very same code.

export const BASIC_ENGINE = "velite-basic-checks";
export const BASIC_NOTE = "Basic file checks, not an antivirus scan";

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const PROGRAM_FILES = /\.(exe|dll|scr|com|bat|cmd|js|jse|vbs|vbe|wsf|ps1|jar|hta|lnk|msi|sh)$/i;
// ("/JS" alone is left out on purpose: three bytes turn up by chance inside the compressed pictures of a large scanned PDF. Every script action also carries "/JavaScript".)
const PDF_ACTIONS = /\/(JavaScript|Launch|EmbeddedFile|RichMedia|XFA)(?![A-Za-z0-9])/;

/** @param {Uint8Array} bytes */
export function sniffDocument(bytes) {
  const ascii = (from, to) => String.fromCharCode(...bytes.slice(from, to));
  if (ascii(0, 4) === "%PDF") return "pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image";
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "docx";
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return "doc";
  return null;
}

// Names of the files inside a .docx (a zip file), read from its central directory. Returns null when the zip cannot be read.
function zipEntryNames(buffer) {
  const lowest = Math.max(0, buffer.length - 65557);
  let end = -1;
  for (let index = buffer.length - 22; index >= lowest; index--) if (buffer.readUInt32LE(index) === 0x06054b50) { end = index; break; }
  if (end < 0) return null;
  const count = buffer.readUInt16LE(end + 10); let offset = buffer.readUInt32LE(end + 16);
  const names = [];
  for (let entry = 0; entry < count; entry++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) return null;
    const nameLength = buffer.readUInt16LE(offset + 28); const extraLength = buffer.readUInt16LE(offset + 30); const commentLength = buffer.readUInt16LE(offset + 32);
    if (offset + 46 + nameLength > buffer.length) return null;
    names.push(buffer.toString("latin1", offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

/**
 * @param {{ bytes: Uint8Array }} input
 * @returns {{ clean: boolean, engine: string, reasons: string[], checked: string[], note: string }}
 */
export function checkDocument({ bytes }) {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const reasons = [];
  const checked = ["the file is really a PDF, picture or Word document", "the standard antivirus test file", "scripts, launch actions and macros inside the file"];
  const kind = sniffDocument(bytes);

  if (buffer.includes(EICAR, 0, "latin1")) reasons.push("It contains the standard antivirus test signature (EICAR).");
  if (!kind) reasons.push("It is not a PDF, JPG, PNG, WebP or Word document.");

  if (kind === "pdf") {
    const match = PDF_ACTIONS.exec(buffer.toString("latin1"));
    if (match) reasons.push(`The PDF contains a hidden action (/${match[1]}) such as a script, a program launch or an attached file.`);
  } else if (kind === "image") {
    const text = buffer.toString("latin1");
    if (/<\?php|<script/i.test(text)) reasons.push("The picture contains hidden program code.");
  } else if (kind === "docx") {
    const names = zipEntryNames(buffer);
    if (!names) reasons.push("The Word file is damaged or is not a real Word document.");
    else {
      if (!names.includes("word/document.xml")) reasons.push("It is a compressed file, not a Word document.");
      if (names.some(name => /vbaProject\.bin$/i.test(name))) reasons.push("The Word file contains macros.");
      const program = names.find(name => PROGRAM_FILES.test(name));
      if (program) reasons.push(`The Word file contains a program file (${program}).`);
    }
  } else if (kind === "doc") {
    if (buffer.includes("_VBA_PROJECT", 0, "latin1") || buffer.includes("_VBA_PROJECT", 0, "utf16le")) reasons.push("The Word file contains macros.");
  }

  return { clean: reasons.length === 0, engine: BASIC_ENGINE, reasons, checked, note: BASIC_NOTE };
}
