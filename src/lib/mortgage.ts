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
  /* ---------------- the three UAE ROIs ----------------
     ROI 1 = introductory / fixed rate — payable for `roi1Years`
     ROI 2 = follow-on rate — payable after the fixed term
     ROI 3 = stress / qualifying rate — NEVER payable; it exists to set the
             maximum eligible amount and to run the stress test.
     When all three are present the engine qualifies the file at ROI 3. When
     absent, the engine
     falls back to the legacy `actualRate + loadFactor` assessment rate. */
  roi1Pct?: number;
  roi1Years?: number;
  roi2Pct?: number;
  roi3Pct?: number;
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
  /* ---------------- three-ROI qualification (UAE) ----------------
     Present when the input carried all three ROIs. These are the ONLY figures the
     UI and the printed assessment should show for rates, EMI and DBR — the screen
     must not recompute them. */
  roi: { r1: number; r2: number; r3: number; introYears: number } | null;
  /** ROI 3 — the rate the file is qualified at */
  qualifyingRate: number;
  /** ROI 3 governs the qualification when three ROIs are present */
  qualifyingBindsRoi: 3;
  /** MAX ELIGIBLE = MIN(DBR capacity, LTV capacity) — the client's ask is NOT a cap */
  maxEligible: number;
  /** which constraint set maxEligible */
  maxEligibleLimitedBy: "DBR / Income" | "LTV" | "Income Multiplier";
  /** Whether the finance sought is within every eligibility cap. */
  requestEligible: boolean;
  /** Amount by which the finance sought exceeds maximum permissible finance. */
  requestShortfall: number;
  /** ROI 3 DBR when the maximum permissible finance is used. */
  maxEligibleDbr3: number;
  /** EMI on the finance under assessment at each ROI (ROI 3 is a test figure, never payable) */
  emi1: number;
  emi2: number;
  emi3: number;
  /** DBR on the finance under assessment at each ROI, % */
  dbr1: number;
  dbr2: number;
  dbr3: number;
  /** true when ROI 3 was entered BELOW ROI 1 or ROI 2 — the file still qualifies at
      the highest rate, but the user should know the stress row is not the worst case */
  roi3BelowHigher: boolean;
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

