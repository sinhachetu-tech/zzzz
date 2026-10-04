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

/**
 * BANK LEG OUTCOME — the competitive result of one bank's journey.
 *
 * WHY THIS EXISTS ALONGSIDE `CaseState`: a multi-bank mortgage is a RACE with
 * exactly one winner (many pre-approvals → one FOL → one loan taken). `CaseState`
 * cannot say that, because "Lost" means "we lost this business", which is NOT
 * what happened to the Emirates leg when Mashreq won. Without this, a beaten leg
 * stays Active, keeps accruing commission and sits in the pipeline forever.
 *
 *   Active     — still in the race
 *   Won        — this bank won. Setting it closes every sibling as LostRace.
 *   LostRace   — another bank won. Not a failure, and NOT a lost deal.
 *   Declined   — the bank said no to the client (a real underwrite signal)
 *   Withdrawn  — the client or we pulled this leg before a decision
 *
 * Only meaningful when the service line has bankRaced = true (mortgage today).
 */
/** A line of business: Mortgage, Golden visa, Wills, … (Phase 1). */
export interface ServiceLineDto {
  id: number;
  code: string;
  name: string;
  shortName: string;
  active: boolean;
  sortOrder: number;
  /** True only where the work is a per-provider race with ONE winner (mortgage). */
  bankRaced: boolean;
  notes: string;
  products?: ProductDto[];
}

/** A specific offering within a service line (MORT-FIRST, GV-10, WIL-DRAFT, …). */
export interface ProductDto {
  id: number;
  serviceLineId: number;
  code: string;
  name: string;
  active: boolean;
  sortOrder: number;
  notes: string;
}

/**
 * LEAD — an expression of interest from someone we do not yet know well enough
 * to commit a file to (Phase 4). Distinct from both Client (the human, once we
 * know them) and LoanCase (a procedure under way).
 *
 * Deliberately holds ONLY: who, how to reach them, what they're asking about,
 * roughly how much, who referred them. Anything deeper arrives after
 * qualification and belongs on the case.
 */
export type LeadStatus = "New" | "Contacted" | "Qualified" | "Nurture" | "Converted" | "Lost" | "Invalid";

export const LEAD_STATUSES: readonly LeadStatus[] = [
  "New", "Contacted", "Qualified", "Nurture", "Converted", "Lost", "Invalid",
];

/** Open = still in play. Closed statuses never appear in the live funnel. */
export const OPEN_LEAD_STATUSES: readonly LeadStatus[] = ["New", "Contacted", "Qualified", "Nurture"];

export const LEAD_SOURCES: readonly string[] = [
  "Direct", "Agent", "Broker", "Website", "Referral", "WalkIn", "Social", "Event",
];

export interface Lead {
  id: number;
  fullName: string;
  /** Digits only — a MATCH HINT for the UI, never a merge key (see client-master). */
  phone: string;
  email: string | null;
  /** REQUIRED — without it "how many leads do we have?" is unanswerable. */
  serviceLineId: number;
  /** null is valid: the prospect doesn't know which product yet. */
  productId: number | null;
  /** null is meaningful: "not stated". */
  intendedAmount: number | null;
  currency: string;
  source: string;
  /** Free text the enum can't hold: "met at GITEX stand", "WhatsApp ad". */
  sourceDetail: string;
  status: LeadStatus;
  /** Nullable is NORMAL — an unassigned lead is not an error. */
  ownerId: number | null;
  /** Pointer, not a required FK: a lead may convert before it's a Client. */
  clientId: number | null;
  /** Set on conversion — the case this lead became. */
  caseId: number | null;
  lostReason: string;
  /**
   * The SLA clock starts HERE, not at createdAt. "Days since a human touched
   * it" is the number a manager wants; createdAt measures arrival age and would
   * report a lead someone called on day 1 as stale by day 4.
   */
  firstContactedAt: string | null;
  convertedAt: string | null;
  convertedById: number | null;
  createdAt: string;
  updatedAt: string;
  /** Denormalised by /api/state for list rendering (not a Prisma column). */
  serviceLineName?: string;
  serviceLineCode?: string;
  productName?: string | null;
  ownerName?: string | null;
  /** Set when this lead's phone matches an existing client — shown, never auto-merged. */
  possibleDuplicateOf?: { id: number; name: string } | null;
}

