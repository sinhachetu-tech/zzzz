// Seed data for HFMC — mirrors the original demo dataset, adapted to Prisma.

import { db } from "./db";
import { BANK_PRODUCTS_SEED, BANK_INTEL } from "./bank-rules-seed-data";

const DAY = 86400000;
const ts = (daysBack: number, hourJitter = 0) =>
  new Date(Date.now() - daysBack * DAY - hourJitter * 3600000).toISOString();

const DESIGNATIONS = [
  { name: "Super Admin", scope: "all", issueTasks: true, admin: true, super: true, viewRevenue: true, builtIn: true },
  { name: "Head of Company", scope: "all", issueTasks: true, admin: true, super: false, viewRevenue: true, builtIn: true },
  { name: "PA to HoC", scope: "all", issueTasks: true, admin: false, super: false, viewRevenue: false, builtIn: true },
  { name: "Mortgage Head", scope: "all", issueTasks: true, admin: true, super: false, viewRevenue: true, builtIn: true },
  { name: "Team Leader SPO", scope: "team", issueTasks: true, admin: false, super: false, viewRevenue: false, builtIn: true },
  { name: "Team Leader VRM", scope: "team", issueTasks: true, admin: false, super: false, viewRevenue: false, builtIn: true },
  { name: "SPO", scope: "own", issueTasks: false, admin: false, super: false, viewRevenue: false, builtIn: true },
  { name: "VRM", scope: "own", issueTasks: false, admin: false, super: false, viewRevenue: false, builtIn: true },
];

const USERS = [
  { id: 11, name: "Salem Al Marri", email: "super@meridian.ae", password: "super123", role: "Super Admin", team: "Management", active: true, createdAt: ts(500) },
  { id: 1, name: "Rashid Al Falasi", email: "head@meridian.ae", password: "admin123", role: "Head of Company", team: "Management", active: true, createdAt: ts(400) },
  { id: 2, name: "Layla Al Hashimi", email: "pa@meridian.ae", password: "demo123", role: "PA to HoC", team: "Management", active: true, createdAt: ts(390) },
  { id: 3, name: "Omar Al Suwaidi", email: "omar@meridian.ae", password: "demo123", role: "Mortgage Head", team: "Management", active: true, createdAt: ts(360) },
  { id: 4, name: "Imran Khan", email: "imran@meridian.ae", password: "demo123", role: "Team Leader SPO", team: "Dubai", active: true, createdAt: ts(300) },
  { id: 5, name: "Aisha Al Zaabi", email: "aisha@meridian.ae", password: "demo123", role: "SPO", team: "Dubai", active: true, createdAt: ts(240) },
  { id: 6, name: "Fatima Al Mansoori", email: "fatima@meridian.ae", password: "demo123", role: "Team Leader VRM", team: "Abu Dhabi", active: true, createdAt: ts(230) },
  { id: 7, name: "Khalid Al Nahyan", email: "khalid@meridian.ae", password: "demo123", role: "VRM", team: "Abu Dhabi", active: true, createdAt: ts(180) },
  { id: 8, name: "Priya Sharma", email: "priya@meridian.ae", password: "demo123", role: "SPO", team: "Dubai", active: true, createdAt: ts(120) },
  { id: 9, name: "Ahmed Al Maktoum", email: "ahmed@meridian.ae", password: "demo123", role: "VRM", team: "Abu Dhabi", active: true, createdAt: ts(90) },
];

const STAGES = [
  { label: "Lead", sortOrder: 0 },
  { label: "WhatsApp Group Creation", sortOrder: 1 },
  { label: "Document Collection", sortOrder: 2 },
  { label: "Pre-Approval", sortOrder: 3 },
  { label: "Property Identification", sortOrder: 4 },
  { label: "MOU / FARD", sortOrder: 5 },
  { label: "Bank Submission", sortOrder: 6 },
  { label: "Valuation", sortOrder: 7 },
  { label: "Final Approval", sortOrder: 8 },
  { label: "Disbursement", sortOrder: 9 },
];

const BANKS = [
  { name: "ENBD", ratePct: 0.85, active: true },
  { name: "ADCB", ratePct: 1.0, active: true },
  { name: "FAB", ratePct: 0.9, active: true },
  { name: "Mashreq", ratePct: 0.95, active: true },
  { name: "HSBC", ratePct: 1.1, active: true },
  { name: "SCB", ratePct: 1.0, active: true },
  { name: "CBD", ratePct: 0.9, active: true },
  { name: "DIB", ratePct: 0.8, active: true },
  { name: "ADIB", ratePct: 0.85, active: true },
  { name: "UAB", ratePct: 0.9, active: true },
  { name: "RAK Bank", ratePct: 1.0, active: true },
  { name: "NBF", ratePct: 1.05, active: true },
];

const PARTNERS = [
  { kind: "Agent", name: "Faisal Properties", defaultSharePct: 20, active: true },
  { kind: "Agent", name: "Gulf Real Estate", defaultSharePct: 15, active: true },
  { kind: "Broker", name: "Prime Mortgage Brokers", defaultSharePct: 30, active: true },
  { kind: "Broker", name: "Emirates Finance Hub", defaultSharePct: 25, active: true },
  { kind: "Referral", name: "Dr. Saeed (existing client)", defaultSharePct: 10, active: true },
  { kind: "Referral", name: "Mr. Tariq (lawyer)", defaultSharePct: 10, active: true },
];

const WHY_PENDING = ["Documents awaited", "Bank query raised", "Valuation pending", "Internal review", "Client decision", "Title deed pending", "NOC pending", "Salary transfer pending"];
const WAITING_FOR = ["Client", "Bank", "Internal", "Partner", "Developer", "Valuer"];

