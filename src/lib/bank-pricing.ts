// Structured, computable bank pricing — Phase 1a + Phase 1 multi-axis.
// Legacy scalar fields stay for backward compat; new array fields mean
// "case value IN set" (null/[] = all). Matcher requires BOTH to agree.
import { setMatches, nationalityAllowed, unknownAxes, type NationalityRule } from "@/lib/bank-rules-taxonomy";

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
  /** Property stage — OFF_PLAN | HANDOVER | COMPLETED. Wired from
   *  LoanCase.propertyStage so off-plan/handover products finally filter. */
  stages?: string[] | null;
  /** Transaction purpose — PURCHASE | REFINANCE | EQUITY_RELEASE | REFINANCE_AND_EQUITY. */
  purposes?: string[] | null;
  /** RESIDENTIAL | COMMERCIAL. */
  propertyTypes?: string[] | null;
  /** Customer profile tier — "Standard", "Preferential Pricing", "Premium…". The
   *  Huspy customer_segments field mixes real profiles with LTV bands and project
   *  names; only the genuine profile values belong here. */
  profiles?: string[] | null;
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
  /** See StressRule below — how the bank stress-tests this card (DBR 3). */
  stress?: StressRule | null;
  note?: string;
  /* ---------------- verification: is this line still TRUE? ----------------
     A rate nobody has re-checked in a year is not a rate, it is a guess. One real
     product carries a stress note dated November 2022 — still live, still quoting.
     `verifiedAt` records when a HUMAN last confirmed this line with the bank. */
  verifiedAt?: string | null;
  /* ---------------- slot state: EMPTY / FILLED / CLOSED ----------------
     A slot that was deliberately NOT offered is not the same fact as a slot
     whose rate was never filed — but they look identical in a grid. CLOSED
     carries a mandatory reason so "the bank doesn't offer this" can never be
     mistaken for "we haven't typed it yet", and a closed line must never
     match a client case. */
  status?: "OPEN" | "CLOSED" | null;
  closedReason?: string | null;
  closedAt?: string | null;
}

/* ---------------- DBR 3: how the bank stress-tests the card ---------------- */

/**
 * HOW THE BANK STRESS-TESTS THIS CARD (DBR 3 — the number that sets eligibility).
 *
 * DBR 1 = intro rate (what the client pays during the fixed period).
 * DBR 2 = follow-on rate (what they pay after intro).
 * DBR 3 = STRESS rate (the ONLY one used for eligibility).
 *
 * Five of 76 products had a typed buffer, 40 had it as prose, and 31 had no rule at
 * all — so the engine silently qualified the majority of the book on the follow-on
 * rate with zero cushion. The four kinds are not invented; each appears in real
 * policy text:
 *   EIBOR_PLUS_MARGIN      "3M EIBOR + 1.75%, stress +2%"     -> computed live
 *   FLAT                   "2 Years Fixed - 5.88%"            -> that literal rate
 *   RELATIVE_TO_FOLLOWON   "follow-on rate + 2%"              -> the follow-on + buffer
 *   FLOOR_PLUS             "Min Floor Rate + Life insurance"  -> the floor is the base
 *   NONE                   no rule filed                      -> fall back to follow-on
 */
export type StressKind = "EIBOR_PLUS_MARGIN" | "FLAT" | "RELATIVE_TO_FOLLOWON" | "FLOOR_PLUS" | "NONE";

export interface StressRule {
  kind: StressKind;
  /** The buffer added to the base (relative kinds), or the absolute rate (FLAT).
   *  Null when NONE. */
  value?: number | null;
  /** Which tenor an EIBOR_PLUS_MARGIN rule is measured from, when the bank names one. */
  basis?: EiborTenor | null;
  note?: string;
}

export interface StressOutcome {
  /** The rate the bank qualifies the client at. This is the DBR 3 number. */
  ratePct: number | null;
  /** Where it came from, so the UI can say "assumed" rather than implying certainty. */
  source: "rule" | "bank-buffer" | "follow-on-fallback" | "unknown";
  /** Plain-English explanation for the explain panel / proposal. */
  note: string;
}

/**
 * Resolve the stress rate for one card.
 *
 * Order is deliberate. An explicit rule on the card wins; then the bank's own typed
 * buffer (legacy `stressBufferPct`); then — per the owner's stated rule — the
 * follow-on rate itself, which is a REAL answer but with no cushion, so it is
 * labelled `follow-on-fallback` and must be shown as such rather than presented as
 * the bank's qualification rule.
 */
