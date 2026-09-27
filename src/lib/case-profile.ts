// Case / Lead structured profile & Joint Application modeling.
// Strictly models Primary Applicant, Property, and Second Party
// with the legal/financial distinction between:
// 1. "co_borrower": Incomes & debts pooled into DBR calculations.
// 2. "co_applicant": Title/KYC only; excluded from loan eligibility.
// 3. "none": Single borrower.

export type SecondPartyRole = "none" | "co_borrower" | "co_applicant";

export interface ApplicantDetails {
  fullName: string;
  dob?: string;          // ISO date — drives the age-based tenure cap
  age?: number;          // manual fallback when DOB is unknown
  disbursementMonths?: number; // expected application->disbursement lag (months)
  nationality?: string;
  // KYC identity — EID is the legal person-key (unique); passport renewable
  eidNo?: string;
  passportNo?: string;
  residency: "UAE National" | "Resident Expatriate" | "Non-Resident";
  phone: string;
  email?: string;
  emirate?: string;
  employmentProfile: "Salaried" | "Self-Employed";
  companyName?: string;
  monthlySalary: number;
  variableIncome: number;
  rentalIncome: number;
  existingEmis: number;
  creditCardLimits: number;
  // decision flags — change pricing/approval posture, not just data
  goldenVisa?: boolean;   // 10-yr visa: several banks quote preferential rates/LTV
  islamicOnly?: boolean;  // client will only take Sharia-compliant finance
}

export interface SecondPartyDetails {
  role: SecondPartyRole;
  relationship?: string; // Spouse, Sibling, Business Partner, Parent, Child, Other
  fullName: string;
  dob?: string;
  age?: number;
  nationality?: string;
  eidNo?: string;
  passportNo?: string;
  residency?: "UAE National" | "Resident Expatriate" | "Non-Resident";
  phone?: string;
  email?: string;
  // Financial fields (ONLY evaluated if role === "co_borrower")
  employmentProfile: "Salaried" | "Self-Employed";
  companyName?: string;
  monthlySalary: number;
  variableIncome: number;
  rentalIncome: number;
  existingEmis: number;
  creditCardLimits: number;
  goldenVisa?: boolean;
}

export interface PropertyDetails {
  propertyValue: number;
  loanAmount: number;
  downPayment: number;
  transactionType: string;
  /** Legacy display value — kept so old rows still render. New classification
   *  lives in the canonical* fields below; never infer stage from this alone. */
  propertyType: "Ready" | "Off-Plan";
  propertyLocation?: string;
  // FINAL PROPERTY CLASSIFICATION PLAN — additive, UNKNOWN-safe. Null/absent =
  // "not yet classified" (treated as UNKNOWN downstream, never guessed).
  canonicalPropertyType?: "RESIDENTIAL" | "COMMERCIAL" | "UNKNOWN" | null;
  canonicalCommercialSubtype?: "OFFICE" | "RETAIL_SHOP" | "WAREHOUSE" | "INDUSTRIAL" | "HOTEL_HOSPITALITY" | "MIXED_USE" | "LAND_PLOT" | "OTHER_COMMERCIAL" | "UNKNOWN" | null;
  canonicalPropertyStage?: "OFF_PLAN" | "HANDOVER" | "COMPLETED" | "UNKNOWN" | null;
  canonicalConstructionStatus?: "NOT_STARTED" | "UNDER_CONSTRUCTION" | "COMPLETED" | "UNKNOWN" | null;
  canonicalPartyRelationship?: "DEVELOPER" | "EXISTING_OWNER" | "SELF" | "UNKNOWN" | null;
  canonicalExistingFinance?: "NONE" | "MORTGAGE" | "UNKNOWN" | null;
  canonicalTransactionPurpose?: "PURCHASE" | "REFINANCE" | "EQUITY_RELEASE" | "REFINANCE_AND_EQUITY" | null;
}

/** Backfill legacy display values to canonical dims. Ambiguous → UNKNOWN.
 *  Never equates Off-plan with Under construction, nor Handover with Completed. */