// SOP Guidebook HFMC-SOP-MASTER-2026 §8.1 — End-to-End TAT matrix.
// Same-day stages get 1d; "escalate if >5 days" stages get 5d.
const SLA_RULES = [
  { stage: "WhatsApp Group Creation", bank: null, maxDays: 1, active: true },
  { stage: "Document Collection", bank: null, maxDays: 5, active: true },
  { stage: "Pre-Approval", bank: null, maxDays: 5, active: true },
  { stage: "Property Identification", bank: null, maxDays: 7, active: true }, // client-dependent — soft cap
  { stage: "MOU / FARD", bank: null, maxDays: 10, active: true },
  { stage: "Bank Submission", bank: null, maxDays: 1, active: true }, // same-day, 4:30 PM UAE deadline
  { stage: "Valuation", bank: null, maxDays: 5, active: true },
  { stage: "Final Approval", bank: null, maxDays: 3, active: true },
  { stage: "Disbursement", bank: null, maxDays: 3, active: true },
];

// Document Vault master catalog — conditional templates (Admin → Doc Rules).
// Vectors: employment / property / transaction / residency; "all"/"any" = always applies.
type DbDocRule = {
  code: string; name: string; category: string; validityDays: number; warnDays: number;
  verifyNotes: string; employment: string[]; property: string[]; txn: string[]; residency: string[];
  mandatory: boolean; visibleToClient: boolean; clientCanUpload: boolean;
};
const A_ALL = ["all"];
const DOC_RULES: DbDocRule[] = [
  // --- KYC ---
  { code: "DOC-EID", name: "Emirates ID (front & back)", category: "KYC", validityDays: 60, warnDays: 30, verifyNotes: "Valid 2+ months; employer & occupation must match Salary Certificate; name must match Passport/Visa.", employment: A_ALL, property: ["any"], txn: A_ALL, residency: ["UAE National", "Resident Expatriate"], mandatory: true, visibleToClient: true, clientCanUpload: true },
  { code: "DOC-PASSPORT", name: "Passport copy", category: "KYC", validityDays: 60, warnDays: 30, verifyNotes: "Valid 2+ months; name & signature must match EID/Visa. Non-resident (CBD): all pages required. Old passport copy if visa stamped there.", employment: A_ALL, property: ["any"], txn: A_ALL, residency: A_ALL, mandatory: true, visibleToClient: true, clientCanUpload: true },
  { code: "DOC-VISA", name: "Residency Visa", category: "KYC", validityDays: 60, warnDays: 30, verifyNotes: "EID/UID + visa number cross-checked; profession & employer match SC.", employment: A_ALL, property: ["any"], txn: A_ALL, residency: ["Resident Expatriate"], mandatory: true, visibleToClient: true, clientCanUpload: true },
  { code: "DOC-FAMILYBOOK", name: "Family Book", category: "KYC", validityDays: 0, warnDays: 0, verifyNotes: "UAE Nationals only — no visa/EID requirements apply.", employment: A_ALL, property: ["any"], txn: A_ALL, residency: ["UAE National"], mandatory: true, visibleToClient: true, clientCanUpload: true },
  { code: "DOC-NR-GOVID", name: "Home-country government ID", category: "KYC", validityDays: 0, warnDays: 0, verifyNotes: "Non-resident clients — national ID or equivalent.", employment: A_ALL, property: ["any"], txn: A_ALL, residency: ["Non-Resident"], mandatory: true, visibleToClient: true, clientCanUpload: true },
  // --- Income · Salaried ---
  { code: "DOC-SAL-CERT", name: "Salary Certificate", category: "Income", validityDays: 30, warnDays: 7, verifyNotes: "Addressed to the specific bank; company stamp + PO Box; issued within 1 month; date of joining present.", employment: ["Salaried"], property: ["any"], txn: A_ALL, residency: A_ALL, mandatory: true, visibleToClient: true, clientCanUpload: true },
  { code: "DOC-SAL-STMT", name: "6-month personal bank statements", category: "Income", validityDays: 0, warnDays: 0, verifyNotes: "Salary credits must match SC; flag gambling, bounced cheques, high cash. 6-month merged period (ADIB accepts 3).", employment: ["Salaried"], property: ["any"], txn: A_ALL, residency: A_ALL, mandatory: true, visibleToClient: true, clientCanUpload: true },
  { code: "DOC-SAL-PAYSLIP", name: "Payslips (latest 3-6 months)", category: "Income", validityDays: 30, warnDays: 7, verifyNotes: "Company stamped or system generated; net pay must match bank statement.", employment: ["Salaried"], property: ["any"], txn: A_ALL, residency: A_ALL, mandatory: true, visibleToClient: true, clientCanUpload: true },
  // --- Income · Self-Employed ---
  { code: "DOC-SE-TRADELIC", name: "Valid Trade License", category: "Income", validityDays: 365, warnDays: 30, verifyNotes: "Must be valid at submission; expiry tracking on.", employment: ["Self-Employed"], property: ["any"], txn: A_ALL, residency: A_ALL, mandatory: true, visibleToClient: true, clientCanUpload: true },
  { code: "DOC-SE-MOA", name: "MOA / AOA (with amendments)", category: "Income", validityDays: 0, warnDays: 0, verifyNotes: "From beginning till date with all amendments; POA copy if any; Freezone share certificate if Freezone.", employment: ["Self-Employed"], property: ["any"], txn: A_ALL, residency: A_ALL, mandatory: true, visibleToClient: true, clientCanUpload: true },
  { code: "DOC-SE-COMPSTMT", name: "12-month company bank statements", category: "Income", validityDays: 0, warnDays: 0, verifyNotes: "Business account flows; Al Hilal requires quarterly VAT statement; audit report mandatory for turnover > AED 5M.", employment: ["Self-Employed"], property: ["any"], txn: A_ALL, residency: A_ALL, mandatory: true, visibleToClient: true, clientCanUpload: true },
  { code: "DOC-SE-FIN", name: "Audited financials (2-3 years)", category: "Income", validityDays: 0, warnDays: 0, verifyNotes: "Audited for latest 2-3 years + current-year in-house financials.", employment: ["Self-Employed"], property: ["any"], txn: A_ALL, residency: A_ALL, mandatory: true, visibleToClient: true, clientCanUpload: true },
  // --- Income · Non-Resident ---
  { code: "DOC-NR-STMT", name: "6-month home-country bank statements", category: "Income", validityDays: 0, warnDays: 0, verifyNotes: "Salary credited or balances maintained.", employment: A_ALL, property: ["any"], txn: A_ALL, residency: ["Non-Resident"], mandatory: true, visibleToClient: true, clientCanUpload: true },
  { code: "DOC-NR-TAX", name: "Income tax returns (2 years)", category: "Income", validityDays: 0, warnDays: 0, verifyNotes: "Required for >50% LTV non-resident requests; self if salaried, self & company if self-employed.", employment: A_ALL, property: ["any"], txn: A_ALL, residency: ["Non-Resident"], mandatory: false, visibleToClient: true, clientCanUpload: true },
  // --- Property · Ready (resale / completed) ---
  { code: "DOC-TITLEDEED", name: "Title Deed / Reg Deed", category: "Property", validityDays: 0, warnDays: 0, verifyNotes: "Match unit details with MOU/Form F; AUH: SPA copy to match addresses.", employment: A_ALL, property: ["Ready"], txn: A_ALL, residency: A_ALL, mandatory: true, visibleToClient: true, clientCanUpload: false },
  { code: "DOC-FORMF", name: "Form F (DXB) / MOU (AUH)", category: "Property", validityDays: 45, warnDays: 7, verifyNotes: "Signed by buyer & seller; 30 working days + 15 via addendum; must remain valid until Loan Booking.", employment: A_ALL, property: ["Ready"], txn: A_ALL, residency: A_ALL, mandatory: true, visibleToClient: true, clientCanUpload: true },
  { code: "DOC-SELLERKYC", name: "Seller passport / visa / EID", category: "Property", validityDays: 0, warnDays: 0, verifyNotes: "Seller KYC; trade license if seller is a company; payment proof.", employment: A_ALL, property: ["Ready"], txn: A_ALL, residency: A_ALL, mandatory: true, visibleToClient: false, clientCanUpload: false },
  { code: "DOC-SERVICECHG", name: "Service fee clearance / DEWA", category: "Property", validityDays: 0, warnDays: 0, verifyNotes: "Service charge clearance from building management.", employment: A_ALL, property: ["Ready"], txn: A_ALL, residency: A_ALL, mandatory: false, visibleToClient: true, clientCanUpload: true },
  // --- Property · Off-Plan ---
  { code: "DOC-OQOOD", name: "Oqood / Initial Title Deed", category: "Property", validityDays: 0, warnDays: 0, verifyNotes: "DXB: Oqood certificate; AUH: registration deed.", employment: A_ALL, property: ["Off-Plan"], txn: A_ALL, residency: A_ALL, mandatory: true, visibleToClient: true, clientCanUpload: true },
  { code: "DOC-SPA", name: "SPA (Sale & Purchase Agreement)", category: "Property", validityDays: 0, warnDays: 0, verifyNotes: "All pages signed; clear late-payment fees on developer SOA first — banks won't finance them.", employment: A_ALL, property: ["Off-Plan"], txn: A_ALL, residency: A_ALL, mandatory: true, visibleToClient: true, clientCanUpload: true },
  { code: "DOC-DEVSCHED", name: "Developer payment schedule", category: "Property", validityDays: 0, warnDays: 0, verifyNotes: "Current dated; construction-linked plan.", employment: A_ALL, property: ["Off-Plan"], txn: A_ALL, residency: A_ALL, mandatory: true, visibleToClient: true, clientCanUpload: false },
  // --- Bank & Liabilities ---
  { code: "DOC-LIAB-LETTER", name: "Liability letter / settlement proof", category: "Bank & Liabilities", validityDays: 0, warnDays: 3, verifyNotes: "Expires fastest of all documents — monitor 3 days out; must remain valid through settlement.", employment: A_ALL, property: ["any"], txn: ["Buyout / Equity Release"], residency: A_ALL, mandatory: true, visibleToClient: true, clientCanUpload: true },
  { code: "DOC-MORTTRACK", name: "12-month mortgage repayment track", category: "Bank & Liabilities", validityDays: 0, warnDays: 0, verifyNotes: "From existing bank — on-time payment history for buyout.", employment: A_ALL, property: ["any"], txn: ["Buyout / Equity Release"], residency: A_ALL, mandatory: true, visibleToClient: true, clientCanUpload: true },
  { code: "DOC-DEPCHEQUES", name: "Deposit cheque copies (10%)", category: "Bank & Liabilities", validityDays: 0, warnDays: 0, verifyNotes: "Security cheques for the deposit per MOU/Form F.", employment: A_ALL, property: ["any"], txn: ["New Purchase"], residency: A_ALL, mandatory: false, visibleToClient: true, clientCanUpload: true },
  { code: "DOC-CC-STMT", name: "Credit card statements (all banks)", category: "Bank & Liabilities", validityDays: 0, warnDays: 0, verifyNotes: "Confirms limits for the 5% rule; even fully-paid cards count.", employment: A_ALL, property: ["any"], txn: A_ALL, residency: A_ALL, mandatory: false, visibleToClient: true, clientCanUpload: true },
  // --- Internal underwriting (staff-only) ---
  { code: "DOC-AECB", name: "AECB credit bureau report", category: "Internal Underwriting", validityDays: 30, warnDays: 7, verifyNotes: "Score + liabilities cross-check before submission. NEVER client-visible.", employment: A_ALL, property: ["any"], txn: A_ALL, residency: A_ALL, mandatory: true, visibleToClient: false, clientCanUpload: false },
  { code: "DOC-CREDIT-MEMO", name: "Credit committee memo", category: "Internal Underwriting", validityDays: 0, warnDays: 0, verifyNotes: "Internal sign-off for exceptions (DBR/LTV overrides).", employment: A_ALL, property: ["any"], txn: A_ALL, residency: A_ALL, mandatory: false, visibleToClient: false, clientCanUpload: false },
  { code: "DOC-NET-MARGIN", name: "Net margin calculation sheet", category: "Internal Underwriting", validityDays: 0, warnDays: 0, verifyNotes: "Commission vs payout working — revenue-restricted.", employment: A_ALL, property: ["any"], txn: A_ALL, residency: A_ALL, mandatory: false, visibleToClient: false, clientCanUpload: false },
  // --- Transfer / stage validity documents ---
  { code: "DOC-NOC", name: "Developer NOC", category: "Transfer", validityDays: 30, warnDays: 7, verifyNotes: "General 1 month · Manazel/Aldar 30d · Emaar 15d · Nakheel 5d.", employment: A_ALL, property: ["any"], txn: A_ALL, residency: A_ALL, mandatory: true, visibleToClient: true, clientCanUpload: false },
  { code: "DOC-SOA", name: "SOA (Statement of Account)", category: "Transfer", validityDays: 0, warnDays: 0, verifyNotes: "Must be valid at handover; ADCB needs 7 days validity for booking.", employment: A_ALL, property: ["any"], txn: A_ALL, residency: A_ALL, mandatory: true, visibleToClient: true, clientCanUpload: false },
  { code: "DOC-MORTSEARCH", name: "Mortgage search certificate (AUH)", category: "Transfer", validityDays: 15, warnDays: 3, verifyNotes: "15 days only — cannot be requested early. Abu Dhabi transactions.", employment: A_ALL, property: ["any"], txn: A_ALL, residency: A_ALL, mandatory: false, visibleToClient: false, clientCanUpload: false },
  { code: "DOC-FOL", name: "Final Offer Letter (FOL)", category: "Bank & Liabilities", validityDays: 30, warnDays: 7, verifyNotes: "Validity 30/60/90 days — check the date on the letter (CBD: 60 calendar days). Verify amount, tenor & rate vs pre-approval.", employment: A_ALL, property: ["any"], txn: A_ALL, residency: A_ALL, mandatory: true, visibleToClient: false, clientCanUpload: false },
  { code: "DOC-VALUATION", name: "Valuation report", category: "Valuation", validityDays: 30, warnDays: 15, verifyNotes: "Share with Real Estate Team on receipt (13 Aug 2026 protocol) — report or amount + property details; log in G-Drive.", employment: A_ALL, property: ["any"], txn: A_ALL, residency: A_ALL, mandatory: true, visibleToClient: false, clientCanUpload: false },
];