export function resolveStress(
  q: RateQuote,
  followOnRatePct: number | null,
  eibor: EiborCurve,
  bankBufferPct: number | null | undefined,
): StressOutcome {
  const rule = q.stress;
  const floor = q.variableAfter?.floorPct ?? q.floorPct ?? null;

  if (rule && rule.kind !== "NONE") {
    switch (rule.kind) {
      case "FLAT":
        if (rule.value != null) {
          return { ratePct: rule.value, source: "rule", note: `bank qualifies at a flat ${rule.value}%` };
        }
        break;
      case "EIBOR_PLUS_MARGIN": {
        // EIBOR + margin + the cushion the bank adds on top
        const basis = rule.basis ?? q.variableAfter?.basis ?? "3M";
        const base = eibor[basis] ?? null;
        const margin = q.variableAfter?.marginPct ?? q.marginPct ?? null;
        if (base != null && margin != null) {
          const rate = base + margin + (rule.value ?? 0);
          return { ratePct: Math.round(rate * 1000) / 1000, source: "rule", note: `${basis} EIBOR ${base}% + margin ${margin}%${rule.value ? ` + ${rule.value}% stress` : ""}` };
        }
        break;
      }
      case "RELATIVE_TO_FOLLOWON":
        if (followOnRatePct != null) {
          const rate = followOnRatePct + (rule.value ?? 0);
          return { ratePct: Math.round(rate * 1000) / 1000, source: "rule", note: `follow-on ${followOnRatePct}% + ${rule.value ?? 0}% stress` };
        }
        break;
      case "FLOOR_PLUS":
        if (floor != null) {
          const rate = floor + (rule.value ?? 0);
          return { ratePct: Math.round(rate * 1000) / 1000, source: "rule", note: `floor ${floor}%${rule.value ? ` + ${rule.value}%` : ""} — a floor-based test, so it holds even if EIBOR falls` };
        }
        break;
    }
  }

  if (typeof bankBufferPct === "number" && bankBufferPct > 0 && followOnRatePct != null) {
    const rate = followOnRatePct + bankBufferPct;
    return { ratePct: Math.round(rate * 1000) / 1000, source: "bank-buffer", note: `follow-on ${followOnRatePct}% + bank buffer ${bankBufferPct}%` };
  }

  if (followOnRatePct != null) {
    return {
      ratePct: followOnRatePct,
      source: "follow-on-fallback",
      note: "no stress rule filed — qualified at the follow-on rate, with no cushion",
    };
  }
  return { ratePct: null, source: "unknown", note: "no stress rule and no follow-on rate to fall back to" };
}

/* ---------------- tier 0: law / norms (the layer below bank) ---------------- */

/**
 * The CBUAE constants. These are LAW, not settings: a bank cannot opt out, and an
 * admin should not be able to type a different number. They live here (rather than
 * being per-bank fields) because every product that had a `dbrPct` column had it
 * EMPTY, so the engine was silently falling back to a hardcoded 50 anyway.
 */
export interface LawNorms {
  /** CBUAE debt burden ceiling. */
  maxDbrPct: number;
  /** UAE standard VAT rate — applies to BANK fees (processing, insurance), which are
   *  quoted "+ VAT". Place/government fees are quoted inclusive and are NOT in scope. */
  vatPct: number;
  /** CBUAE early-settlement cap: 1% of outstanding or AED 10,000, whichever is lower. */
  earlySettlementPctCap: number;
  earlySettlementAedCap: number;
  /** Years before a "constant" is treated as un-confirmed. A value nobody has
   *  re-checked in a year is not a constant, it is a guess. */
  verifyAfterMonths: number;
}

export const LAW_NORMS: LawNorms = {
  maxDbrPct: 50,
  vatPct: 5,
  earlySettlementPctCap: 1,
  earlySettlementAedCap: 10000,
  verifyAfterMonths: 12,
};

/** Applies UAE VAT to a bank fee. Place/government fees are quoted inclusive. */
export function withVat(amount: number, vatPct: number = LAW_NORMS.vatPct): number {
  return Math.round(amount * (1 + vatPct / 100) * 100) / 100;
}

/* ---------------- staleness: a rate nobody re-checked is a guess ---------------- */