export function backfillCanonicalProperty(p: {
  propertyType?: string | null;
  transactionType?: string | null;
}): Pick<PropertyDetails,
  "canonicalPropertyType" | "canonicalCommercialSubtype" | "canonicalPropertyStage" | "canonicalConstructionStatus"
  | "canonicalPartyRelationship" | "canonicalExistingFinance" | "canonicalTransactionPurpose"> {
  const pt = (p.propertyType ?? "").toLowerCase();
  const txn = (p.transactionType ?? "").toLowerCase();
  const isOffPlan = pt.includes("off");
  const isBuyout = txn.includes("buyout");
  const isEquity = txn.includes("equity") || txn.includes("cashout") || txn.includes("top up");
  return {
    canonicalPropertyType: "UNKNOWN",
    canonicalCommercialSubtype: null, // only set when type is COMMERCIAL
    canonicalPropertyStage: isOffPlan ? "OFF_PLAN" : pt.includes("ready") || txn.includes("resale") ? "COMPLETED" : "UNKNOWN",
    canonicalConstructionStatus: "UNKNOWN", // never inferred from stage
    canonicalPartyRelationship: txn.includes("developer") || txn.includes("primary") || txn.includes("handover") ? "DEVELOPER"
      : isBuyout || txn.includes("resale") ? "EXISTING_OWNER" : "UNKNOWN",
    canonicalExistingFinance: isBuyout ? "MORTGAGE" : "UNKNOWN",
    canonicalTransactionPurpose: isBuyout && isEquity ? "REFINANCE_AND_EQUITY"
      : isBuyout ? "REFINANCE" : isEquity ? "EQUITY_RELEASE" : "PURCHASE",
  };
}

/** Guard: commercial subtype must be NULL for residential properties. */
export function sanitizeCanonicalProperty(p: PropertyDetails): PropertyDetails {
  if (p.canonicalPropertyType === "RESIDENTIAL") return { ...p, canonicalCommercialSubtype: null };
  return p;
}

export interface CaseProfile {
  primary: ApplicantDetails;
  property: PropertyDetails;
  secondParty: SecondPartyDetails;
  /** expected months from application to first EMI — banks take 2-4 months;
      tenure must be measured at disbursement, not application. Default 3. */
  processingMonths?: number;
}

/** Age in whole years from an ISO dob, as of today. */
export function ageFromDob(dob?: string | null): number | undefined {
  if (!dob) return undefined;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return undefined;
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a >= 0 && a < 120 ? a : undefined;
}

export interface JointAffordabilitySummary {
  role: SecondPartyRole;
  isJointFinancial: boolean;
  qualifyingIncome: number;
  qualifyingBonus: number;
  qualifyingRental: number;
  qualifyingExistingEmis: number;
  qualifyingCardLimits: number;
  effectiveAge?: number;
  badgeLabel: string;
  badgeTone: "mint" | "amber" | "slate";
  explanation: string;
}

/** Create a clean default profile pre-populated from basic case fields if available */
export function defaultCaseProfile(c?: {
  customer?: string;
  whatsapp?: string;
  loanAmount?: number;
  employmentProfile?: string;
  residency?: string;
  propertyType?: string;
  transactionType?: string;
  propertyLocation?: string | null;
  coApplicantName?: string | null;
  // canonical classification (LoanCase columns) — used when profileJson has none
  propertyTypeCanonical?: string | null;
  commercialSubtype?: string | null;
  propertyStage?: string | null;
  constructionStatus?: string | null;
  partyRelationship?: string | null;
  existingFinance?: string | null;
  transactionPurpose?: string | null;
}): CaseProfile {
  const primaryRes = (c?.residency === "UAE National" || c?.residency === "Non-Resident")
    ? c.residency
    : "Resident Expatriate";
  const primaryEmp = c?.employmentProfile === "Self-Employed"
    ? "Self-Employed"
    : "Salaried";
  const derived = backfillCanonicalProperty({ propertyType: c?.propertyType, transactionType: c?.transactionType });

  return {
    primary: {
      fullName: c?.customer ?? "",
      phone: c?.whatsapp ?? "",
      residency: primaryRes,
      employmentProfile: primaryEmp,
      monthlySalary: 0,
      variableIncome: 0,
      rentalIncome: 0,
      existingEmis: 0,
      creditCardLimits: 0,
      emirate: c?.propertyLocation ?? "Dubai",
    },
    property: {
      propertyValue: c?.loanAmount ? Math.round(c.loanAmount / 0.8) : 0,
      loanAmount: c?.loanAmount ?? 0,
      downPayment: c?.loanAmount ? Math.round(c.loanAmount / 0.8) - c.loanAmount : 0,
      transactionType: c?.transactionType ?? "Resale",
      propertyType: (c?.propertyType === "Off-Plan") ? "Off-Plan" : "Ready",
      propertyLocation: c?.propertyLocation ?? "Dubai",
      canonicalPropertyType: (c?.propertyTypeCanonical as PropertyDetails["canonicalPropertyType"]) ?? derived.canonicalPropertyType,
      canonicalCommercialSubtype: (c?.commercialSubtype as PropertyDetails["canonicalCommercialSubtype"]) ?? null,
      canonicalPropertyStage: (c?.propertyStage as PropertyDetails["canonicalPropertyStage"]) ?? derived.canonicalPropertyStage,
      canonicalConstructionStatus: (c?.constructionStatus as PropertyDetails["canonicalConstructionStatus"]) ?? "UNKNOWN",
      canonicalPartyRelationship: (c?.partyRelationship as PropertyDetails["canonicalPartyRelationship"]) ?? derived.canonicalPartyRelationship,
      canonicalExistingFinance: (c?.existingFinance as PropertyDetails["canonicalExistingFinance"]) ?? derived.canonicalExistingFinance,
      canonicalTransactionPurpose: (c?.transactionPurpose as PropertyDetails["canonicalTransactionPurpose"]) ?? derived.canonicalTransactionPurpose,
    },
    secondParty: {
      role: c?.coApplicantName ? "co_applicant" : "none",
      fullName: c?.coApplicantName ?? "",
      relationship: "Spouse",
      residency: "Resident Expatriate",
      employmentProfile: "Salaried",
      monthlySalary: 0,
      variableIncome: 0,
      rentalIncome: 0,
      existingEmis: 0,
      creditCardLimits: 0,
    },
  };
}

