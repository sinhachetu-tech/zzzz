// Bank Match engine — Phase 2. Feeds a case profile through every approved
// bank product: resolves the pricing quote, computes the DSR-stressed maximum
// loan by DBR and by LTV, and explains the verdict per bank.
// Phase 3.5 — also computes all bank charges (processing fee, pre-approval,
// early settlement, insurance) and total cost of finance.
import { db } from "@/lib/db";
import { parsePricing, resolveQuote, assessmentRate, rateSchedule, type EiborCurve, type RateQuote, type RateSchedule } from "@/lib/bank-pricing";
import {
  parseFees, parseInsurance, processingFeePct, processingFeeAed,
  preApprovalFeeAed, earlySettlementChargeAed, partialSettlementFreeAed,
  lifeInsuranceMonthly, propertyInsuranceYearly, totalCostOfFinance,
  type BankFees, type BankInsurance, type TotalCostBreakdown,
} from "@/lib/bank-fees";
import { emi, loanForEmi } from "@/lib/calc";
import type { BankProduct } from "@/lib/types";

export interface MatchInput {
  employmentProfile: string; // Salaried | Self-Employed | Non-Resident
  residency: string;         // UAE National | Resident Expatriate | Non-Resident
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
}

const MAX_DBR = 0.5; // CBUAE ceiling

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
  const emp = p.employment;
  const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z]/g, "");
  const pEmp = norm(p.employment);
  const cEmp = norm(input.employmentProfile);
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
  if (p.financeType !== "Residential") return "commercial product — residential match pending";
  return null;
}

