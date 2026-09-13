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
  "secondary": "Resale", "second hand": "Resale",
  "under construction": "Off-Plan", "offplan": "Off-Plan", "off plan": "Off-Plan",
  "buy-out": "Buyout", "buy out": "Buyout", "balance transfer": "Buyout",
  "equity": "Equity Release", "cash out": "Equity Release", "cashout": "Equity Release", "refinance": "Equity Release",
  "land purchase": "Land", "plot": "Land",
  "self const": "Self-Construction", "self-construction": "Self-Construction",
  "loan against property": "LAP", "mortgage loan against property": "LAP",
};

export function canonicalTxn(text: string): CanonicalTxn | null {
  const t = text.toLowerCase().trim();
  if (TXN_ALIASES[t]) return TXN_ALIASES[t];
  for (const [alias, canon] of Object.entries(TXN_ALIASES)) if (t.includes(alias)) return canon;
  for (const c of CANONICAL_TXN) if (t.includes(c.toLowerCase())) return c;
  return null;
}

/** Pricing/product dimensions that cut across transaction types (bank-specific names normalized). */
export const SALARY_TRANSFER = ["STL", "NSTL"] as const;         // salary transfer vs non-salary transfer
export const FTV_BANDS = ["<=60%", ">60%"] as const;             // finance-to-value bands (DIB uses these)
export const PRODUCT_KINDS = ["Conventional", "Islamic"] as const;

export const EMPLOYMENT_SEGMENTS = ["Salaried", "Self-Employed", "Salaried or Self-Employed"] as const;
export const RESIDENCY_SEGMENTS = ["Resident", "Non-Resident"] as const;
export const FINANCE_TYPES = ["Residential", "Commercial"] as const;

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
