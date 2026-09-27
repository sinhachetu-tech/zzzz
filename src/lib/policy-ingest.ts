// Deterministic bank-policy document ingestion — NO AI here.
// Parses a pasted text block (PDF text or Excel cell dump) into:
//   { axes, quoteHints, needs } where `needs` are the EXACT pieces of
// information the engine requires but the document did NOT contain.
// The AI layer (`policy-draft.ts`) turns `needs` into human questions; this
// module is pure TypeScript and unit-tested (tests/policy-ingest.ts).
import {
  canonicalTxn,
  type NationalityRule,
} from "@/lib/bank-rules-taxonomy";
import type { RateQuote } from "@/lib/bank-pricing";

/** One verbatim policy axis, in the same shape `extractFromAxes` consumes:
 *  label → raw text. Detects both "Label: value" lines and two-column rows. */
export type PolicyAxes = Record<string, string>;

/** Everything the engines need that the document did NOT state. Each entry is
 *  a stable machine key plus a ready-to-ask human question. */
export interface PolicyNeed {
  key: string;
  question: string;
  importance: "blocking" | "improvement";
}

export interface IngestedPolicy {
  axes: PolicyAxes;
  /** heuristic per-axis quote hints used to seed the quote rows editor */
  quoteHints: ParsedRateHint[];
  needs: PolicyNeed[];
}

/** One rate-like fragment the parser could read, before human confirmation. */
export interface ParsedRateHint {
  ratePct: number | null;
  marginPct: number | null;
  termYears: number | null;
  txnHints: string[];
  stlHint: boolean | null;
  sourceLine: string;
}

const pct = (s: string): number | null => {
  const m = s.match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? parseFloat(m[1]) : null;
};

/** "Label: value" and "Label \t value" row splitting. */
export function textToAxes(raw: string): PolicyAxes {
  const axes: PolicyAxes = {};
  for (const line of String(raw || "").split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    // two-column row: "Fixed Rate \t 3.95% ..." or "Label: value"
    const m = l.match(/^([^:\t]{2,60}?)\s*[:\t]\s*(.+)$/);
    if (!m) continue; // prose lines belong to the quote parser, not the axes map
    const label = m[1].trim();
    const value = m[2].trim();
    if (value.length < 1) continue;
    // merge duplicate labels the same way axesJson does ("islamic\n—islamic")
    axes[label] = axes[label] ? `${axes[label]}\n—${value}` : value;
  }
  return axes;
}

/** Rate-like fragments: "3.95% Fixed for 3 years", "1.99% + 3M EIBOR",
 *  "Fixed_3Years_STL - 3.99%", token forms included. */
export function rateHints(text: string): ParsedRateHint[] {
  const hints: ParsedRateHint[] = [];
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const l = rawLine.trim();
    if (!l || !/%/.test(l)) continue;
    const fixed = l.match(/(\d+(?:\.\d+)?)\s*%[^0-9%]{0,40}?(\d{1,2})\s*-?\s*years?/i)
      ?? l.match(/(\d{1,2})\s*-?\s*years?[^0-9%]{0,45}?(\d+(?:\.\d+)?)\s*%/i);
    if (fixed) {
      const isTermFirst = /^[^0-9%]*\d{1,2}\s*-?\s*years?/i.test(l);
      const rate = parseFloat(isTermFirst ? fixed[2] : fixed[1]);
      const term = parseInt(isTermFirst ? fixed[1] : fixed[2], 10);
      const txns: string[] = [];
      for (const chunk of l.split(/[,/&+]/)) {
        const c = canonicalTxn(chunk);
        if (c) txns.push(c);
      }
      hints.push({
        ratePct: rate, marginPct: null,
        termYears: Number.isFinite(term) && term >= 1 && term <= 30 ? term : null,
        txnHints: [...new Set(txns)],
        stlHint: /_nstl\b|[^a-z]nstl[^a-z]/i.test(l) ? false : /_stl\b|[^a-z]stl[^a-z]/i.test(l) ? true : null,
        sourceLine: l.slice(0, 160),
      });
      continue;
    }
    const varM = l.match(/(\d+(?:\.\d+)?)\s*%?\s*(?:fixed\s*margin\s*(?:of|:)?|[-+])\s*\+?\s*(3|6|1|12)?\s*-?\s*months?\s*eibor/i);
    if (varM) {
      hints.push({
        ratePct: null, marginPct: parseFloat(varM[1]), termYears: 0,
        txnHints: [], stlHint: null, sourceLine: l.slice(0, 160),
      });
    }
  }
  return hints;
}


/** Multi-txn declaration actually present? ("Resale, Buyout & Equity" etc.) */
function hasMultiTxn(text: string): boolean {
  const found = new Set<string>();
  for (const chunk of text.split(/[,/&+\n]/)) {
    const c = canonicalTxn(chunk);
    if (c) found.add(c);
  }
  return found.size >= 2;
}

/** Nationality gating declared? ("Accept … only: UK, France…" / "Iranians: No") */
function hasNationalityRule(text: string): boolean {
  return /accept[^\n]{0,80}only|restricted nationalit|no\s+\w+\s*(?:nationals?)?/i.test(text);
}

