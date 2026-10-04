// Bank Rules taxonomy + parsing — canonical vocabulary that normalizes the
// different ways banks name the same things, and typed parsers that turn the
// Excel's free text into engine-usable numbers. Phase 0 of the rule engine.

/** Canonical transaction types — every bank's naming maps onto these. */
export const CANONICAL_TXN = [
  "Primary Purchase",      // fresh / direct from developer / handover (ready)
  "Primary Handover",      // off-plan handover stage
  "Resale",                // secondary market
  "Off-Plan",              // under construction
  "Buyout",                // moving an existing mortgage
  "Equity Release",        // cash-out against owned property
  "Land",                  // land purchase
  "Self-Construction",     // building finance
  "LAP",                   // loan against property (commercial)
] as const;
export type CanonicalTxn = (typeof CANONICAL_TXN)[number];

/** Bank-side synonyms → canonical. Grows as more banks are imported. */
export const TXN_ALIASES: Record<string, CanonicalTxn> = {
  "fresh": "Primary Purchase", "direct": "Primary Purchase", "new purchase": "Primary Purchase",
  "primary": "Primary Purchase", "handover from developer": "Primary Handover", "handover": "Primary Handover",
  "final payment": "Primary Handover",
  "secondary": "Resale", "second hand": "Resale",
  "under construction": "Off-Plan", "offplan": "Off-Plan", "off plan": "Off-Plan",
  "buy-out": "Buyout", "buy out": "Buyout", "balance transfer": "Buyout",
  "equity": "Equity Release", "cash out": "Equity Release", "cashout": "Equity Release", "refinance": "Equity Release", "top up": "Equity Release", "topup": "Equity Release",
  "land purchase": "Land", "plot": "Land", "land fin": "Land",
  "self const": "Self-Construction", "self-construction": "Self-Construction", "building finance": "Self-Construction", "bldg fin": "Self-Construction",
  "loan against property": "LAP", "mortgage loan against property": "LAP",
};

export function canonicalTxn(text: string): CanonicalTxn | null {
  const raw = text.toLowerCase().trim();
  if (TXN_ALIASES[raw]) return TXN_ALIASES[raw];
  // hyphens/underscores are word glue ("Off-Plan" == "off plan"); single-word
  // aliases match whole words only so fragments ("stl") can never alias.
  const t = raw.replace(/[-_]+/g, " ");
  const words = new Set(t.replace(/[0-9]+/g, " ").split(/[^a-z]+/).filter(Boolean));
  for (const [alias, canon] of Object.entries(TXN_ALIASES)) {
    const flat = alias.replace(/[-_]+/g, " ");
    const parts = flat.split(/[^a-z]+/).filter(Boolean);
    if (parts.length === 1) {
      if (words.has(parts[0])) return canon;
    } else if (t.includes(flat)) return canon;
  }
  for (const c of CANONICAL_TXN) {
    const cl = c.toLowerCase().replace(/[-_]+/g, " ");
    if (cl.includes(" ") ? t.includes(cl) : words.has(cl)) return c;
  }
  return null;
}

/** Pricing/product dimensions that cut across transaction types (bank-specific names normalized). */
export const SALARY_TRANSFER = ["STL", "NSTL"] as const;         // salary transfer vs non-salary transfer
export const FTV_BANDS = ["<=60%", ">60%"] as const;             // finance-to-value bands (DIB uses these)
export const PRODUCT_KINDS = ["Conventional", "Islamic"] as const;

export const EMPLOYMENT_SEGMENTS = ["Salaried", "Self-Employed", "Salaried or Self-Employed"] as const;
export const RESIDENCY_SEGMENTS = ["Resident", "Non-Resident"] as const;
export const FINANCE_TYPES = ["Residential", "Commercial"] as const;

/* ---------- Phase 1: multi-axis applicability (sets, not scalars) ---------- */

/** A quote field set to null/[]/"any" matches every case. Otherwise the case
 *  value must be IN the set. This gives "few, some, or all" for free. */
export type ApplicabilitySet = string[] | null | undefined;