// SOP §6.9 fee matrices (Dubai & Abu Dhabi; primary / resale / buyout).
// Source rows only — self-contribution is derived from property value − finance.
type DBFeeRule = {
  emirate: string; txnType: string; label: string; amountType: string;
  amount: number; paidBy: string; note: string; active: boolean;
};
const FEE_RULES: Omit<DBFeeRule, "sortOrder">[] = [
  // --- Dubai · Primary ---
  { emirate: "Dubai", txnType: "Primary", label: "Real Estate Agency Fee", amountType: "pct_property", amount: 2, paidBy: "Client", note: "2% + VAT", active: true },
  { emirate: "Dubai", txnType: "Primary", label: "DLD Transfer Fee", amountType: "pct_property", amount: 4, paidBy: "Client", note: "4% of property value", active: true },
  { emirate: "Dubai", txnType: "Primary", label: "DLD Trustee Fee", amountType: "fixed", amount: 4200, paidBy: "Client", note: "Incl. VAT", active: true },
  { emirate: "Dubai", txnType: "Primary", label: "Mortgage Registration Fee", amountType: "pct_loan", amount: 0.25, paidBy: "Client", note: "0.25% of finance amount", active: true },
  { emirate: "Dubai", txnType: "Primary", label: "Title Deed / Knowledge & Innovation", amountType: "fixed", amount: 870, paidBy: "Client", note: "", active: true },
  { emirate: "Dubai", txnType: "Primary", label: "Bank Processing Fee", amountType: "pct_loan", amount: 0.525, paidBy: "Client", note: "0–0.525% + VAT, bank-dependent", active: true },
  { emirate: "Dubai", txnType: "Primary", label: "Valuation Fee", amountType: "fixed", amount: 3150, paidBy: "Client", note: "AED 2,500–3,150", active: true },
  { emirate: "Dubai", txnType: "Primary", label: "Brokerage Consultancy", amountType: "fixed", amount: 2625, paidBy: "Client", note: "Nil if max LTV + extra finance taken", active: true },
  // --- Dubai · Resale ---
  { emirate: "Dubai", txnType: "Resale", label: "Real Estate Agency Fee", amountType: "pct_property", amount: 2, paidBy: "Client", note: "2% + VAT", active: true },
  { emirate: "Dubai", txnType: "Resale", label: "DLD Transfer Fee", amountType: "pct_property", amount: 4, paidBy: "Client", note: "4% of property value", active: true },
  { emirate: "Dubai", txnType: "Resale", label: "DLD Trustee Fee", amountType: "fixed", amount: 4200, paidBy: "Client", note: "Incl. VAT", active: true },
  { emirate: "Dubai", txnType: "Resale", label: "Mortgage Registration Fee", amountType: "pct_loan", amount: 0.25, paidBy: "Client", note: "0.25% of finance amount", active: true },
  { emirate: "Dubai", txnType: "Resale", label: "Title Deed / Knowledge & Innovation", amountType: "fixed", amount: 870, paidBy: "Client", note: "", active: true },
  { emirate: "Dubai", txnType: "Resale", label: "Bank Processing Fee", amountType: "pct_loan", amount: 0.525, paidBy: "Client", note: "0–0.525% + VAT, bank-dependent", active: true },
  { emirate: "Dubai", txnType: "Resale", label: "Valuation Fee", amountType: "fixed", amount: 3150, paidBy: "Client", note: "AED 2,500–3,150", active: true },
  { emirate: "Dubai", txnType: "Resale", label: "DLD Blocking Fee", amountType: "fixed", amount: 1545, paidBy: "Client", note: "Resale-specific", active: true },
  { emirate: "Dubai", txnType: "Resale", label: "Mortgage Release Fee", amountType: "fixed", amount: 1605, paidBy: "Seller", note: "1,605 / 1,875 Islamic — paid by seller", active: true },
  // --- Dubai · Buyout / Equity Release ---
  { emirate: "Dubai", txnType: "Buyout", label: "Mortgage Registration Fee", amountType: "pct_loan", amount: 0.25, paidBy: "Client", note: "0.25% of finance amount", active: true },
  { emirate: "Dubai", txnType: "Buyout", label: "Mortgage Release Fee", amountType: "fixed", amount: 1605, paidBy: "Client", note: "Fixed", active: true },
  { emirate: "Dubai", txnType: "Buyout", label: "Trustee / Electronic Registration", amountType: "fixed", amount: 4200, paidBy: "Client", note: "Incl. 5% VAT", active: true },
  { emirate: "Dubai", txnType: "Buyout", label: "Title Deed Fees", amountType: "fixed", amount: 870, paidBy: "Client", note: "", active: true },
  { emirate: "Dubai", txnType: "Buyout", label: "Bank Processing Fee", amountType: "pct_loan", amount: 1.05, paidBy: "Client", note: "Up to 1.05% + VAT", active: true },
  { emirate: "Dubai", txnType: "Buyout", label: "Valuation Fee", amountType: "fixed", amount: 3150, paidBy: "Client", note: "AED 2,625–3,150", active: true },
  // --- Abu Dhabi · Primary ---
  { emirate: "Abu Dhabi", txnType: "Primary", label: "Real Estate Agency Fee", amountType: "pct_property", amount: 2.1, paidBy: "Client", note: "2.1% incl. VAT", active: true },
  { emirate: "Abu Dhabi", txnType: "Primary", label: "ADM Transfer Fee", amountType: "pct_property", amount: 2, paidBy: "Client", note: "2% of property value (1% for Al Reef)", active: true },
  { emirate: "Abu Dhabi", txnType: "Primary", label: "Mortgage Registration Fee", amountType: "pct_loan", amount: 0.1, paidBy: "Client", note: "0.1% of finance amount", active: true },
  { emirate: "Abu Dhabi", txnType: "Primary", label: "Electronic Registration Fee", amountType: "fixed", amount: 1391.25, paidBy: "Client", note: "", active: true },
  { emirate: "Abu Dhabi", txnType: "Primary", label: "NOC / Admin Fee", amountType: "fixed", amount: 5250, paidBy: "Client", note: "Manazel standard — varies by developer", active: true },
  { emirate: "Abu Dhabi", txnType: "Primary", label: "DARI Transfer Fee", amountType: "fixed", amount: 1575, paidBy: "Client", note: "1,575 mortgage / 1,050 cash", active: true },
  { emirate: "Abu Dhabi", txnType: "Primary", label: "Bank Processing Fee", amountType: "pct_loan", amount: 1.05, paidBy: "Client", note: "0–1.05% of finance", active: true },
  { emirate: "Abu Dhabi", txnType: "Primary", label: "Valuation Fee", amountType: "fixed", amount: 3150, paidBy: "Client", note: "AED 2,625–3,150", active: true },
  // --- Abu Dhabi · Resale ---
  { emirate: "Abu Dhabi", txnType: "Resale", label: "Real Estate Agency Fee", amountType: "pct_property", amount: 2.1, paidBy: "Client", note: "2.1% incl. VAT", active: true },
  { emirate: "Abu Dhabi", txnType: "Resale", label: "ADM Transfer Fee", amountType: "pct_property", amount: 2, paidBy: "Client", note: "2% of property value (1% for Al Reef)", active: true },
  { emirate: "Abu Dhabi", txnType: "Resale", label: "Mortgage Registration Fee", amountType: "pct_loan", amount: 0.1, paidBy: "Client", note: "0.1% of finance amount", active: true },
  { emirate: "Abu Dhabi", txnType: "Resale", label: "Electronic Registration Fee", amountType: "fixed", amount: 1391.25, paidBy: "Client", note: "", active: true },
  { emirate: "Abu Dhabi", txnType: "Resale", label: "NOC / Admin Fee", amountType: "fixed", amount: 5250, paidBy: "Client", note: "Manazel standard — varies by developer", active: true },
  { emirate: "Abu Dhabi", txnType: "Resale", label: "DARI Transfer Fee", amountType: "fixed", amount: 1575, paidBy: "Client", note: "1,575 mortgage / 1,050 cash", active: true },
  { emirate: "Abu Dhabi", txnType: "Resale", label: "Bank Processing Fee", amountType: "pct_loan", amount: 1.05, paidBy: "Client", note: "0–1.05% of finance", active: true },
  { emirate: "Abu Dhabi", txnType: "Resale", label: "Valuation Fee", amountType: "fixed", amount: 3150, paidBy: "Client", note: "AED 2,625–3,150", active: true },
  { emirate: "Abu Dhabi", txnType: "Resale", label: "Mortgage Release Fee", amountType: "fixed", amount: 900, paidBy: "Seller", note: "Fixed — paid by seller", active: true },
  // --- Abu Dhabi · Buyout / Equity Release ---
  { emirate: "Abu Dhabi", txnType: "Buyout", label: "Mortgage Registration Fee", amountType: "pct_loan", amount: 0.1, paidBy: "Client", note: "0.10% of finance amount", active: true },
  { emirate: "Abu Dhabi", txnType: "Buyout", label: "Mortgage Release Fee", amountType: "fixed", amount: 900, paidBy: "Client", note: "Fixed", active: true },
  { emirate: "Abu Dhabi", txnType: "Buyout", label: "Electronic Registration Fee", amountType: "fixed", amount: 1391.25, paidBy: "Client", note: "", active: true },
  { emirate: "Abu Dhabi", txnType: "Buyout", label: "Bank Processing Fee", amountType: "pct_loan", amount: 1.05, paidBy: "Client", note: "Up to 1.05% + VAT", active: true },
  { emirate: "Abu Dhabi", txnType: "Buyout", label: "Valuation Fee", amountType: "fixed", amount: 3150, paidBy: "Client", note: "AED 2,625–3,150", active: true },
];

