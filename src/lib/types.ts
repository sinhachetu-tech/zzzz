export * from "./case-profile";
import type { CaseProfile } from "./case-profile";
// HFMC domain types — ported from the original smallhfmc.

export type Role = string; // designation label, admin-managed

export type CaseStatus = "On Track" | "At Risk" | "Overdue" | "No Action";
export type TaskStatus = "Open" | "Done";
export type CaseState = "Active" | "Closed" | "Lost";
export type CaseSource = "Direct" | "Agent" | "Broker" | "Website" | "Referral";
export type PartnerKind = "Agent" | "Broker" | "Referral";
export type RepeatKind = "none" | "daily" | "weekdays";

export interface CasePartner {
  kind: PartnerKind;
  name: string;
  sharePct: number;
}

export interface User {
  id: number;
  name: string;
  email: string;
  password: string;
  role: string;
  team: string;
  active: boolean;
  createdAt: string;
}

export interface Designation {
  id: number;
  name: string;
  scope: "all" | "team" | "own";
  issueTasks: boolean;
  admin: boolean;
  super: boolean;
  viewRevenue: boolean; // commission rates & earnings are restricted
  manageDocs: boolean; // may upload/verify/reject/waive/delete/compress vault documents
  builtIn: boolean;
}

export interface LoanCase {
  id: number;
  caseNumber: string;
  customer: string;
  banks: string[];
  wonBank: string | null;
  loanAmount: number;
  stage: string;
  caseStatus: CaseState;
  closedDate: string | null;
  ownerId: number;
  source: CaseSource;
  partner: CasePartner | null;
  whatsapp: string;
  waGroup: string | null;
  createdAt: string;
  updatedAt: string;
  // Two-way commission
  submissionType: "direct" | "channel";
  channelId: number | null;
  channelName: string | null;
  channelRatePct: number;
  // --- MIS operational fields ---
  statusNote: string; // daily free-text status narrative
  bankRm: string | null; // bank relationship manager name
  vrmId: number | null; // internal VRM (User.id, separate from owner)
  transactionType: string; // Buyout, Buyout+Equity, Primary Handover, Resale, etc.
  propertyLocation: string | null; // Dubai, Abu Dhabi, ADGM, etc.
  coApplicantName: string | null;
  partnerRm: string | null; // partner's RM/coordinator on this file
  onHold: boolean;
  holdReason: string | null;
  holdUntil: string | null;
  lostReason: string | null; // ISO date
  // --- Bank submission tracking ---
  // Document Vault profile vectors
  employmentProfile: string; // Salaried | Self-Employed
  propertyType: string; // Ready | Off-Plan
  residency: string; // UAE National | Resident Expatriate | Non-Resident
  loanType: string | null; // NSTL | STL
  fileSubmittedDate: string | null; // ISO date
  bankRate: number | null; // actual rate the bank quoted
  bankTenor: number | null; // actual tenor in months
  // --- Pre-approval stage capture ---
  preApprovalDate: string | null;
  preApprovalAmount: number | null;
  preApprovalTenure: number | null; // months
  preApprovalRoi: number | null; // rate of interest
  // --- Final Offer Letter (FOL) stage capture ---
  folDate: string | null;
  folAmount: number | null;
  folTenure: number | null; // months
  folRoi: number | null; // rate of interest
  profileJson?: string | null;
  profile?: CaseProfile;
  // Client master links — the person behind the engagement
  clientId: number | null;
  secondPartyClientId: number | null;
}

// Client master — one row per human across all their engagements
// (mortgage cases, future buyouts, insurance). Identity decided by KYC:
// EID (unique) > passport > phone+name corroboration; phone alone never merges.
export interface ClientDto {
  id: number;
  fullName: string;
  eidNo: string | null;
  passportNo: string | null;
  phone: string;
  email: string | null;
  dob: string | null;
  nationality: string | null;
  residency: string;
  emirate: string | null;
  employmentProfile: string;
  companyName: string | null;
  monthlySalary: number;
  variableIncome: number;
  rentalIncome: number;
  existingEmis: number;
  creditCardLimits: number;
  notes: string;
  createdAt: string;
}

// Stage transition log — one row per stage change on a case.
export interface StageTransition {
  id: number;
  caseId: number;
  fromStage: string;
  toStage: string;
  comment: string;
  userId: number;
  at: string;
}

// DTO variant that includes the user's display name — returned by the
// transitions API route and the state endpoint for the audit timeline.
export interface StageTransitionDto extends StageTransition {
  userName: string | null;
}

export interface ChannelItem {
  id: number;
  name: string;
  commissionPct: number;
  active: boolean;

  contacts: Contact[]; // channel RMs
}

