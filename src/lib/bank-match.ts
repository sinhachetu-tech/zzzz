// Bank Match engine — Phase 2. Feeds a case profile through every approved
// bank product: resolves the pricing quote, computes the DSR-stressed maximum
// loan by DBR and by LTV, and explains the verdict per bank.
import { db } from "@/lib/db";
import { parsePricing, resolveQuote, assessmentRate, rateSchedule, type EiborCurve, type RateQuote, type RateSchedule } from "@/lib/bank-pricing";
import { emi, loanForEmi } from "@/lib/calc";
import type { BankProduct } from "@/lib/types";

export interface MatchInput {
  employmentProfile: string; // Salaried | Self-Employed | Non-Resident
  residency: string; // UAE National | Resident Expatriate | Non-Resident
  transactionType: string; // free text from the case
  loanAmount: number; // requested finance
  propertyValue: number;
  monthlyIncome: number; // fixed salary + fixed allowances
  existingEmis: number; // loan EMIs only — card obligations are computed per bank
  cardLimitsTotal: number; // total credit-card limits across banks
  rentalIncome: number; // monthly rental income
  bonusIncome: number; // monthly-averaged bonus/incentive income
  stl: boolean; // salary transfer
  termYears: number; // preferred fixed term (3 default)
}

export interface MatchResult {
  bankProductId: number;
  bankName: string;
  productName: string;
  verdict: "eligible" | "conditions" | "not_eligible";
  reasons: string[];
  quote: RateQuote | null;
  assessmentRatePct: number | null;
  monthlyEmi: number | null;
  maxLoanByDbr: number | null;
  maxLoanByLtv: number | null;
  eligibleLoan: number | null;
  ltvPct: number | null;
  cardObligation: number | null;
  dbrPctUsed: number | null;
  eligibleIncome: number | null;
  schedule: RateSchedule | null;   // intro / follow-on / stress rates
  introEmi: number | null;         // client pays this during the intro period
  followOnEmi: number | null;      // client pays this after the intro ends
  stressEmi: number | null;        // the payment the bank qualifies them at
}

const MAX_DBR = 0.5; // CBUAE ceiling; bank-specific DBR overrides come later

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
  if (emp !== "Salaried or Self-Employed" && emp !== input.employmentProfile) {
    return `product is for ${emp} clients`;
  }
  const productResident = p.residency === "Resident";
  const clientResident = input.residency !== "Non-Resident";
  if (productResident !== clientResident) {
    return `product is for ${p.residency.toLowerCase()} clients`;
  }
  if (p.financeType !== "Residential") return "commercial product — residential match pending";
  return null;
}

function baseResult(p: { id: number }, bankName: string, productName: string): MatchResult {
  return { bankProductId: p.id, bankName, productName, verdict: "not_eligible", reasons: [], quote: null, assessmentRatePct: null, monthlyEmi: null, maxLoanByDbr: null, maxLoanByLtv: null, eligibleLoan: null, ltvPct: null, cardObligation: null, dbrPctUsed: null, eligibleIncome: null, schedule: null, introEmi: null, followOnEmi: null, stressEmi: null };
}

export async function runBankMatch(input: MatchInput): Promise<MatchResult[]> {
  const [products, eiborRows] = await Promise.all([
    db.bankProduct.findMany({ where: { status: "approved", active: true }, include: { bank: { select: { name: true } } } }),
    db.eiborRate.findMany(),
  ]);
  const eibor: EiborCurve = Object.fromEntries(eiborRows.map((e) => [e.tenor, e.ratePct]));
  const txn = canonicalTxn(input.transactionType);
  const results: MatchResult[] = [];

  for (const p of products) {
    const dto = { ...p, bankName: p.bank?.name ?? "", axes: {}, pricingJson: p.pricingJson } as unknown as BankProduct & { pricingJson: string };
    const reasons: string[] = [];
    const applicability = productApplies(dto, input);
    if (applicability) {
      results.push({ ...baseResult(p, dto.bankName, p.name), reasons: [applicability] });
      continue;
    }

    if (p.minSalary != null && input.monthlyIncome < p.minSalary) {
      const minMsg = "monthly income below the bank minimum of AED " + p.minSalary.toLocaleString();
      results.push({ ...baseResult(p, dto.bankName, p.name), reasons: [minMsg] });
      continue;
    }

    const pricing = parsePricing(p.pricingJson);
    const quote = resolveQuote(pricing, { stl: input.stl, termYears: input.termYears, ftv: p.maxLtvExpatriate ?? 80, txn });
    if (!quote) {
      results.push({ ...baseResult(p, dto.bankName, p.name), reasons: ["no pricing quote for this salary-transfer / term / transaction combination"] });
      continue;
    }

    const rate = assessmentRate(quote, eibor);
    const ltvCap = input.residency === "UAE National" ? p.maxLtvNational : p.maxLtvExpatriate;
    const maxLoanByLtv = input.propertyValue > 0 && ltvCap != null ? Math.round((input.propertyValue * ltvCap) / 100) : null;
    const ltvPct = input.propertyValue > 0 ? Math.round((input.loanAmount / input.propertyValue) * 1000) / 10 : null;

    // bank-specific affordability: card rule, bonus/rental haircuts, DBR ceiling
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
    let monthlyEmi: number | null = null;
    let introEmi: number | null = null;
    let followOnEmi: number | null = null;
    let stressEmi: number | null = null;
    const schedule: RateSchedule | null = rateSchedule(quote, eibor);
    if (rate != null && p.tenorYears) {
      const availableEmi = Math.round((eligibleIncome * dbrPct) / 100 - input.existingEmis - cardObligation);
      if (availableEmi <= 0) {
        reasons.push("income below obligations — no DBR headroom");
      } else {
        maxLoanByDbr = Math.round(loanForEmi(availableEmi, rate, p.tenorYears));
        monthlyEmi = Math.round(emi(input.loanAmount, rate, p.tenorYears));
        stressEmi = monthlyEmi; // payment at the qualifying (stress) rate
        if (schedule?.introRatePct != null) introEmi = Math.round(emi(input.loanAmount, schedule.introRatePct, p.tenorYears));
        if (schedule?.followOnRatePct != null) followOnEmi = Math.round(emi(input.loanAmount, schedule.followOnRatePct, p.tenorYears));
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

    results.push({ bankProductId: p.id, bankName: dto.bankName, productName: p.name, verdict, reasons, quote, assessmentRatePct: rate, monthlyEmi, maxLoanByDbr, maxLoanByLtv, eligibleLoan, ltvPct, cardObligation, dbrPctUsed: dbrPct, eligibleIncome, schedule, introEmi, followOnEmi, stressEmi });
  }

  const rank = { eligible: 0, conditions: 1, not_eligible: 2 };
  return results.sort((a, b) => rank[a.verdict] - rank[b.verdict] || (b.eligibleLoan ?? 0) - (a.eligibleLoan ?? 0));
}