export function setMatches(set: ApplicabilitySet, value: string | null | undefined): boolean {
  if (set == null || set.length === 0) return true;
  if (set.length === 1 && set[0].toLowerCase() === "any") return true;
  // A wildcard request ("any", e.g. the calculator's relaxed-rescue path) matches
  // any declared set — it means "show me priced options regardless of this axis".
  if (value != null && value.toLowerCase().trim() === "any") return true;
  if (value == null || value === "") return false;
  const v = value.toLowerCase().trim();
  return set.some((s) => String(s).toLowerCase().trim() === v);
}

/** Nationality gating: ALL = every passport, ALLOW = only listed, DENY = all except listed. */
export interface NationalityRule {
  mode: "ALL" | "ALLOW" | "DENY";
  countries: string[];
}

export function nationalityAllowed(rule: NationalityRule | null | undefined, nationality: string | null | undefined): boolean {
  if (rule == null || rule.mode === "ALL" || rule.countries.length === 0) return true;
  if (!nationality) return true; // unknown passport never blocks — surfaced via nationalityUnverified() below
  const hit = rule.countries.some((c) => c.toLowerCase().trim() === nationality.toLowerCase().trim());
  return rule.mode === "ALLOW" ? hit : !hit;
}

/**
 * The THIRD state the engine was missing.
 *
 * A quote that gates on nationality will "pass" when the case has no passport
 * recorded, because we refuse to guess a rejection. That is the right call for the
 * verdict (never invent a failure) but it must not be SILENT — otherwise a
 * restricted product is presented to a client whose passport we simply never asked
 * for. Returns the list of constrained-but-unknown axes so the UI can show
 * "needs verification" instead of a confident ✓.
 */
export function unknownAxes(q: RateQuoteLike, req: QuoteMatchInputLike): string[] {
  const gaps: string[] = [];
  if (req.nationality == null || req.nationality === "") {
    if (q.nationalityRule && q.nationalityRule.mode !== "ALL" && q.nationalityRule.countries.length > 0) {
      gaps.push(`nationality (${q.nationalityRule.mode}-list not checked — passport unknown)`);
    }
  }
  return gaps;
}
type RateQuoteLike = { nationalityRule?: NationalityRule | null };
type QuoteMatchInputLike = { nationality?: string | null };

/** Bank segment synonyms → display label. Grows as more banks are imported. */
export const SEGMENT_ALIASES: Record<string, string> = {
  "geco": "GECO",
  "auh developer": "AUH Developer", "abu dhabi developer": "AUH Developer", "auh": "AUH Developer",
  "prb": "PRB", "private": "Private", "premier": "Premier", "advance": "Advance",
  "szhp": "SZHP", "sheikh zayed": "SZHP",
  "etb": "ETB", "ntb": "NTB",
  "others": "Others", "all other segment": "Others", "all others": "Others",
  "standard": "Standard", "premium": "Premium",
};

export function canonicalSegment(text: string): string | null {
  const t = text.toLowerCase();
  for (const [alias, canon] of Object.entries(SEGMENT_ALIASES)) if (t.includes(alias)) return canon;
  return null;
}

/** FINAL PROPERTY CLASSIFICATION PLAN — canonical enums (additive, UNKNOWN-safe). */
export const PROPERTY_TYPES = ["RESIDENTIAL", "COMMERCIAL", "UNKNOWN"] as const;
export const COMMERCIAL_SUBTYPES = [
  "OFFICE", "RETAIL_SHOP", "WAREHOUSE", "INDUSTRIAL", "HOTEL_HOSPITALITY",
  "MIXED_USE", "LAND_PLOT", "OTHER_COMMERCIAL", "UNKNOWN",
] as const;
export const PROPERTY_STAGES = ["OFF_PLAN", "HANDOVER", "COMPLETED", "UNKNOWN"] as const;
export const CONSTRUCTION_STATUSES = ["NOT_STARTED", "UNDER_CONSTRUCTION", "COMPLETED", "UNKNOWN"] as const;
export const PARTY_RELATIONSHIPS = ["DEVELOPER", "EXISTING_OWNER", "SELF", "UNKNOWN"] as const;
export const EXISTING_FINANCE = ["NONE", "MORTGAGE", "UNKNOWN"] as const;
export const TRANSACTION_PURPOSES = ["PURCHASE", "REFINANCE", "EQUITY_RELEASE", "REFINANCE_AND_EQUITY"] as const;

