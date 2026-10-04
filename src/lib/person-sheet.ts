// The Person data sheet — the ONE place a bank-form field is declared.
//
// WHY A DECLARATIVE LIST AND NOT HARD-CODED FORM JSX: the field set is
// discovered incrementally. Every new bank form turns up something new (DIB
// wanted mother's maiden name; another will want a shareholding percentage),
// and the requirement is that adding one is a SINGLE LINE here plus nothing
// else. The UI renders whatever this list says, the completion meter counts
// whatever this list says, and the PDF filler reads the same keys — so a field
// can never exist in the form but be missing from the sheet, or vice versa.
//
// `path` is the key inside Client.personJson. `key` is the canonical registry
// key used by the PDF filler, so the same value serves both.
//
// `who` decides who realistically supplies it, and it drives the UI's whole
// anti-overwhelm design: staff should never be shown 50 empty boxes, because
// almost all of these are facts only the CLIENT knows. "client" fields are
// chased, not typed; "either" can be typed by whoever has the file open.

export type SheetWho = "client" | "staff" | "either";
export type SheetInput = "text" | "number" | "date" | "select" | "yesno";

export interface SheetField {
  /** Key inside Client.personJson. */
  path: string;
  /** Canonical registry key the PDF filler maps to. */
  key: string;
  label: string;
  input: SheetInput;
  who: SheetWho;
  /** Rendered as required (still never auto-filled if the registry marks it protected). */
  required?: boolean;
  /** Options for `select`. */
  options?: string[];
  hint?: string;
  /** Only shown when the person's employmentProfile is Self-Employed. */
  onlyIfSelfEmployed?: boolean;
  /** Only shown when a co-partner is on the case. */
  onlyIfSecondParty?: boolean;
}

export interface SheetSection {
  id: string;
  title: string;
  /** One line explaining why we ask, shown collapsed. */
  blurb?: string;
  fields: SheetField[];
}

const YES_NO: SheetField["options"] = ["Yes", "No"];

export const RESIDENCE_STATUS = ["Owned - self", "Owned - family", "Rented", "Company provided", "Other"];
export const PROPERTY_STATUS = ["Self-owned", "Rented", "Family-owned", "Under offer", "Mortgage outstanding"];