export type Freshness = "fresh" | "aging" | "stale" | "never";

export interface Verification {
  state: Freshness;
  /** Whole months since a human confirmed this line, or null when never confirmed. */
  monthsAgo: number | null;
  note: string;
}

/**
 * Is this rate still TRUE?
 *
 * A live catalogue drifts: one product in this database still carries a stress note
 * dated November 2022 and would still qualify a client on it. Rates move monthly, so
 * an unverified line is not a stale copy — it is a guess with a confident typeface.
 *
 * `never` and `stale` are deliberately distinct: never means nobody has ever
 * confirmed it (the norm for an import), stale means someone did, long ago, and the
 * world has moved since. Both need a phone call; only one is a process failure.
 */
export function staleness(
  verifiedAt: string | null | undefined,
  on: string = new Date().toISOString().slice(0, 10),
  months = LAW_NORMS.verifyAfterMonths,
): Verification {
  if (!verifiedAt) {
    return { state: "never", monthsAgo: null, note: "never confirmed with the bank" };
  }
  const from = Date.parse(verifiedAt);
  const to = Date.parse(on);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    return { state: "never", monthsAgo: null, note: "confirmation date unreadable" };
  }
  const monthsAgo = Math.floor((to - from) / (1000 * 60 * 60 * 24 * 30.44));
  if (monthsAgo < 0) {
    // a future date is a data-entry error, not freshness — treat as unconfirmed
    return { state: "never", monthsAgo: null, note: "confirmation date is in the future" };
  }
  if (monthsAgo >= months) {
    return { state: "stale", monthsAgo, note: `last confirmed ${monthsAgo} months ago — re-check with the bank` };
  }
  // the last quarter before expiry is the window to re-confirm, not a failure
  if (monthsAgo >= months - 3) {
    return { state: "aging", monthsAgo, note: `confirmed ${monthsAgo} months ago — due for re-check` };
  }
  return { state: "fresh", monthsAgo, note: `confirmed ${monthsAgo} month(s) ago` };
}

/* ---------------- bank defaults: inheritance resolution ---------------- */

/**
 * ONE function decides every inherited value, so the engine and the UI can never
 * disagree about what a product actually costs.
 *
 *   product value  ??  bank default  ??  law norm
 *
 * Order matters and is the whole point: a product's own value always wins, because
 * that is where an intentional exception lives. A `null` at every level falls
 * through to the norm, so a resolved value ALWAYS exists — the UI can print a
 * number rather than a blank, and the "inherited" badge is just a report of which
 * level won.
 */
export interface ResolveInput<T> {
  product: T | null | undefined;
  bank: T | null | undefined;
  norm?: number;
}

export type InheritedFrom = "product" | "bank" | "norm";

export interface Resolved<T> {
  value: number | null;
  from: InheritedFrom;
}

export function resolveField<T extends Record<string, unknown>, K extends keyof T & string>(
  key: K,
  input: { product: T | null | undefined; bank: T | null | undefined },
  normValue: number | null = null,
): Resolved<number | null> {
  const p = input.product?.[key];
  if (typeof p === "number") return { value: p, from: "product" };
  const b = input.bank?.[key];
  if (typeof b === "number") return { value: b, from: "bank" };
  return { value: normValue, from: "norm" };
}

/* ---------------- the CARD: the unit an admin actually changes ---------------- */

/**
 * A bank does not change "a rate". It moves a whole RATE CARD: a rate, and the
 * follow-on recipe, floor and processing fee that travel with it. Splitting those
 * across pricingJson / feesJson / a 900-line modal is why pricing felt scattered —
 * the numbers a broker reads together lived in four different places.
 *
 * So the grid's row IS a card, and the edit panel edits the card. `override` marks
 * which fields the admin chose to change this time; everything else is left alone
 * (banks very often send a new rate and nothing else, so a card-wide "apply to all"
 * default would be wrong).
 */
export interface CardField<T> {
  value: T | null;
  from: InheritedFrom;
  /** true when the value differs from what the parent level would have given. */
  overridden: boolean;
  /** What the parent level would have given — null when there is no parent value.
   *  Needed so the grid can show "bank default 0.525%" beside an override and offer
   *  a revert; without it an override is a number with no way back. */
  parentValue: number | null;
}

