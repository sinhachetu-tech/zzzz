// Structured bank fees + insurance - fully typed for the pricing engine.
// Every field that previously lived only as free text in BankProduct.fees/insurance
// is now a structured, computable number. The Admin Fee Editor saves to feesJson;
// the bank-match engine reads from here; the proposal print page also reads here.

/* --------------- Core types --------------- */

export interface BankFees {
  processing: {
    /** % of loan amount (default segment, e.g. 1.05 means 1.05%) */
    default?: number;
    /** % for equity-release / cashout portion */
    equityRelease?: number;
    /** % for buyout / balance transfer */
    buyout?: number;
    /** Minimum AED charge regardless of % calculation */
    minFee?: number;
    /** AED cap (e.g. some banks cap at AED 30,000) */
    maxFee?: number;
    /** VAT note, exclusions, etc. */
    note?: string;
  };
  preApproval?: {
    /** AED fixed fee for salaried clients (generic / default) */
    fee?: number;
    /** AED fee specifically for STL clients */
    feeStl?: number;
    /** AED fee specifically for NSTL clients */
    feeNstl?: number;
    /** AED fee for self-employed (often free or different) */
    feeSelfEmployed?: number;
    note?: string;
  };
  valuation?: {
    /** Descriptive note - e.g. "AED 2,500-5,000 depending on property value" */
    note?: string;
  };
  earlySettlement?: {
    /** % of outstanding balance at time of settlement */
    pct?: number;
    /** Minimum AED charge */
    minFee?: number;
    /** AED cap on the early settlement charge */
    cap?: number;
    /** Waived after this many years (some banks: free after year 5) */
    freeAfterYears?: number;
    note?: string;
  };
  partialSettlement?: {
    /** % of original loan that can be repaid free per year (ENBD: 25-30%) */
    freeYearlyPct?: number;
    /** Penalty % on amounts above the free threshold */
    pct?: number;
    /** AED cap on the penalty */
    cap?: number;
    note?: string;
  };
}

export interface BankInsurance {
  life?: {
    basis: "per_million_monthly" | "pct_pa_of_loan";
    rate: number;
    note?: string;
  };
  property?: {
    basis: "pct_pa_of_property";
    rate: number;
    note?: string;
  };
}

/* --------------- Parsers --------------- */

export function parseFees(json: string | null | undefined): BankFees | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as BankFees) : null;
  } catch {
    return null;
  }
}

export function parseInsurance(json: string | null | undefined): BankInsurance | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as BankInsurance) : null;
  } catch {
    return null;
  }
}

/* --------------- Fee calculators --------------- */

/** Processing fee % for a transaction. Falls back from segment to default. */
export function processingFeePct(fees: BankFees | null, txn: string): number | null {
  if (!fees?.processing) return null;
  if ((txn === "Equity Release" || txn === "Buyout + Equity Release") && fees.processing.equityRelease != null)
    return fees.processing.equityRelease;
  if (txn.startsWith("Buyout") && fees.processing.buyout != null)
    return fees.processing.buyout;
  return fees.processing.default ?? null;
}

/** Processing fee in AED for a loan amount. Respects minFee and maxFee. */
export function processingFeeAed(fees: BankFees | null, txn: string, loanAmount: number): number | null {
  const pct = processingFeePct(fees, txn);
  if (pct == null) return null;
  let aed = Math.round((loanAmount * pct) / 100);
  if (fees!.processing.minFee != null) aed = Math.max(aed, fees!.processing.minFee);
  if (fees!.processing.maxFee != null) aed = Math.min(aed, fees!.processing.maxFee);
  return aed;
}

/** Pre-approval fee in AED. Picks STL/NSTL/selfEmployed/generic depending on opts. */
export function preApprovalFeeAed(
  fees: BankFees | null,
  opts: { stl?: boolean; selfEmployed?: boolean } = {},
): number | null {
  const pa = fees?.preApproval;
  if (!pa) return null;
  if (opts.selfEmployed && pa.feeSelfEmployed != null) return pa.feeSelfEmployed;
  if (opts.stl === true && pa.feeStl != null) return pa.feeStl;
  if (opts.stl === false && pa.feeNstl != null) return pa.feeNstl;
  return pa.fee ?? null;
}

/** Early settlement charge in AED on an outstanding balance. Respects minFee and cap. */
export function earlySettlementChargeAed(fees: BankFees | null, outstandingBalance: number): number | null {
  const es = fees?.earlySettlement;
  if (!es || es.pct == null) return null;
  let aed = Math.round((outstandingBalance * es.pct) / 100);
  if (es.minFee != null) aed = Math.max(aed, es.minFee);
  if (es.cap != null) aed = Math.min(aed, es.cap);
  return aed;
}