export const PERSON_SECTIONS: SheetSection[] = [
  {
    id: "personal",
    title: "Personal information",
    blurb: "Identity. Almost every bank form asks for these, so they are asked once — here.",
    fields: [
      { path: "firstName", key: "name.first", label: "First name", input: "text", who: "client", required: true },
      { path: "middleName", key: "name.middle", label: "Middle name", input: "text", who: "client" },
      { path: "lastName", key: "name.last", label: "Last / family name", input: "text", who: "client", required: true },
      { path: "mothersMaidenName", key: "mothersMaidenName", label: "Mother's maiden name", input: "text", who: "client" },
      { path: "email", key: "email", label: "Email", input: "text", who: "client", required: true },
      { path: "phone", key: "mobile", label: "Mobile number (UAE)", input: "text", who: "client", required: true },
      { path: "mobileHomeCountry", key: "mobileHomeCountry", label: "Mobile number in home country", input: "text", who: "client" },
      { path: "gender", key: "gender", label: "Gender", input: "select", who: "client", options: ["Male", "Female"] },
      { path: "maritalStatus", key: "maritalStatus", label: "Marital status", input: "select", who: "client", required: true, options: ["Single", "Married", "Divorced", "Widowed"] },
      { path: "numberOfDependants", key: "dependants", label: "Number of dependants", input: "number", who: "client", required: true },
      { path: "birthPlace", key: "birthPlace", label: "Place of birth", input: "text", who: "client" },
      { path: "civilStatusNote", key: "civilStatusNote", label: "Civil status notes", input: "text", who: "staff" },
    ],
  },
  {
    id: "kyc",
    title: "Identity documents",
    blurb: "Validity windows matter — a bank rejects an expired document, so capture both ends.",
    fields: [
      { path: "eidFullName", key: "eidFullName", label: "Emirates ID — full name (as printed)", input: "text", who: "client" },
      { path: "eidNo", key: "eidNo", label: "Emirates ID number", input: "text", who: "client", required: true },
      { path: "eidIssuePlace", key: "eidIssuePlace", label: "Emirates ID — place of issue", input: "text", who: "client" },
      { path: "eidValidFrom", key: "eidValidFrom", label: "Emirates ID — valid from", input: "date", who: "client" },
      { path: "eidValidUpto", key: "eidValidUpto", label: "Emirates ID — valid up to", input: "date", who: "client" },
      { path: "passportFullName", key: "passportFullName", label: "Passport — full name", input: "text", who: "client" },
      { path: "passportNo", key: "passportNo", label: "Passport number", input: "text", who: "client" },
      { path: "passportCountry", key: "passportCountry", label: "Passport — country of issue", input: "text", who: "client" },
      { path: "passportPlaceOfBirth", key: "passportPlaceOfBirth", label: "Passport — place of birth", input: "text", who: "client" },
      { path: "passportValidFrom", key: "passportValidFrom", label: "Passport — valid from", input: "date", who: "client" },
      { path: "passportValidUpto", key: "passportValidUpto", label: "Passport — valid up to", input: "date", who: "client" },
      { path: "visaNo", key: "visaNo", label: "Visa number", input: "text", who: "client" },
      { path: "visaValidFrom", key: "visaValidFrom", label: "Visa — valid from", input: "date", who: "client" },
      { path: "visaValidUpto", key: "visaValidUpto", label: "Visa — valid up to", input: "date", who: "client" },
    ],
  },
  {
    id: "uae-residence",
    title: "Residency in the UAE",
    fields: [
      { path: "yearMovedToUae", key: "yearMovedToUae", label: "Year moved to the UAE", input: "number", who: "client", required: true },
      { path: "residenceStatus", key: "resType", label: "Status of current residence", input: "select", who: "client", required: true, options: RESIDENCE_STATUS },
      { path: "uaeAddressLine", key: "resAddress", label: "Address (building / street)", input: "text", who: "client", required: true },
      { path: "uaeFlatUnit", key: "uaeFlatUnit", label: "Flat or unit number", input: "text", who: "client", required: true },
      { path: "uaeBuilding", key: "uaeBuilding", label: "Building name", input: "text", who: "client", required: true },
      { path: "uaeLandmark", key: "uaeLandmark", label: "Nearest landmark", input: "text", who: "client", required: true },
      { path: "uaeCity", key: "uaeCity", label: "City", input: "text", who: "client", required: true },
      { path: "uaeState", key: "uaeState", label: "State / emirate", input: "select", who: "client", required: true, options: ["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah"] },
      { path: "uaePoBox", key: "uaePoBox", label: "PO Box", input: "text", who: "client" },
      { path: "uaeLandline", key: "uaeLandline", label: "Landline", input: "text", who: "client" },
      { path: "yearsAtCurrentAddress", key: "yearsAtCurrentAddress", label: "Years at this address", input: "number", who: "client" },
    ],
  },
  {
    id: "home-country",
    title: "Home-country residency",
    blurb: "Banks run a home-country credit check as well as the UAE one.",
    fields: [
      { path: "homeCountry", key: "nationality", label: "Country", input: "text", who: "client", required: true },
      { path: "homeAddressLine", key: "homeAddress", label: "Address", input: "text", who: "client", required: true },
      { path: "homeCity", key: "homeCity", label: "City", input: "text", who: "client", required: true },
      { path: "homeState", key: "homeState", label: "State / province", input: "text", who: "client" },
      { path: "homePoBox", key: "homePoBox", label: "Postal / ZIP", input: "text", who: "client", required: true },
      { path: "homeLandline", key: "homeLandline", label: "Home-country phone", input: "text", who: "client" },
    ],
  },
  {
    id: "references",
    title: "References",
    blurb: "Two sets: someone who knows them in the UAE, and someone at home.",
    fields: [
      { path: "uaeRef1Name", key: "ref1Name", label: "UAE reference 1 — name", input: "text", who: "client" },
      { path: "uaeRef1Mobile", key: "ref1Mobile", label: "UAE reference 1 — mobile", input: "text", who: "client" },
      { path: "uaeRef2Name", key: "ref2Name", label: "UAE reference 2 — name", input: "text", who: "client" },
      { path: "uaeRef2Mobile", key: "ref2Mobile", label: "UAE reference 2 — mobile", input: "text", who: "client" },
      { path: "homeRef1Name", key: "homeRef1Name", label: "Home-country reference 1 — name", input: "text", who: "client" },
      { path: "homeRef1Mobile", key: "homeRef1Mobile", label: "Home-country reference 1 — mobile", input: "text", who: "client" },
      { path: "homeRef2Name", key: "homeRef2Name", label: "Home-country reference 2 — name", input: "text", who: "client" },
      { path: "homeRef2Mobile", key: "homeRef2Mobile", label: "Home-country reference 2 — mobile", input: "text", who: "client" },
    ],
  },
  {
    id: "employment",
    title: "Employment",
    blurb: "The shareholding fields only appear for the self-employed — banks assess them differently.",
    fields: [
      { path: "employmentType", key: "employmentProfile", label: "Employment type", input: "select", who: "client", required: true, options: ["Salaried", "Self-Employed", "Business Owner", "Retired", "Student"] },
      { path: "jobTitle", key: "companyPosition", label: "Job title / designation", input: "text", who: "client", required: true },
      { path: "workEmail", key: "workEmail", label: "Work email address", input: "text", who: "client" },
      { path: "companyName", key: "companyName", label: "Employer / company name", input: "text", who: "client", required: true },
      { path: "companyIndustry", key: "companyIndustry", label: "Company industry", input: "text", who: "client" },
      { path: "companyAddressLine", key: "companyAddress", label: "Employer address", input: "text", who: "client", required: true },
      { path: "companyCity", key: "companyCity", label: "Employer city", input: "text", who: "client", required: true },
      { path: "companyCountry", key: "companyCountry", label: "Employer country", input: "text", who: "client", required: true },
      { path: "companyPoBox", key: "companyPOBox", label: "Employer PO Box", input: "text", who: "client" },
      { path: "companyPhone", key: "companyTel", label: "Employer phone", input: "text", who: "client", required: true },
      { path: "companyHrEmail", key: "companyHrEmail", label: "Employer HR email", input: "text", who: "client" },
      { path: "companyWebsite", key: "companyWebsite", label: "Company website", input: "text", who: "client" },
      { path: "companyEmployees", key: "companyEmployees", label: "Number of employees", input: "number", who: "client" },
      { path: "employedSince", key: "employedSince", label: "Employed since", input: "date", who: "client" },
      { path: "timeInUae", key: "timeInUae", label: "Time in the UAE (years)", input: "number", who: "client" },
      { path: "previousEmployer", key: "previousEmployer", label: "Previous employer", input: "text", who: "client" },
      { path: "previousJobTitle", key: "previousJobTitle", label: "Previous job title", input: "text", who: "client" },
      { path: "previousStartDate", key: "previousStartDate", label: "Previous job — from", input: "date", who: "client" },
      { path: "previousEndDate", key: "previousEndDate", label: "Previous job — to", input: "date", who: "client" },

      // --- self-employed only ---
      { path: "businessType", key: "businessType", label: "Nature of business", input: "text", who: "client", onlyIfSelfEmployed: true },
      { path: "businessShareholdingPct", key: "businessShareholdingPct", label: "Your shareholding in the company / firm (%)", input: "number", who: "client", required: true, onlyIfSelfEmployed: true, hint: "Banks assess the applicant's interest in the entity, not just the salary drawn from it. A 100%-owner director and a 20% shareholder are treated very differently." },
      { path: "businessRole", key: "businessRole", label: "Your role in the business", input: "text", who: "client", onlyIfSelfEmployed: true, options: ["Owner", "Partner", "Director", "Manager", "Employee", "Consultant"] },
      { path: "businessEstablished", key: "businessEstablished", label: "Business established on", input: "date", who: "client", onlyIfSelfEmployed: true },
      { path: "businessIncome", key: "businessIncome", label: "Average monthly business income", input: "number", who: "client", required: true, onlyIfSelfEmployed: true },
      { path: "businessProfitShare", key: "businessProfitShare", label: "Profit share / drawings", input: "number", who: "client", onlyIfSelfEmployed: true },
      { path: "tradeLicenceNo", key: "tradeLicenceNo", label: "Trade licence number", input: "text", who: "client", onlyIfSelfEmployed: true },
      { path: "tradeLicenceExpiry", key: "tradeLicenceExpiry", label: "Trade licence valid up to", input: "date", who: "client", onlyIfSelfEmployed: true },
      { path: "visaSponsor", key: "visaSponsor", label: "Visa sponsor", input: "text", who: "client", onlyIfSelfEmployed: true },
    ],
  },
  {
    id: "income",
    title: "Income",
    fields: [
      { path: "incomeType", key: "incomeType", label: "Income type", input: "select", who: "client", required: true, options: ["Salary", "Business income", "Rental income", "Investments", "Retirement", "Other"] },
      { path: "monthlyFixedIncome", key: "salary", label: "Monthly fixed income", input: "number", who: "client", required: true },
      { path: "monthlyVariableIncome", key: "bonus", label: "Monthly variable / bonus", input: "number", who: "client" },
      { path: "monthlyRentalIncome", key: "rentalIncome", label: "Monthly rental income", input: "number", who: "client" },
      { path: "otherMonthlyIncome", key: "otherIncome", label: "Other monthly income", input: "number", who: "client" },
      { path: "totalMonthlyIncome", key: "totalIncome", label: "Total monthly income", input: "number", who: "client", required: true, hint: "Must be the total the bank will assess — usually the sum of the four above." },
      { path: "monthlyHouseholdExpenses", key: "monthlyHouseholdExpenses", label: "Total monthly household expenses", input: "number", who: "client" },
    ],
  },
  {
    id: "liabilities",
    title: "Liabilities, credit cards and bank accounts",
    blurb: "The 50% DBR check is built entirely from this section, so the splits matter.",
    fields: [
      { path: "hasCreditCards", key: "hasCreditCards", label: "Do you have credit cards?", input: "select", who: "client", required: true, options: YES_NO },
      { path: "creditCardLimit", key: "creditCardLimit", label: "Total credit card limit", input: "number", who: "client" },
      { path: "hasPersonalLoans", key: "hasPersonalLoans", label: "Do you have any personal loans?", input: "select", who: "client", required: true, options: YES_NO },
      { path: "personalLoanMonthly", key: "liabPersonalMonthly", label: "Personal loan — monthly instalment", input: "number", who: "client" },
      { path: "hasAutoLoans", key: "hasAutoLoans", label: "Do you have any auto loans?", input: "select", who: "client", required: true, options: YES_NO },
      { path: "autoLoanMonthly", key: "liabAutoMonthly", label: "Auto loan — monthly instalment", input: "number", who: "client" },
      { path: "hasExistingMortgages", key: "hasExistingMortgages", label: "Do you have any other existing loans?", input: "select", who: "client", required: true, options: YES_NO },
      { path: "mortgage1Institution", key: "mortgage1Institution", label: "Existing home finance #1 — bank", input: "text", who: "client" },
      { path: "mortgage1Monthly", key: "liabHf1Monthly", label: "Existing home finance #1 — monthly", input: "number", who: "client" },
      { path: "mortgage2Institution", key: "mortgage2Institution", label: "Existing home finance #2 — bank", input: "text", who: "client" },
      { path: "mortgage2Monthly", key: "liabHf2Monthly", label: "Existing home finance #2 — monthly", input: "number", who: "client" },
      { path: "otherLoansMonthly", key: "liabOthersMonthly", label: "Other liabilities — monthly", input: "number", who: "client" },
      { path: "totalMonthlyLiabilities", key: "totalEmis", label: "Total existing monthly obligations", input: "number", who: "client", required: true },
      { path: "bankName1", key: "bankName1", label: "Main salary account — bank", input: "text", who: "client" },
      { path: "bankAccount1", key: "bankAccount1", label: "Main salary account — number", input: "text", who: "client" },
      { path: "bankAccount1Iban", key: "iban", label: "IBAN", input: "text", who: "client", hint: "UAE IBANs start with AE and are 23 characters." },
    ],
  },
];

