/* HFMC Mortgage Calculator engine — preliminary MPBF eligibility, not a bank approval.
   Ported verbatim from the original smallhfmc. Pure TypeScript. */

export type Frequency = "Monthly" | "Annual" | "Quarterly" | "Semi-Annual" | "Weekly";
export type ApplicantType = "Expatriate" | "UAE National";
export type Employment = "Salaried" | "Self-Employed";
export type LiabType = "Mortgage" | "Personal Loan" | "Car Loan" | "Credit Card" | "Overdraft" | "Other Loan" | "Other Liability";
export type LiabMethod = "Actual EMI" | "5% of Limit" | "5% of Outstanding" | "Manual";

export const FREQUENCIES: Frequency[] = ["Monthly", "Annual", "Quarterly", "Semi-Annual", "Weekly"];
export const SALARIED_SOURCES = ["Basic Salary", "Housing Allowance", "Other Allowance", "Bonus", "Commission", "Rental Income", "Other Income"];
export const SE_SOURCES = ["Business Income", "Salary / Drawings", "Rental Income", "Other Regular Income"];
export const LIAB_TYPES: LiabType[] = ["Mortgage", "Personal Loan", "Car Loan", "Credit Card", "Overdraft", "Other Loan", "Other Liability"];
export const LIAB_METHODS: LiabMethod[] = ["Actual EMI", "5% of Limit", "5% of Outstanding", "Manual"];
export const MAX_DBR = 50; // CBUAE debt-burden ceiling, %
export const CBUAE_MAX_TENOR_YEARS = 25;

export interface IncomeRow {
  id: string;
  source: string;
  frequency: Frequency;
  amount: number;
  eligiblePct: number;
}

export interface LiabRow {
  id: string;
  name: string;
  type: LiabType;
  limitOrOutstanding: number;
  monthlyEmi: number;
  method: LiabMethod;
}

export interface CoBorrower {
  name: string;
  dob: string;
  incomes: IncomeRow[];
  liabilities: LiabRow[];
}

export interface MortgageInput {
  name: string;
  whatsapp: string;
  applicantType: ApplicantType;
  employment: Employment;
  dob: string;
  finalAge: number;
  marginMonths: number;
  propertyValue: number;
  valuation: number | null;
  requested: number;
  ltvPctChoice: number | null;
  customLtv: string;
  incomes: IncomeRow[];
  coBorrower: CoBorrower | null;
  liabilities: LiabRow[];
  actualRate: number;
  loadFactor: number;
  stressOverride: number | null;
  multiplierX: number;
  tenorOverrideMonths: number | null;
}

export const LTV_CHOICES = [60, 70, 80, 85];
export const defaultLtvPct = (t: ApplicantType): number => (t === "UAE National" ? 85 : 80);
export const CO_SOURCES = ["Basic Salary", "Other Allowance", "Rental Income", "Business Income", "Other Income"];

export interface MortgageResult {
  ageNowYears: number;
  ageAfterMarginMonths: number;
  remainingMonths: number;
  maxTenorMonths: number;
  eligibleIncome: number;
  ownIncome: number;
  coIncome: number;
  existingEmis: number;
  ownEmis: number;
  coEmis: number;
  currentDbr: number;
  maxDbr: number;
  residualDbr: number;
  availableEmi: number;
  actualRate: number;
  loadFactor: number;
  assessmentRate: number;
  calcBasis: number;
  basisLabel: string;
  ltvPct: number;
  dbrMpbf: number;
  ltvMpbf: number;
  multiplierCap: number | null;
  requested: number;
  finalMpbf: number;
  limitedBy: "DBR / Income" | "LTV" | "Income Multiplier" | "Requested Finance";
  downPayment: number;
  actualLtv: number;
  dbrAfter: number;
  newEmi: number;
  coAgeYears: number;
  tenorLimitedBy: "applicant" | "co-borrower" | "tenor cap" | null;
  trail: string[];
  notes: string[];
}

const uid = () => Math.random().toString(36).slice(2, 9);
export const newIncomeRow = (source = "Basic Salary", employment: Employment = "Salaried"): IncomeRow => ({
  id: uid(), source, frequency: "Monthly", amount: 0, eligiblePct: 100,
  ...(source === "Business Income" && employment === "Self-Employed" ? { frequency: "Annual" as Frequency, eligiblePct: 70 } : {}),
});
export const newLiabRow = (type: LiabType = "Credit Card"): LiabRow => ({
  id: uid(), name: type === "Credit Card" ? "Credit Card" : type, type,
  limitOrOutstanding: 0, monthlyEmi: 0, method: type === "Credit Card" ? "5% of Limit" : "Actual EMI",
});