/** Annual free partial settlement amount in AED. */
export function partialSettlementFreeAed(fees: BankFees | null, originalLoan: number): number | null {
  const ps = fees?.partialSettlement;
  if (!ps || ps.freeYearlyPct == null) return null;
  return Math.round((originalLoan * ps.freeYearlyPct) / 100);
}

/* --------------- Insurance calculators --------------- */

/** Life insurance monthly cost for a loan amount. */
export function lifeInsuranceMonthly(ins: BankInsurance | null, loanAmount: number): number | null {
  const life = ins?.life;
  if (!life) return null;
  if (life.basis === "per_million_monthly")
    return Math.round(((loanAmount * life.rate) / 100) * 10) / 10;
  if (life.basis === "pct_pa_of_loan")
    return Math.round(((loanAmount * life.rate) / 100 / 12) * 10) / 10;
  return null;
}

/** Property insurance yearly cost for a property value. */
export function propertyInsuranceYearly(ins: BankInsurance | null, propertyValue: number): number | null {
  const pr = ins?.property;
  if (!pr) return null;
  return Math.round((propertyValue * pr.rate) / 100);
}

/* --------------- Total cost of finance --------------- */

export interface TotalCostBreakdown {
  /** Total EMI payments over the full tenor */
  totalRepayment: number;
  /** Processing fee paid upfront */
  processingFeeAed: number | null;
  /** Total life insurance over tenor (monthly ? months) */
  totalLifeInsurance: number | null;
  /** Pre-approval fee (one-time) */
  preApprovalFeeAed: number | null;
  /** Indicative total outflow to bank + insurance */
  grandTotal: number | null;
  /** Indicative total interest = totalRepayment - loanAmount */
  totalInterest: number;
}

/** Indicative total cost of finance over the full tenor. */
export function totalCostOfFinance(
  loanAmount: number,
  tenorYears: number,
  monthlyEmi: number,
  fees: BankFees | null,
  insurance: BankInsurance | null,
  txn = "Resale",
  stl = true,
): TotalCostBreakdown {
  const months = tenorYears * 12;
  const totalRepayment = Math.round(monthlyEmi * months);
  const totalInterest = Math.max(0, totalRepayment - loanAmount);
  const procFee = processingFeeAed(fees, txn, loanAmount);
  const lifeMonthly = lifeInsuranceMonthly(insurance, loanAmount);
  const totalLife = lifeMonthly != null ? Math.round(lifeMonthly * months) : null;
  const paFee = preApprovalFeeAed(fees, { stl }) ?? 0;
  const grand = totalRepayment + (procFee ?? 0) + (totalLife ?? 0) + paFee;
  return {
    totalRepayment,
    processingFeeAed: procFee,
    totalLifeInsurance: totalLife,
    preApprovalFeeAed: paFee > 0 ? paFee : null,
    grandTotal: grand,
    totalInterest,
  };
}

/* --------------- Axes JSON migrator --------------- */

/**
 * Parse a BankProduct's raw axesJson and extract structured fees + insurance.
 * Used by the "Sync from axes" admin button - never overwrites if value already exists.
 */