/** "2 & 3 Years" / "8-10 Years" / "16-20 Years" → [2,3] / [8,9,10] / [16..20].
 *  Returns null when no year range is found (caller keeps the contextual default). */
export function expandFixedYearLabel(label: string): number[] | null {
  const t = label.replace(/&/g, "-").replace(/to/gi, "-");
  // range: "8-10 years", "8 - 10 yrs", "16-20 years"
  const range = t.match(/(\d{1,2})\s*-\s*(\d{1,2})\s*(?:years?|yrs?)/i);
  if (range) {
    const a = parseInt(range[1], 10), b = parseInt(range[2], 10);
    if (a >= 1 && b <= 30 && b >= a) {
      const out: number[] = [];
      for (let y = a; y <= b; y++) out.push(y);
      return out;
    }
  }
  // conjunction: "2 & 3 years", "2, 3 years"
  const conj = t.match(/(\d{1,2})\s*[,/&+]\s*(\d{1,2})\s*(?:years?|yrs?)/i);
  if (conj) {
    const a = parseInt(conj[1], 10), b = parseInt(conj[2], 10);
    if (a >= 1 && b >= 1 && a <= 30 && b <= 30) return [a, b];
  }
  const single = t.match(/(\d{1,2})\s*(?:years?|yrs?)/i);
  if (single) {
    const y = parseInt(single[1], 10);
    if (y >= 1 && y <= 30) return [y];
  }
  return null;
}

/* ---------- typed parsers for the Excel's free text ---------- */

export function parseMoney(text: string): number | null {
  if (!text) return null;
  const m = /([\d][\d,]*(?:\.\d+)?)\s*(k\b|m\b|million)?/i.exec(text.replace(/,/g, ","));
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ""));
  if (Number.isNaN(n)) return null;
  if (/m\b|million/i.test(m[2] ?? "")) n *= 1_000_000;
  else if (/k\b/i.test(m[2] ?? "")) n *= 1_000;
  if (n < 1000 && !m[2]) return null; // "250000" without separators still parses; tiny numbers are junk
  return Math.round(n);
}

export function parsePct(text: string): number | null {
  if (!text) return null;
  const m = /(\d+(?:\.\d+)?)\s*%/.exec(text);
  if (!m) {
    // decimals like "0.6" meaning 60% LTV, or "0.0199" meaning a rate
    const d = /^\s*0?\.(\d+)/.exec(text);
    return null;
  }
  return parseFloat(m[1]);
}

/** "Up to 85% Locals, 80% Expats (Land Purchase: 70%)" → { national: 85, expatriate: 80 } */
export function parseLtv(text: string): { national: number | null; expatriate: number | null } {
  const out = { national: null as number | null, expatriate: null as number | null };
  if (!text) return out;
  const nat = /(\d{2})\s*%\s*(?:for\s*)?(locals|nationals|uae national)/i.exec(text);
  const exp = /(\d{2})\s*%\s*(?:for\s*)?(expats?|expatriates?)/i.exec(text);
  if (nat) out.national = parseInt(nat[1], 10);
  if (exp) out.expatriate = parseInt(exp[1], 10);
  if (!out.national && !out.expatriate) {
    const any = /(?:up to\s*)?(\d{2})\s*%/i.exec(text);
    if (any) out.national = parseInt(any[1], 10);
  }
  return out;
}

export function parseYears(text: string): number | null {
  const m = /(\d{2})\s*(?:years?|yrs?)/i.exec(text) ?? /^\s*(\d{2})\s*$/.exec(text.trim());
  if (m) { const n = parseInt(m[1], 10); if (n >= 5 && n <= 40) return n; }
  const plain = parseInt(text.trim(), 10);
  return Number.isFinite(plain) && plain >= 5 && plain <= 40 ? plain : null;
}

export function parseIntLoose(text: string): number | null {
  if (!text) return null;
  const m = /([\d,]+(?:\.\d+)?)/.exec(text.replace(/,/g, ","));
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function isIslamic(loanType: string): boolean {
  return /islamic/i.test(loanType) && !/and|&|conventional/i.test(loanType.replace("Islamic Only", "").trim() + "");
}