const CASES = [
  { caseNumber: "HFMC-0001", customer: "Mohammed Al Mansoori", banks: ["ENBD", "ADCB"], wonBank: null, loanAmount: 1850000, stage: "Document Collection", caseStatus: "Active" as const, ownerId: 5, source: "Direct" as const, partner: null, whatsapp: "+971501234567", waGroup: null, ageDays: 8 },
  { caseNumber: "HFMC-0002", customer: "Sara Al Rashid", banks: ["FAB"], wonBank: "FAB", loanAmount: 2400000, stage: "Disbursement", caseStatus: "Closed" as const, ownerId: 4, source: "Direct" as const, partner: null, whatsapp: "+971552345678", waGroup: "https://chat.whatsapp.com/abc", ageDays: 60 },
  { caseNumber: "HFMC-0003", customer: "John Mathews", banks: ["Mashreq", "HSBC"], wonBank: null, loanAmount: 1200000, stage: "Bank Submission", caseStatus: "Active" as const, ownerId: 7, source: "Agent" as const, partner: { kind: "Agent" as const, name: "Faisal Properties", sharePct: 20 }, whatsapp: "+971523456789", waGroup: null, ageDays: 14 },
  { caseNumber: "HFMC-0004", customer: "Aisha Al Suwaidi", banks: ["ADCB"], wonBank: null, loanAmount: 3500000, stage: "Valuation", caseStatus: "Active" as const, ownerId: 8, source: "Referral" as const, partner: { kind: "Referral" as const, name: "Dr. Saeed (existing client)", sharePct: 10 }, whatsapp: "+971534567890", waGroup: "https://chat.whatsapp.com/def", ageDays: 20 },
  { caseNumber: "HFMC-0005", customer: "Rahul Verma", banks: ["SCB", "CBD"], wonBank: null, loanAmount: 950000, stage: "Pre-Approval", caseStatus: "Active" as const, ownerId: 5, source: "Website" as const, partner: null, whatsapp: "+971545678901", waGroup: null, ageDays: 3 },
  { caseNumber: "HFMC-0006", customer: "Maryam Al Marri", banks: ["DIB"], wonBank: "DIB", loanAmount: 1600000, stage: "Disbursement", caseStatus: "Closed" as const, ownerId: 6, source: "Broker" as const, partner: { kind: "Broker" as const, name: "Prime Mortgage Brokers", sharePct: 30 }, whatsapp: "+971556789012", waGroup: null, ageDays: 75 },
  { caseNumber: "HFMC-0007", customer: "Vikram Patel", banks: ["ADIB", "ENBD"], wonBank: null, loanAmount: 2750000, stage: "MOU / FARD", caseStatus: "Active" as const, ownerId: 7, source: "Direct" as const, partner: null, whatsapp: "+971567890123", waGroup: "https://chat.whatsapp.com/ghi", ageDays: 12 },
  { caseNumber: "HFMC-0008", customer: "Fatima Al Zahra", banks: ["UAB"], wonBank: null, loanAmount: 800000, stage: "Document Collection", caseStatus: "Lost" as const, ownerId: 8, source: "Agent" as const, partner: { kind: "Agent" as const, name: "Gulf Real Estate", sharePct: 15 }, whatsapp: "+971578901234", waGroup: null, ageDays: 45 },
  { caseNumber: "HFMC-0009", customer: "Hassan Al Falasi", banks: ["RAK Bank"], wonBank: null, loanAmount: 4200000, stage: "Final Approval", caseStatus: "Active" as const, ownerId: 4, source: "Direct" as const, partner: null, whatsapp: "+971589012345", waGroup: "https://chat.whatsapp.com/jkl", ageDays: 25 },
  { caseNumber: "HFMC-0010", customer: "Lakshmi Nair", banks: ["NBF", "FAB"], wonBank: null, loanAmount: 1300000, stage: "Property Identification", caseStatus: "Active" as const, ownerId: 5, source: "Referral" as const, partner: { kind: "Referral" as const, name: "Mr. Tariq (lawyer)", sharePct: 10 }, whatsapp: "+971590123456", waGroup: null, ageDays: 5 },
  { caseNumber: "HFMC-0011", customer: "Abdullah Al Mheiri", banks: ["Mashreq"], wonBank: null, loanAmount: 2100000, stage: "Bank Submission", caseStatus: "Active" as const, ownerId: 7, source: "Direct" as const, partner: null, whatsapp: "+971501112233", waGroup: null, ageDays: 9 },
  { caseNumber: "HFMC-0012", customer: "Sunita Reddy", banks: ["HSBC", "ADCB"], wonBank: null, loanAmount: 1750000, stage: "WhatsApp Group Creation", caseStatus: "Active" as const, ownerId: 8, source: "Website" as const, partner: null, whatsapp: "+971502223344", waGroup: null, ageDays: 1 },
];