export function defaultInput(): MortgageInput {
  return {
    name: "", whatsapp: "", applicantType: "Expatriate", employment: "Salaried",
    dob: "1990-01-15", finalAge: 60, marginMonths: 2,
    propertyValue: 1500000, valuation: null, requested: 1200000, ltvPctChoice: null, customLtv: "",
    incomes: [newIncomeRow("Basic Salary")],
    coBorrower: null,
    liabilities: [],
    actualRate: 3.99, loadFactor: 1.5, stressOverride: null, multiplierX: 0, tenorOverrideMonths: null,
  };
}

/* ---------------- money & date math ---------------- */

export const fmtAED = (n: number): string => `AED ${Math.round(n).toLocaleString("en-US")}`;
export const fmtPct = (n: number): string => `${n.toFixed(2)}%`;

export function emiFor(principal: number, annualRate: number, months: number): number {
  if (principal <= 0 || months <= 0) return 0;
  const r = annualRate / 1200;
  if (r === 0) return principal / months;
  const f = Math.pow(1 + r, months);
  return (principal * r * f) / (f - 1);
}

export function pvFor(monthly: number, annualRate: number, months: number): number {
  if (monthly <= 0 || months <= 0) return 0;
  const r = annualRate / 1200;
  if (r === 0) return monthly * months;
  const f = Math.pow(1 + r, months);
  return (monthly * (f - 1)) / (r * f);
}

export function diffMonths(dobISO: string): number {
  const [y, m, d] = dobISO.split("-").map(Number);
  const dob = new Date(y, m - 1, d);
  const now = new Date();
  let months = (now.getFullYear() - dob.getFullYear()) * 12 + (now.getMonth() - dob.getMonth());
  if (now.getDate() < d) months -= 1;
  return Math.max(0, months);
}

export const tenorLabel = (months: number): string => `${Math.floor(months / 12)}Y ${months % 12}M`;

const freqFactor: Record<Frequency, number> = {
  Monthly: 1, Annual: 1 / 12, Quarterly: 1 / 3, "Semi-Annual": 1 / 6, Weekly: 52 / 12,
};

export const incomeMonthly = (r: IncomeRow): number => r.amount * freqFactor[r.frequency] * (r.eligiblePct / 100);

export const liabilityEmi = (r: LiabRow): number => {
  switch (r.method) {
    case "Actual EMI": return r.monthlyEmi;
    case "5% of Limit":
    case "5% of Outstanding": return r.limitOrOutstanding * 0.05;
    case "Manual": return r.monthlyEmi;
  }
};

/* ---------------- main calculation ---------------- */

