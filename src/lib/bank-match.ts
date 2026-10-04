// Bank Match engine — Phase 2. Feeds a case profile through every approved
// bank product: resolves the pricing quote, computes the DSR-stressed maximum
// loan by DBR and by LTV, and explains the verdict per bank.
// Phase 3.5 — also computes all bank charges (processing fee, pre-approval,
// early settlement, insurance) and total cost of finance.
import { db } from "@/lib/db";
import { parsePricing, resolveQuote, assessmentRate, rateSchedule, applyFloor, UAE_NORMS, type UaeNorms, type PricingFloor, type EiborCurve, type RateQuote, type RateSchedule } from "@/lib/bank-pricing";
import { unknownAxes } from "@/lib/bank-rules-taxonomy";
import {
  parseFees, parseInsurance, processingFeePct, processingFeeAed,
  preApprovalFeeAed, earlySettlementChargeAed, partialSettlementFreeAed,
  lifeInsuranceMonthly, propertyInsuranceYearly, totalCostOfFinance,
  type BankFees, type BankInsurance, type TotalCostBreakdown,
} from "@/lib/bank-fees";
import { emi, loanForEmi } from "@/lib/calc";
import { todayISO } from "@/lib/format";
import type { BankProduct } from "@/lib/types";
import type { Promotion } from "@/lib/types";

export interface MatchInput {
  employmentProfile: string; // Salaried | Self-Employed (never Non-Resident — that's residency)
  residency: string;         // UAE National | Resident Expatriate | Non-Resident
  nationality?: string | null; // passport country — checked against quote nationalityRule
  emirate?: string | null;     // Dubai | Abu Dhabi | ... — checked against quote emirates
  financeType?: string | null; // Residential | Commercial
  loanKind?: string | null;    // Conventional | Islamic
  segment?: string | null;     // GECO | Premium | AUH Developer | ... — strict quote matching
  transactionType: string;   // free text from the case
  loanAmount: number;        // requested finance
  propertyValue: number;
  monthlyIncome: number;     // fixed salary + fixed allowances
  existingEmis: number;      // loan EMIs only — card obligations are computed per bank
  cardLimitsTotal: number;   // total credit-card limits across all banks
  rentalIncome: number;      // monthly rental income
  bonusIncome: number;       // monthly-averaged bonus/incentive income
  stl: boolean;              // salary transfer
  termYears: number;         // preferred fixed term (3 default; -1 = best of all fixed terms)
  ratePref?: "best" | "fixed" | "flexible"; // fixed-for-term vs EIBOR-linked vs best of either
  // Joint application / Second party
  secondPartyRole?: "none" | "co_borrower" | "co_applicant";
  coBorrowerIncome?: number;
  coBorrowerBonus?: number;
  coBorrowerRental?: number;
  coBorrowerEmis?: number;
  coBorrowerCardLimits?: number;
  primaryAge?: number;
  coBorrowerAge?: number;
  processingMonths?: number; // application -> first EMI lag; tenure caps at disbursement age
  /* --- NEW: previously captured but never read by the engine --- */
  propertyStage?: string | null;      // OFF_PLAN | HANDOVER | COMPLETED
  transactionPurpose?: string | null; // PURCHASE | REFINANCE | EQUITY_RELEASE | REFINANCE_AND_EQUITY
  propertyTypeCanonical?: string | null; // RESIDENTIAL | COMMERCIAL
  customerProfile?: string | null;    // "Standard" | "Preferential Pricing" | …
  serviceMonths?: number | null;      // applicant's time with current employer
  propertyAgeYears?: number | null;   // age of the building itself
  isFirstProperty?: boolean | null;   // first purchase for this client
  /** Tier-1 HFMC floor. Omitted = no floor, so behaviour is unchanged. */
  floor?: PricingFloor;
}

export interface MatchFees {
  processingFeePct: number | null;
  processingFeeAed: number | null;
  processingFeeNote: string | null;
  preApprovalFeeAed: number | null;
  preApprovalNote: string | null;
  earlySettlementPct: number | null;
  earlySettlementCapAed: number | null;
  earlySettlementNote: string | null;
  partialSettlementFreeYearlyPct: number | null;
  partialSettlementFreeAed: number | null;
  partialSettlementNote: string | null;
  valuationNote: string | null;
}

export interface MatchInsurance {
  lifeMonthlyAed: number | null;
  propertyYearlyAed: number | null;
  lifeNote: string | null;
  propertyNote: string | null;
}