const TASK_SEED = [
  { caseId: 1, description: "Collect KYC & income documents", ownerId: 5, createdBy: 4, waitingFor: "Client", whyPending: "Documents awaited", dueDate: 2, status: "Open" as const },
  { caseId: 1, description: "Create WhatsApp group with client", ownerId: 5, createdBy: 5, waitingFor: "Internal", whyPending: "Internal review", dueDate: -2, status: "Open" as const },
  { caseId: 3, description: "Submit to Mashreq pre-approval", ownerId: 7, createdBy: 4, waitingFor: "Bank", whyPending: "Bank query raised", dueDate: 1, status: "Open" as const },
  { caseId: 3, description: "Verify agent share agreement", ownerId: 4, createdBy: 4, waitingFor: "Partner", whyPending: "Internal review", dueDate: 4, status: "Open" as const },
  { caseId: 4, description: "Chase bank valuation report", ownerId: 8, createdBy: 6, waitingFor: "Valuer", whyPending: "Valuation pending", dueDate: 0, status: "Open" as const },
  { caseId: 5, description: "Run affordability calculator", ownerId: 5, createdBy: 5, waitingFor: "Internal", whyPending: "Internal review", dueDate: -1, status: "Open" as const },
  { caseId: 7, description: "Draft MOU and send to client", ownerId: 7, createdBy: 6, waitingFor: "Client", whyPending: "Documents awaited", dueDate: 3, status: "Open" as const },
  { caseId: 9, description: "Follow up RAK Bank final offer letter", ownerId: 4, createdBy: 4, waitingFor: "Bank", whyPending: "Bank query raised", dueDate: 5, status: "Open" as const },
  { caseId: 9, description: "Confirm property valuation matches sale price", ownerId: 4, createdBy: 1, waitingFor: "Internal", whyPending: "Valuation pending", dueDate: 2, status: "Open" as const },
  { caseId: 10, description: "Shortlist properties in budget", ownerId: 5, createdBy: 5, waitingFor: "Client", whyPending: "Client decision", dueDate: 7, status: "Open" as const },
  { caseId: 11, description: "Submit application to Mashreq", ownerId: 7, createdBy: 4, waitingFor: "Bank", whyPending: "Documents awaited", dueDate: 4, status: "Open" as const },
  { caseId: 12, description: "Onboard client to portal", ownerId: 8, createdBy: 8, waitingFor: "Internal", whyPending: "Internal review", dueDate: 6, status: "Open" as const },
  { caseId: 2, description: "Coordinate disbursement with developer", ownerId: 4, createdBy: 1, waitingFor: "Developer", whyPending: "NOC pending", dueDate: -30, status: "Done" as const },
  { caseId: 6, description: "Obtain final NOC from developer", ownerId: 6, createdBy: 3, waitingFor: "Developer", whyPending: "NOC pending", dueDate: -40, status: "Done" as const },
];

