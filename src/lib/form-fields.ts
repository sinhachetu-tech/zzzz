// Canonical form-field registry — the ONE vocabulary every bank form maps onto.
//
// WHY A REGISTRY AT ALL: there are ~20 banks × 3-4 forms ≈ 80 forms, and typing
// 250 mappings per form is 20,000 mappings. It is not viable, and it is not
// necessary: bank forms ask for the SAME data under different names. This file
// is the shared vocabulary, written once, and each bank form becomes a thin
// mapping onto it. That turns "80 × 250 mappings" into "1 registry + 80 short
// alias lists".
//
// HOW A MAPPING IS WRITTEN:
//   "Emirates_ID"        → "eidNo"                  (exact canonical name)
//   "Customer_Name"      → "name.full"              (explicit alias)
//   "Bank_Account1"      → "formData.bankAccounts[0]" (explicit indexed path)
//
// THREE THINGS THIS FILE ENFORCES, because getting them wrong is expensive:
//
// 1. FORMATS ARE FUNCTIONS, not strings. A bank wanting the account number as
//    one 14-digit block, or the DOB as dd-MMM-yyyy, or the phone as 0501234567,
//    is a format choice — never a data difference. "same data, different
//    rendering" is the whole point.
//
// 2. PROTECTED FIELDS ARE NEVER AUTO-FILLED. The DIB form carries
//    Credit_Default / Credit_Bankrupt / Credit_Criminal_Case / Credit_Guarantor
//    as radio groups. Those are LEGAL DECLARATIONS: a false "no" is a
//    misrepresentation by the applicant. Same for consent and Takaful
//    cross-sell checkboxes. `protected: true` means the generator leaves it
//    blank and the UI flags it — a human answers those, always.
//
// 3. STAFF-USE-ONLY FIELDS ARE NOT THE APPLICANT'S. HFA_Name, SM_StaffID,
//    Form_Validated, Missing_Fields, txt_Error are filled in by the bank's own
//    staff. We must not invent a value for them.