export interface MatchResult {
  bankProductId: number;
  bankName: string;
  productName: string;
  version?: number;
  effectiveDate?: string | null;
  expiryDate?: string;
  verdict: "eligible" | "conditions" | "not_eligible";
  reasons: string[];
  quote: RateQuote | null;
  assessmentRatePct: number | null;
  monthlyEmi: number | null;        // EMI at assessment (stress) rate
  maxLoanByDbr: number | null;
  maxLoanByLtv: number | null;
  eligibleLoan: number | null;
  ltvPct: number | null;
  cardObligation: number | null;
  dbrPctUsed: number | null;
  eligibleIncome: number | null;
  schedule: RateSchedule | null;
  introEmi: number | null;
  followOnEmi: number | null;
  stressEmi: number | null;
  maxTenorByAgeMonths: number | null; // tenure ceiling in months (maturity-age cap, after processing months)
  tenorUsedMonths: number | null;     // tenor actually applied in the EMI math, in months
  /** Structured fees from feesJson — null if no fees data on this product */
  fees: MatchFees | null;
  /** Structured insurance from insuranceJson — null if no data */
  insurance: MatchInsurance | null;
  /** Total cost of finance over the full tenor (indicative) */
  costBreakdown: TotalCostBreakdown | null;
  /** TAT and validity from the product policy */
  tat: {
    totalTatDays: number | null;
    paTatDays: number | null;
    paValidityDays: number | null;
    folValidityDays: number | null;
    valuationValidityDays: number | null;
  };
  jointAffordability: {
    isJoint: boolean;
    role: "none" | "co_borrower" | "co_applicant";
    qualifyingIncome: number;
    qualifyingBonus: number;
    qualifyingRental: number;
    qualifyingEmis: number;
    qualifyingCardLimits: number;
    effectiveAge?: number;
    summary: string;
  };
  /** Which cap actually bound the eligible loan, and the full cap list. Powers
   *  "why you qualify" on the proposal and the Rate Desk impact preview. */
  capTrace?: CapResolution;
  /** Axes this quote constrains that the CASE has no value for. A non-empty list
   *  means the verdict is provisional — we never invent a rejection, but the UI
   *  must not show a confident ✓ either. */
  verifyNeeded?: string[];
  /** Stressed-rate provenance: whether the bank's stress buffer was recorded or
   *  inherited from the norm. "assumed" must be visible, never silently 0. */
  stressBufferSource?: "bank" | "norm" | "none";
  /** Set when propertyValue was not captured — every LTV-based number is then
   *  unavailable rather than fabricated from an assumed LTV. */
  dataGaps?: string[];
  // Tier-4 promotion overlay — active promo applied ON TOP of base pricing
  // (null = no active promo for this product/term today; self-expires by date)
  promo?: {
    name: string;
    description?: string;
    rateDiscountBps?: number | null;
    processingFeeOverridePct?: number | null;
    valuationFeeWaived?: boolean;
    validFrom: string;
    validTo: string;
  } | null;
}

const MAX_DBR = 0.5; // CBUAE ceiling. NOTE: kept only as documentation of the statutory
// ceiling — the engine actually uses the per-bank dbrPct override below (line ~371),
// falling back to UAE_NORMS.maxDbrPct. A bank that genuinely allows 65% (e.g. for a
// high-net-worth private-banking product) must not be clipped to 50% by a constant.

/** free-text transaction → canonical dimension used in pricing quotes */
export function canonicalTxn(transactionType: string): string {
  const t = (transactionType || "").toLowerCase();
  const buyout = t.includes("buyout");
  const equity = t.includes("equity") || t.includes("cashout");
  if (buyout && equity) return "Buyout + Equity Release";
  if (buyout) return "Buyout";
  if (equity) return "Equity Release";
  if (t.includes("handover") || t.includes("primary") || t.includes("off")) return "Primary Handover";
  if (t.includes("land")) return "Land";
  if (t.includes("construction")) return "Self Construction";
  if (t.includes("lap")) return "LAP";
  return "Resale";
}

function productApplies(p: BankProduct, input: MatchInput): string | null {
  const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z]/g, "");
  const pEmp = norm(p.employment);
  // legacy rows store "Non-Resident" in employment — treat it as residency, not a blocker
  const cEmpRaw = norm(input.employmentProfile);
  const cEmp = cEmpRaw.includes("nonresident") ? "" : cEmpRaw;
  const empMatches =
    !pEmp ||
    pEmp.includes("salariedorselfemployed") ||
    pEmp.includes("all") ||
    (pEmp.includes("salaried") && cEmp.includes("salaried")) ||
    (pEmp.includes("employed") && !pEmp.includes("self") && cEmp.includes("salaried")) ||
    (pEmp.includes("self") && cEmp.includes("self"));
  if (!empMatches) {
    return `product is for ${p.employment} clients`;
  }
  const productResident = p.residency === "Resident";
  const clientResident = input.residency !== "Non-Resident";
  if (productResident !== clientResident) {
    return `product is for ${p.residency.toLowerCase()} clients`;
  }
  // Finance type: only enforced when the PRODUCT declares one. Legacy rows with
  // a blank financeType impose no constraint (never guess a blocker).
  const prodFinance = (p.financeType ?? "").trim().toLowerCase();
  const caseCommercial = /commercial/i.test(input.financeType ?? "");
  if (prodFinance.includes("commercial") && !caseCommercial) {
    return "commercial product — case is not classified as commercial";
  }
  if (prodFinance.includes("residential") && caseCommercial) {
    return "residential product — case is classified as commercial";
  }
  return null;
}

