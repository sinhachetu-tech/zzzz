// Mapping a bank's AcroForm fields onto the canonical registry, and resolving a
// case's data into the values that fill them.
//
// THE POINT: with ~20 banks × 3-4 forms, hand-mapping 250 fields per form is
// ~20,000 mappings and therefore not a project anyone will finish. But the
// field NAMES repeat across banks — one DIB form already maps onto the registry
// by name alone for most of its fields. So mapping is: try the alias index, then
// a looser token overlap, and hand the residue to a human. A well-named form
// lands in minutes; a badly-named one costs more, which is the honest answer.

import {
  CANONICAL_FIELDS,
  FIELD_LOOKUP,
  FORMATTERS,
  type CanonicalField,
} from "./form-fields";

export interface FormFieldInfo {
  name: string;
  type: string;
  value?: string;
  options?: string[] | null;
  radioCodes?: string[] | null;
}

export interface ProposedMapping {
  /** The bank's field name. */
  field: string;
  /** The canonical field key, or null when nothing matched. */
  canonicalKey: string | null;
  format: string;
  /** How confident the match is. */
  confidence: "exact" | "alias" | "fuzzy" | "none";
  /** Why it matched, for the human reviewing the residue. */
  note: string;
  protected: boolean;
  staffOnly: boolean;
}

/** "Bank_Account1" → ["bank","account","1"] */
function tokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 1);
}

/** Word-boundary overlap, ignoring the bank prefix the form already encodes. */
function overlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const set = new Set(b);
  const hits = a.filter((t) => set.has(t)).length;
  return hits / a.length;
}

export function matchField(fieldName: string, opts: { excludeBankPrefix?: string } = {}): ProposedMapping {
  const clean = (fieldName || "").trim();
  const lower = clean.toLowerCase();

  // 1. exact canonical key
  const exact = FIELD_LOOKUP.get(lower);
  if (exact) {
    return { field: clean, canonicalKey: exact.key, format: exact.format, confidence: "exact", note: "exact name", protected: !!exact.protected, staffOnly: !!exact.staffOnly };
  }

  // 2. alias
  for (const f of CANONICAL_FIELDS) {
    if (f.aliases.some((a) => a.toLowerCase() === lower)) {
      return { field: clean, canonicalKey: f.key, format: f.format, confidence: "alias", note: "alias match", protected: !!f.protected, staffOnly: !!f.staffOnly };
    }
  }

  // 3. fuzzy: strip the bank's own grouping prefix before comparing, because
  //    "Liabilities_HF1_Monthly_Inst" carries no useful signal beyond
  //    "monthly" once you already know the rest.
  const fTokens = tokens(clean);
  const stripped = opts.excludeBankPrefix
    ? fTokens.filter((t) => t !== opts.excludeBankPrefix!.toLowerCase())
    : fTokens;

  let best: { f: CanonicalField; score: number } | null = null;
  for (const f of CANONICAL_FIELDS) {
    const names = [f.key.replace(/\./g, " "), f.label, ...f.aliases];
    for (const n of names) {
      const score = Math.max(overlap(stripped, tokens(n)), overlap(fTokens, tokens(n)));
      if (!best || score > best.score) best = { f, score };
    }
  }

  if (best && best.score >= 0.6) {
    return { field: clean, canonicalKey: best.f.key, format: best.f.format, confidence: "fuzzy", note: `${Math.round(best.score * 100)}% word overlap — check it`, protected: !!best.f.protected, staffOnly: !!best.f.staffOnly };
  }

  return { field: clean, canonicalKey: null, format: "text", confidence: "none", note: "no match — pick or leave blank", protected: false, staffOnly: false };
}

/** Match a whole form. The residue (confidence "none") is what a human reviews. */
export function matchForm(fields: FormFieldInfo[], opts: { excludeBankPrefix?: string } = {}): ProposedMapping[] {
  return fields.map((f) => matchField(f.name, opts));
}

/** Read a dotted/indexed path out of the resolved data bag. */
export function readPath(data: Record<string, unknown>, path: string): unknown {
  let cur: unknown = data;
  for (const part of path.split(".")) {
    if (cur == null) return undefined;
    const m = String(part).match(/^(\w+)(?:\[(\d+)\])?$/);
    if (!m) return undefined;
    const obj = cur as Record<string, unknown>;
    cur = obj[m[1]];
    if (m[2] != null) {
      const arr = cur as unknown[] | undefined;
      cur = Array.isArray(arr) ? arr[Number(m[2])] : undefined;
    }
  }
  return cur;
}

export function applyFormat(value: unknown, format: string): string {
  const fn = FORMATTERS[format] ?? FORMATTERS.text;
  try { return fn(value); } catch { return ""; }
}