export type LegStatus = "Active" | "Won" | "LostRace" | "Declined" | "Withdrawn";

export const LEG_STATUSES: readonly LegStatus[] = ["Active", "Won", "LostRace", "Declined", "Withdrawn"];

/**
 * The role a person holds ON ONE CASE (Phase A).
 *
 * Deliberately NOT a field on Client. "Co-borrower" is what Ahmed's wife is on
 * HFMC-0187 — three years on she may be the primary on her own loan, or a guarantor
 * on someone else's, and none of that changes who she is. The person lives on
 * Client; the role lives here.
 */
export type PartyRole = "CoBorrower" | "CoApplicant" | "Guarantor";

export const PARTY_ROLES: readonly PartyRole[] = ["CoBorrower", "CoApplicant", "Guarantor"];

export const PARTY_ROLE_LABEL: Record<PartyRole, string> = {
  CoBorrower: "Co-borrower",
  CoApplicant: "Co-applicant",
  Guarantor: "Guarantor",
};

/** One person on one case, in one role. */
export interface CaseParty {
  id: number;
  caseId: number;
  clientId: number;
  role: PartyRole;
  sortOrder: number;
  createdAt: string;
  /** Denormalised by /api/state for list rendering (not a Prisma column). */
  clientName?: string;
  /** True when this link is the one held by LoanCase.secondPartyClientId. */
  legacySlot?: boolean;
}

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
  phone?: string | null; // WhatsApp / direct line — shown on client & agent portal contact cards
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
  clientChat: boolean; // may reply to client & agent chats
  builtIn: boolean;
}