export interface Task {
  id: number;
  caseId: number;
  description: string;
  ownerId: number;
  createdBy: number;
  waitingFor: string;
  whyPending: string;
  createdAt: string;
  dueDate: string;
  status: TaskStatus;
  completedAt: string | null;
  remarks: string;
}

export interface Activity {
  id: number;
  caseId: number;
  userId: number;
  at: string;
  action: string;
  oldValue?: string;
  newValue?: string;
}

export interface Reply {
  id: number;
  userId: number;
  text: string;
  at: string;
}

export interface Instruction {
  id: number;
  caseId: number;
  issuedBy: number;
  instruction: string;
  assignedTo: number;
  dueDate: string;
  status: "Open" | "Done";
  createdAt: string;
  completedAt: string | null;
  replies: Reply[];
}

export interface BulletinItem {
  id: number;
  date: string;
  issuedBy: number;
  task: string;
  caseId: number | null;
  targets: number[];
  status: "Open" | "Done";
  completedAt: string | null;
  completedBy: number | null;
  createdAt: string;
  replies: Reply[];
  carriedFrom?: string | null;
  dropped?: boolean;
  repeat?: RepeatKind;
  templateId?: number | null;
  isTemplate?: boolean;
}

export interface SlaRule {
  id: number;
  stage: string;
  bank: string | null;
  maxDays: number;
  active: boolean;
}

export interface StageItem {
  id: number;
  label: string;
  active: boolean;
  sortOrder: number;
}

export interface MasterItem {
  id: number;
  label: string;
  active: boolean;
}

export interface Contact {
  name: string;
  phone?: string;
  email?: string;
  role?: string; // RM / relationship manager title, desk, etc.
}

export interface BankItem {
  id: number;
  name: string;
  ratePct: number;
  hasLogo: boolean;
  posPoints: string;
  negPoints: string;
  website: string;
  active: boolean;
  contacts: Contact[]; // bank RMs
}

// Bank rule product — decoded from the rates/policy workbooks, versioned.
export interface BankProduct {
  id: number;
  bankId: number;
  bankName: string;
  name: string;
  sheet: string;
  employment: string;
  residency: string;
  financeType: string;
  program: string;
  loanKind: string;
  maxLtvNational: number | null;
  maxLtvExpatriate: number | null;
  minLoan: number | null;
  maxLoan: number | null;
  tenorYears: number | null;
  minSalary: number | null;
  cardRulePct: number | null;
  bonusPct: number | null;
  rentalIncomePct: number | null;
  rentalCapPctOfSalary: number | null;
  dbrPct: number | null;
  stressBufferPct?: number | null;
  totalTatDays: number | null;
  paTatDays: number | null;
  paValidityDays: number | null;
  folValidityDays: number | null;
  valuationValidityDays: number | null;
  pricingJson: string;
  feesJson: string;
  insuranceJson: string;
  rateTable: string;
  stressTest: string;
  fees: string;
  insurance: string;
  eligibility: string;
  documents: string;
  notes: string;
  axes: Record<string, string>;
  version: number;
  status: "draft" | "approved";
  effectiveDate: string | null;
  expiryDate?: string;
  approvedBy: string | null;
  sourceFiles: string;
  active: boolean;
}

export interface PartnerItem {
  id: number;
  kind: PartnerKind;
  name: string;
  defaultSharePct: number;
  active: boolean;
  contacts: Contact[]; // partner RMs / coordinators
}

export interface AffordabilityCheck {
  id: number;
  caseId: number | null;
  customerName: string;
  monthlyIncome: number;
  otherIncome: number;
  existingEmis: number;
  age: number;
  employmentType: "Salaried" | "Self-Employed";
  propertyValue: number;
  bank: string;
  interestRate: number | null;
  tenureYears: number | null;
  applicableLtv: number;
  maxLoanByLtv: number;
  maxDbrPct: number;
  availableDbrEmi: number;
  maxLoanByDbr: number;
  maxTenureByAge: number;
  finalEligibleLoan: number;
  estimatedEmi: number;
  eligible: boolean;
  createdBy: number;
  createdAt: string;
  payload?: string;
}

// SOP §8.2 — document validity / expiry rule (Admin → Doc Validity, fully CRUD-managed)
export interface DocRule {
  id: number;
  code: string; // e.g. DOC-SAL-CERT
  name: string;
  category: string; // KYC | Income | Property | Bank & Liabilities | Internal Underwriting | Valuation | Transfer
  validityDays: number; // 0 = no fixed validity — see verifyNotes
  warnDays: number; // flag this many days before expiry
  verifyNotes: string;
  // condition vectors — "all"/"any" or specific values
  applicableEmployment: string[]; // Salaried | Self-Employed | Non-Resident | all
  applicablePropertyType: string[]; // Ready | Off-Plan | any
  applicableTransaction: string[]; // New Purchase | Buyout / Equity Release | any
  applicableResidency: string[]; // UAE National | Resident Expatriate | Non-Resident | all
  mandatory: boolean;
  visibleToClient: boolean;
  clientCanUpload: boolean;
  expiryTrackingRequired: boolean;
  active: boolean;
}