function baseResult(p: { id: number; version?: number; effectiveDate?: string | null; expiryDate?: string }, bankName: string, productName: string, jointAffordability?: MatchResult["jointAffordability"]): MatchResult {
  return {
    bankProductId: p.id, bankName, productName,
    version: p.version ?? 1,
    effectiveDate: p.effectiveDate ?? null,
    expiryDate: p.expiryDate ?? "2099-12-31",
    verdict: "not_eligible", reasons: [],
    quote: null, assessmentRatePct: null, monthlyEmi: null, maxLoanByDbr: null,
    maxLoanByLtv: null, eligibleLoan: null, ltvPct: null, cardObligation: null,
    dbrPctUsed: null, eligibleIncome: null, schedule: null, introEmi: null, maxTenorByAgeMonths: null, tenorUsedMonths: null,
    followOnEmi: null, stressEmi: null, fees: null, insurance: null, costBreakdown: null,
    tat: { totalTatDays: null, paTatDays: null, paValidityDays: null, folValidityDays: null, valuationValidityDays: null },
    jointAffordability: jointAffordability ?? {
      isJoint: false, role: "none", qualifyingIncome: 0, qualifyingBonus: 0,
      qualifyingRental: 0, qualifyingEmis: 0, qualifyingCardLimits: 0, summary: "Single Borrower",
    },
  };
}

/** Build the MatchFees object from a parsed BankFees structure + loan context.
 *  loanAmount is threaded through so slabbed schedules and buyout+equity
 *  component splits resolve correctly (flat-only fees behave exactly as before).
 *
 *  `bfees` may be null (a product with no feesJson at all) — the bank default
 *  processing fee still applies in that case, because inheriting the bank's fee
 *  is the whole point of the Bank Defaults screen. Previously a missing feesJson
 *  produced no fee object at all and the default was unreachable. */
function buildMatchFees(
  bfees: BankFees | null, txn: string, loanAmount: number, stl: boolean,
  equityPortionAed?: number, bankDefaultPct: number | null = null,
): MatchFees {
  const pfPct = processingFeePct(bfees, txn, loanAmount, todayISO(), bankDefaultPct);
  const pfAed = processingFeeAed(bfees, txn, loanAmount, equityPortionAed, bankDefaultPct);
  const paAed = preApprovalFeeAed(bfees, { stl });
  const psFreeAed = partialSettlementFreeAed(bfees, loanAmount);
  return {
    processingFeePct: pfPct,
    processingFeeAed: pfAed,
    processingFeeNote: bfees?.processing?.note ?? null,
    preApprovalFeeAed: paAed,
    preApprovalNote: bfees?.preApproval?.note ?? null,
    earlySettlementPct: bfees?.earlySettlement?.pct ?? null,
    earlySettlementCapAed: bfees?.earlySettlement?.cap ?? null,
    earlySettlementNote: bfees?.earlySettlement?.note ?? null,
    partialSettlementFreeYearlyPct: bfees?.partialSettlement?.freeYearlyPct ?? null,
    partialSettlementFreeAed: psFreeAed,
    partialSettlementNote: bfees?.partialSettlement?.note ?? null,
    valuationNote: bfees?.valuation?.note ?? null,
  };
}

/** Build the MatchInsurance object. */
function buildMatchInsurance(bins: BankInsurance, loanAmount: number, propertyValue: number): MatchInsurance {
  return {
    lifeMonthlyAed: lifeInsuranceMonthly(bins, loanAmount),
    propertyYearlyAed: propertyInsuranceYearly(bins, propertyValue),
    lifeNote: bins.life?.note ?? null,
    propertyNote: bins.property?.note ?? null,
  };
}

/**
 * Collapse every affordability/limit cap into ONE answer plus the name of the
 * binding constraint.
 *
 * Previously the caps were combined with scattered Math.min() calls, so a client
 * asking "why is my max loan 1.2M?" could only be answered by reading the code.
 * `boundBy` is what the proposal's "why you qualify" line and the Rate Desk's
 * impact preview both render — it names the single rule that actually bit.
 */