/** Parse profileJson from database / API with fallback */
export function parseCaseProfile(json?: string | null, fallbackCase?: Parameters<typeof defaultCaseProfile>[0]): CaseProfile {
  if (!json) return defaultCaseProfile(fallbackCase);
  try {
    const p = JSON.parse(json);
    if (!p || typeof p !== "object" || !p.primary) return defaultCaseProfile(fallbackCase);
    return {
      primary: {
        fullName: String(p.primary.fullName ?? fallbackCase?.customer ?? ""),
        dob: p.primary.dob ?? undefined,
        age: ageFromDob(p.primary.dob) ?? (typeof p.primary.age === "number" ? p.primary.age : undefined),
        nationality: p.primary.nationality ?? undefined,
        eidNo: p.primary.eidNo ?? undefined,
        passportNo: p.primary.passportNo ?? undefined,
        residency: p.primary.residency ?? "Resident Expatriate",
        phone: String(p.primary.phone ?? fallbackCase?.whatsapp ?? ""),
        email: p.primary.email ?? undefined,
        emirate: p.primary.emirate ?? "Dubai",
        employmentProfile: p.primary.employmentProfile ?? "Salaried",
        companyName: p.primary.companyName ?? undefined,
        monthlySalary: Number(p.primary.monthlySalary) || 0,
        variableIncome: Number(p.primary.variableIncome) || 0,
        rentalIncome: Number(p.primary.rentalIncome) || 0,
        existingEmis: Number(p.primary.existingEmis) || 0,
        creditCardLimits: Number(p.primary.creditCardLimits) || 0,
        goldenVisa: !!p.primary.goldenVisa,
        islamicOnly: !!p.primary.islamicOnly,
      },
      property: {
        propertyValue: Number(p.property?.propertyValue) || 0,
        loanAmount: Number(p.property?.loanAmount) || (fallbackCase?.loanAmount ?? 0),
        downPayment: Number(p.property?.downPayment) || 0,
        transactionType: String(p.property?.transactionType ?? fallbackCase?.transactionType ?? "Resale"),
        propertyType: p.property?.propertyType === "Off-Plan" ? "Off-Plan" : "Ready",
        propertyLocation: p.property?.propertyLocation ?? "Dubai",
        // canonical dims: profileJson wins → case-row columns → conservative backfill
        canonicalPropertyType: p.property?.canonicalPropertyType ?? fallbackCase?.propertyTypeCanonical ?? backfillCanonicalProperty({
          propertyType: p.property?.propertyType, transactionType: p.property?.transactionType,
        }).canonicalPropertyType ?? "UNKNOWN",
        canonicalCommercialSubtype: p.property?.canonicalCommercialSubtype ?? fallbackCase?.commercialSubtype ?? null,
        canonicalPropertyStage: p.property?.canonicalPropertyStage ?? fallbackCase?.propertyStage ?? backfillCanonicalProperty({
          propertyType: p.property?.propertyType, transactionType: p.property?.transactionType,
        }).canonicalPropertyStage ?? "UNKNOWN",
        canonicalConstructionStatus: p.property?.canonicalConstructionStatus ?? fallbackCase?.constructionStatus ?? "UNKNOWN",
        canonicalPartyRelationship: p.property?.canonicalPartyRelationship ?? fallbackCase?.partyRelationship ?? backfillCanonicalProperty({
          propertyType: p.property?.propertyType, transactionType: p.property?.transactionType,
        }).canonicalPartyRelationship ?? "UNKNOWN",
        canonicalExistingFinance: p.property?.canonicalExistingFinance ?? fallbackCase?.existingFinance ?? backfillCanonicalProperty({
          propertyType: p.property?.propertyType, transactionType: p.property?.transactionType,
        }).canonicalExistingFinance ?? "UNKNOWN",
        canonicalTransactionPurpose: p.property?.canonicalTransactionPurpose ?? fallbackCase?.transactionPurpose ?? backfillCanonicalProperty({
          propertyType: p.property?.propertyType, transactionType: p.property?.transactionType,
        }).canonicalTransactionPurpose ?? "PURCHASE",
      },
      secondParty: {
        role: (p.secondParty?.role === "co_borrower" || p.secondParty?.role === "co_applicant") ? p.secondParty.role : "none",
        relationship: p.secondParty?.relationship ?? "Spouse",
        fullName: String(p.secondParty?.fullName ?? fallbackCase?.coApplicantName ?? ""),
        dob: p.secondParty?.dob ?? undefined,
        age: ageFromDob(p.secondParty?.dob) ?? (typeof p.secondParty?.age === "number" ? p.secondParty?.age : undefined),
        nationality: p.secondParty?.nationality ?? undefined,
        eidNo: p.secondParty?.eidNo ?? undefined,
        passportNo: p.secondParty?.passportNo ?? undefined,
        phone: p.secondParty?.phone ?? undefined,
        email: p.secondParty?.email ?? undefined,
        employmentProfile: p.secondParty?.employmentProfile ?? "Salaried",
        companyName: p.secondParty?.companyName ?? undefined,
        monthlySalary: Number(p.secondParty?.monthlySalary) || 0,
        variableIncome: Number(p.secondParty?.variableIncome) || 0,
        rentalIncome: Number(p.secondParty?.rentalIncome) || 0,
        existingEmis: Number(p.secondParty?.existingEmis) || 0,
        creditCardLimits: Number(p.secondParty?.creditCardLimits) || 0,
        goldenVisa: !!p.secondParty?.goldenVisa,
      },
      processingMonths: Number(p.processingMonths) || 3,
    };
  } catch {
    return defaultCaseProfile(fallbackCase);
  }
}