export interface CaseUpdate {
  id: number;
  caseId: number;
  date: string;
  note: string;
  onHold: boolean;
  holdReason: string;
  authorId: number;
  authorName?: string | null;
  createdAt: string;
}

export interface Proposal {
  id: number;
  caseId: number;
  productIds: number[];
  inputs: Record<string, unknown>;
  mode: "client" | "internal";
  status: "draft" | "sent" | "won" | "lost";
  version: number;
  createdBy: number;
  authorName?: string | null;
  sentAt: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export type CaseDocStatus = "Pending upload" | "Uploaded" | "Verified" | "Rejected" | "Waived";

// Per-case document instance — the living vault (metadata only; file bytes are
// served separately via /api/documents/[id]/file).
export interface CaseDocument {
  id: number;
  caseId: number;
  templateId: number | null; // null = ad-hoc
  title: string;
  category: string;
  status: CaseDocStatus;
  mandatory: boolean;
  visibleToClient: boolean;
  clientCanUpload: boolean;
  rejectionReason: string;
  notes: string;
  fileName: string | null;
  fileType: string | null;
  fileSize: number | null;
  expiryDate: string | null;
  uploadedByKind: string; // client | staff
  uploadedAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
  // --- Storage (Cloudflare R2) ---
  hasFile: boolean; // a file exists (R2 or legacy bytes) — gates the View/Download buttons
  hasCompressed: boolean; // a compressed version exists — gates Compress/compare UI
  compressedSize: number | null;
  selectedVersion: "original" | "compressed";
  // --- Independent Google Drive archive (optional, env-driven) ---
  driveFileId: string | null; // set once the file was copied into Drive's per-case folder
  driveLink: string | null; // webViewLink so the team can open the archive copy
}

// SOP §6.9 — transfer fee rule (Admin → Fee rules); feeds the Calculator's Transfer Fees tab
export type FeeEmirate = "Dubai" | "Abu Dhabi";
export type FeeTxnType = "Primary" | "Resale" | "Buyout";
export type FeeAmountType = "pct_property" | "pct_loan" | "fixed";

export interface FeeRule {
  id: number;
  emirate: FeeEmirate;
  txnType: FeeTxnType;
  label: string;
  amountType: FeeAmountType;
  amount: number;
  paidBy: string; // Client | Seller
  note: string;
  sortOrder: number;
  active: boolean;
}

export type Tone = "mint" | "amber" | "coral" | "sky" | "slate";

export const SOURCES: CaseSource[] = ["Direct", "Agent", "Broker", "Website", "Referral"];
export const PARTNER_SHARES = [10, 15, 20, 30];

// MIS operational dropdown options — shared by Dashboard, Case Detail, and New Case modal.
export const EMPLOYMENT_PROFILES = ["Salaried", "Self-Employed"] as const;
export const PROPERTY_TYPES = ["Ready", "Off-Plan"] as const;
export const RESIDENCIES = ["UAE National", "Resident Expatriate", "Non-Resident"] as const;
export const TRANSACTION_TYPES = ["Buyout", "Buyout+Equity", "Primary Handover", "Resale", "Equity Cashout", "Refinance", "Other"] as const;
export const PROPERTY_LOCATIONS = ["Dubai", "Abu Dhabi", "ADGM", "Sharjah", "RAK", "Other"] as const;
export const LOAN_TYPES = ["NSTL", "STL"] as const;

export interface NewCaseInput {
  customer: string;
  banks: string[];
  loanAmount: number;
  stage: string;
  ownerId: number;
  source: CaseSource;
  partner: CasePartner | null;
  whatsapp: string;
  waGroup: string | null;
  task?: { description: string; dueDate: string; waitingFor: string; whyPending: string; ownerId: number };
}

export interface TaskInput {
  description: string;
  ownerId: number;
  waitingFor: string;
  whyPending: string;
  dueDate: string;
}

export interface EmailLog {
  id: number;
  caseId: number;
  subject: string;
  sender: string;
  direction: string; // from_bank | from_client | internal
  receivedAt: string;
  outlookLink: string | null;
  messageId: string | null;
}

export interface UnmatchedEmail {
  id: number;
  subject: string;
  sender: string;
  receivedAt: string;
  bestGuessCaseId: number | null;
  status: string; // Pending | Linked | Ignored
  messageId: string | null;
}