export interface RateCard {
  key: string;                 // `${bankProductId}:${quoteIndex}`
  bankProductId: number;
  bankId: number;
  bankName: string;
  productName: string;
  quoteIndex: number;

  /* ---------------- slot state: EMPTY / FILLED / CLOSED ----------------
     FILLED = a live rate line. EMPTY = no rate filed yet (dashed cell — chase
     the bank). CLOSED = deliberately not offered, with a reason (greyed, struck
     through — done, never re-filled). Missing and closed look identical in a
     spreadsheet and are completely different facts. */
  slotState: "EMPTY" | "FILLED" | "CLOSED";
  closedReason: string | null;
  closedAt: string | null;

  // --- the slot's own axes (what the "Applies to" cell reads + edits) ---
  /** Filed transaction set. Empty = matches all (the common case — 281 quotes). */
  slotTxns: string[];
  /** Salary transfer as a SET, with the legacy boolean normalised on load.
   *  Empty = either. The old column showed "either" for rows that quietly meant
   *  STL-only — which is why this is a set now, not a nullable scalar. */
  slotStl: Array<"STL" | "NSTL">;
  slotTermYears: number | null;
  slotRateType: string;
  slotBasis: string | null;
  // --- the master's pinned axes (what the header reads + edits) ---
  masterEmployment: string;
  masterResidency: string;
  masterMortgageType: string;
  masterFinanceType: string;

  /* Is this line still true? A rate nobody has re-checked in a year is a guess,
     not a rate — and a proposal built on it is a promise we cannot keep. */
  verification: { state: Freshness; monthsAgo: number | null; note: string };
  verifiedAt: string | null;

  // --- the four numbers that move together ---
  ratePct: CardField<number>;     // intro / headline
  followOn: CardField<number>;    // margin over EIBOR after the fixed period
  floorPct: CardField<number>;    // the minimum the rate will not go below
  processingFeePct: CardField<number>;

  // DBR 3 — not a rate the client pays, but the number that decides how much they
  // can borrow. Shown separately because it is a RULE (kind + value), not a price.
  stress: { kind: string; value: number | null; label: string };

  // --- context, read-only ---
  rateType: string;
  termYears: number | null;
  eiborBasis: string | null;      // "3M" etc — ENBD/ADIB price off 1M, most off 3M
  eiborNow: number | null;
  resolvedRatePct: number | null; // EIBOR + margin, at today's EIBOR
  salaryTransfer: "STL" | "NSTL" | null;
  residency: string;
  employment: string;
  mortgageType: string;
  transaction: string;
  customerProfile: string | null;
  isExclusive: boolean;
  ltvMax: number | null;

