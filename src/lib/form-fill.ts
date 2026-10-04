// Fill a bank's AcroForm from a case's resolved data.
//
// WHY THIS IS SMALL: the bank has already decided its own layout, so there is no
// positioning to compute. We only set field VALUES, and the "same data, different
// format" problem is entirely handled by the format column in the registry.
//
// THREE SAFETY RULES, in order of importance:
//
// 1. PROTECTED FIELDS ARE NEVER WRITTEN. Legal declarations (credit default,
//    bankruptcy, criminal case) and consents. They are the applicant's word about
//    themselves; writing "No" on their behalf is a misrepresentation. They are
//    reported as "must answer", never filled.
// 2. STAFF-USE FIELDS ARE NEVER WRITTEN. The bank's own HFA_Name / Form_Validated
//    / Missing_Fields are filled by bank staff, not by us.
// 3. A FIELD THAT VANISHED IS REPORTED, NOT IGNORED. Banks revise their forms. If
//    the template no longer has a field the mapping names, the result carries a
//    `staleFields` list so the UI can say "this template is out of date" instead
//    of quietly producing a half-filled PDF.
//
// A BLANK IS A NORMAL OUTCOME, not a failure. The brief was explicitly "70%
// filled is a win" — the report at the end is what tells the broker what is
// still missing so they can finish by hand.

import { PDFDocument } from "pdf-lib";
import { FIELD_LOOKUP, type CanonicalField } from "./form-fields";
import { applyFormat, readPath, type ProposedMapping } from "./form-map";
import type { FormDataBag } from "./form-data";

export interface FieldReport {
  field: string;
  status: "filled" | "blank-no-data" | "skipped-protected" | "skipped-staff" | "not-in-template" | "type-mismatch";
  value?: string;
}

export interface FillResult {
  bytes: Uint8Array;
  filled: number;
  /** Fields the mapping knows about that this template no longer has. */
  staleFields: string[];
  /** Protected fields deliberately left blank — the applicant must answer. */
  mustAnswer: string[];
  report: FieldReport[];
}

export async function fillFormPdf(
  templateBytes: Uint8Array,
  data: FormDataBag,
  mappings: ProposedMapping[],
  opts: { flatten?: boolean } = {},
): Promise<FillResult> {
  const doc = await PDFDocument.load(templateBytes, { ignoreEncryption: true, updateMetadata: false });
  const form = doc.getForm();
  const byName = new Map(form.getFields().map((f) => [f.getName(), f]));

  const report: FieldReport[] = [];
  const staleFields: string[] = [];
  const mustAnswer: string[] = [];
  let filled = 0;

  for (const m of mappings) {
    // 1 + 2 — never written, always reported.
    if (m.protected) {
      mustAnswer.push(m.field);
      report.push({ field: m.field, status: "skipped-protected" });
      continue;
    }
    if (m.staffOnly) {
      report.push({ field: m.field, status: "skipped-staff" });
      continue;
    }

    const target = byName.get(m.field);
    if (!target) {
      // 3 — the template changed shape under us.
      staleFields.push(m.field);
      report.push({ field: m.field, status: "not-in-template" });
      continue;
    }

    // FIELD_LOOKUP is keyed LOWERCASE (canonical key AND aliases). Looking it up
    // with the raw camelCase key silently missed every field whose key is
    // camelCase — eidNo, salary, totalIncome, loanAmount and so on — which
    // reported as "we don't hold that data" when the truth was a lookup miss.
    const field: CanonicalField | undefined =
      m.canonicalKey ? FIELD_LOOKUP.get(m.canonicalKey.toLowerCase()) : undefined;
    if (!field || !field.source) {
      report.push({ field: m.field, status: "blank-no-data" });
      continue;
    }

    const value = applyFormat(readPath(data as unknown as Record<string, unknown>, field.source), m.format);
    if (!value) {
      report.push({ field: m.field, status: "blank-no-data" });
      continue;
    }

    try {
      const type = target.constructor.name;
      if (type === "PDFTextField") {
        (target as unknown as { setText(v: string): void }).setText(value);
      } else if (type === "PDFCheckBox") {
        // Only a genuine yes/no, never inferred from a non-boolean source.
        if (value === "Yes" || value === "true") {
          (target as unknown as { check(): void }).check();
        }
      } else if (type === "PDFDropdown") {
        const opts = (target as unknown as { getOptions(): string[] }).getOptions();
        const hit = opts.find((o) => o.toLowerCase() === value.toLowerCase());
        if (hit) (target as unknown as { select(v: string): void }).select(hit);
        else { report.push({ field: m.field, status: "type-mismatch", value }); continue; }
      } else if (type === "PDFRadioGroup") {
        const codes = (target as unknown as { getOptions(): { exportValue: string }[] }).getOptions();
        const hit = codes.find((c) => c.exportValue.toLowerCase() === value.toLowerCase());
        if (hit) (target as unknown as { select(v: string): void }).select(hit.exportValue);
        else { report.push({ field: m.field, status: "type-mismatch", value }); continue; }
      } else {
        report.push({ field: m.field, status: "type-mismatch", value });
        continue;
      }
      filled++;
      report.push({ field: m.field, status: "filled", value });
    } catch {
      report.push({ field: m.field, status: "type-mismatch", value });
    }
  }

  // Bake the values in so the applicant cannot accidentally edit what we filled,
  // and so every PDF viewer shows the same thing.
  if (opts.flatten !== false) {
    try { form.flatten(); } catch { /* some fields refuse to flatten; the values are still set */ }
  }

  return { bytes: await doc.save(), filled, staleFields, mustAnswer, report };
}