export function extractFromAxes(axesJson: string | null | undefined): { fees: BankFees; insurance: BankInsurance } {
  const fees: BankFees = { processing: {} };
  const insurance: BankInsurance = {};
  let axes: Record<string, string> = {};
  try {
    if (axesJson) axes = JSON.parse(axesJson) as Record<string, string>;
  } catch {
    return { fees, insurance };
  }

  // Processing fee - "0.0105" decimal or "1.05%"
  const procRaw = axes["Processing Fee"] ?? "";
  const procPct = _parseProcFeeDecimalOrPct(procRaw);
  if (procPct != null) fees.processing.default = procPct;
  const procMax = _parseKilo(procRaw, /(?:whichever lower|cap|max)/i);
  if (procMax != null) fees.processing.maxFee = procMax;

  // Pre-approval fee - "1575/-\n-Free" ? salaried 1575, self-employed 0
  const paRaw = (axes["Pre Approval Fee"] ?? "").replace(/\u2014/g, "\n");
  const paLines = paRaw.split(/\n/).map((s) => s.trim()).filter(Boolean);
  if (paLines.length >= 1) {
    const v1 = _parseAedFixed(paLines[0]);
    if (v1 != null) fees.preApproval = { fee: v1 };
    else if (/free/i.test(paLines[0])) fees.preApproval = { fee: 0 };
  }
  if (paLines.length >= 2 && fees.preApproval) {
    const v2 = _parseAedFixed(paLines[1]);
    if (v2 != null) fees.preApproval.feeSelfEmployed = v2;
    else if (/free/i.test(paLines[1])) fees.preApproval.feeSelfEmployed = 0;
  }

  // Valuation fee note
  const valRaw = axes["Valuation Fee"] ?? "";
  if (valRaw.trim()) fees.valuation = { note: valRaw.slice(0, 200) };

  // Early settlement
  const esRaw = (axes["Early Settlement"] ?? "").split(/\n/)[0] ?? "";
  const esPct = _parsePct(esRaw);
  const esCap = _parseKilo(esRaw, /(?:whichever lower|cap|max)/i);
  if (esPct != null || esCap != null) {
    fees.earlySettlement = { note: esRaw.slice(0, 120) };
    if (esPct != null) fees.earlySettlement.pct = esPct;
    if (esCap != null) fees.earlySettlement.cap = esCap;
  }

  // Partial settlement
  const psRaw = (axes["Partial Settlement"] ?? "").split(/\n/)[0] ?? "";
  if (/free/i.test(psRaw)) {
    const freePct = _parsePct(psRaw.replace(/penalty/i, ""));
    fees.partialSettlement = { freeYearlyPct: freePct ?? undefined, note: psRaw.slice(0, 120) };
  } else {
    const psPct = _parsePct(psRaw);
    const psCap = _parseKilo(psRaw, /(?:whichever lower|cap)/i);
    if (psPct != null || psCap != null) {
      fees.partialSettlement = { note: psRaw.slice(0, 120) };
      if (psPct != null) fees.partialSettlement.pct = psPct;
      if (psCap != null) fees.partialSettlement.cap = psCap;
    }
  }

  // Life insurance - "0.03 p.m on loan outstanding"
  const lifeRaw = (axes["Life Insurance"] ?? "").split(/\n/)[0] ?? "";
  if (/p\.m|per month|monthly/i.test(lifeRaw)) {
    const rate = _parseSmallDecimalOrPct(lifeRaw);
    if (rate != null) insurance.life = { basis: "per_million_monthly", rate, note: lifeRaw.slice(0, 120) };
  } else if (/p\.a|per annum|annual/i.test(lifeRaw)) {
    const rate = _parseSmallDecimalOrPct(lifeRaw);
    if (rate != null) insurance.life = { basis: "pct_pa_of_loan", rate, note: lifeRaw.slice(0, 120) };
  }

  // Property insurance - "0.035% p.a."
  const propRaw = (axes["Property Insurance"] ?? "").split(/\n/)[0] ?? "";
  const propRate = _parseSmallDecimalOrPct(propRaw);
  if (propRate != null) insurance.property = { basis: "pct_pa_of_property", rate: propRate, note: propRaw.slice(0, 120) };

  return { fees, insurance };
}

/* --------------- private helpers --------------- */

function _parseProcFeeDecimalOrPct(s: string): number | null {
  const pctM = s.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pctM) return parseFloat(pctM[1]);
  // "0.0105" raw decimal - convert to percentage
  const decM = s.match(/\b(0\.\d{4,})\b/);
  if (decM) return Math.round(parseFloat(decM[1]) * 10000) / 100;
  return null;
}

function _parsePct(s: string): number | null {
  const m = s.match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? parseFloat(m[1]) : null;
}

function _parseKilo(s: string, contextRe: RegExp): number | null {
  // Match a number before a context pattern (e.g. "10k whichever lower")
  const idx = s.search(contextRe);
  if (idx === -1) return null;
  const before = s.slice(0, idx);
  const m = before.match(/(\d[\d,]*)([kK]?)\s*(?:aed|AED)?\s*$/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, "")) * (/k/i.test(m[2]) ? 1000 : 1);
  return n > 100 ? Math.round(n) : null;
}

function _parseAedFixed(s: string): number | null {
  const m = s.replace(/,/g, "").match(/(\d{3,6})\s*\/?-?/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function _parseSmallDecimalOrPct(s: string): number | null {
  const pctM = s.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pctM) return parseFloat(pctM[1]);
  const decM = s.match(/\b(0\.\d{2,6})\b/);
  if (decM) return parseFloat(decM[1]);
  return null;
}