/** Compute joint affordability numbers based strictly on secondParty.role */
export function computeJointAffordability(profile: CaseProfile): JointAffordabilitySummary {
  const p = profile.primary;
  const s = profile.secondParty;

  if (s.role === "co_borrower" && s.fullName.trim()) {
    const combinedIncome = (p.monthlySalary || 0) + (s.monthlySalary || 0);
    const combinedBonus = (p.variableIncome || 0) + (s.variableIncome || 0);
    const combinedRental = (p.rentalIncome || 0) + (s.rentalIncome || 0);
    const combinedEmis = (p.existingEmis || 0) + (s.existingEmis || 0);
    const combinedCards = (p.creditCardLimits || 0) + (s.creditCardLimits || 0);
    const effectiveAge = Math.max(p.age || 0, s.age || 0) || undefined;

    return {
      role: "co_borrower",
      isJointFinancial: true,
      qualifyingIncome: combinedIncome,
      qualifyingBonus: combinedBonus,
      qualifyingRental: combinedRental,
      qualifyingExistingEmis: combinedEmis,
      qualifyingCardLimits: combinedCards,
      effectiveAge,
      badgeLabel: "Joint Co-Borrower: " + s.fullName,
      badgeTone: "mint",
      explanation: "Incomes and obligations pooled. Combined salary: AED " + combinedIncome.toLocaleString() + ". Both borrowers co-signing.",
    };
  }

  if (s.role === "co_applicant" && s.fullName.trim()) {
    return {
      role: "co_applicant",
      isJointFinancial: false,
      qualifyingIncome: p.monthlySalary || 0,
      qualifyingBonus: p.variableIncome || 0,
      qualifyingRental: p.rentalIncome || 0,
      qualifyingExistingEmis: p.existingEmis || 0,
      qualifyingCardLimits: p.creditCardLimits || 0,
      effectiveAge: p.age,
      badgeLabel: "Co-Applicant (Title Only): " + s.fullName,
      badgeTone: "amber",
      explanation: s.fullName + " added for property title & KYC only. Incomes and debts excluded from qualification.",
    };
  }

  return {
    role: "none",
    isJointFinancial: false,
    qualifyingIncome: p.monthlySalary || 0,
    qualifyingBonus: p.variableIncome || 0,
    qualifyingRental: p.rentalIncome || 0,
    qualifyingExistingEmis: p.existingEmis || 0,
    qualifyingCardLimits: p.creditCardLimits || 0,
    effectiveAge: p.age,
    badgeLabel: "Single Borrower",
    badgeTone: "slate",
    explanation: "Standard single borrower application.",
  };
}
