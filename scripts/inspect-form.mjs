// Inspect a bank's fillable PDF and report every AcroForm field.
//
// WHY: an AcroForm filler is only as good as the field mapping behind it, and
// hand-mapping ~250 fields per form across ~80 forms is not viable. This tool
// dumps the complete field inventory — names, types, radio export codes and
// dropdown OPTION LISTS — so the mapping can be generated rather than typed.
// A filled sample form is the ideal input: the field list is identical to a
// blank one, and the pre-filled values additionally show the real value shapes
// the bank expects (e.g. "784-1976-5729651-9" for an Emirates ID).
//
//   node scripts/inspect-form.mjs "<form.pdf>"            # human-readable
//   node scripts/inspect-form.mjs "<form.pdf>" --json out.json
//
// Read-only: it never writes into the PDF and only creates the file you ask
// for with --json.

import fs from "node:fs";
import { PDFDocument } from "pdf-lib";

const [, , fileArg, ...flags] = process.argv;
if (!fileArg) {
  console.error('usage: node scripts/inspect-form.mjs "<form.pdf>" [--json out.json]');
  process.exit(1);
}
const jsonOut = flags.includes("--json") ? flags[flags.indexOf("--json") + 1] : null;

const KEY_VALUE = (f) => {
  try {
    if (typeof f.getText === "function") return String(f.getText() ?? "");
    if (typeof f.getOnValue === "function") return f.getOnValue() ? "ON" : "off";
    if (typeof f.getSelected === "function") return JSON.stringify(f.getSelected() ?? []);
  } catch {
    return "<err>";
  }
  return "";
};

const optionsOf = (f) => {
  try {
    if (typeof f.getOptions === "function") return f.getOptions();
  } catch { /* not a dropdown */ }
  return null;
};

const radioCodes = (f) => {
  try {
    if (typeof f.getOptions === "function") {
      return f.getOptions().map((o) => (typeof o === "string" ? o : o.exportValue));
    }
  } catch { /* not a radio group */ }
  return null;
};

const bytes = fs.readFileSync(fileArg);
const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });

const out = {
  file: fileArg,
  sizeBytes: bytes.length,
  pages: doc.getPageCount(),
  flattened: false,
  fields: [],
};

let form = null;
try { form = doc.getForm(); } catch { form = null; }
if (!form) out.flattened = true;

const raw = form ? form.getFields() : [];
out.fieldCount = raw.length;
if (!raw.length && form) out.flattened = true;

for (const f of raw) {
  const type = f.constructor.name.replace(/^PDF/, "");
  out.fields.push({
    name: f.getName(),
    type,
    value: KEY_VALUE(f),
    readOnly: typeof f.isReadOnly === "function" ? f.isReadOnly() : null,
    required: typeof f.isRequired === "function" ? f.isRequired() : null,
    // Dropdown option list / radio export codes. Without these a mapping cannot
    // be written at all — "Education = 2" is meaningless without knowing what 2 is.
    options: type === "Dropdown" ? optionsOf(f) : null,
    radioCodes: type === "RadioGroup" ? radioCodes(f) : null,
  });
}

const byType = {};
for (const f of out.fields) byType[f.type] = (byType[f.type] || 0) + 1;
out.byType = byType;

if (out.flattened) {
  console.log(`${fileArg}`);
  console.log(`  ${(bytes.length / 1024 / 1024).toFixed(2)} MB · ${out.pages} pages`);
  console.log("");
  console.log("VERDICT: NO live form fields (flattened, or a scan).");
  console.log("An AcroForm filler cannot fill this file. It would need to be laid out from scratch instead.");
} else {
  console.log(`${fileArg}`);
  console.log(`  ${(bytes.length / 1024 / 1024).toFixed(2)} MB · ${out.pages} pages · ${out.fieldCount} live fields`);
  console.log(`  types: ${JSON.stringify(byType)}`);
  const filled = out.fields.filter((f) => f.value && f.value !== "off" && f.value !== "[]").length;
  console.log(`  already carrying a value: ${filled} / ${out.fieldCount}`);
  const readable = out.fields.filter((f) => /[A-Za-z]{4,}/.test(f.name) && !/^Page\d+\./.test(f.name)).length;
  console.log(`  readable names: ${readable} · machine names: ${out.fieldCount - readable}`);
  console.log("");
  for (const f of out.fields) {
    const extras = [];
    if (f.radioCodes) extras.push(`codes=[${f.radioCodes.join("|")}]`);
    if (f.options) extras.push(`options=[${f.options.join("|")}]`);
    console.log(
      `  ${f.type.padEnd(11)} ${f.name}${f.value ? ` = ${f.value}` : ""}` +
        (extras.length ? `\n              ${extras[0].slice(0, 150)}` : ""),
    );
  }
}

if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify(out, null, 2));
  console.log("");
  console.log(`inventory written: ${jsonOut}`);
}