export function computeMortgage(inp: MortgageInput): MortgageResult {
  const notes: string[] = [];

  const ageMonths = diffMonths(inp.dob);
  const ageNowYears = Math.floor(ageMonths / 12);
  const ageAfterMarginMonths = ageMonths + Math.max(0, inp.marginMonths);
  const remainingMonths = Math.max(0, inp.finalAge * 12 - ageAfterMarginMonths);

  const coAgeMonths = inp.coBorrower ? diffMonths(inp.coBorrower.dob) : null;
  const coAgeYears = coAgeMonths != null ? Math.floor(coAgeMonths / 12) : 0;
  const coRemainingMonths =
    inp.coBorrower ? Math.max(0, inp.finalAge * 12 - (coAgeMonths! + Math.max(0, inp.marginMonths))) : null;

  const cap = inp.tenorOverrideMonths && inp.tenorOverrideMonths > 0 ? inp.tenorOverrideMonths : CBUAE_MAX_TENOR_YEARS * 12;
  let maxTenorMonths = Math.min(cap, remainingMonths);
  let tenorLimitedBy: MortgageResult["tenorLimitedBy"] =
    cap < remainingMonths ? "tenor cap" : "applicant";
  if (coRemainingMonths != null && coRemainingMonths < maxTenorMonths) {
    maxTenorMonths = coRemainingMonths;
    tenorLimitedBy = "co-borrower";
  }
  if (inp.tenorOverrideMonths) tenorLimitedBy = null;
  if (remainingMonths <= 0) notes.push("Applicant is at or past the final age — no age-based tenor remains.");
  if (coRemainingMonths != null && tenorLimitedBy === "co-borrower")
    notes.push(`Tenor capped at ${tenorLabel(maxTenorMonths)} by the co-borrower's age (${coAgeYears} yrs) — the loan must end when the first borrower reaches the final age.`);
  if (inp.tenorOverrideMonths) notes.push(`Tenor manually set to ${tenorLabel(maxTenorMonths)} (overrides age limits).`);

  const ownIncome = inp.incomes.reduce((s, r) => s + incomeMonthly(r), 0);
  const coIncome = inp.coBorrower ? inp.coBorrower.incomes.reduce((s, r) => s + incomeMonthly(r), 0) : 0;
  const eligibleIncome = ownIncome + coIncome;
  const ownEmis = inp.liabilities.reduce((s, r) => s + liabilityEmi(r), 0);
  const coEmis = inp.coBorrower ? inp.coBorrower.liabilities.reduce((s, r) => s + liabilityEmi(r), 0) : 0;
  const existingEmis = ownEmis + coEmis;

  const currentDbr = eligibleIncome > 0 ? (existingEmis / eligibleIncome) * 100 : 100;
  const residualDbr = Math.max(0, MAX_DBR - currentDbr);
  const availableEmi = (eligibleIncome * residualDbr) / 100;
  if (eligibleIncome <= 0) notes.push("No eligible income entered — DBR headroom is zero.");

  const assessmentRate = inp.stressOverride != null ? inp.stressOverride : inp.actualRate + inp.loadFactor;

  const hasValuation = inp.valuation != null && inp.valuation > 0;
  const calcBasis = hasValuation ? Math.min(inp.propertyValue, inp.valuation as number) : inp.propertyValue;
  const basisLabel = hasValuation
    ? inp.valuation !== inp.propertyValue && (inp.valuation as number) < inp.propertyValue
      ? "lower of property value & bank valuation"
      : "property value (valuation not lower)"
    : "property value (no valuation yet)";

  const ltvDefault = defaultLtvPct(inp.applicantType);
  const customNum = parseFloat(inp.customLtv);
  const ltvPct = !Number.isNaN(customNum) && customNum > 0 ? Math.min(95, Math.max(1, customNum)) : inp.ltvPctChoice ?? ltvDefault;
  const ltvIsCustom = !Number.isNaN(customNum) && customNum > 0;
  const ltvMpbf = (calcBasis * ltvPct) / 100;
  if (ltvIsCustom || (inp.ltvPctChoice != null && inp.ltvPctChoice !== ltvDefault))
    notes.push(`LTV manually set to ${ltvPct}% (default for ${inp.applicantType} is ${ltvDefault}%).`);

  const dbrMpbf = pvFor(availableEmi, assessmentRate, maxTenorMonths);
  const multiplierCap = inp.multiplierX > 0 ? eligibleIncome * 12 * inp.multiplierX : null;

  const caps: { v: number; label: MortgageResult["limitedBy"] }[] = [
    { v: dbrMpbf, label: "DBR / Income" },
    { v: ltvMpbf, label: "LTV" },
  ];
  if (multiplierCap != null) caps.push({ v: multiplierCap, label: "Income Multiplier" });
  if (inp.requested > 0) caps.push({ v: inp.requested, label: "Requested Finance" });
  const limiting = caps.reduce((min, c) => (c.v < min.v ? c : min), caps[0]);
  const finalMpbf = Math.max(0, Math.floor(limiting.v / 5000) * 5000);

  const newEmi = emiFor(finalMpbf, inp.actualRate, maxTenorMonths);
  const downPayment = Math.max(0, calcBasis - finalMpbf);
  const actualLtv = calcBasis > 0 ? (finalMpbf / calcBasis) * 100 : 0;
  const dbrAfter = eligibleIncome > 0 ? ((existingEmis + newEmi) / eligibleIncome) * 100 : 0;

  const trail = [
    `${fmtPct(MAX_DBR)} max − ${fmtPct(currentDbr)} current = ${fmtPct(residualDbr)} residual DBR`,
    `Residual ${fmtPct(residualDbr)} → available EMI ${fmtAED(availableEmi)}/mo`,
    `PV at ${assessmentRate.toFixed(2)}% over ${tenorLabel(maxTenorMonths)} → DBR MPBF ${fmtAED(dbrMpbf)}`,
    `LTV: ${fmtAED(calcBasis)} × ${ltvPct}% (${inp.ltvPctChoice != null ? "selected" : `default · ${inp.applicantType}`}) → ${fmtAED(ltvMpbf)}`,
  ];
  if (inp.coBorrower) {
    trail.push(`Combined income: applicant ${fmtAED(ownIncome)} + co-borrower ${fmtAED(coIncome)} = ${fmtAED(eligibleIncome)}/mo`);
    trail.push(`Combined liabilities: applicant ${fmtAED(ownEmis)} + co-borrower ${fmtAED(coEmis)} = ${fmtAED(existingEmis)}/mo`);
    if (tenorLimitedBy === "co-borrower")
      trail.push(`Tenor: ${tenorLabel(remainingMonths)} applicant vs ${tenorLabel(coRemainingMonths ?? 0)} co-borrower → ${tenorLabel(maxTenorMonths)} used (first to reach final age binds)`);
  }
  if (multiplierCap != null) trail.push(`Income multiplier: ${inp.multiplierX}× annual eligible → cap ${fmtAED(multiplierCap)}`);
  trail.push(`Final MPBF = MIN(${caps.map((c) => `${c.label} ${fmtAED(c.v)}`).join(", ")})`);

  return {
    ageNowYears, ageAfterMarginMonths, remainingMonths, maxTenorMonths,
    eligibleIncome, ownIncome, coIncome, existingEmis, ownEmis, coEmis,
    currentDbr, maxDbr: MAX_DBR, residualDbr, availableEmi,
    actualRate: inp.actualRate, loadFactor: inp.loadFactor, assessmentRate,
    calcBasis, basisLabel, ltvPct, dbrMpbf, ltvMpbf, multiplierCap, requested: inp.requested,
    finalMpbf, limitedBy: limiting.label, downPayment, actualLtv, dbrAfter, newEmi,
    coAgeYears, tenorLimitedBy, trail, notes,
  };
}