  // --- health ---
  volatility: Record<string, "high" | "medium" | "low">;
  issues: { code: string; label: string; severity: "warn" | "error" }[];
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

/** How often each field realistically moves — drives the 🔴🟡🟢 dots so an admin
 *  knows where their attention belongs instead of treating all fields equally. */
export const VOLATILITY = {
  rate: "high",          // repricing cycle
  followOn: "high",
  floor: "medium",
  processingFeePct: "medium",   // changes when the bank revises its fee schedule
} as const;

/**
 * Wrap a resolved number with the level that supplied it, and flag an override.
 *
 * This badge is the whole safety story of the hierarchy: without it you cannot tell
 * a bank default from a one-off, so changing the default would silently move an
 * unknown number of products. Lives here (not in rate-cards.ts) because it is pure
 * and the pricing tests need it without pulling in Prisma.
 */
export function cardField(
  value: number | null | undefined,
  from: InheritedFrom,
  parentValue: number | null | undefined,
): CardField<number> {
  const v = typeof value === "number" ? value : null;
  const parent = typeof parentValue === "number" ? parentValue : null;
  return {
    value: v,
    from,
    // half-a-basis-point tolerance so float noise never reads as an override
    overridden: v != null && parent != null && Math.abs(v - parent) > 0.0005,
    parentValue: parent,
  };
}

/* ---------------- editing a card (shared by single + bulk) ---------------- */

/**
 * Apply ONE named field to a quote, returning a new quote.
 *
 * Lives here (not in the API route) because it is pure pricing logic and the bulk
 * path is exactly where a subtle divergence would silently reprice thirty products —
 * two copies of "what does editing a floor actually do" always drift. Being here also
 * makes it testable without a database.
 *
 * A fixed line's follow-on/floor live inside `variableAfter`, where `basis` is a bare
 * EiborTenor ("3M"), NOT the suffixed rateType ("3M_EIBOR").
 */
export function applyCardField(
  target: RateQuote,
  field: string,
  value: number | null,
  stressKind: string | null,
): RateQuote {
  const edited: RateQuote = { ...target };
  const isFixed = target.rateType === "FIXED";
  const va: NonNullable<RateQuote["variableAfter"]> = edited.variableAfter ?? { basis: "3M", marginPct: 0 };

  if (field === "ratePct" && isFixed) edited.ratePct = value;
  if (field === "followOn" || field === "marginPct") {
    if (isFixed) edited.variableAfter = { ...va, marginPct: value ?? 0 };
    else edited.marginPct = value;
  }
  if (field === "floorPct") {
    if (isFixed) edited.variableAfter = { ...va, floorPct: value };
    else edited.floorPct = value;
  }
  if (field === "stress" && stressKind) {
    // NONE, or a kind with no number yet, means "no rule filed" — which is distinct
    // from a rule that exists, so it must write null, not a blank rule.
    edited.stress = stressKind !== "NONE" && value != null
      ? { kind: stressKind as StressKind, value }
      : null;
  }
  return edited;
}

/** Would this edit breach a floor? Returns the reason, or null when it is safe. */
export function floorViolation(
  edited: RateQuote,
  isFixed: boolean,
  cfg: { minFixedRatePct?: number | null; minMarginBps?: number | null },
): string | null {
  const effRate = isFixed ? edited.ratePct : edited.marginPct;
  if (cfg.minFixedRatePct != null && isFixed && effRate != null && effRate < cfg.minFixedRatePct - 0.005) {
    return `Below the HFMC floor (${cfg.minFixedRatePct}%).`;
  }
  if (cfg.minMarginBps != null && !isFixed && effRate != null && effRate < cfg.minMarginBps / 100 - 0.005) {
    return `Margin below the HFMC floor (${cfg.minMarginBps}bps).`;
  }
  // a rate below its own floor is self-contradictory — the bank would never quote it
  if (isFixed && edited.ratePct != null && edited.variableAfter?.floorPct != null
    && edited.ratePct < edited.variableAfter.floorPct - 0.005) {
    return `A ${edited.ratePct}% fixed rate cannot sit below its own ${edited.variableAfter.floorPct}% floor.`;
  }
  return null;
}

/** Resolve a card's CURRENT value for a field — used by a bulk shift, which cannot
 *  compute a delta against a blank. */
export function currentCardValue(q: RateQuote, field: string): number | null {
  if (field === "ratePct") return q.ratePct ?? null;
  if (field === "followOn" || field === "marginPct") return q.variableAfter?.marginPct ?? q.marginPct ?? null;
  if (field === "floorPct") return q.variableAfter?.floorPct ?? q.floorPct ?? null;
  return null;
}

/** The value a bulk edit produces for one card. "shift" may move a card by a delta. */
export function bulkNextValue(q: RateQuote, field: string, mode: "set" | "shift", value: number | null): number | null {
  if (value == null) return null;
  if (mode === "set") return value;
  const cur = currentCardValue(q, field);
  return cur == null ? null : Math.round((cur + value) * 1000) / 1000;
}


export interface ProductPricing {
  quotes: RateQuote[];
}

/* ---------------- tier 0: UAE norms (inherited defaults) ---------------- */

/**
 * The CBUAE / UAE-market norms a bank INHERITS unless it explicitly overrides.
 *
 * IMPORTANT: these are DEFAULTS, not authority. They deliberately do not win over
 * a bank's own value — DIB counts 2% of card limits where the norm is 5%, ENBD
 * counts 50% of bonus where the norm is 0%. If the norms layer sat above the bank
 * it would erase exactly the facts that win cases. A bank row that leaves a field
 * null inherits the value here; see resolveNorm() in bank-match.ts.
 */
export interface UaeNorms {
  maxDbrPct: number;          // CBUAE ceiling 50
  cardRulePct: number;        // % of credit-card limits counted in DBR
  bonusPct: number;           // % of bonus income counted
  rentalIncomePct: number;    // % of rental income counted
  rentalCapPctOfSalary: number; // rental credit capped at this % of primary salary
  maxTenorYears: number;      // 25 — the UAE norm when a product states none
  maxAgeAtMaturitySalaried: number;
  maxAgeAtMaturitySelfEmp: number;
  processingMonths: number;   // application -> first EMI lag, deducted from tenure
  /** Fallback stress buffer when a product records none. An UNRECORDED buffer is
   *  not the same as a real zero — using 0 here would qualify clients with no
   *  cushion at all, so we default to the norm and flag it as assumed. */
  defaultStressBufferPct: number;
}

export const UAE_NORMS: UaeNorms = {
  maxDbrPct: 50,
  cardRulePct: 5,
  bonusPct: 0,
  rentalIncomePct: 0,
  rentalCapPctOfSalary: 50,
  maxTenorYears: 25,
  maxAgeAtMaturitySalaried: 65,
  maxAgeAtMaturitySelfEmp: 70,
  processingMonths: 3,
  defaultStressBufferPct: 0,
};

/* ---------------- tier 1: HFMC pricing floor ---------------- */

/**
 * The minimum WE will sell at, independent of what the bank allows. Admin-owned
 * (Admin → Pricing → Floor), effective-dated, and enforced in exactly one place:
 * applyFloor() inside resolveQuote(). Unset fields impose no restriction, so an
 * empty floor is a no-op and the golden tests prove behaviour is unchanged.
 */
export interface PricingFloor {
  /** Never quote a variable rate below EIBOR + this many bps. */
  minMarginBps?: number | null;
  /** Never quote a fixed rate below this percent. */
  minFixedRatePct?: number | null;
  /** Never accept a deal whose net commission falls below this percent. */
  minNetCommissionPct?: number | null;
  /** Refuse to price at all below this percent. */
  hardStopPct?: number | null;
  updatedBy?: string;
  updatedAt?: string;
}

export const EMPTY_FLOOR: PricingFloor = {};

/** Outcome of running one quote through the floor. */
export interface FloorResult {
  quote: RateQuote;
  /** The figure the floor was applied to (fixed ratePct, or margin for variable). */
  effectivePct: number | null;
  /** true when the floor RAISED the quote above what the bank published. */
  raised: boolean;
  /** true when the quote is below hardStopPct — the engine must not price it. */
  blocked: boolean;
  note: string | null;
}

/**
 * Apply the HFMC floor to a resolved quote. Returns a NEW quote; the caller's
 * stored row is never mutated. Comparison is in basis points so 3.895 vs 3.89
 * doesn't trip a false breach from float noise.
 */
export function applyFloor(q: RateQuote, floor: PricingFloor = EMPTY_FLOOR): FloorResult {
  const EPS = 0.005; // half a basis point of tolerance
  if (q.rateType === "FIXED") {
    const rate = q.ratePct;
    if (rate == null) return { quote: q, effectivePct: null, raised: false, blocked: false, note: null };
    if (floor.hardStopPct != null && rate < floor.hardStopPct - EPS) {
      return {
        quote: q, effectivePct: rate, raised: false, blocked: true,
        note: `below hard stop (${floor.hardStopPct}%) — not priced`,
      };
    }
    if (floor.minFixedRatePct != null && rate < floor.minFixedRatePct - EPS) {
      const raised = floor.minFixedRatePct;
      return {
        quote: { ...q, ratePct: raised, note: `${q.note ? q.note + " — " : ""}raised to HFMC floor` },
        effectivePct: raised, raised: true, blocked: false,
        note: `raised ${rate}% → ${raised}% (HFMC floor)`,
      };
    }
    return { quote: q, effectivePct: rate, raised: false, blocked: false, note: null };
  }
  // variable: the floor is expressed as a margin over the benchmark
  const margin = q.marginPct;
  if (margin == null) return { quote: q, effectivePct: null, raised: false, blocked: false, note: null };
  if (floor.hardStopPct != null && margin < floor.hardStopPct - EPS) {
    return { quote: q, effectivePct: margin, raised: false, blocked: true, note: `margin below hard stop — not priced` };
  }
  if (floor.minMarginBps != null) {
    const minMargin = floor.minMarginBps / 100;
    if (margin < minMargin - EPS) {
      return {
        quote: { ...q, marginPct: minMargin, note: `${q.note ? q.note + " — " : ""}raised to HFMC floor` },
        effectivePct: minMargin, raised: true, blocked: false,
        note: `margin ${margin}% → ${minMargin}% (HFMC floor)`,
      };
    }
  }
  return { quote: q, effectivePct: margin, raised: false, blocked: false, note: null };
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
  /** NEW property/segment axes — sourced from LoanCase canonical columns. */
  stage?: string | null;          // OFF_PLAN | HANDOVER | COMPLETED
  purpose?: string | null;         // PURCHASE | REFINANCE | EQUITY_RELEASE | REFINANCE_AND_EQUITY
  propertyTypeCanonical?: string | null; // RESIDENTIAL | COMMERCIAL
  profile?: string | null;         // customer profile tier ("Standard", "Preferential Pricing"…)
  ratePref?: "fixed" | "flexible"; // prefer fixed-for-term or EIBOR-linked quotes
  on?: string;               // evaluation date (ISO). Default: today
  /** Tier-1 HFMC floor. Empty = no restriction, so behaviour is unchanged. */
  floor?: PricingFloor;
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
  if (q.stages?.length) n++;
  if (q.purposes?.length) n++;
  if (q.propertyTypes?.length) n++;
  if (q.profiles?.length) n++;
  if (q.nationalityRule && q.nationalityRule.mode !== "ALL") n++;
  return n;
}

/** Does a single quote match the requested dimensions? */
export function quoteMatches(q: RateQuote, req: QuoteMatchInput): boolean {
  // a deliberately closed slot is not offered — it must never match, whatever
  // its axes say. This is the one fact a CLOSED line asserts.
  if (q.status === "CLOSED") return false;
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
  if (req.stage != null && !setMatches(q.stages, req.stage)) return false;
  if (req.purpose != null && !setMatches(q.purposes, req.purpose)) return false;
  if (req.propertyTypeCanonical != null && !setMatches(q.propertyTypes, req.propertyTypeCanonical)) return false;
  if (req.profile != null && !setMatches(q.profiles, req.profile)) return false;
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
  // Tier-1 HFMC floor — the ONE place a floor is enforced. Runs after ranking so
  // it always applies to the winning line. A blocked line is removed and we fall
  // through to the next best one rather than pricing below our own floor.
  if (req.floor) {
    const pass: RateQuote[] = [];
    for (const m of matches) {
      const r = applyFloor(m, req.floor);
      if (!r.blocked) pass.push(r.quote);
    }
    matches = pass;
    if (matches.length === 0) return null;
  }
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
  introRatePct: number | null;   // DBR 1 — what the client pays during the fixed period
  introTermYears: number | null; // null/0 = no intro period (day-1 variable)
  followOnRatePct: number | null; // DBR 2 — what they pay after intro (margin + current EIBOR, floored)
  stressRatePct: number | null;  // DBR 3 — what the bank qualifies them at (DSR assessment)
  /** The EIBOR curve DBR 2/3 were computed against, baked in so a later EIBOR move
   *  cannot silently reprice an old verdict. When null, today's live curve was used. */
  eiborAtComputation?: EiborCurve | null;
  /** Where the stress number came from: the bank's own rule, its legacy buffer, or
   *  nothing at all (in which case it IS the follow-on and there is no cushion). */
  stressSource?: StressOutcome["source"];
  stressNote?: string;
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
    // DBR 3 is resolved as a TYPED rule, not `followOn + buffer`. With no rule filed
    // this lands on `bank-buffer` / `follow-on-fallback`, i.e. identical to the old
    // arithmetic — so wiring it changes nothing until a stress rule is actually filed.
    const st = resolveStress(q, followOn, eibor, stressBufferPct);
    return {
      introRatePct: q.ratePct ?? null,
      introTermYears: q.termYears ?? null,
      followOnRatePct: followOn,
      stressRatePct: st.ratePct,
      stressSource: st.source,
      stressNote: st.note,
      eiborAtComputation: { ...eibor },
    };
  }
  // day-1 variable: intro == follow-on == stress
  const tenor = q.rateType.replace("_EIBOR", "") as EiborTenor;
  const rate = varRate(tenor, q.marginPct, q.floorPct);
  const st = resolveStress(q, rate, eibor, stressBufferPct);
  return {
    introRatePct: rate,
    introTermYears: 0,
    followOnRatePct: rate,
    stressRatePct: st.ratePct,
    stressSource: st.source,
    stressNote: st.note,
    eiborAtComputation: { ...eibor },
  };
}