/** Every field, flattened — the completion meter and the PDF filler read this. */
export const ALL_SHEET_FIELDS: SheetField[] = PERSON_SECTIONS.flatMap((s) => s.fields);

/** Which fields apply to a person, honouring the conditional ones. */
export function fieldsFor(opts: { selfEmployed?: boolean; secondParty?: boolean } = {}): SheetField[] {
  return ALL_SHEET_FIELDS.filter((f) => {
    if (f.onlyIfSelfEmployed && !opts.selfEmployed) return false;
    if (f.onlyIfSecondParty && !opts.secondParty) return false;
    return true;
  });
}

export type PersonData = Record<string, unknown>;

/**
 * Pre-fill the sheet from EVERYTHING already on file, so it never presents as an
 * empty form.
 *
 * THE BUG THIS FIXES: the sheet was seeded from `personData` alone, which starts
 * as `{}`. A client whose name, Emirates ID, passport, phone, email, DOB,
 * nationality, employer and salary were ALL on file still saw "0 of 102
 * answered" — which is wrong, and actively harmful, because that meter drives the
 * "request from client" chase: staff would have chased a client for their own
 * Emirates ID number.
 *
 * It is a SEED, not an overwrite — `put` is first-write-wins, so a value the
 * client or a broker has already corrected on the sheet always survives. Losing
 * a correction on the next page load would be worse than showing a stale default.
 *
 * NAMES: the parts come from the profile when they are already recorded, and
 * otherwise from `splitName` as a starting value. A three-box form needs parts,
 * and refusing to seed them would make the sheet look empty for a reason that
 * has nothing to do with the client. `splitName` is a convenience, never a
 * decision — the parts stay editable.
 */