/** A rendering of one canonical value. Pure: same input, same output. */
export type Formatter = (v: unknown) => string;

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Parse an ISO-ish date into its parts, tolerating the shapes we actually store. */
function dateParts(v: unknown): { d: number; m: number; y: number } | null {
  const s = String(v ?? "").trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { y: +iso[1], m: +iso[2], d: +iso[3] };
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) return { d: +dmy[1], m: +dmy[2], y: +dmy[3] };
  return null;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export const FORMATTERS: Record<string, Formatter> = {
  text: (v) => (v == null ? "" : String(v)).trim(),

  // --- numbers: the bank wants 0, not "0.00", and never a currency symbol ---
  amount: (v) => (v ? String(Math.round(num(v))) : ""),
  amountDec: (v) => (v ? num(v).toFixed(2) : ""),

  // --- account numbers: THIS is the "14 digits, one block or several" case ---
  digits14: (v) => String(v ?? "").replace(/\D/g, "").slice(0, 14),
  digits14Spaced: (v) => {
    const d = String(v ?? "").replace(/\D/g, "").slice(0, 14);
    return d.length > 7 ? `${d.slice(0, 7)} ${d.slice(7)}` : d;
  },
  iban: (v) => String(v ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase(),

  // --- UAE phone: three plausible renderings, one stored value ---
  phoneFull: (v) => `+971 ${String(v ?? "").replace(/\D/g, "").replace(/^971/, "")}`.replace(/\s+/g, " ").trim(),
  phoneLocal: (v) => `0${String(v ?? "").replace(/\D/g, "").replace(/^971/, "")}`,
  phoneCompact: (v) => `+971${String(v ?? "").replace(/\D/g, "").replace(/^971/, "")}`,

  // --- dates ---
  dateDDMMYYYY: (v) => { const p = dateParts(v); return p ? `${pad(p.d)}/${pad(p.m)}/${p.y}` : ""; },
  dateDDMMMYYYY: (v) => {
    const p = dateParts(v);
    return p && p.m >= 1 && p.m <= 12 ? `${pad(p.d)}-${MONTHS[p.m - 1]}-${p.y}` : "";
  },
  dateYYYYMMDD: (v) => { const p = dateParts(v); return p ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : ""; },

  // --- names ---
  nameFull: (v) => String(v ?? "").replace(/\s+/g, " ").trim(),
  nameUpper: (v) => String(v ?? "").toUpperCase().replace(/\s+/g, " ").trim(),

  // EID is stored digits-only but every bank prints it 784-1976-5729651-9
  eidFormatted: (v) => {
    const d = String(v ?? "").replace(/\D/g, "");
    return d.length === 15
      ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 14)}-${d.slice(14)}`
      : d;
  },
};

export type FieldKind = "text" | "checkbox" | "radio" | "dropdown";

export interface CanonicalField {
  /** Stable key used in mappings. Also the name the matcher looks for. */
  key: string;
  /** Human label, shown in the mapping UI. */
  label: string;
  /** Path into the case's resolved form data. `null` = nothing to fill. */
  source: string | null;
  format: string;
  kind: FieldKind;
  /**
   * NEVER auto-fill. Legal declarations (credit default / bankruptcy /
   * criminal case), consents, and bank Takaful cross-sell. A wrong "no" here is
   * a misrepresentation by the applicant, so these stay blank and get flagged.
   */
  protected?: boolean;
  /**
   * Filled in by the bank's own staff, not the applicant (HFA_Name, SM_StaffID,
   * Form_Validated, Missing_Fields). We never invent these.
   */
  staffOnly?: boolean;
  /**
   * Extra spellings banks use for the same thing. This alias list is what makes
   * 80 forms tractable: a form is mapped once, and any bank whose field name is
   * already listed here matches automatically.
   */
  aliases: string[];
}

/** The registry, ordered roughly as a bank form is laid out, so the mapping UI
 *  is reviewable top-to-bottom instead of alphabetically. */
export const CANONICAL_FIELDS: CanonicalField[] = [
  // ---------- identity ----------
  { key: "name.first", label: "First name", source: "name.first", format: "nameFull", kind: "text", aliases: ["first_name", "firstname", "given_name", "applicant_first_name", "fname"] },
  { key: "name.middle", label: "Middle name", source: "name.middle", format: "nameFull", kind: "text", aliases: ["middle_name", "middlename", "second_name", "mname"] },
  { key: "name.last", label: "Last / family name", source: "name.last", format: "nameFull", kind: "text", aliases: ["last_name", "lastname", "surname", "family_name", "lname"] },
  { key: "name.full", label: "Full name (single box)", source: "name.full", format: "nameFull", kind: "text", aliases: ["customer_name", "applicant_name", "full_name", "name"] },
  { key: "eidNo", label: "Emirates ID", source: "eidNo", format: "eidFormatted", kind: "text", aliases: ["emirates_id", "emiratesid", "eid", "emirates_id_number", "id_number"] },
  { key: "eidExpiry", label: "Emirates ID expiry", source: "eidExpiry", format: "dateDDMMYYYY", kind: "text", aliases: ["emiratesid_expirydate", "eid_expiry", "eid_expiry_date"] },
  { key: "passportNo", label: "Passport number", source: "passportNo", format: "text", kind: "text", aliases: ["passport_no", "passportno", "passport_number"] },
  { key: "visaNo", label: "Visa number", source: "formData.visaNumber", format: "digits14", kind: "text", aliases: ["visa_number", "visano", "visa_no"] },
  { key: "visaExpiry", label: "Visa expiry", source: "formData.visaExpiry", format: "dateDDMMYYYY", kind: "text", aliases: ["visa_expirydate", "visa_expiry"] },
  { key: "dob", label: "Date of birth", source: "dob", format: "dateDDMMYYYY", kind: "text", aliases: ["date_of_birth", "birth_date", "birthdate"] },
  { key: "birthPlace", label: "Place of birth", source: "formData.birthPlace", format: "text", kind: "text", aliases: ["birth_place", "place_of_birth", "pob"] },
  { key: "nationality", label: "Nationality", source: "nationality", format: "text", kind: "text", aliases: ["nationality", "nat", "country_of_nationality"] },
  { key: "gender", label: "Gender", source: "formData.gender", format: "text", kind: "radio", protected: true, aliases: ["group_gender", "sex"] },
  { key: "maritalStatus", label: "Marital status", source: "formData.maritalStatus", format: "text", kind: "dropdown", protected: true, aliases: ["marital_status", "maritalstatus", "group_relationship", "relationship"] },
  { key: "mobile", label: "Mobile number", source: "phone", format: "phoneFull", kind: "text", aliases: ["mobile_no", "mobile_number", "mobile", "contact_number", "phone"] },
  { key: "email", label: "Email", source: "email", format: "text", kind: "text", aliases: ["email", "e_mail", "email_address"] },
  // ---------- income ----------
  { key: "salary", label: "Basic salary (monthly)", source: "monthlySalary", format: "amount", kind: "text", aliases: ["inc_basic_salary", "basic_salary", "monthly_salary", "salary"] },
  { key: "housingAllowance", label: "Housing allowance", source: "formData.housingAllowance", format: "amount", kind: "text", aliases: ["inc_housing_allowance", "housing_allowance"] },
  { key: "bonus", label: "Annual bonus", source: "variableIncome", format: "amount", kind: "text", aliases: ["inc_annual_bonus", "annual_bonus", "bonus"] },
  { key: "rentalIncome", label: "Rental income", source: "rentalIncome", format: "amount", kind: "text", aliases: ["inc_rental_income", "rental_income", "rent_income"] },
  { key: "otherIncome", label: "Other income", source: "formData.otherIncome", format: "amount", kind: "text", aliases: ["inc_other_income", "other_income"] },
  { key: "totalIncome", label: "Total income", source: "totalIncome", format: "amount", kind: "text", aliases: ["inc_total_income", "total_income", "gross_income"] },

  // ---------- employment ----------
  { key: "companyName", label: "Employer name", source: "companyName", format: "text", kind: "text", aliases: ["company_name", "employer", "employer_name", "company"] },
  { key: "companyAddress", label: "Employer address", source: "formData.companyAddress", format: "text", kind: "text", aliases: ["company_address", "employer_address"] },
  { key: "companyPOBox", label: "Employer PO box", source: "formData.companyPOBox", format: "text", kind: "text", aliases: ["company_pobox", "po_box"] },
  { key: "companyTel", label: "Employer telephone", source: "formData.companyTel", format: "text", kind: "text", aliases: ["company_tel_no", "company_telephone", "office_tel"] },
  { key: "companyPosition", label: "Job title", source: "formData.companyPosition", format: "text", kind: "text", aliases: ["company_position", "designation", "job_title", "position"] },
  { key: "employedSince", label: "Employed since", source: "formData.employedSince", format: "dateDDMMYYYY", kind: "text", aliases: ["company_employed_since", "employed_since", "date_joined"] },
  { key: "timeInUAE", label: "Time in UAE", source: "formData.timeInUae", format: "text", kind: "text", aliases: ["time_in_uae", "years_in_uae", "time_in_emirates"] },

  // ---------- self-employed ----------
  { key: "businessType", label: "Business type", source: "formData.businessType", format: "text", kind: "radio", protected: true, aliases: ["business_type", "nature_of_business"] },
  { key: "businessTypeOther", label: "Business type (other)", source: "formData.businessTypeOther", format: "text", kind: "text", aliases: ["business_type_others", "business_type_other"] },
  { key: "businessEstablished", label: "Business established", source: "formData.businessEstablished", format: "dateDDMMYYYY", kind: "text", aliases: ["business_date_of_establishment", "date_of_establishment", "incorporation_date"] },
  { key: "businessIncome", label: "Business monthly income", source: "formData.businessMonthlyIncome", format: "amount", kind: "text", aliases: ["business_estimated_monthly_income", "business_income", "estimated_income"] },
  { key: "tradeLicenceExpiry", label: "Trade licence expiry", source: "formData.tradeLicenceExpiry", format: "dateDDMMYYYY", kind: "text", aliases: ["tradelicense_expirydate", "trade_licence_expiry", "license_expiry"] },

  // ---------- assets ----------
  { key: "assetsDeposits", label: "Bank deposits", source: "formData.assetsDeposits", format: "amount", kind: "text", aliases: ["assets_deposits", "bank_deposits", "deposits"] },
  { key: "assetsOther", label: "Other assets", source: "formData.assetsOther", format: "amount", kind: "text", aliases: ["assets_other_assets", "other_assets"] },
  { key: "assetsTotal", label: "Total assets", source: "formData.assetsTotal", format: "amount", kind: "text", aliases: ["assets_total_assets", "total_assets"] },

  // ---------- liabilities ----------
  // The bank splits these five ways and each is 3 sub-fields. We hold ONE
  // aggregate (existingEmis) and one card-limit total, so these are mostly
  // `formData` until someone models liabilities properly.
  { key: "liabPersonalMonthly", label: "Personal loan monthly", source: "formData.liabPersonalMonthly", format: "amount", kind: "text", aliases: ["liabilities_personal_monthly_inst", "personal_loan_monthly"] },
  { key: "liabAutoMonthly", label: "Auto loan monthly", source: "formData.liabAutoMonthly", format: "amount", kind: "text", aliases: ["liabilities_auto_monthly_inst", "auto_loan_monthly"] },
  { key: "liabHf1Monthly", label: "Existing home finance #1 monthly", source: "formData.liabHf1Monthly", format: "amount", kind: "text", aliases: ["liabilities_hf1_monthly_inst", "hf1_monthly", "existing_mortgage_1"] },
  { key: "liabHf2Monthly", label: "Existing home finance #2 monthly", source: "formData.liabHf2Monthly", format: "amount", kind: "text", aliases: ["liabilities_hf2_monthly_inst", "hf2_monthly", "existing_mortgage_2"] },
  { key: "liabOthersMonthly", label: "Other liabilities monthly", source: "formData.liabOthersMonthly", format: "amount", kind: "text", aliases: ["liabilities_others_monthly_inst", "others_monthly"] },
  { key: "creditCardLimit", label: "Credit card limit(s)", source: "creditCardLimits", format: "amount", kind: "text", aliases: ["liabilities_credit_card1_limit", "credit_card_limit", "card_limit"] },
  { key: "totalEmis", label: "Total existing monthly obligations", source: "existingEmis", format: "amount", kind: "text", aliases: ["total_emis", "existing_emis", "total_debt"] },
  // ---------- existing bank accounts ----------
  // THIS is the "14 digits, one block or three" case the DIB form demonstrates
  // with Bank_Account1/2/3. One stored value, rendered however the bank asks.
  { key: "bankName1", label: "Existing bank #1", source: "formData.bankAccounts[0].name", format: "text", kind: "text", aliases: ["bank_name1", "bank1", "bank_name_1"] },
  { key: "bankAccount1", label: "Account #1", source: "formData.bankAccounts[0].number", format: "digits14", kind: "text", aliases: ["bank_account1", "account1", "bank_account_1", "account_number_1"] },
  { key: "bankName2", label: "Existing bank #2", source: "formData.bankAccounts[1].name", format: "text", kind: "text", aliases: ["bank_name2", "bank2", "bank_name_2"] },
  { key: "bankAccount2", label: "Account #2", source: "formData.bankAccounts[1].number", format: "digits14", kind: "text", aliases: ["bank_account2", "account2", "bank_account_2", "account_number_2"] },
  { key: "bankAccount3", label: "Account #3", source: "formData.bankAccounts[2].number", format: "digits14", kind: "text", aliases: ["bank_account3", "account3", "bank_account_3", "account_number_3"] },

  // ---------- property ----------
  { key: "propertyAddress", label: "Property address", source: "formData.propertyAddress", format: "text", kind: "text", aliases: ["property_address", "address_of_property", "property_addr"] },
  { key: "propertyValue", label: "Property value", source: "propertyValue", format: "amount", kind: "text", aliases: ["property_value", "property_price"] },
  { key: "appraisedValue", label: "Bank-appraised value", source: "formData.appraisedValue", format: "amount", kind: "text", aliases: ["appraised_property_value", "valuation_amount"] },
  { key: "downPayment", label: "Down payment", source: "formData.downPayment", format: "amount", kind: "text", aliases: ["property_down_payment_amount", "down_payment"] },

  // ---------- the loan being applied for ----------
  { key: "loanAmount", label: "Loan amount requested", source: "loanAmount", format: "amount", kind: "text", aliases: ["transaction_amount", "property_finance_amount", "loan_amount", "finance_amount"] },
  { key: "tenure", label: "Tenure (years)", source: "formData.tenure", format: "amount", kind: "text", aliases: ["tenure_of_finance", "repayment_tenor", "loan_tenure", "tenure"] },
  { key: "transactionType", label: "Transaction type", source: "transactionType", format: "text", kind: "text", aliases: ["transaction_type", "purpose_of_loan", "loan_purpose"] },

  // ---------- residence / household / references ----------
  { key: "resAddress", label: "Residential address", source: "formData.resAddress", format: "text", kind: "text", aliases: ["res_address", "current_address", "residential_address"] },
  { key: "resType", label: "Residence type", source: "formData.resType", format: "text", kind: "radio", protected: true, aliases: ["res_type_residence", "type_of_residence", "accommodation_type"] },
  { key: "education", label: "Education level", source: "formData.education", format: "text", kind: "radio", protected: true, aliases: ["education", "education_description", "qualification"] },
  { key: "dependants", label: "Number of dependants", source: "formData.dependants", format: "amount", kind: "text", aliases: ["no_of_dependants", "no_of_dependents", "dependants"] },
  { key: "ref1Name", label: "Reference 1 name", source: "formData.ref1Name", format: "text", kind: "text", aliases: ["ref1_name", "reference1_name", "ref_one_name"] },
  { key: "ref1Mobile", label: "Reference 1 mobile", source: "formData.ref1Mobile", format: "phoneFull", kind: "text", aliases: ["ref1_mobile", "reference1_mobile"] },
  // ---------- LEGAL DECLARATIONS — never auto-filled ----------
  // The DIB form carries these as radio groups: they are the applicant's word
  // about their OWN credit and criminal history. Guessing "No" on someone's
  // behalf is a misrepresentation, so the generator leaves them blank and the
  // UI lists them as "the applicant must answer these".
  { key: "creditDefault", label: "Credit default declaration", source: null, format: "text", kind: "radio", protected: true, aliases: ["credit_default", "have_you_defaulted"] },
  { key: "creditBankrupt", label: "Bankruptcy declaration", source: null, format: "text", kind: "radio", protected: true, aliases: ["credit_bankrupt", "bankruptcy_declaration", "declared_bankrupt"] },
  { key: "creditCriminal", label: "Criminal case declaration", source: null, format: "text", kind: "radio", protected: true, aliases: ["credit_criminal_case", "criminal_case_declaration"] },
  { key: "creditGuarantor", label: "Guarantor declaration", source: null, format: "text", kind: "radio", protected: true, aliases: ["credit_guarantor", "guarantor_declaration"] },
  { key: "consent", label: "Consent to credit check", source: null, format: "text", kind: "checkbox", protected: true, aliases: ["consent", "i_consent", "authorise_credit", "consent_credit_check"] },
  { key: "lifeTakaful", label: "Life Takaful (bank cross-sell)", source: null, format: "text", kind: "checkbox", protected: true, aliases: ["life_takaful_others", "life_takaful", "takaful"] },
  { key: "propertyTakaful", label: "Property Takaful (bank cross-sell)", source: null, format: "text", kind: "checkbox", protected: true, aliases: ["proporty_takaful_others", "property_takaful", "property_insurance_others"] },

  // ---------- the bank's own staff use these ----------
  { key: "staffName", label: "Bank staff name", source: null, format: "text", kind: "text", staffOnly: true, aliases: ["hfa_name", "sm_name", "staff_name", "rm_name"] },
  { key: "staffId", label: "Bank staff ID", source: null, format: "text", kind: "text", staffOnly: true, aliases: ["hfa_staffid", "sm_staffid", "staff_id"] },
  { key: "formValidated", label: "Form validated (bank audit)", source: null, format: "text", kind: "text", staffOnly: true, aliases: ["form_validated", "validated"] },
  { key: "missingFields", label: "Missing fields (bank audit)", source: null, format: "text", kind: "text", staffOnly: true, aliases: ["missing_fields", "txt_error", "validation_error"] },
];

/** name / alias → field, built once at module load. This index is what makes 80
 *  forms tractable: a new form only needs mapping for the names it invents. */
export const FIELD_LOOKUP: Map<string, CanonicalField> = (() => {
  const m = new Map<string, CanonicalField>();
  for (const f of CANONICAL_FIELDS) {
    m.set(f.key.toLowerCase(), f);
    for (const a of f.aliases) m.set(a.toLowerCase(), f);
  }
  return m;
})();

