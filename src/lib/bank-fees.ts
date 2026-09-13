// Structured bank fees + insurance — Phase 3.5.
// These power the proposal cost sheet: processing fee per transaction,
// early/partial settlement, and life/property insurance estimates.

export interface BankFees {
  processing: {
    default?: number;       // % of loan, default segment
    equityRelease?: number; // % for equity-release portion
    buyout?: number;
    note?: string;
  };
  earlySettlement?: { pct?: number; cap?: number; note?: string };
  partialSettlement?: { freeYearlyPct?: number; pct?: number; cap?: number; note?: string };
}

export interface BankInsurance {
  life?: { basis: "per_million_monthly" | "pct_pa_of_loan"; rate: number; note?: string };
  property?: { basis: "pct_pa_of_property"; rate: number; note?: string };
}

export function parseFees(json: string | null | undefined): BankFees | null {
  if (!json) return null;
  try { const v = JSON.parse(json); return v && typeof v === "object" ? v as BankFees : null; } catch { return null; }
}
export function parseInsurance(json: string | null | undefined): BankInsurance | null {
  if (!json) return null;
  try { const v = JSON.parse(json); return v && typeof v === "object" ? v as BankInsurance : null; } catch { return null; }
}

/** Processing fee % for a transaction (falls back to the default segment). */
export function processingFeePct(fees: BankFees | null, txn: string): number | null {
  if (!fees?.processing) return null;
  if (txn === "Equity Release" && fees.processing.equityRelease != null) return fees.processing.equityRelease;
  if (txn.startsWith("Buyout") && fees.processing.buyout != null) return fees.processing.buyout;
  return fees.processing.default ?? null;
}

/** Life insurance monthly cost for a loan amount. */
export function lifeInsuranceMonthly(ins: BankInsurance | null, loanAmount: number): number | null {
  const life = ins?.life;
  if (!life) return null;
  if (life.basis === "per_million_monthly") return Math.round(((loanAmount * life.rate) / 100) * 10) / 10; // rate is % of loan per month (0.01849% per million ≡ this)
  if (life.basis === "pct_pa_of_loan") return Math.round(((loanAmount * life.rate) / 100 / 12) * 10) / 10;
  return null;
}

/** Property insurance yearly cost for a property value. */
export function propertyInsuranceYearly(ins: BankInsurance | null, propertyValue: number): number | null {
  const pr = ins?.property;
  if (!pr) return null;
  return Math.round((propertyValue * pr.rate) / 100);
}