export function seedPersonSheet(
  personData: PersonData,
  known: {
    fullName?: string;
    firstName?: string;
    middleName?: string;
    lastName?: string;
    eidNo?: string; passportNo?: string; dob?: string; nationality?: string;
    phone?: string; email?: string; birthPlace?: string;
    employmentProfile?: string; companyName?: string;
    monthlySalary?: number; variableIncome?: number; rentalIncome?: number;
    existingEmis?: number; creditCardLimits?: number;
  },
): PersonData {
  const out: PersonData = { ...personData };
  const filled = (p: string) => {
    const v = out[p];
    return v !== undefined && v !== null && String(v).trim() !== "";
  };
  const put = (path: string, v: unknown) => {
    if (filled(path)) return;
    if (v === undefined || v === null) return;
    if (typeof v === "string" && v.trim() === "") return;
    if (typeof v === "number" && !Number.isFinite(v)) return;
    out[path] = v;
  };

  // --- identity ---
  put("firstName", known.firstName);
  put("middleName", known.middleName);
  put("lastName", known.lastName);
  if (!filled("firstName") && !filled("lastName") && known.fullName) {
    const g = splitName(known.fullName);
    if (g.first) out.firstName = g.first;
    if (g.last) out.lastName = g.last;
    if (g.middle) out.middleName = g.middle;
  }
  put("eidNo", known.eidNo);
  put("passportNo", known.passportNo);
  put("dob", known.dob);
  put("nationality", known.nationality);
  put("phone", known.phone);
  put("email", known.email);
  put("birthPlace", known.birthPlace);

  // --- employment & income ---
  put("employmentType", known.employmentProfile);
  put("companyName", known.companyName);
  put("monthlyFixedIncome", known.monthlySalary);
  put("monthlyVariableIncome", known.variableIncome);
  put("monthlyRentalIncome", known.rentalIncome);
  const fixed = Number(out.monthlyFixedIncome) || 0;
  const variable = Number(out.monthlyVariableIncome) || 0;
  const rent = Number(out.monthlyRentalIncome) || 0;
  if (fixed + variable + rent > 0) put("totalMonthlyIncome", fixed + variable + rent);

  // --- liabilities ---
  put("totalMonthlyLiabilities", known.existingEmis);
  put("creditCardLimit", known.creditCardLimits);

  return out;
}