export interface LoanCase {
  id: number;
  caseNumber: string;
  customer: string;
  banks: string[];
  wonBank: string | null;
  /** The BANK's own case / application number (not our HFMC-xxxx). Per-bank,
   *  because a multi-bank deal is split into sibling cases. */
  bankRef: string | null;
  /** The first bank of a multi-bank deal; siblings point back at it. */
  parentCaseId: number | null;
  /** How many sibling legs exist on this engagement (parents only carry it). */
  legCount?: number;
  /** This leg's competitive outcome. See LegStatus for why CaseState can't say it. */
  legStatus: LegStatus;
  decidedAt: string | null;
  decidedById: number | null;
  /** Which line of business + which offering (Phase 1). null = not classified. */
  serviceLineId: number | null;
  productId: number | null;
  loanAmount: number;
  /** REAL property value; null = not captured (never derived from loanAmount). */
  propertyValue: number | null;
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
  // --- Lead → case conversion stamp ---
  // Set once, when the stage first leaves "Lead". null = this case was never a
  // lead (created straight into the pipeline), which is what the "From lead"
  // saved view filters on. See the note in prisma/schema.prisma.
  convertedAt: string | null;
  convertedById: number | null;
  // --- Bank submission tracking ---
  // Document Vault profile vectors
  employmentProfile: string; // Salaried | Self-Employed
  propertyType: string; // Ready | Off-Plan (legacy display)
  residency: string; // UAE National | Resident Expatriate | Non-Resident
  // --- FINAL PROPERTY CLASSIFICATION (canonical dims — additive, UNKNOWN-safe) ---
  // Never merged with case stage/status or transactionPurpose. Unknown = "UNKNOWN", never guessed.
  propertyTypeCanonical: string; // RESIDENTIAL | COMMERCIAL | UNKNOWN
  commercialSubtype: string | null; // OFFICE | ... ; NULL unless propertyTypeCanonical = COMMERCIAL
  propertyStage: string; // OFF_PLAN | HANDOVER | COMPLETED | UNKNOWN
  constructionStatus: string; // NOT_STARTED | UNDER_CONSTRUCTION | COMPLETED | UNKNOWN
  partyRelationship: string; // DEVELOPER | EXISTING_OWNER | SELF | UNKNOWN
  existingFinance: string; // NONE | MORTGAGE | UNKNOWN
  transactionPurpose: string; // PURCHASE | REFINANCE | EQUITY_RELEASE | REFINANCE_AND_EQUITY | UNKNOWN
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
  // --- Stage timeline (captured in the Case 360 stage drawer).
  // The journey ticks read these fields first; daily-note sniffing is a fallback.
  valuationInitiatedDate: string | null;
  inspectionDate: string | null;
  valuationReportDate: string | null;
  folConversionDate: string | null; // 4.1 — must precede folSignedDate
  folSignedDate: string | null; // 4.4 — never before conversion
  ddaActive: boolean; // 4.5 — DDA activated
  liabilityLetterDate: string | null;
  settlementDate: string | null;
  transferDate: string | null;
  titleDeedDate: string | null;
  profileJson?: string | null;
  profile?: CaseProfile;
  // Client master links — the person behind the engagement
  clientId: number | null;
  secondPartyClientId: number | null;
  advisorId: number | null;      // client-facing advisor (falls back to owner when unset)
  backup1Id: number | null;      // first backup staffer — covers the file while the owner is on leave
  backup2Id: number | null;      // second backup staffer — covers the file while the owner is on leave
  profileClientVerifiedAt: string | null; // when the client last confirmed their data sheet
  notificationOverrides?: { push?: boolean; whatsapp?: boolean; email?: boolean } | null;
  // Admin-defined flexible stage data — shape: { [stageLabel]: { [fieldKey]: value } }
  // New fields added by admin for any stage land here; no migration needed per field.
  stageDataJson?: Record<string, any>;
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
  /**
   * The reusable bank-form answer sheet (see src/lib/person-sheet.ts). Lives on
   * the PERSON so a returning customer is never asked the same question on a
   * second case — a renovation loan two years later starts from what we already
   * know about that human. `profileJson` on each case stays the as-filed
   * snapshot; this is the latest known truth.
   */
  personData: Record<string, unknown>;
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
  // Admin-configurable behaviour fields (Phase 1)
  ownerRole: string;        // e.g. "VRM → SPO" — shown on journey cards
  exitGateSummary: string;  // one-liner shown when stage advance is blocked
  sopJson: string[];        // procedure bullets (admin-editable)
  commsJson: string[];      // CommTemplate keys surfaced in the drawer Actions
  steps: StageStep[];       // ordered sub-step checklist (Phase 2)
  /**
   * The SET this stage belongs to — and the set is what carries the service line.
   * A stage has NO serviceLineId of its own; scoping must go through here. Null
   * only for a stage created before Phase 5.
   */
  stageSetId: number | null;
  /** Denormalised by /api/state for convenience (resolved from the set). */
  serviceLineId?: number | null;
}