function baseResult(p: { id: number }, bankName: string, productName: string, jointAffordability?: MatchResult["jointAffordability"]): MatchResult {
  return {
    bankProductId: p.id, bankName, productName, verdict: "not_eligible", reasons: [],
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

/** Build the MatchFees object from a parsed BankFees structure + loan context. */
function buildMatchFees(bfees: BankFees, txn: string, loanAmount: number, stl: boolean): MatchFees {
  const pfPct = processingFeePct(bfees, txn);
  const pfAed = processingFeeAed(bfees, txn, loanAmount);
  const paAed = preApprovalFeeAed(bfees, { stl });
  const esPct = bfees.earlySettlement?.pct ?? null;
  const esCap = bfees.earlySettlement?.cap ?? null;
  const psFree = bfees.partialSettlement?.freeYearlyPct ?? null;
  const psFreeAed = partialSettlementFreeAed(bfees, loanAmount);
  return {
    processingFeePct: pfPct,
    processingFeeAed: pfAed,
    processingFeeNote: bfees.processing?.note ?? null,
    preApprovalFeeAed: paAed,
    preApprovalNote: bfees.preApproval?.note ?? null,
    earlySettlementPct: esPct,
    earlySettlementCapAed: esCap,
    earlySettlementNote: bfees.earlySettlement?.note ?? null,
    partialSettlementFreeYearlyPct: psFree,
    partialSettlementFreeAed: psFreeAed,
    partialSettlementNote: bfees.partialSettlement?.note ?? null,
    valuationNote: bfees.valuation?.note ?? null,
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

export async function runBankMatch(input: MatchInput): Promise<MatchResult[]> {
  const [products, eiborRows] = await Promise.all([
    db.bankProduct.findMany({ where: { status: "approved", active: true }, include: { bank: { select: { name: true } } } }),
    db.eiborRate.findMany(),
  ]);
  const eibor: EiborCurve = Object.fromEntries(eiborRows.map((e) => [e.tenor, e.ratePct]));
  const txn = canonicalTxn(input.transactionType);
  const results: MatchResult[] = [];

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

    const pricing = parsePricing(p.pricingJson);
    const baseReq = { stl: input.stl, ftv: p.maxLtvExpatriate ?? 80, txn };
    let quote: RateQuote | null = null;
    if (input.ratePref === "flexible") {
      quote = resolveQuote(pricing, { ...baseReq, termYears: null, ratePref: "flexible" });
    } else if (input.ratePref === "fixed" && input.termYears === -1) {
      // best across every fixed tenure the bank publishes
      for (const t of [1, 2, 3, 4, 5]) {
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

    const rate = assessmentRate(quote, eibor, (p as unknown as { stressBufferPct?: number | null }).stressBufferPct ?? 0);
    const ltvCap = input.residency === "UAE National" ? p.maxLtvNational : p.maxLtvExpatriate;
    const maxLoanByLtv = input.propertyValue > 0 && ltvCap != null ? Math.round((input.propertyValue * ltvCap) / 100) : null;
    const ltvPct = input.propertyValue > 0 ? Math.round((input.loanAmount / input.propertyValue) * 1000) / 10 : null;

    const cardPct = p.cardRulePct ?? 5;
    const cardObligation = Math.round((input.cardLimitsTotal * cardPct) / 100);
    const bonusCredit = Math.round((input.bonusIncome * (p.bonusPct ?? 0)) / 100);
    let rentalCredit = Math.round((input.rentalIncome * (p.rentalIncomePct ?? 0)) / 100);
    if (p.rentalCapPctOfSalary != null) {
      rentalCredit = Math.min(rentalCredit, Math.round((input.monthlyIncome * p.rentalCapPctOfSalary) / 100));
    }
    const eligibleIncome = input.monthlyIncome + bonusCredit + rentalCredit;
    const dbrPct = p.dbrPct ?? 50;

    let maxLoanByDbr: number | null = null;
    let maxTenorByAgeMonths: number | null = null;
    let tenorUsedMonths: number | null = null;
    let monthlyEmi: number | null = null;
    let introEmi: number | null = null;
    let followOnEmi: number | null = null;
    let stressEmi: number | null = null;
    const schedule: RateSchedule | null = rateSchedule(quote, eibor, (p as unknown as { stressBufferPct?: number | null }).stressBufferPct ?? 0);
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

    const caps = [maxLoanByDbr, maxLoanByLtv].filter((x): x is number => x != null && x > 0);
    const hardCap = p.maxLoan ?? null;
    let eligibleLoan = caps.length ? Math.min(...caps) : null;
    if (hardCap != null && eligibleLoan != null) eligibleLoan = Math.min(eligibleLoan, hardCap);
    if (p.minLoan != null && eligibleLoan != null && eligibleLoan < p.minLoan) {
      eligibleLoan = null;
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

    // Structured fees & insurance
    const bfees = parseFees((p as unknown as { feesJson?: string }).feesJson);
    const bins = parseInsurance((p as unknown as { insuranceJson?: string }).insuranceJson);
    const matchFees = bfees ? buildMatchFees(bfees, txn, input.loanAmount, input.stl) : null;
    const matchIns = bins ? buildMatchInsurance(bins, input.loanAmount, input.propertyValue) : null;

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
      reasons.push(`max eligible finance is AED ${eligibleLoan.toLocaleString()} — AED ${(input.loanAmount - eligibleLoan).toLocaleString()} short of request`);
    }

    results.push({
      bankProductId: p.id, bankName: dto.bankName, productName: p.name,
      verdict, reasons, quote, assessmentRatePct: rate,
      monthlyEmi, maxLoanByDbr, maxLoanByLtv, eligibleLoan, ltvPct,
      cardObligation, dbrPctUsed: dbrPct, eligibleIncome, schedule,
      introEmi, followOnEmi, stressEmi,
      maxTenorByAgeMonths, tenorUsedMonths,
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
    });
  }

  const rank = { eligible: 0, conditions: 1, not_eligible: 2 };
  return results.sort((a, b) => rank[a.verdict] - rank[b.verdict] || (b.eligibleLoan ?? 0) - (a.eligibleLoan ?? 0));
}