const BULLETIN_TODAY = [
  { issuedBy: 1, task: "Push Mohammed Al Mansoori (HFMC-0001) — documents 2 days overdue.", caseId: 1, targets: [4, 5] },
  { issuedBy: 1, task: "Confirm Mashreq submission status for John Mathews (HFMC-0003).", caseId: 3, targets: [7] },
  { issuedBy: 3, task: "All SPOs: clear your Open queue before EOD — 3 files are At Risk.", caseId: null, targets: [5, 8] },
  { issuedBy: 4, task: "Rahul Verma (HFMC-0005) — run affordability and report back.", caseId: 5, targets: [5] },
  { issuedBy: 6, task: "Aisha Al Suwaidi (HFMC-0004) valuation due today — escalate if no response.", caseId: 4, targets: [8] },
];

export async function seedDatabase() {
  // Only seed if empty
  const userCount = await db.user.count();
  if (userCount > 0) {
    const ensured = await ensureSopMasterData();
    return { skipped: true, reason: "database already has data", ...ensured };
  }

  for (const d of DESIGNATIONS) {
    await db.designation.create({ data: d });
  }

  for (const u of USERS) {
    await db.user.create({ data: { ...u, createdAt: new Date(u.createdAt) } });
  }

  for (const s of STAGES) {
    await db.stageItem.create({ data: { ...s, active: true } });
  }

  for (const b of BANKS) {
    await db.bankItem.create({ data: b });
  }

  for (const p of PARTNERS) {
    await db.partnerItem.create({ data: p });
  }

  for (const w of WHY_PENDING) {
    await db.masterItem.create({ data: { kind: "whyPending", label: w, active: true } });
  }
  for (const w of WAITING_FOR) {
    await db.masterItem.create({ data: { kind: "waitingFor", label: w, active: true } });
  }

  for (const s of SLA_RULES) {
    await db.slaRule.create({ data: s });
  }

  for (const c of CASES) {
    const created = await db.loanCase.create({
      data: {
        caseNumber: c.caseNumber,
        customer: c.customer,
        banks: JSON.stringify(c.banks),
        wonBank: c.wonBank,
        loanAmount: c.loanAmount,
        stage: c.stage,
        caseStatus: c.caseStatus,
        closedDate: c.caseStatus === "Closed" ? ts(c.ageDays - 10) : null,
        ownerId: c.ownerId,
        source: c.source,
        partnerKind: c.partner?.kind ?? null,
        partnerName: c.partner?.name ?? null,
        partnerSharePct: c.partner?.sharePct ?? null,
        whatsapp: c.whatsapp,
        waGroup: c.waGroup,
        createdAt: ts(c.ageDays),
        updatedAt: ts(Math.max(0, c.ageDays - 2)),
      },
    });
    // activity: case opened
    await db.activity.create({
      data: { caseId: created.id, userId: c.ownerId, at: ts(c.ageDays), action: "opened case" },
    });
    if (c.caseStatus === "Closed") {
      await db.activity.create({
        data: { caseId: created.id, userId: c.ownerId, at: ts(c.ageDays - 10), action: `marked Closed (won by ${c.wonBank})` },
      });
    }
    if (c.caseStatus === "Lost") {
      await db.activity.create({
        data: { caseId: created.id, userId: c.ownerId, at: ts(c.ageDays - 5), action: "marked Lost" },
      });
    }
  }

  for (const t of TASK_SEED) {
    await db.task.create({
      data: {
        caseId: t.caseId,
        description: t.description,
        ownerId: t.ownerId,
        createdBy: t.createdBy,
        waitingFor: t.waitingFor,
        whyPending: t.whyPending,
        dueDate: daysAgo(-t.dueDate),
        status: t.status,
        completedAt: t.status === "Done" ? ts(Math.abs(t.dueDate) + 1) : null,
        createdAt: ts(7),
        remarks: t.status === "Done" ? "Completed." : "",
      },
    });
  }

  const today = toISODate(new Date());
  for (const b of BULLETIN_TODAY) {
    await db.bulletinItem.create({
      data: {
        date: today,
        issuedBy: b.issuedBy,
        task: b.task,
        caseId: b.caseId,
        status: "Open",
        createdAt: ts(0),
        targets: { create: b.targets.map((userId) => ({ userId })) },
      },
    });
  }

  const ensured = await ensureSopMasterData();
  return { seeded: true, counts: { users: USERS.length, cases: CASES.length, tasks: TASK_SEED.length }, ...ensured };
}