export interface StageStep {
  id: number;
  stageId: number;
  stepNumber: string;  // display label e.g. "2.3"
  label: string;
  hint: string;
  sortOrder: number;
  active: boolean;
  isGate: boolean;     // blocks stage advance if not satisfied
  checkType: "date_field" | "boolean_field" | "doc_category" | "note_keyword" | "manual";
  checkTarget: string; // field name on LoanCase, doc category, or regex
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
  /** Bank-specific requirement. "any"/"all" = every bank. A rule scoped to one
   *  bank only appears on that bank's leg of a multi-bank deal. */
  applicableBank: string[];
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

export type CaseDocStatus =
  | "Pending upload"
  | "Uploaded"
  | "Verified"
  | "Rejected"
  | "Waived"
  // Application-form lifecycle. An application form is broker-produced and sent
  // TO the bank, so it does not fit the client-uploads-then-staff-verifies flow.
  // "Filled (unsigned)" is the common real case: the bank wants the form
  // completed but NOT signed, because the RM signs or it is e-signed separately.
  | "Filled (unsigned)"
  | "Submitted to bank"
  | "Signed"
  | "Returned by bank";

// Per-case document instance — the living vault (metadata only; file bytes are
// served separately via /api/documents/[id]/file).
export interface CaseDocument {
  id: number;
  caseId: number;
  templateId: number | null; // null = ad-hoc
  /** Set when this row was pre-filled from a SIBLING bank leg of the same deal
   *  (add-bank). The file is shared, not duplicated — this is the audit trail. */
  copiedFromId: number | null;
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
  displayName: string | null; // custom inline renamed label
  source: string; // "vault" | "chat"
}

export interface ChatMessageDto {
  id: number;
  caseId: number;
  senderId: number | null;
  senderType: "STAFF" | "CLIENT" | "AGENT";
  senderName: string;
  threadType: "CLIENT" | "AGENT";
  text: string | null;
  attachmentKey: string | null;
  attachmentName: string | null;
  attachmentSize: number | null;
  mimeType: string | null;
  documentId: number | null;
  sentAt: string;
  readByStaff: boolean;
  readByExternal: boolean;
}

export interface UserDeviceDto {
  id: number;
  userId: number | null;
  caseId: number | null;
  deviceType: "mobile" | "desktop" | "tablet";
  pwaInstalled: boolean;
  installedAt: string | null;
  pushEndpoint: string | null;
  lastSeenAt: string;
  userAgent: string | null;
}

// SOP §6.9 — transfer fee rule (Admin → Fee rules); feeds the Calculator's Transfer Fees tab
export type FeeEmirate = "Dubai" | "Abu Dhabi";
export type FeeTxnType = "Primary" | "Resale" | "Buyout";
export type FeeAmountType = "pct_property" | "pct_loan" | "fixed";

// Tier-4 promotion overlay — applied ON TOP of base pricing, never overwrites it.
// Self-expires by date (validFrom/validTo inclusive); active=false kills it early.
export interface Promotion {
  id: number;
  bankProductId: number;
  name: string;
  description: string;
  rateOptionTermYears: number | null; // null = all rate options
  rateDiscountBps: number | null;     // e.g. -25 = intro rate down 0.25%
  processingFeeOverridePct: number | null; // null = base fee; 0 = waived
  valuationFeeWaived: boolean;
  validFrom: string; // ISO date inclusive
  validTo: string;   // ISO date inclusive
  active: boolean;
  createdBy: string;
}

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

// Stage-wise communication templates (WhatsApp / email / call script).
// Wording is admin-editable; stage files reference only `key`.
export type CommChannel = "whatsapp" | "email" | "call";
export type CommStageKey = "doc" | "pre" | "val" | "fol" | "transfer";

export interface CommTemplate {
  id: number;
  key: string;
  channel: CommChannel;
  stageKey: CommStageKey;
  bank: string | null;
  name: string;
  subject: string | null;
  body: string;
  vars: string[];
  sortOrder: number;
  active: boolean;
}

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

/* ── Notification & device types ─────────────────────────────────── */

export interface UserNotificationPrefs {
  pushChatMessage: boolean;
  pushTaskAssigned: boolean;
  pushTaskOverdue: boolean;
  pushDocUpload: boolean;
  pushStageChange: boolean;
  pushLeadAssigned: boolean;
  emailChatMessage: boolean;
  emailTaskAssigned: boolean;
  emailTaskOverdue: boolean;
  emailDocUpload: boolean;
  emailStageChange: boolean;
  emailLeadAssigned: boolean;
  soundEnabled: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string; // "22:00"
  quietHoursEnd: string;   // "07:00"
}

export interface DeviceInfo {
  id: number;
  userId: number | null;
  caseId: number | null;
  deviceType: string;
  pushEndpoint: string | null;
  createdAt: string;
}

/* ── Internal staff chat ────────────────────────────────────────── */

export interface StaffRoomDto {
  id: number;
  name: string;
  isDirect: boolean;
  createdAt: string;
  createdById: number;
  /** Total messages in this room */
  messageCount?: number;
  /** Messages newer than lastReadAt for the calling user */
  unreadCount: number;
  /** ISO string from StaffRoomMember.lastReadAt — null if never read */
  lastReadAt: string | null;
  /** Snippet of the last message for the room list preview */
  lastMessage: string | null;
  lastMessageAt: string | null;
  lastMessageSender: string | null;
  members: { userId: number; name: string }[];
}

export interface StaffMessageDto {
  id: number;
  roomId: number;
  senderId: number;
  senderName: string;
  text: string | null;
  attachmentKey?: string | null;
  attachmentName?: string | null;
  attachmentSize?: number | null;
  mimeType?: string | null;
  sentAt: string;
  editedAt: string | null;
}