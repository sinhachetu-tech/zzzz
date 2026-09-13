// Structured, computable bank pricing — Phase 1a.
// A bank product's `pricingJson` holds RateQuote rows with explicit match
// conditions; the resolver picks the quote for a case the same way a human
// reads the pricing sheet: filter by salary-transfer status, transaction,
// FTV band and term, then read the number.

export type EiborTenor = "1M" | "3M" | "6M" | "1Y";

export interface EiborCurve {
  [tenor: string]: number; // current rate pct, e.g. 3M -> 3.62496
}

export interface RateQuote {
  // match conditions — every field must match the case (null = matches both)
  stl?: boolean | null;          // salary transfer required for this quote?
  termYears?: number | null;     // fixed-term length; null = variable day 1
  ftvMax?: number | null;        // max finance-to-value band, null = any
  txn?: string | null;           // "any" | "Resale" | "Primary Handover" | "Buyout" | "Equity Release" | "Land" | "Self Construction" | "LAP"
  segment?: string | null;       // bank segment label (GECo, Premium, SZHP…)
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
}

/** Does a single quote match the requested dimensions? */
export function quoteMatches(q: RateQuote, req: QuoteMatchInput): boolean {
  if (q.stl != null && q.stl !== req.stl) return false;
  if (q.txn != null && q.txn !== "any" && q.txn !== req.txn) return false;
  if (q.segment != null && req.segment != null && q.segment !== req.segment) return false;
  if (q.ftvMax != null && req.ftv > q.ftvMax) return false;
  const qt = q.termYears ?? null;
  const rt = req.termYears ?? null;
  if ((qt ?? 0) !== (rt ?? 0)) return false; // term must match exactly (0 = variable day 1)
  return true;
}

/** Best (lowest) matching rate quote for a case, or null when not priced. */
export function resolveQuote(pricing: ProductPricing | null, req: QuoteMatchInput): RateQuote | null {
  if (!pricing?.quotes?.length) return null;
  const matches = pricing.quotes.filter((q) => quoteMatches(q, req));
  if (matches.length === 0) return null;
  // rank: FIXED first for a fixed-term request, then lowest effective rate
  const effective = (q: RateQuote) =>
    q.rateType === "FIXED" ? (q.ratePct ?? 99) : (q.marginPct ?? 99);
  return matches.sort((a, b) => effective(a) - effective(b))[0];
}

/**
 * Assessment rate for DSR stress testing: the rate the bank qualifies the
 * client at. Fixed quotes use follow-on (variable) rate; variable quotes use
 * margin + current EIBOR. This is what keeps stress tests alive when EIBOR moves.
 */
export function assessmentRate(q: RateQuote, eibor: EiborCurve): number | null {
  return rateSchedule(q, eibor).stressRatePct;
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
export function rateSchedule(q: RateQuote, eibor: EiborCurve): RateSchedule {
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
    return {
      introRatePct: q.ratePct ?? null,
      introTermYears: q.termYears ?? null,
      followOnRatePct: followOn,
      stressRatePct: followOn, // banks qualify at the follow-on rate
    };
  }
  // day-1 variable: intro == follow-on == stress
  const tenor = q.rateType.replace("_EIBOR", "") as EiborTenor;
  const rate = varRate(tenor, q.marginPct, q.floorPct);
  return { introRatePct: rate, introTermYears: 0, followOnRatePct: rate, stressRatePct: rate };
}
