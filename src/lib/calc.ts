// Mortgage affordability engine — ported verbatim from the original smallhfmc.
// Pure TypeScript, framework-agnostic.

export type CalcInput = AffordabilityInput;

export const defaultRateFor = (bank: string): number => BANK_RATES[bank] ?? 4.5;

export interface AffordabilityInput {
  monthlyIncome: number;
  otherIncome: number;
  existingEmis: number;
  age: number;
  employmentType: "Salaried" | "Self-Employed";
  propertyValue: number;
  bank: string;
  interestRate: number | null; // annual % — blank = use bank desk rate
  tenureYears: number | null; // blank = longest allowed by age
}

export interface AffordabilityResult {
  rateUsed: number;
  tenureUsed: number;
  applicableLtv: number;
  maxLoanByLtv: number;
  maxDbrPct: number;
  availableDbrEmi: number;
  maxLoanByDbr: number;
  maxTenureByAge: number;
  finalEligibleLoan: number;
  estimatedEmi: number;
  eligible: boolean;
  notes: string[];
}

const RETIREMENT_AGE = { Salaried: 60, "Self-Employed": 65 } as const;

// UAE bank desk rates — annual %, floating (EIBOR + margin)
export const BANK_RATES: Record<string, number> = {
  ADCB: 4.25, ADIB: 4.5, "Ajman Bank": 4.75, "Al Hilal": 4.6, "Arab Bank": 5.0,
  CBD: 4.4, DIB: 4.65, EIB: 4.7, ENBD: 4.35, FAB: 4.2, HSBC: 4.5, Mashreq: 4.45,
  NBF: 4.9, "RAK Bank": 4.8, SCB: 4.3, UAB: 4.55,
};

// CBUAE-style LTV caps: ≤ AED 5M vs above
const LTV: Record<"Salaried" | "Self-Employed", [number, number]> = {
  Salaried: [80, 70],
  "Self-Employed": [75, 65],
};

const MAX_TENURE = { Salaried: 25, "Self-Employed": 20 } as const;
const MAX_DBR = 50; // debt-burden ratio cap, %
const MIN_LOAN = 250000;

export function emi(principal: number, annualRate: number, years: number): number {
  const n = years * 12;
  const r = annualRate / 1200;
  if (r === 0) return principal / n;
  const f = Math.pow(1 + r, n);
  return (principal * r * f) / (f - 1);
}

export function loanForEmi(target: number, annualRate: number, years: number): number {
  const n = years * 12;
  const r = annualRate / 1200;
  if (r === 0) return target * n;
  const f = Math.pow(1 + r, n);
  return (target * (f - 1)) / (r * f);
}

export function computeAffordability(inp: AffordabilityInput): AffordabilityResult {
  const notes: string[] = [];
  const rateUsed = inp.interestRate ?? BANK_RATES[inp.bank] ?? 4.5;
  if (inp.interestRate == null) notes.push(`Desk rate applied for ${inp.bank}: ${rateUsed}% p.a.`);

  const maxTenureByAge = Math.max(
    1,
    Math.min(MAX_TENURE[inp.employmentType], RETIREMENT_AGE[inp.employmentType] - inp.age)
  );
  if (maxTenureByAge < MAX_TENURE[inp.employmentType])
    notes.push(`Tenure capped at ${maxTenureByAge}y by age (retires at ${RETIREMENT_AGE[inp.employmentType]}).`);
  const tenureUsed = inp.tenureYears ? Math.min(inp.tenureYears, maxTenureByAge) : maxTenureByAge;

  const ltvBand = inp.propertyValue <= 5000000 ? 0 : 1;
  const applicableLtv = LTV[inp.employmentType][ltvBand];
  const maxLoanByLtv = Math.floor((inp.propertyValue * applicableLtv) / 100);
  if (ltvBand === 1) notes.push("Property above AED 5M — lower LTV band applied.");

  const grossIncome = inp.monthlyIncome + inp.otherIncome;
  const maxDbrPct = MAX_DBR;
  const availableDbrEmi = Math.max(0, (grossIncome * maxDbrPct) / 100 - inp.existingEmis);
  const maxLoanByDbr = Math.floor(loanForEmi(availableDbrEmi, rateUsed, tenureUsed));

  const rawFinal = Math.min(maxLoanByLtv, maxLoanByDbr);
  const finalEligibleLoan = rawFinal >= MIN_LOAN ? Math.floor(rawFinal / 10000) * 10000 : 0;
  const estimatedEmi = finalEligibleLoan > 0 ? Math.round(emi(finalEligibleLoan, rateUsed, tenureUsed)) : 0;

  const eligible = finalEligibleLoan >= MIN_LOAN;
  if (!eligible && maxLoanByDbr < MIN_LOAN && availableDbrEmi > 0)
    notes.push("DBR room is too thin at this rate and tenure — a bigger down payment won't fix it; income or liabilities must move.");
  if (!eligible && maxLoanByDbr >= MIN_LOAN && maxLoanByLtv < MIN_LOAN)
    notes.push("Income supports a loan but the property value caps it below the AED 250K minimum.");

  return {
    rateUsed, tenureUsed, applicableLtv, maxLoanByLtv, maxDbrPct,
    availableDbrEmi: Math.round(availableDbrEmi), maxLoanByDbr, maxTenureByAge,
    finalEligibleLoan, estimatedEmi, eligible, notes,
  };
}

export { MAX_DBR, MIN_LOAN };