/* ---------------- what-if scenarios ---------------- */

export const cloneInput = (i: MortgageInput): MortgageInput => JSON.parse(JSON.stringify(i));

export function scenarioCardsPct(inp: MortgageInput, pct: number): MortgageInput {
  const c = cloneInput(inp);
  const scale = (ls: LiabRow[]) => ls.map((l) => (l.type === "Credit Card" ? { ...l, limitOrOutstanding: l.limitOrOutstanding * pct } : l));
  c.liabilities = scale(c.liabilities);
  if (c.coBorrower) c.coBorrower = { ...c.coBorrower, liabilities: scale(c.coBorrower.liabilities) };
  return c;
}

export function scenarioRemoveCards(inp: MortgageInput): MortgageInput {
  const c = cloneInput(inp);
  c.liabilities = c.liabilities.filter((l) => l.type !== "Credit Card");
  if (c.coBorrower) c.coBorrower = { ...c.coBorrower, liabilities: c.coBorrower.liabilities.filter((l) => l.type !== "Credit Card") };
  return c;
}

export function scenarioCardNewLimit(inp: MortgageInput, id: string, newLimit: number): MortgageInput {
  const c = cloneInput(inp);
  c.liabilities = c.liabilities.map((l) => (l.id === id ? { ...l, limitOrOutstanding: newLimit } : l));
  return c;
}

export function scenarioRemoveLiab(inp: MortgageInput, id: string): MortgageInput {
  const c = cloneInput(inp);
  c.liabilities = c.liabilities.filter((l) => l.id !== id);
  return c;
}

export function scenarioRate(inp: MortgageInput, rate: number): MortgageInput {
  return { ...cloneInput(inp), stressOverride: rate };
}

export function scenarioTenor(inp: MortgageInput, months: number): MortgageInput {
  return { ...cloneInput(inp), tenorOverrideMonths: months };
}

export function scenarioIncomeRemove(inp: MortgageInput, id: string): MortgageInput {
  const c = cloneInput(inp);
  c.incomes = c.incomes.filter((r) => r.id !== id);
  return c;
}

export function scenarioIncomePct(inp: MortgageInput, id: string, pct: number): MortgageInput {
  const c = cloneInput(inp);
  c.incomes = c.incomes.map((r) => (r.id === id ? { ...r, amount: r.amount * pct } : r));
  return c;
}

export interface ScenarioRow {
  label: string;
  dbr: number;
  residual: number;
  mpbf: number;
}

export function scenarioTable(inp: MortgageInput, scenarios: { label: string; input: MortgageInput }[]): ScenarioRow[] {
  return scenarios.map(({ label, input }) => {
    const r = computeMortgage(input);
    return { label, dbr: r.currentDbr, residual: r.residualDbr, mpbf: r.finalMpbf };
  });
}