/** Compute the missing-information list. Never invents — only checks presence. */
export function missingInfo(axes: PolicyAxes, hints: ParsedRateHint[], rawText: string): PolicyNeed[] {
  const needs: PolicyNeed[] = [];
  const blob = `${rawText}\n${Object.values(axes).join("\n")}`;
  const has = (re: RegExp) => re.test(blob);

  if (!has(/(resale|buyout|equity|off[\s-]?plan|primary|handover|land|lap)/i) && !hasMultiTxn(blob)) {
    needs.push({
      key: "txns",
      question: "Which transaction types does this pricing cover — Resale, Buyout, Equity Release, Off-Plan, or all of them?",
      importance: "blocking",
    });
  }
  if (!has(/\b(STL|NSTL|salary transfer)\b/i)) {
    needs.push({
      key: "salaryTransfer",
      question: "Does this rate apply to salary-transfer (STL) clients, non-STL, or both?",
      importance: "blocking",
    });
  }
  if (!has(/\b(FTV|finance.to.value|up\s*to\s*60|above\s*60)\b/i)) {
    needs.push({
      key: "ftvBands",
      question: "Is there a different rate for high finance-to-value (e.g. above 60%) — or one rate for all LTVs?",
      importance: "improvement",
    });
  }
  if (!has(/(follow[\s-]?on|thereafter|after.{0,10}fixed|revert|post.fixed)/i)) {
    needs.push({
      key: "followOn",
      question: "What happens after the fixed period — which EIBOR tenor plus what margin (and is there a floor)?",
      importance: "blocking",
    });
  }
  if (!has(/(processing fee|arrangement fee|PF\b)/i)) {
    needs.push({
      key: "processingFee",
      question: "What is the processing / arrangement fee — % of loan, with any cap, minimum, or waiver?",
      importance: "blocking",
    });
  }
  if (!has(/(early settlement|settlement fee|ESF)/i)) {
    needs.push({
      key: "earlySettlement",
      question: "What is the early-settlement charge — % and cap (and is it waived after some years)?",
      importance: "improvement",
    });
  }
  if (!has(/(life insurance|takaful)/i)) {
    needs.push({
      key: "lifeInsurance",
      question: "What is the life insurance / takaful rate — per-million-monthly or % p.a. of loan?",
      importance: "improvement",
    });
  }
  if (!has(/(property insurance|property takaful)/i)) {
    needs.push({
      key: "propertyInsurance",
      question: "What is the property insurance rate — % p.a. of property value?",
      importance: "improvement",
    });
  }
  if (!has(/(min.{0,10}salary|minimum income)/i)) {
    needs.push({
      key: "minSalary",
      question: "What is the minimum salary for this product (and is it different for joint borrowers)?",
      importance: "improvement",
    });
  }
  if (!has(/(rental income|addback|bonus|commission)/i)) {
    needs.push({
      key: "incomeAddbacks",
      question: "Which variable incomes count — what % of rental income, bonus, commission is added back?",
      importance: "improvement",
    });
  }
  if (!hasNationalityRule(blob)) {
    needs.push({
      key: "nationalityRule",
      question: "Any nationality restrictions — an allow-list of accepted passports, or a deny-list?",
      importance: "improvement",
    });
  }
  if (!has(/(valid|effective|from|until|till|w\.e\.f)/i)) {
    needs.push({
      key: "validity",
      question: "From when is this pricing valid, and until when (start and end dates)?",
      importance: "blocking",
    });
  }
  void hints;
  return needs;
}

/** Top-level entry: raw pasted text (PDF text or Excel cell dump) → axes, hints, needs. */
export function ingestPolicyText(raw: string): IngestedPolicy {
  const axes = textToAxes(raw);
  const hints = rateHints(raw);
  const needs = missingInfo(axes, hints, raw);
  return { axes, quoteHints: hints, needs };
}

/** XLSX workbook → one axes-map per accepted sheet, in zz_extract.mjs shape.
 *  `pick` chooses which sheets to accept; bank label comes from the picker. */
export function ingestWorkbook(
  sheets: Array<{ name: string; rows: string[][] }>,
  pick: { bank: string; sheets: string[] },
): Array<{ key: string; bank: string; sheet: string; axes: PolicyAxes; source: string }> {
  const out: Array<{ key: string; bank: string; sheet: string; axes: PolicyAxes; source: string }> = [];
  for (const { name, rows } of sheets) {
    if (!pick.sheets.includes(name)) continue;
    const axes: PolicyAxes = {};
    for (const row of rows) {
      const cells = (row ?? []).map((c) => String(c ?? "").trim());
      if (cells.every((c) => !c)) continue;
      const label = cells[0];
      const rest = cells.slice(1).filter(Boolean);
      if (!label || rest.length === 0) continue;
      const value = rest.join("\n—");
      axes[label] = axes[label] ? `${axes[label]}\n—${value}` : value;
    }
    out.push({ key: `${pick.bank}||${name}`, bank: pick.bank, sheet: name, axes, source: "uploaded workbook" });
  }
  return out;
}

// re-exported so AI and UI share the vocabulary
export type { NationalityRule, RateQuote };