/**
 * Best-effort name split, used only as a starting value for a three-box form.
 * A particle prefix (Al / Bin / Ibn) travels with the family name, which is the
 * convention Gulf names actually follow. The result is a suggestion the user can
 * change, never something the PDF filler treats as authoritative.
 */
export function splitName(full: string): { first: string; middle: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", middle: "", last: "" };
  if (parts.length === 1) return { first: parts[0], middle: "", last: "" };
  let lastIdx = parts.length - 1;
  if (lastIdx > 0 && /^(al|el|bin|ibn|abu|umm)$/i.test(parts[lastIdx - 1])) lastIdx -= 1;
  return {
    first: parts[0],
    middle: parts.slice(1, lastIdx).join(" "),
    last: parts.slice(lastIdx).join(" "),
  };
}

/** A field counts as answered only if it holds something real — 0 is a real
 *  answer for a count, "" / null / undefined are not. */
export function isAnswered(data: PersonData, f: SheetField): boolean {
  const v = data?.[f.path];
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "number") return Number.isFinite(v);
  return true;
}

export interface SheetCompletion {
  total: number;
  done: number;
  missing: SheetField[];
  /** Gaps the CLIENT should supply — this is what staff chase, not type. */
  clientMissing: SheetField[];
  pct: number;
}

export function sheetCompletion(
  data: PersonData,
  opts: { selfEmployed?: boolean; secondParty?: boolean } = {},
): SheetCompletion {
  const all = fieldsFor(opts);
  const done = all.filter((f) => isAnswered(data, f));
  const missing = all.filter((f) => !isAnswered(data, f));
  return {
    total: all.length,
    done: done.length,
    missing,
    clientMissing: missing.filter((f) => f.who === "client"),
    pct: all.length ? Math.round((done.length / all.length) * 100) : 0,
  };
}
