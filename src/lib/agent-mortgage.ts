// Agent-portal quick mortgage math — UAE universal (CBUAE) rules only.
// Deliberately lighter than the staff calculator: no bank products, no quotes,
// no policy overrides. One source of truth for the slider-based tools so the
// numbers the agent shows a client are defensible (indicative, bank may vary).

export type Residency = "UAE National" | "Resident Expatriate" | "Non-Resident";
export type PropertyCount = "First property" | "Second property";
export type TxnType = "Ready / Resale" | "Off-plan" | "Buyout + equity release" | "Land / self-build";
export type Emirate = "Dubai" | "Abu Dhabi" | "Other emirates";

/** CBUAE universal constants (2020 stimulus levels, still the market norm). */
export const CBUAE = {
  dbrPct: 50,               // max share of monthly income servicing ALL debt
  cardRepayPct: 5,          // % of total credit-card limit counted as a monthly repayment
  maxTenorYears: 25,
  maturityAgeSalaried: 65,  // borrower age cap at loan maturity
  maturityAgeSelfEmp: 70,
  bigTicketFrom: 5_000_000, // above this price the LTV steps down
  equityReleaseDeduction: 20, // pp off LTV when cashing out (CBUAE rule)
  landDeduction: 10,          // indicative pp off for land / self-construction
  offplanDeduction: 10,       // indicative pp off (bank/developer dependent)
} as const;

/** CBUAE LTV matrix, % of property price. Non-residents: bank discretion —
 *  market norm 50–60%, shown here as indicative. */
const LTV_MATRIX: Record<Residency, Record<PropertyCount, { base: number; big: number }>> = {
  "UAE National": { "First property": { base: 90, big: 80 }, "Second property": { base: 85, big: 75 } },
  "Resident Expatriate": { "First property": { base: 80, big: 70 }, "Second property": { base: 60, big: 55 } },
  "Non-Resident": { "First property": { base: 60, big: 50 }, "Second property": { base: 50, big: 50 } },
};

/** Transaction-type adjustments, pp off the residency LTV. */
const TXN_DEDUCTION: Record<TxnType, number> = {
  "Ready / Resale": 0,
  "Off-plan": CBUAE.offplanDeduction,
  "Buyout + equity release": CBUAE.equityReleaseDeduction,
  "Land / self-build": CBUAE.landDeduction,
};

export function ltvCap(residency: Residency, property: PropertyCount, txn: TxnType, price: number): number {
  const band = price > CBUAE.bigTicketFrom ? "big" : "base";
  const ltv = LTV_MATRIX[residency][property][band];
  return Math.max(40, ltv - TXN_DEDUCTION[txn]);
}

/** Reducing-balance monthly instalment. */
export function emiOf(loanAmount: number, ratePct: number, years: number): number {
  if (loanAmount <= 0 || years <= 0) return 0;
  const r = ratePct / 100 / 12;
  const n = Math.round(years * 12);
  if (r <= 0) return loanAmount / n;
  const f = Math.pow(1 + r, n);
  return (loanAmount * r * f) / (f - 1);
}

/** Monthly repayment the bank will accept: 50% DBR minus existing EMIs and
 *  5% of total credit-card limits (CBUAE universal). */
export function eligibleEmi(monthlyIncome: number, existingEmis: number, cardLimits: number): number {
  const ceiling = (Math.max(0, monthlyIncome) * CBUAE.dbrPct) / 100;
  const commitments = Math.max(0, existingEmis) + (Math.max(0, cardLimits) * CBUAE.cardRepayPct) / 100;
  return Math.max(0, ceiling - commitments);
}

/** Largest loan the affordable EMI supports at the given rate/tenor. */
export function maxLoanFor(affordableEmi: number, ratePct: number, years: number): number {
  const n = Math.round(years * 12);
  const r = ratePct / 100 / 12;
  if (affordableEmi <= 0 || n <= 0) return 0;
  if (r <= 0) return affordableEmi * n;
  const f = Math.pow(1 + r, n);
  return (affordableEmi * (f - 1)) / (r * f);
}

/** Max tenure in years: CBUAE 25y cap, age-capped at maturity (disbursement + tenor). */
export function maxTenorYears(age: number | null, employment: "Salaried" | "Self-Employed"): number {
  const capAge = employment === "Salaried" ? CBUAE.maturityAgeSalaried : CBUAE.maturityAgeSelfEmp;
  if (age != null && age > 0) {
    const byAge = capAge - age;
    if (byAge <= 0) return 0; // beyond maturity age — tenure will be rejected
    return Math.min(CBUAE.maxTenorYears, byAge);
  }
  return CBUAE.maxTenorYears;
}

/** One-off purchase costs (agent-side estimate; Dubai/AD differ). */
export function cashToClose(price: number, loanAmount: number, emirate: Emirate) {
  const dldPct = emirate === "Dubai" ? 4 : 2; // Abu Dhabi & northern emirates ~2%
  const regPct = emirate === "Dubai" ? 0.25 : 0.25; // mortgage registration on the LOAN
  const downPayment = Math.max(0, price - loanAmount);
  const dldFee = (price * dldPct) / 100;
  const mortgageReg = (loanAmount * regPct) / 100 + (emirate === "Dubai" ? 290 : 500);
  const agencyFee = (price * 2) / 100; // 2% brokerage, market norm
  const valuation = 3_000; // typical bank valuation + admin
  return { downPayment, dldFee, mortgageReg, agencyFee, valuation, total: downPayment + dldFee + mortgageReg + agencyFee + valuation };
}

export const RULES_FOOTNOTE =
  "Indicative only — built on UAE universal rules (CBUAE 50% DBR, 5% card-limit repayment, LTV caps by nationality & transaction). Each bank applies its own stricter policies.";