// Idempotent top-up for SOP master data — runs on every seed call (even on a
// database that already has users/cases) so existing installs pick up the
// document validity rules, transfer fee matrices and stage TATs without a
// wipe. Create-if-missing only: never overwrites admin edits.
async function ensureSopMasterData() {
  let docRules = 0, feeRules = 0, slaRules = 0, bankProducts = 0;

  if ((await db.docRule.count()) === 0) {
    for (const d of DOC_RULES) await db.docRule.create({ data: docRuleData(d) });
    docRules = DOC_RULES.length;
  } else {
    // Migration: pre-conditional rows have no code — replace once with the catalog
    const coded = await db.docRule.count({ where: { code: { not: "" } } });
    if (coded === 0) {
      await db.docRule.deleteMany({});
      for (const d of DOC_RULES) await db.docRule.create({ data: docRuleData(d) });
      docRules = DOC_RULES.length;
    }
  }
  if ((await db.feeRule.count()) === 0) {
    for (const [i, f] of FEE_RULES.entries()) await db.feeRule.create({ data: { ...f, sortOrder: i } });
    feeRules = FEE_RULES.length;
  }
  for (const s of SLA_RULES) {
    const exists = await db.slaRule.findFirst({ where: { stage: s.stage, bank: null } });
    if (!exists) {
      await db.slaRule.create({ data: s });
      slaRules++;
    }
  }
  // "Lead" stage — self-registrations from the client portal land here
  const lead = await db.stageItem.findFirst({ where: { label: "Lead" } });
  if (!lead) await db.stageItem.create({ data: { label: "Lead", active: true, sortOrder: 0 } });

  // Bank rule products — phase 0 banks (DIB + ENBD), decoded from the workbooks
  if ((await db.bankProduct.count()) === 0) {
    for (const p of BANK_PRODUCTS_SEED) {
      const bank = await db.bankItem.findFirst({ where: { name: p.bankName } });
      if (!bank) continue;
      await db.bankProduct.create({
        data: {
          bankId: bank.id, name: p.name, sheet: p.sheet, employment: p.employment,
          residency: p.residency, financeType: p.financeType, program: p.program, loanKind: p.loanKind,
          maxLtvNational: p.maxLtvNational, maxLtvExpatriate: p.maxLtvExpatriate,
          minLoan: p.minLoan, maxLoan: p.maxLoan, tenorYears: p.tenorYears, minSalary: p.minSalary,
          totalTatDays: p.totalTatDays, paTatDays: p.paTatDays, paValidityDays: p.paValidityDays,
          folValidityDays: p.folValidityDays, valuationValidityDays: p.valuationValidityDays,
          rateTable: p.rateTable, stressTest: p.stressTest, fees: p.fees, insurance: p.insurance,
          eligibility: p.eligibility, documents: p.documents, axesJson: p.axesJson,
          sourceFiles: p.sourceFiles, status: "approved", approvedBy: "Excel import (Sep 2026)",
          effectiveDate: "2026-09-01",
        },
      });
    }
    bankProducts = BANK_PRODUCTS_SEED.length;
  }
  // negotiating intel onto the bank profile
  for (const [bankName, it] of Object.entries(BANK_INTEL)) {
    const bank = await db.bankItem.findFirst({ where: { name: bankName } });
    if (bank && !bank.posPoints && !bank.negPoints) {
      await db.bankItem.update({ where: { id: bank.id }, data: { posPoints: it.pos, negPoints: it.neg } });
    }
  }
  return { ensured: { docRules, feeRules, slaRules, bankProducts } };
}

function docRuleData(d: DbDocRule) {
  return {
    code: d.code, name: d.name, category: d.category, validityDays: d.validityDays, warnDays: d.warnDays,
    verifyNotes: d.verifyNotes,
    applicableEmployment: JSON.stringify(d.employment),
    applicablePropertyType: JSON.stringify(d.property),
    applicableTransaction: JSON.stringify(d.txn),
    applicableResidency: JSON.stringify(d.residency),
    mandatory: d.mandatory, visibleToClient: d.visibleToClient, clientCanUpload: d.clientCanUpload,
    expiryTrackingRequired: d.validityDays > 0 || d.warnDays > 0,
    active: true,
  };
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function daysAgo(n: number): string {
  return toISODate(new Date(Date.now() + n * DAY));
}