export interface CapResolution {
  eligibleLoan: number | null;
  /** The name of the tightest cap: "DBR" | "LTV" | "bank maximum" | "bank minimum" | "age/tenure". */
  boundBy: string | null;
  /** Human-readable explanation of the binding cap. */
  boundNote: string | null;
  /** Every cap considered, for the full explain trace. */
  caps: { name: string; value: number | null }[];
}

export function resolveCaps(caps: { name: string; value: number | null }[]): CapResolution {
  const usable = caps.filter((c): c is { name: string; value: number } =>
    c.value != null && c.value > 0,
  );
  if (usable.length === 0) {
    return { eligibleLoan: null, boundBy: null, boundNote: null, caps };
  }
  // smallest wins; ties resolve to the FIRST cap listed so the explanation is stable
  let best = usable[0];
  for (const c of usable) if (c.value < best.value) best = c;
  const notes: Record<string, string> = {
    DBR: "limited by debt-burden ratio — your income against existing obligations",
    LTV: "limited by the bank's maximum loan-to-value for your residency",
    "bank maximum": "limited by the bank's maximum loan amount for this product",
    "bank minimum": "below the bank's minimum loan for this product",
    "age/tenure": "limited by the tenure your age allows at disbursement",
  };
  return {
    eligibleLoan: best.value,
    boundBy: best.name,
    boundNote: notes[best.name] ?? `limited by ${best.name}`,
    caps,
  };
}

/* ---------------- tier 0: norm resolution ---------------- */

/**
 * A bank INHERITS the UAE norm for any field it leaves null, and OVERRIDES it
 * explicitly where it deviates (DIB 2% card rule vs the 5% norm, ENBD 50% bonus vs
 * 0%). The norm never overwrites a bank's own value — that ordering is the whole
 * point of keeping the norms as defaults rather than as an authority layer.
 */
export function resolveNorm<T extends Record<string, unknown>>(
  bank: T,
  fallback: Partial<UaeNorms>,
): { values: Partial<UaeNorms>; assumed: string[] } {
  const pick = (k: keyof UaeNorms): number => {
    const bankVal = bank[k as keyof T];
    return typeof bankVal === "number" ? bankVal : (fallback[k] as number);
  };
  const assumed: string[] = [];
  for (const k of Object.keys(fallback) as (keyof UaeNorms)[]) {
    if (typeof bank[k as keyof T] !== "number") assumed.push(String(k));
  }
  return {
    values: {
      maxDbrPct: pick("maxDbrPct"),
      cardRulePct: pick("cardRulePct"),
      bonusPct: pick("bonusPct"),
      rentalIncomePct: pick("rentalIncomePct"),
      rentalCapPctOfSalary: pick("rentalCapPctOfSalary"),
      maxTenorYears: pick("maxTenorYears"),
      maxAgeAtMaturitySalaried: pick("maxAgeAtMaturitySalaried"),
      maxAgeAtMaturitySelfEmp: pick("maxAgeAtMaturitySelfEmp"),
      processingMonths: pick("processingMonths"),
      defaultStressBufferPct: pick("defaultStressBufferPct"),
    },
    assumed,
  };
}

