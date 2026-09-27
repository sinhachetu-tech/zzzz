// Structured, computable bank pricing — Phase 1a + Phase 1 multi-axis.
// Legacy scalar fields stay for backward compat; new array fields mean
// "case value IN set" (null/[] = all). Matcher requires BOTH to agree.
import { setMatches, nationalityAllowed, type NationalityRule } from "@/lib/bank-rules-taxonomy";

export type EiborTenor = "1M" | "3M" | "6M" | "1Y";

export interface EiborCurve {
  [tenor: string]: number; // current rate pct, e.g. 3M -> 3.62496
}

export interface RateQuote {
  // match conditions — every field must match the case (null = matches both)
  stl?: boolean | null;          // salary transfer required for this quote?
  termYears?: number | null;     // fixed-term length; null = variable day 1
  ftvMax?: number | null;        // max finance-to-value band, null = any
  txn?: string | null;           // legacy single txn ("any" | "Resale" | ...)
  segment?: string | null;       // legacy single bank segment label
  // Phase 1 sets — null/[] = matches all; else case value IN set
  txns?: string[] | null;
  salaryTransfer?: Array<"STL" | "NSTL"> | null;
  segments?: string[] | null;
  residency?: string[] | null;
  employment?: string[] | null;
  financeType?: string[] | null;
  loanKind?: string[] | null;
  emirates?: string[] | null;
  nationalityRule?: NationalityRule | null;
  ftvMin?: number | null;
  sourceLabel?: string | null;
  // effective dating — a rate revision creates a NEW line (from = revision date,
  // to = blank/2099-12-31) and closes the old line the day before. Null dates =
  // always valid (legacy quotes). A rollback = re-apply: same mechanism, new line.
  effectiveFrom?: string | null; // ISO date, inclusive
  effectiveTo?: string | null;   // ISO date, inclusive; 2099-12-31 = open
  // the quote itself
  rateType: "FIXED" | "1M_EIBOR" | "3M_EIBOR" | "6M_EIBOR" | "1Y_EIBOR";
  ratePct?: number | null;       // for FIXED
  marginPct?: number | null;     // for variable quotes (margin over EIBOR)
  floorPct?: number | null;      // minimum rate during variable period
  variableAfter?: {              // what happens when the fixed term ends
    basis: EiborTenor;
    marginPct: number;
    floorPct?: number | null;
  } | null;
  note?: string;
}

export interface ProductPricing {
  quotes: RateQuote[];
}

export interface QuoteMatchInput {
  stl: boolean;
  termYears?: number | null; // requested fixed term (null = variable day 1)
  ftv: number;               // finance-to-value %
  txn: string;               // canonical transaction
  segment?: string | null;
  // Phase 1 optional axes — omitted = new set-fields impose no constraint
  salaryTransfer?: "STL" | "NSTL" | null;
  residency?: string | null;
  employment?: string | null;  // "Salaried" | "Self-Employed" (split from residency)
  financeType?: string | null;
  loanKind?: string | null;
  emirate?: string | null;
  nationality?: string | null;
  ratePref?: "fixed" | "flexible"; // prefer fixed-for-term or EIBOR-linked quotes
  on?: string;               // evaluation date (ISO). Default: today
}

/** Specificity: constrained axes count. Most-specific match wins. */
export function quoteSpecificity(q: RateQuote): number {
  let n = 0;
  if (q.stl != null) n++;
  if (q.txn != null && q.txn !== "any") n++;
  if (q.segment != null) n++;
  if (q.termYears != null) n++;
  if (q.ftvMax != null || q.ftvMin != null) n++;
  if (q.txns?.length) n += 2;
  if (q.salaryTransfer?.length) n++;
  if (q.segments?.length) n++;
  if (q.residency?.length) n++;
  if (q.employment?.length) n++;
  if (q.financeType?.length) n++;
  if (q.loanKind?.length) n++;
  if (q.emirates?.length) n++;
  if (q.nationalityRule && q.nationalityRule.mode !== "ALL") n++;
  return n;
}

/** Does a single quote match the requested dimensions? */
export function quoteMatches(q: RateQuote, req: QuoteMatchInput): boolean {
  if (q.stl != null && q.stl !== req.stl) return false;
  // a wildcard request ("any") bypasses the legacy scalar too — same rule as setMatches
  if (q.txn != null && q.txn !== "any" && req.txn !== "any" && q.txn !== req.txn) return false;
  if (!setMatches(q.txns, req.txn)) return false;
  const stlLabel = req.salaryTransfer ?? (req.stl ? "STL" : "NSTL");
  if (!setMatches(q.salaryTransfer, stlLabel)) return false;
  if (req.segment != null && !setMatches(q.segments, req.segment)) return false;
  if (q.segment != null && req.segment != null && q.segment !== req.segment) return false;
  if (req.residency != null && !setMatches(q.residency, req.residency)) return false;
  if (req.employment != null && !setMatches(q.employment, req.employment)) return false;
  if (req.financeType != null && !setMatches(q.financeType, req.financeType)) return false;
  if (req.loanKind != null && !setMatches(q.loanKind, req.loanKind)) return false;
  if (req.emirate != null && !setMatches(q.emirates, req.emirate)) return false;
  if (req.nationality !== undefined && !nationalityAllowed(q.nationalityRule, req.nationality ?? null)) return false;
  if (q.ftvMax != null && req.ftv > q.ftvMax) return false;
  if (q.ftvMin != null && req.ftv <= q.ftvMin) return false;
  const qt = q.termYears ?? null;
  const rt = req.termYears ?? null;
  if ((qt ?? 0) !== (rt ?? 0)) return false; // term must match exactly (0 = variable day 1)
  return true;
}