export function blankInput(): MortgageInput {
  return {
    name: "", whatsapp: "", applicantType: "Expatriate", employment: "Salaried",
    dob: "", finalAge: 60, marginMonths: 2,
    propertyValue: 0, valuation: null, requested: 0, ltvPctChoice: null, customLtv: "",
    incomes: [newIncomeRow("Basic Salary")],
    coBorrower: null,
    liabilities: [],
    actualRate: 0, loadFactor: 1.5, stressOverride: null, multiplierX: 0, tenorOverrideMonths: null,
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

  /* ---- three-ROI qualification ---- */
  const hasRoi = inp.roi1Pct != null && inp.roi2Pct != null && inp.roi3Pct != null;
  const roi = hasRoi
    ? { r1: inp.roi1Pct as number, r2: inp.roi2Pct as number, r3: inp.roi3Pct as number, introYears: inp.roi1Years ?? 0 }
    : null;
  let qualifyingRate = assessmentRate;
  const qualifyingBindsRoi: 3 = 3;
  if (roi) {
    qualifyingRate = roi.r3;
    const roi3BelowHigher = roi.r3 < Math.max(roi.r1, roi.r2);
    if (roi3BelowHigher)
      notes.push(
        `ROI 3 (${fmtPct(roi.r3)}) is below ROI 1 or ROI 2. Eligibility still uses ROI 3, while a payable-stage DBR may be higher.`
      );
  }

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

  const dbrMpbf = pvFor(availableEmi, qualifyingRate, maxTenorMonths);
  const multiplierCap = inp.multiplierX > 0 ? eligibleIncome * 12 * inp.multiplierX : null;

  /* MAX ELIGIBLE — the client's ask is deliberately NOT a cap here: a client who asks
     for less than they can afford must not have their capacity understated. */
  const capsNoReq: { v: number; label: MortgageResult["maxEligibleLimitedBy"] }[] = [
    { v: dbrMpbf, label: "DBR / Income" },
    { v: ltvMpbf, label: "LTV" },
  ];
  if (multiplierCap != null) capsNoReq.push({ v: multiplierCap, label: "Income Multiplier" });
  const eligibleLimiting = capsNoReq.reduce((min, c) => (c.v < min.v ? c : min), capsNoReq[0]);
  const maxEligible = Math.max(0, Math.floor(eligibleLimiting.v / 5000) * 5000);

  const caps: { v: number; label: MortgageResult["limitedBy"] }[] = [
    { v: dbrMpbf, label: "DBR / Income" },
    { v: ltvMpbf, label: "LTV" },
  ];
  if (multiplierCap != null) caps.push({ v: multiplierCap, label: "Income Multiplier" });
  if (inp.requested > 0) caps.push({ v: inp.requested, label: "Requested Finance" });
  const limiting = caps.reduce((min, c) => (c.v < min.v ? c : min), caps[0]);
  const finalMpbf = Math.max(0, Math.floor(limiting.v / 5000) * 5000);

  /* DBR 1 / 2 / 3 — computed ONCE here on the finance sought (or the maximum
     eligible amount when no finance is entered) and read by every screen. */
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const dbrOf = (emi: number) => (eligibleIncome > 0 ? round2(((existingEmis + emi) / eligibleIncome) * 100) : 0);
  const financeUnderAssessment = inp.requested > 0 ? inp.requested : maxEligible;
  const emiAt = (rate: number) => emiFor(financeUnderAssessment, rate, maxTenorMonths);
  const emi1 = roi ? emiAt(roi.r1) : emiAt(inp.actualRate);
  const emi2 = roi ? emiAt(roi.r2) : emi1;
  const emi3 = roi ? emiAt(roi.r3) : emiAt(qualifyingRate);
  const dbr1 = dbrOf(emi1);
  const dbr2 = dbrOf(emi2);
  const dbr3 = dbrOf(emi3);
  const maxEligibleDbr3 = dbrOf(emiFor(maxEligible, roi ? roi.r3 : qualifyingRate, maxTenorMonths));
  const requestEligible = inp.requested > 0 && inp.requested <= maxEligible;
  const requestShortfall = Math.max(0, inp.requested - maxEligible);

  const roi3BelowHigher = !!roi && roi.r3 < Math.max(roi.r1, roi.r2);

  const newEmi = emiFor(finalMpbf, inp.actualRate, maxTenorMonths);
  const downPayment = Math.max(0, calcBasis - finalMpbf);
  const actualLtv = calcBasis > 0 ? (finalMpbf / calcBasis) * 100 : 0;
  const dbrAfter = eligibleIncome > 0 ? ((existingEmis + newEmi) / eligibleIncome) * 100 : 0;

  const trail = [
    `${fmtPct(MAX_DBR)} max − ${fmtPct(currentDbr)} current = ${fmtPct(residualDbr)} residual DBR`,
    `Residual ${fmtPct(residualDbr)} → available EMI ${fmtAED(availableEmi)}/mo`,
    roi
      ? `Qualifying rate = ROI 3 ${fmtPct(roi.r3)}`
      : `PV at ${assessmentRate.toFixed(2)}% over ${tenorLabel(maxTenorMonths)} → DBR MPBF ${fmtAED(dbrMpbf)}`,
    `PV at ${fmtPct(qualifyingRate)} over ${tenorLabel(maxTenorMonths)} → DBR capacity ${fmtAED(dbrMpbf)}`,
    `LTV: ${fmtAED(calcBasis)} × ${ltvPct}% (${inp.ltvPctChoice != null ? "selected" : `default · ${inp.applicantType}`}) → ${fmtAED(ltvMpbf)}`,
    `MAX ELIGIBLE = MIN(${fmtAED(dbrMpbf)} DBR, ${fmtAED(ltvMpbf)} LTV${multiplierCap != null ? `, ${fmtAED(multiplierCap)} multiplier` : ""}) → ${fmtAED(maxEligible)}${eligibleLimiting.label !== "DBR / Income" ? ` (${eligibleLimiting.label} binds)` : " (income binds)"}`,
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
    actualRate: inp.actualRate, loadFactor: inp.loadFactor, assessmentRate, qualifyingRate, qualifyingBindsRoi,
    roi, maxEligible, maxEligibleLimitedBy: eligibleLimiting.label, requestEligible, requestShortfall, maxEligibleDbr3,
    emi1, emi2, emi3, dbr1, dbr2, dbr3,
    roi3BelowHigher,
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
  // With the three-ROI model a rate change means changing the qualifying (stress) ROI.
  // Without ROIs (legacy callers) the stressOverride path is preserved unchanged.
  if (inp.roi1Pct != null && inp.roi2Pct != null && inp.roi3Pct != null)
    return { ...cloneInput(inp), roi3Pct: rate };
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
  /** MAX ELIGIBLE for this scenario — the value the What-if gains are measured on */
  maxEligible: number;
  /** Requested-finance DBR at each ROI */
  dbr1: number;
  dbr2: number;
  dbr3: number;
}

export function scenarioTable(inp: MortgageInput, scenarios: { label: string; input: MortgageInput }[]): ScenarioRow[] {
  return scenarios.map(({ label, input }) => {
    const r = computeMortgage(input);
    return { label, dbr: r.currentDbr, residual: r.residualDbr, maxEligible: r.maxEligible, dbr1: r.dbr1, dbr2: r.dbr2, dbr3: r.dbr3 };
  });
}

/* ---------------- year-wise amortisation ---------------- */

export interface AmortYear {
  year: number;
  months: number; // 12, or fewer for the final stub year
  emi: number; // monthly EMI in effect that year
  opening: number;
  principal: number;
  interest: number;
  closing: number;
  ratePct: number; // rate in effect that year
}

export interface AmortSchedule {
  rows: AmortYear[];
  totalPrincipal: number;
  totalInterest: number;
  totalPayable: number;
  rateChangedAtMonth: number | null; // 1-based month where ROI 2 takes over, null if never
}

/* Year-wise amortisation across the two PAYABLE ROIs: ROI 1 for `introMonths`,
   then ROI 2. At the rate change the EMI is recalculated on the outstanding balance
   over the remaining term — which is what the client actually pays. ROI 3 is never
   payable and never appears here. Used by the printed assessment and the Excel export. */
export function amortizationYears(
  principal: number, roi1Pct: number, introMonths: number, roi2Pct: number, totalMonths: number,
): AmortSchedule {
  type M = { emi: number; interest: number; principal: number; closing: number; ratePct: number; opening: number };
  const months: M[] = [];
  // variable pricing (no fixed term): ROI 1 == ROI 2, run the whole schedule at ROI 2
  const startRate = introMonths > 0 ? roi1Pct : roi2Pct;
  let bal = principal;
  let ratePct = startRate;
  let emi = totalMonths > 0 ? emiFor(bal, ratePct, totalMonths) : 0;
  let rateChangedAtMonth: number | null = null;
  for (let m = 1; m <= totalMonths && bal > 0.005; m++) {
    if (m === introMonths + 1 && introMonths < totalMonths && introMonths > 0) {
      ratePct = roi2Pct;
      emi = totalMonths - introMonths > 0 ? emiFor(bal, ratePct, totalMonths - introMonths) : 0;
      rateChangedAtMonth = m;
    }
    const r = ratePct / 1200;
    const interest = bal * r;
    let pay = emi;
    if (r === 0) pay = bal / (totalMonths - m + 1);
    if (pay >= bal + interest) pay = bal + interest; // final payment cap — no overpay
    const princ = Math.max(0, pay - interest);
    const closing = Math.max(0, bal - princ);
    months.push({ emi: pay, interest, principal: princ, closing, ratePct, opening: bal });
    bal = closing;
  }
  const rows: AmortYear[] = [];
  for (let i = 0; i < months.length; i += 12) {
    const chunk = months.slice(i, i + 12);
    rows.push({
      year: rows.length + 1,
      months: chunk.length,
      emi: chunk[0].emi,
      opening: chunk[0].opening,
      principal: chunk.reduce((s, x) => s + x.principal, 0),
      interest: chunk.reduce((s, x) => s + x.interest, 0),
      closing: chunk[chunk.length - 1].closing,
      ratePct: chunk[0].ratePct,
    });
  }
  const totalPrincipal = rows.reduce((s, x) => s + x.principal, 0);
  const totalInterest = rows.reduce((s, x) => s + x.interest, 0);
  return { rows, totalPrincipal, totalInterest, totalPayable: totalPrincipal + totalInterest, rateChangedAtMonth };
}