export async function runBankMatch(input: MatchInput): Promise<MatchResult[]> {
  const [productsRaw, eiborRows] = await Promise.all([
    // Only the fields the engine resolves from a bank default. `name` carries the
    // display; `defaultProcessingFeePct` is the one default the engine actually
    // inherits (the rest of the defaults are still display-only on the products page
    // and the proposal's policy block — see CODEBASE.md).
    db.bankProduct.findMany({ where: { status: "approved", active: true }, include: { bank: { select: { name: true, defaultProcessingFeePct: true } } } }),
    db.eiborRate.findMany(),
  ]);

  // Versioning selection: Pick the active rate sheet for today
  const today = new Date().toISOString().slice(0, 10);
  const activeProductsMap = new Map<string, typeof productsRaw[0]>();
  for (const p of productsRaw) {
    const eff = p.effectiveDate ? p.effectiveDate.slice(0, 10) : "";
    const exp = (p as any).expiryDate ? (p as any).expiryDate.slice(0, 10) : "2099-12-31";
    if (eff && eff > today) continue; // Future version not active yet
    if (exp && exp < today) continue; // Expired version

    const key = `${p.bankId}__${p.name.trim().toLowerCase()}__${p.employment}__${p.residency}`;
    const existing = activeProductsMap.get(key);
    if (!existing || (p.version ?? 1) > (existing.version ?? 1)) {
      activeProductsMap.set(key, p);
    }
  }
  const products = Array.from(activeProductsMap.values());
  const eibor: EiborCurve = Object.fromEntries(eiborRows.map((e) => [e.tenor, e.ratePct]));
  const txn = canonicalTxn(input.transactionType);
  const results: MatchResult[] = [];
  // Tier-4 promotion overlay — one query filtered to today's active window.
  // Self-expiring: no admin action needed to revert after validTo.
  const todayStr = today.length === 10 ? today : today.slice(0, 10);
  const activePromos = (await db.promotion.findMany({
    where: { active: true, validFrom: { lte: todayStr }, validTo: { gte: todayStr } },
  }).catch(() => [])) as unknown as Promotion[];
  const promoFor = (bankProductId: number, termYears: number | null): Promotion | null =>
    activePromos.find((pr) =>
      pr.bankProductId === bankProductId &&
      (pr.rateOptionTermYears == null || (termYears != null && pr.rateOptionTermYears === termYears))
    ) ?? null;

  // Joint pooling calculations - strictly distinguishes co_borrower vs co_applicant
  const isCoBorrower = input.secondPartyRole === "co_borrower";
  const effectiveMonthlyIncome = input.monthlyIncome + (isCoBorrower ? (input.coBorrowerIncome || 0) : 0);
  const effectiveBonusIncome = input.bonusIncome + (isCoBorrower ? (input.coBorrowerBonus || 0) : 0);
  const effectiveRentalIncome = input.rentalIncome + (isCoBorrower ? (input.coBorrowerRental || 0) : 0);
  const effectiveExistingEmis = input.existingEmis + (isCoBorrower ? (input.coBorrowerEmis || 0) : 0);
  const effectiveCardLimitsTotal = input.cardLimitsTotal + (isCoBorrower ? (input.coBorrowerCardLimits || 0) : 0);
  const effectiveAge = isCoBorrower
    ? (Math.max(input.primaryAge || 0, input.coBorrowerAge || 0) || null)
    : (input.primaryAge || null);

  const jointAffordability: MatchResult["jointAffordability"] = {
    isJoint: isCoBorrower,
    role: input.secondPartyRole ?? "none",
    qualifyingIncome: effectiveMonthlyIncome,
    qualifyingBonus: effectiveBonusIncome,
    qualifyingRental: effectiveRentalIncome,
    qualifyingEmis: effectiveExistingEmis,
    qualifyingCardLimits: effectiveCardLimitsTotal,
    effectiveAge: effectiveAge ?? undefined,
    summary: isCoBorrower
      ? `Joint Co-Borrower Application: AED ${effectiveMonthlyIncome.toLocaleString()} combined income (incomes & obligations pooled)`
      : input.secondPartyRole === "co_applicant"
      ? "Single Borrower (Co-Applicant Title/KYC Only � Financials Excluded)"
      : "Single Borrower Application",
  };

  for (const p of products) {
    const dto = { ...p, bankName: p.bank?.name ?? "", axes: {}, pricingJson: p.pricingJson } as unknown as BankProduct & { pricingJson: string };
    const reasons: string[] = [];
    const applicability = productApplies(dto, input);
    if (applicability) {
      results.push({ ...baseResult(p, dto.bankName, p.name, jointAffordability), reasons: [applicability] });
      continue;
    }

    if (p.minSalary != null && input.monthlyIncome < p.minSalary) {
      const minMsg = "monthly income below the bank minimum of AED " + p.minSalary.toLocaleString();
      results.push({ ...baseResult(p, dto.bankName, p.name), reasons: [minMsg] });
      continue;
    }

    // --- NEW rules the engine previously could not see (they lived in free text) ---
    if (p.serviceMonthsMin != null && input.serviceMonths != null && input.serviceMonths < p.serviceMonthsMin) {
      const msg = `needs ${p.serviceMonthsMin} months with current employer — client has ${input.serviceMonths}`;
      results.push({ ...baseResult(p, dto.bankName, p.name), reasons: [msg] });
      continue;
    }
    if (p.propertyAgeYearsMax != null && input.propertyAgeYears != null && input.propertyAgeYears > p.propertyAgeYearsMax) {
      const msg = `property is ${input.propertyAgeYears} years old — bank caps at ${p.propertyAgeYearsMax} years`;
      results.push({ ...baseResult(p, dto.bankName, p.name), reasons: [msg] });
      continue;
    }
    if (p.firstPropertyOnly && input.isFirstProperty === false) {
      results.push({ ...baseResult(p, dto.bankName, p.name), reasons: ["first-property products only — client already owns a property"] });
      continue;
    }

    const pricing = parsePricing(p.pricingJson);
    // Property value is REAL or absent. It used to be back-derived as
    // loanAmount/0.8 in case-profile.ts, which invented an 80% LTV and fed it to
    // every LTV verdict. Absent now means "not captured" — we say so instead of
    // guessing, and the FTV axis falls back to the bank's own cap so a band quote
    // can still match without pretending to know the client's LTV.
    const hasPropertyValue = input.propertyValue > 0;
    const dataGaps: string[] = [];
    if (!hasPropertyValue) dataGaps.push("property value not captured — LTV-based limits unavailable");
    const ltvReq = hasPropertyValue
      ? (input.loanAmount / input.propertyValue) * 100
      : (p.maxLtvExpatriate ?? 80);
    const stlLabel = (input.stl ? "STL" : "NSTL") as "STL" | "NSTL";
    const normEmp = /self/i.test(input.employmentProfile) ? "Self-Employed" : /salaried/i.test(input.employmentProfile) ? "Salaried" : null;
    const baseReq: import("@/lib/bank-pricing").QuoteMatchInput = {
      stl: input.stl, salaryTransfer: stlLabel, ftv: ltvReq, txn,
      segment: input.segment ?? null,
      residency: input.residency ?? null,
      employment: normEmp,
      financeType: input.financeType ?? (p.financeType || null),
      loanKind: input.loanKind ?? (p.loanKind || null),
      emirate: input.emirate ?? null,
      nationality: input.nationality ?? null,
      // NEW axes — these LoanCase columns existed but nothing read them
      stage: input.propertyStage ?? null,
      purpose: input.transactionPurpose ?? null,
      propertyTypeCanonical: input.propertyTypeCanonical ?? null,
      profile: input.customerProfile ?? null,
      // Tier-1 HFMC floor. Undefined = no floor, so a default caller is unchanged.
      ...(input.floor ? { floor: input.floor } : {}),
      on: today,
    };
    let quote: RateQuote | null = null;
    if (input.ratePref === "flexible") {
      quote = resolveQuote(pricing, { ...baseReq, termYears: null, ratePref: "flexible" });
    } else if (input.ratePref === "fixed" && input.termYears === -1) {
      // best across every fixed tenure any quote publishes (1..20y, not just 1-5)
      const terms = [...new Set((pricing?.quotes ?? []).map((q) => q.termYears ?? 0))].filter((t) => t > 0);
      for (const t of (terms.length ? terms : [1, 2, 3, 4, 5])) {
        const q = resolveQuote(pricing, { ...baseReq, termYears: t, ratePref: "fixed" });
        if (q && (!quote || (q.ratePct ?? 99) < (quote.ratePct ?? 99))) quote = q;
      }
    } else {
      quote = resolveQuote(pricing, { ...baseReq, termYears: input.termYears, ratePref: input.ratePref === "fixed" ? "fixed" : undefined });
      if (!quote && input.ratePref !== "fixed") {
        quote = resolveQuote(pricing, { ...baseReq, termYears: null }); // fall back to variable day 1
      }
    }
    if (!quote) {
      results.push({ ...baseResult(p, dto.bankName, p.name), reasons: ["no pricing quote for this salary-transfer / term / transaction combination"] });
      continue;
    }

    // Stress-buffer provenance. An UNRECORDED buffer is not the same as a real
    // zero: using 0 silently qualifies clients with no cushion. We distinguish the
    // two so the UI can mark the number "assumed" rather than presenting it as the
    // bank's own qualification rule.
    const bankBuffer = (p as unknown as { stressBufferPct?: number | null }).stressBufferPct;
    const stressBufferSource: "bank" | "norm" | "none" =
      typeof bankBuffer === "number" ? "bank" : UAE_NORMS.defaultStressBufferPct > 0 ? "norm" : "none";
    const stressBuffer = bankBuffer ?? UAE_NORMS.defaultStressBufferPct;

    const rate = assessmentRate(quote, eibor, stressBuffer);
    const ltvCap = input.residency === "UAE National" ? p.maxLtvNational : p.maxLtvExpatriate;
    const maxLoanByLtv = input.propertyValue > 0 && ltvCap != null ? Math.round((input.propertyValue * ltvCap) / 100) : null;
    const ltvPct = input.propertyValue > 0 ? Math.round((input.loanAmount / input.propertyValue) * 1000) / 10 : null;

    // Tier 0 norms: a bank INHERITS any field it leaves null and OVERRIDES what it
    // records. The norm never overwrites a bank value (see resolveNorm).
    const norm = resolveNorm(
      { cardRulePct: p.cardRulePct, bonusPct: p.bonusPct, rentalIncomePct: p.rentalIncomePct,
        rentalCapPctOfSalary: p.rentalCapPctOfSalary, dbrPct: p.dbrPct, tenorYears: p.tenorYears,
        maxAgeSalaried: (p as unknown as { maxAgeSalaried?: number | null }).maxAgeSalaried,
        maxAgeSelfEmp: (p as unknown as { maxAgeSelfEmp?: number | null }).maxAgeSelfEmp } as Record<string, unknown>,
      UAE_NORMS,
    );
    const cardPct = p.cardRulePct ?? norm.values.cardRulePct ?? 5;
    const cardObligation = Math.round((input.cardLimitsTotal * cardPct) / 100);
    const bonusCredit = Math.round((input.bonusIncome * (p.bonusPct ?? 0)) / 100);
    let rentalCredit = Math.round((input.rentalIncome * (p.rentalIncomePct ?? 0)) / 100);
    if (p.rentalCapPctOfSalary != null) {
      rentalCredit = Math.min(rentalCredit, Math.round((input.monthlyIncome * p.rentalCapPctOfSalary) / 100));
    }
    const eligibleIncome = input.monthlyIncome + bonusCredit + rentalCredit;
    const dbrPct = p.dbrPct ?? norm.values.maxDbrPct ?? 50;

    let maxLoanByDbr: number | null = null;
    let maxTenorByAgeMonths: number | null = null;
    let tenorUsedMonths: number | null = null;
    let monthlyEmi: number | null = null;
    let introEmi: number | null = null;
    let followOnEmi: number | null = null;
    let stressEmi: number | null = null;
    const schedule: RateSchedule | null = rateSchedule(quote, eibor, stressBuffer);
    // Tier-4 promo overlay — apply AFTER the base schedule so base pricing is
    // never mutated: rate discount reduces the intro rate only (follow-on/stress untouched).
    const promo = promoFor(p.id, quote.termYears ?? null);
    if (promo && promo.rateDiscountBps != null && schedule && schedule.introRatePct != null) {
      schedule.introRatePct = Math.round((schedule.introRatePct + promo.rateDiscountBps / 100) * 10000) / 10000;
      if (quote.rateType === "FIXED" && quote.ratePct != null) {
        quote = { ...quote, ratePct: schedule.introRatePct }; // display copy — original quote row untouched
      }
    }
    // indicative EMIs: product tenor, else the 25-year UAE norm — then capped by
    // the borrower's age AT DISBURSEMENT, all in MONTHS: eligible tenure =
    // (maturity-age cap − age at application) × 12 − processing months
    const ages = [input.primaryAge, input.secondPartyRole === "co_borrower" ? input.coBorrowerAge : null]
      .filter((a): a is number => typeof a === "number" && a > 0);
    const oldest = ages.length ? Math.max(...ages) : null;
    const maxAge = input.employmentProfile === "Self-Employed"
      ? ((p as unknown as { maxAgeSelfEmp?: number | null }).maxAgeSelfEmp ?? 70)
      : ((p as unknown as { maxAgeSalaried?: number | null }).maxAgeSalaried ?? 70);
    const procMonths = input.processingMonths ?? 0;
    const maxTenureMonthsByAge = oldest != null ? Math.floor((maxAge - oldest) * 12 - procMonths) : null;
    const productTenorMonths = (p.tenorYears ?? 25) * 12;
    const tenorMonths = Math.max(12, Math.min(productTenorMonths, maxTenureMonthsByAge ?? 999));
    maxTenorByAgeMonths = maxTenureMonthsByAge;
    tenorUsedMonths = tenorMonths;
    const tenorY = tenorMonths / 12;
    if (maxTenureMonthsByAge != null && productTenorMonths > maxTenureMonthsByAge) {
      reasons.push("tenure capped to " + tenorMonths + " months (" + (tenorMonths / 12).toFixed(1) + "y) — age " + oldest + " + " + procMonths + " months processing vs " + maxAge + "y maturity cap");
    }
    if (rate != null) {
      const availableEmi = Math.round((eligibleIncome * dbrPct) / 100 - input.existingEmis - cardObligation);
      if (availableEmi <= 0) {
        reasons.push("income below obligations — no DBR headroom");
      } else {
        maxLoanByDbr = Math.round(loanForEmi(availableEmi, rate, tenorY));
        monthlyEmi = Math.round(emi(input.loanAmount, rate, tenorY));
        stressEmi = monthlyEmi;
        if (schedule?.introRatePct != null) introEmi = Math.round(emi(input.loanAmount, schedule.introRatePct, tenorY));
        if (schedule?.followOnRatePct != null) followOnEmi = Math.round(emi(input.loanAmount, schedule.followOnRatePct, tenorY));
      }
    }

    // Collapse every cap into ONE answer + the name of the binding constraint, so
    // "why is my max 1.2M?" has an answer the UI can print.
    const hardCap = p.maxLoan ?? null;
    const capTrace = resolveCaps([
      { name: "DBR", value: maxLoanByDbr },
      { name: "LTV", value: maxLoanByLtv },
      { name: "bank maximum", value: hardCap },
    ]);
    let eligibleLoan = capTrace.eligibleLoan;
    if (p.minLoan != null && eligibleLoan != null && eligibleLoan < p.minLoan) {
      eligibleLoan = null;
      capTrace.boundBy = "bank minimum";
      capTrace.boundNote = "below the bank's minimum loan for this product";
      reasons.push(`loan below ${dto.bankName}'s minimum (AED ${p.minLoan.toLocaleString()})`);
    }
    if (ltvCap != null && ltvPct != null && ltvPct > ltvCap) {
      reasons.push(`LTV ${ltvPct}% exceeds the ${ltvCap}% cap — increase down payment`);
    }
    if (hardCap != null && input.loanAmount > hardCap) {
      reasons.push(`requested amount above the AED ${hardCap.toLocaleString()} maximum (exception approval needed)`);
    }
    if (rate == null && !reasons.some((r) => r.includes("DBR headroom"))) {
      reasons.push("benchmark EIBOR tenor for this quote is missing — add it in Admin so the stressed rate can be computed");
    }

    // Structured fees & insurance. The bank default processing fee is threaded
    // through so an inherited fee reaches the proposal exactly as the grid showed it.
    const bfees = parseFees((p as unknown as { feesJson?: string }).feesJson);
    const bins = parseInsurance((p as unknown as { insuranceJson?: string }).insuranceJson);
    const bankDefaultPct = (p as unknown as { bank?: { defaultProcessingFeePct?: number | null } }).bank?.defaultProcessingFeePct ?? null;
    const matchFees = buildMatchFees(bfees, txn, input.loanAmount, input.stl, undefined, bankDefaultPct);
    const matchIns = bins ? buildMatchInsurance(bins, input.loanAmount, input.propertyValue) : null;
    // Tier-4 promo fee overlay — processing override (0 = waived) + valuation waiver
    if (promo && matchFees) {
      if (promo.processingFeeOverridePct != null) {
        matchFees.processingFeePct = promo.processingFeeOverridePct;
        matchFees.processingFeeAed = Math.round((input.loanAmount * promo.processingFeeOverridePct) / 100);
        matchFees.processingFeeNote = ` promo: ${promo.processingFeeOverridePct}% (${promo.name})`;
      }
      if (promo.valuationFeeWaived && matchFees.valuationNote) {
        matchFees.valuationNote = `Waived — ${promo.name}`;
      }
    }

    // Total cost of finance (only if we have an EMI and tenor)
    let costBreakdown: TotalCostBreakdown | null = null;
    if (introEmi != null && p.tenorYears) {
      costBreakdown = totalCostOfFinance(
        input.loanAmount, tenorY,
        introEmi, // use intro EMI for the intro period — approximation
        bfees, bins, txn, input.stl,
      );
    }

    let verdict: MatchResult["verdict"];
    if (eligibleLoan == null || rate == null) {
      verdict = "not_eligible";
      if (reasons.length === 0) reasons.push("not priceable on current data");
    } else if (input.loanAmount <= eligibleLoan) {
      verdict = "eligible";
    } else {
      verdict = "conditions";
      const why = capTrace.boundNote ? ` (${capTrace.boundNote})` : "";
      reasons.push(`max eligible finance is AED ${eligibleLoan.toLocaleString()} — AED ${(input.loanAmount - eligibleLoan).toLocaleString()} short of request${why}`);
    }

    // Axes this quote gates on that the case has no value for. We never invent a
    // rejection, but the UI must not show a confident ✓ either.
    const verifyNeeded = unknownAxes(quote, baseReq);

    results.push({
      bankProductId: p.id, bankName: dto.bankName, productName: p.name,
      verdict, reasons, quote, assessmentRatePct: rate,
      monthlyEmi, maxLoanByDbr, maxLoanByLtv, eligibleLoan, ltvPct,
      cardObligation, dbrPctUsed: dbrPct, eligibleIncome, schedule,
      introEmi, followOnEmi, stressEmi,
      maxTenorByAgeMonths, tenorUsedMonths,
      capTrace, verifyNeeded, stressBufferSource,
      dataGaps: dataGaps.length ? dataGaps : undefined,
      fees: matchFees,
      insurance: matchIns,
      costBreakdown,
      tat: {
        totalTatDays: p.totalTatDays ?? null,
        paTatDays: p.paTatDays ?? null,
        paValidityDays: p.paValidityDays ?? null,
        folValidityDays: p.folValidityDays ?? null,
        valuationValidityDays: p.valuationValidityDays ?? null,
      },
      jointAffordability,
      promo: promo ? {
        name: promo.name, description: promo.description,
        rateDiscountBps: promo.rateDiscountBps, processingFeeOverridePct: promo.processingFeeOverridePct,
        valuationFeeWaived: promo.valuationFeeWaived, validFrom: promo.validFrom, validTo: promo.validTo,
      } : null,
    });
  }

  const rank = { eligible: 0, conditions: 1, not_eligible: 2 };
  return results.sort((a, b) => rank[a.verdict] - rank[b.verdict] || (b.eligibleLoan ?? 0) - (a.eligibleLoan ?? 0));
}