/** Best matching rate quote for a case, or null when not priced.
 *  Rank: most-specific first, then latest effective-from, then lowest rate. */
export function resolveQuote(pricing: ProductPricing | null, req: QuoteMatchInput): RateQuote | null {
  if (!pricing?.quotes?.length) return null;
  const on = req.on ?? new Date().toISOString().slice(0, 10);
  let matches = pricing.quotes.filter((q) => {
    if (!quoteMatches(q, req)) return false;
    const from = q.effectiveFrom ?? "";
    const to = q.effectiveTo ?? "";
    if (from && from > on) return false;  // scheduled revision not live yet
    if (to && to !== "2099-12-31" && to < on) return false; // superseded line
    return true;
  });
  if (matches.length === 0) return null;
  // overlapping lines: most-specific match wins; ties → latest effective-from, then best rate
  const effective = (q: RateQuote) =>
    q.rateType === "FIXED" ? (q.ratePct ?? 99) : (q.marginPct ?? 99);
  matches = [...matches].sort((a, b) =>
    (quoteSpecificity(b) - quoteSpecificity(a)) ||
    (b.effectiveFrom ?? "").localeCompare(a.effectiveFrom ?? "") ||
    (effective(a) - effective(b)));
  // honour the rate preference when the bank offers that style; otherwise fall
  // back to the bank's best available quote (specificity order preserved)
  if (req.ratePref === "fixed") {
    const f = matches.filter((m) => m.rateType === "FIXED");
    if (f.length) matches = f;
  } else if (req.ratePref === "flexible") {
    const v = matches.filter((m) => m.rateType !== "FIXED");
    if (v.length) matches = v;
  }
  // matches already sorted by specificity → date → rate; preference filter keeps that order
  return matches[0];
}

/**
 * Assessment rate for DSR stress testing: the rate the bank qualifies the
 * client at. Fixed quotes use follow-on (variable) rate; variable quotes use
 * margin + current EIBOR. This is what keeps stress tests alive when EIBOR moves.
 */
export function assessmentRate(q: RateQuote, eibor: EiborCurve, stressBufferPct: number | null = 0): number | null {
  return rateSchedule(q, eibor, stressBufferPct).stressRatePct;
}

/** Parse "pricingJson" safely. */
export function parsePricing(json: string | null | undefined): ProductPricing | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return v?.quotes ? (v as ProductPricing) : null;
  } catch {
    return null;
  }
}

/* ---------------- three-rate schedule ---------------- */

export interface RateSchedule {
  introRatePct: number | null;   // what the client pays during the fixed period
  introTermYears: number | null; // null/0 = no intro period (day-1 variable)
  followOnRatePct: number | null; // what they pay after intro (margin + current EIBOR, floored)
  stressRatePct: number | null;  // what the bank qualifies them at (DSR assessment)
}

/** The complete rate story for one quote at today's EIBOR. */
export function rateSchedule(q: RateQuote, eibor: EiborCurve, stressBufferPct: number | null = 0): RateSchedule {
  const eiborFor = (tenor: EiborTenor) => eibor[tenor] ?? null;
  const varRate = (basis: EiborTenor, margin: number | null | undefined, floor: number | null | undefined): number | null => {
    const base = eiborFor(basis);
    if (base == null) return null;
    const rate = (margin ?? 0) + base;
    return floor != null ? Math.max(rate, floor) : rate;
  };
  if (q.rateType === "FIXED") {
    const va = q.variableAfter;
    const followOn = va ? varRate(va.basis.replace("_EIBOR", "") as EiborTenor, va.marginPct, va.floorPct) : (q.ratePct ?? null);
    const stress = followOn != null && stressBufferPct ? followOn + stressBufferPct : followOn;
    return {
      introRatePct: q.ratePct ?? null,
      introTermYears: q.termYears ?? null,
      followOnRatePct: followOn,
      stressRatePct: stress, // banks qualify at follow-on + their stress buffer (CBD +2 etc.)
    };
  }
  // day-1 variable: intro == follow-on == stress
  const tenor = q.rateType.replace("_EIBOR", "") as EiborTenor;
  const rate = varRate(tenor, q.marginPct, q.floorPct);
  const stress = rate != null && stressBufferPct ? rate + stressBufferPct : rate;
  return { introRatePct: rate, introTermYears: 0, followOnRatePct: rate, stressRatePct: stress };
}
