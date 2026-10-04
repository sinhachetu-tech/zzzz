import { parseCaseProfile } from "./case-profile";
// Serialization: Prisma row → API DTO matching the original HFMC types.
import type {
  Activity, BankItem, BulletinItem, CasePartner, ClientDto, CommTemplate, Instruction, LoanCase,
  BankProduct, Proposal, CaseDocument, CaseUpdate, DocRule, FeeRule, MasterItem, PartnerItem, Promotion, Reply, SlaRule, StageItem, StageTransition, StageTransitionDto, Task, User,
} from "./types";

type PrismaUser = {
  id: number; name: string; email: string; password: string; role: string; team: string;
  active: boolean; createdAt: Date;
};

// SECURITY: the password hash is deliberately NOT serialized — every signed-in
// user's browser receives this DTO via /api/state, and shipping bcrypt hashes
// to clients was a leak. If some legacy UI ever needs a placeholder, it can
// check truthiness on an empty string.
export function serUser(u: PrismaUser): User {
  return {
    id: u.id, name: u.name, email: u.email, password: "", role: u.role, team: u.team,
    active: u.active, phone: (u as unknown as { phone?: string | null }).phone ?? null, createdAt: u.createdAt.toISOString(),
  };
}

type PrismaCase = {
  id: number; caseNumber: string; customer: string; banks: string; wonBank: string | null;
  loanAmount: number; stage: string; caseStatus: string; closedDate: string | null;
  ownerId: number; source: string; partnerKind: string | null; partnerName: string | null;
  partnerSharePct: number | null; whatsapp: string; waGroup: string | null;
  createdAt: Date; updatedAt: Date;
  // Two-way commission
  submissionType?: string; channelId?: number | null; channelName?: string | null; channelRatePct?: number;
  // --- MIS operational fields ---
  statusNote?: string;
  bankRm?: string | null;
  vrmId?: number | null;
  transactionType?: string;
  propertyLocation?: string | null;
  coApplicantName?: string | null;
  partnerRm?: string | null;
  onHold?: boolean;
  holdReason?: string | null;
  holdUntil?: string | null;
  lostReason?: string | null;
  // --- Bank submission tracking ---
  employmentProfile: string;
  propertyType: string;
  residency: string;
  // --- FINAL PROPERTY CLASSIFICATION (canonical dims — optional pre-push) ---
  propertyTypeCanonical?: string;
  commercialSubtype?: string | null;
  propertyStage?: string;
  constructionStatus?: string;
  partyRelationship?: string;
  existingFinance?: string;
  transactionPurpose?: string;
  loanType?: string | null;
  fileSubmittedDate?: string | null;
  bankRate?: number | null;
  bankTenor?: number | null;
  // --- Pre-approval stage capture ---
  preApprovalDate?: string | null;
  preApprovalAmount?: number | null;
  preApprovalTenure?: number | null;
  preApprovalRoi?: number | null;
  // --- Final Offer Letter (FOL) stage capture ---
  folDate?: string | null;
  folAmount?: number | null;
  folTenure?: number | null;
  folRoi?: number | null;
  // --- Stage timeline (Case 360 drawer) — fields first, note-sniffing second
  valuationInitiatedDate?: string | null;
  inspectionDate?: string | null;
  valuationReportDate?: string | null;
  folConversionDate?: string | null;
  folSignedDate?: string | null;
  ddaActive?: boolean;
  liabilityLetterDate?: string | null;
  settlementDate?: string | null;
  transferDate?: string | null;
  titleDeedDate?: string | null;
  stageDataJson?: string | null;
  profileJson?: string | null;
  // Lead → case conversion stamp (null = never a lead)
  convertedAt?: Date | null;
  convertedById?: number | null;
  // Client master links
  clientId?: number | null;
  secondPartyClientId?: number | null;
  advisorId?: number | null;
  backup1Id?: number | null;
  backup2Id?: number | null;
  profileClientVerifiedAt?: Date | string | null;
  notificationOverrides?: string | null;
  /** REAL property value (nullable) — added so the engine can report an LTV data
   *  gap instead of fabricating one from the loan amount. */
  propertyValue?: number | null;
  // per-bank journey identity
  bankRef?: string | null;
  parentCaseId?: number | null;
};

export function serCase(c: PrismaCase): LoanCase {
  let banks: string[] = [];
  try { banks = JSON.parse(c.banks); } catch { banks = []; }
  let partner: CasePartner | null = null;
  if (c.partnerKind && c.partnerName && c.partnerSharePct != null) {
    partner = { kind: c.partnerKind as CasePartner["kind"], name: c.partnerName, sharePct: c.partnerSharePct };
  }
  return {
    id: c.id, caseNumber: c.caseNumber, customer: c.customer, banks, wonBank: c.wonBank,
    // Per-bank journey identity (the bank's own reference + sibling linkage)
    bankRef: c.bankRef ?? null,
    parentCaseId: c.parentCaseId ?? null,
    loanAmount: c.loanAmount,
    propertyValue: c.propertyValue ?? null,
    stage: c.stage, caseStatus: c.caseStatus as LoanCase["caseStatus"],
    closedDate: c.closedDate, ownerId: c.ownerId, source: c.source as LoanCase["source"],
    partner, whatsapp: c.whatsapp, waGroup: c.waGroup,
    createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString(),
    submissionType: c.submissionType === "channel" ? "channel" : "direct",
    channelId: c.channelId ?? null,
    channelName: c.channelName ?? null,
    channelRatePct: c.channelRatePct ?? 0,
    // MIS operational
    statusNote: c.statusNote ?? "",
    bankRm: c.bankRm ?? null,
    vrmId: c.vrmId ?? null,
    transactionType: c.transactionType ?? "",
    propertyLocation: c.propertyLocation ?? null,
    coApplicantName: c.coApplicantName ?? null,
    partnerRm: (c as unknown as { partnerRm?: string | null }).partnerRm ?? null,
    onHold: c.onHold ?? false,
    holdReason: c.holdReason ?? null,
    holdUntil: c.holdUntil ?? null,
    lostReason: c.lostReason ?? null,
    // Lead → case conversion stamp (nullable: never a lead)
    convertedAt: c.convertedAt ? c.convertedAt.toISOString() : null,
    convertedById: c.convertedById ?? null,
    // Bank submission
    employmentProfile: c.employmentProfile, propertyType: c.propertyType, residency: c.residency,
    // FINAL PROPERTY CLASSIFICATION — canonical dims (UNKNOWN-safe defaults pre-push)
    propertyTypeCanonical: c.propertyTypeCanonical ?? "UNKNOWN",
    commercialSubtype: c.commercialSubtype ?? null,
    propertyStage: c.propertyStage ?? "UNKNOWN",
    constructionStatus: c.constructionStatus ?? "UNKNOWN",
    partyRelationship: c.partyRelationship ?? "UNKNOWN",
    existingFinance: c.existingFinance ?? "UNKNOWN",
    transactionPurpose: c.transactionPurpose ?? "UNKNOWN",
    loanType: c.loanType ?? null,
    fileSubmittedDate: c.fileSubmittedDate ?? null,
    bankRate: c.bankRate ?? null,
    bankTenor: c.bankTenor ?? null,
    // Pre-approval
    preApprovalDate: c.preApprovalDate ?? null,
    preApprovalAmount: c.preApprovalAmount ?? null,
    preApprovalTenure: c.preApprovalTenure ?? null,
    preApprovalRoi: c.preApprovalRoi ?? null,
    // FOL
    folDate: c.folDate ?? null,
    folAmount: c.folAmount ?? null,
    folTenure: c.folTenure ?? null,
    folRoi: c.folRoi ?? null,
    // stage timeline (drawer-captured)
    valuationInitiatedDate: c.valuationInitiatedDate ?? null,
    inspectionDate: c.inspectionDate ?? null,
    valuationReportDate: c.valuationReportDate ?? null,
    folConversionDate: c.folConversionDate ?? null,
    folSignedDate: c.folSignedDate ?? null,
    ddaActive: c.ddaActive ?? false,
    liabilityLetterDate: c.liabilityLetterDate ?? null,
    settlementDate: c.settlementDate ?? null,
    transferDate: c.transferDate ?? null,
    titleDeedDate: c.titleDeedDate ?? null,
    // structured qualification profile — without this the editor round-trips empty
    profileJson: c.profileJson ?? null,
    // Client master links
    clientId: (c as unknown as { clientId?: number | null }).clientId ?? null,
    secondPartyClientId: (c as unknown as { secondPartyClientId?: number | null }).secondPartyClientId ?? null,
    advisorId: (c as unknown as { advisorId?: number | null }).advisorId ?? null,
    backup1Id: (c as unknown as { backup1Id?: number | null }).backup1Id ?? null,
    backup2Id: (c as unknown as { backup2Id?: number | null }).backup2Id ?? null,
    profileClientVerifiedAt: (c as unknown as { profileClientVerifiedAt?: Date | string | null }).profileClientVerifiedAt
      ? new Date((c as unknown as { profileClientVerifiedAt: Date | string }).profileClientVerifiedAt).toISOString()
      : null,
    notificationOverrides: (() => {
      if (!c.notificationOverrides) return null;
      try { return JSON.parse(c.notificationOverrides); } catch { return null; }
    })(),
    stageDataJson: (() => {
      const raw = (c as unknown as { stageDataJson?: string | null }).stageDataJson;
      if (!raw) return {};
      try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return {}; }
    })(),
  };
}

/* ---------------- client master ---------------- */

type PrismaClientRow = {
  id: number; fullName: string; eidNo: string | null; passportNo: string | null;
  phone: string; email: string | null; dob: string | null; nationality: string | null;
  residency: string; emirate: string | null; employmentProfile: string; companyName: string | null;
  monthlySalary: number; variableIncome: number; rentalIncome: number; existingEmis: number;
  creditCardLimits: number; notes: string; createdAt: Date; personJson?: string | null;
};

export function serClient(c: PrismaClientRow): ClientDto {
  // The answer sheet is stored as JSON text. A malformed or absent value must
  // degrade to {} rather than throwing — one bad blob on one client must not
  // take down /api/state for the whole workspace.
  let personData: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(c.personJson ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      personData = parsed as Record<string, unknown>;
    }
  } catch { personData = {}; }
  return {
    id: c.id, fullName: c.fullName, eidNo: c.eidNo, passportNo: c.passportNo,
    phone: c.phone, email: c.email, dob: c.dob, nationality: c.nationality,
    residency: c.residency, emirate: c.emirate, employmentProfile: c.employmentProfile,
    companyName: c.companyName, monthlySalary: c.monthlySalary, variableIncome: c.variableIncome,
    rentalIncome: c.rentalIncome, existingEmis: c.existingEmis, creditCardLimits: c.creditCardLimits,
    notes: c.notes, personData, createdAt: c.createdAt.toISOString(),
  };
}

type PrismaChannel = { id: number; name: string; commissionPct: number; active: boolean; contactsJson?: string | null };
export function serChannel(ch: PrismaChannel) {
  let contacts: import("./types").Contact[] = [];
  try { const arr = JSON.parse(ch.contactsJson ?? "[]"); if (Array.isArray(arr)) contacts = arr; } catch { contacts = []; }
  return { id: ch.id, name: ch.name, commissionPct: ch.commissionPct, active: ch.active, contacts };
}

type PrismaTask = {
  id: number; caseId: number; description: string; ownerId: number; createdBy: number;
  waitingFor: string; whyPending: string; createdAt: Date; dueDate: string;
  status: string; completedAt: Date | null; remarks: string;
};

export function serTask(t: PrismaTask): Task {
  return {
    id: t.id, caseId: t.caseId, description: t.description, ownerId: t.ownerId, createdBy: t.createdBy,
    waitingFor: t.waitingFor, whyPending: t.whyPending, createdAt: t.createdAt.toISOString(),
    dueDate: t.dueDate, status: t.status as Task["status"],
    completedAt: t.completedAt ? t.completedAt.toISOString() : null, remarks: t.remarks,
  };
}

type PrismaActivity = {
  id: number; caseId: number; userId: number; at: Date; action: string;
  oldValue: string | null; newValue: string | null;
};

export function serActivity(a: PrismaActivity): Activity {
  return {
    id: a.id, caseId: a.caseId, userId: a.userId, at: a.at.toISOString(), action: a.action,
    oldValue: a.oldValue ?? undefined, newValue: a.newValue ?? undefined,
  };
}

type PrismaBank = { id: number; name: string; ratePct: number; active: boolean; logoData?: Uint8Array | Buffer | null; posPoints?: string | null; negPoints?: string | null; website?: string | null; contactsJson?: string | null };
export function serBank(b: PrismaBank): BankItem {
  let contacts: import("./types").Contact[] = [];
  try { const arr = JSON.parse(b.contactsJson ?? "[]"); if (Array.isArray(arr)) contacts = arr; } catch { contacts = []; }
  return { id: b.id, name: b.name, ratePct: b.ratePct, hasLogo: !!b.logoData, posPoints: b.posPoints ?? "", negPoints: b.negPoints ?? "", website: b.website ?? "", active: b.active, contacts };
}

type PrismaBankProduct = {
  id: number; bankId: number; name: string; sheet: string; employment: string; residency: string;
  financeType: string; program: string; loanKind: string;
  maxLtvNational: number | null; maxLtvExpatriate: number | null;
  minLoan: number | null; maxLoan: number | null; tenorYears: number | null; minSalary: number | null;
  totalTatDays: number | null; paTatDays: number | null; paValidityDays: number | null;
  folValidityDays: number | null; valuationValidityDays: number | null;
  rateTable: string; stressTest: string; fees: string; insurance: string; pricingJson: string; feesJson?: string | null; insuranceJson?: string | null;
  cardRulePct?: number | null; bonusPct?: number | null; rentalIncomePct?: number | null; rentalCapPctOfSalary?: number | null; dbrPct?: number | null; stressBufferPct?: number | null;
  eligibility: string; documents: string; notes: string; axesJson: string;
  version: number; status: string; effectiveDate: string | null; approvedBy: string | null;
  sourceFiles: string; active: boolean;
};

export function serBankProduct(p: PrismaBankProduct): BankProduct {
  let axes: Record<string, string> = {};
  try { axes = JSON.parse(p.axesJson); } catch { axes = {}; }
  return {
    id: p.id, bankId: p.bankId, bankName: (p as unknown as { bank?: { name?: string } }).bank?.name ?? "", name: p.name, sheet: p.sheet, employment: p.employment,
    residency: p.residency, financeType: p.financeType, program: p.program, loanKind: p.loanKind,
    maxLtvNational: p.maxLtvNational, maxLtvExpatriate: p.maxLtvExpatriate,
    minLoan: p.minLoan, maxLoan: p.maxLoan, tenorYears: p.tenorYears, minSalary: p.minSalary,
    cardRulePct: p.cardRulePct ?? null, bonusPct: p.bonusPct ?? null, rentalIncomePct: p.rentalIncomePct ?? null,
    rentalCapPctOfSalary: p.rentalCapPctOfSalary ?? null, dbrPct: p.dbrPct ?? null, stressBufferPct: p.stressBufferPct ?? null,
    totalTatDays: p.totalTatDays, paTatDays: p.paTatDays, paValidityDays: p.paValidityDays,
    folValidityDays: p.folValidityDays, valuationValidityDays: p.valuationValidityDays,
    rateTable: p.rateTable, stressTest: p.stressTest, fees: p.fees, insurance: p.insurance,
    pricingJson: (p as unknown as { pricingJson?: string }).pricingJson ?? "{}",
    feesJson: (p as unknown as { feesJson?: string }).feesJson ?? "{}", insuranceJson: (p as unknown as { insuranceJson?: string }).insuranceJson ?? "{}",
    eligibility: p.eligibility, documents: p.documents, notes: p.notes, axes,
    version: p.version, status: p.status as BankProduct["status"], effectiveDate: p.effectiveDate, expiryDate: (p as unknown as { expiryDate?: string }).expiryDate ?? '2099-12-31',
    approvedBy: p.approvedBy, sourceFiles: p.sourceFiles, active: p.active,
  };
}

type PrismaPartner = { id: number; kind: string; name: string; defaultSharePct: number; active: boolean; contactsJson?: string | null };
export function serPartner(p: PrismaPartner): PartnerItem {
  let contacts: import("./types").Contact[] = [];
  try { const arr = JSON.parse(p.contactsJson ?? "[]"); if (Array.isArray(arr)) contacts = arr; } catch { contacts = []; }
  return { id: p.id, kind: p.kind as PartnerItem["kind"], name: p.name, defaultSharePct: p.defaultSharePct, active: p.active, contacts };
}

type PrismaStageStep = {
  id: number; stageId: number; stepNumber: string; label: string; hint: string;
  sortOrder: number; active: boolean; isGate: boolean; checkType: string; checkTarget: string;
};
function serStep(s: PrismaStageStep): import("./types").StageStep {
  return {
    id: s.id, stageId: s.stageId, stepNumber: s.stepNumber, label: s.label, hint: s.hint,
    sortOrder: s.sortOrder, active: s.active, isGate: s.isGate,
    checkType: s.checkType as import("./types").StageStep["checkType"],
    checkTarget: s.checkTarget,
  };
}

type PrismaStage = {
  id: number; label: string; active: boolean; sortOrder: number;
  ownerRole: string; exitGateSummary: string; sopJson: string; commsJson: string;
  steps?: PrismaStageStep[];
};
export function serStage(s: PrismaStage): import("./types").StageItem {
  let sop: string[] = [];
  let comms: string[] = [];
  try { sop = JSON.parse(s.sopJson ?? "[]"); } catch { sop = []; }
  try { comms = JSON.parse(s.commsJson ?? "[]"); } catch { comms = []; }
  const steps = (s.steps ?? [])
    .filter((x) => x.active)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(serStep);
  return {
    id: s.id, label: s.label, active: s.active, sortOrder: s.sortOrder,
    ownerRole: s.ownerRole ?? "", exitGateSummary: s.exitGateSummary ?? "",
    sopJson: sop, commsJson: comms, steps,
  };
}


type PrismaMaster = { id: number; kind: string; label: string; active: boolean };
export function serMaster(m: PrismaMaster): MasterItem {
  return { id: m.id, label: m.label, active: m.active };
}

type PrismaSla = { id: number; stage: string; bank: string | null; maxDays: number; active: boolean };
export function serSla(s: PrismaSla): SlaRule {
  return { id: s.id, stage: s.stage, bank: s.bank, maxDays: s.maxDays, active: s.active };
}

type PrismaReply = { id: number; userId: number; text: string; at: Date };
export function serReply(r: PrismaReply): Reply {
  return { id: r.id, userId: r.userId, text: r.text, at: r.at.toISOString() };
}

type PrismaInstruction = {
  id: number; caseId: number; issuedBy: number; instruction: string; assignedTo: number;
  dueDate: string; status: string; createdAt: Date; completedAt: Date | null;
  replies: PrismaReply[];
};

export function serInstruction(i: PrismaInstruction): Instruction {
  return {
    id: i.id, caseId: i.caseId, issuedBy: i.issuedBy, instruction: i.instruction,
    assignedTo: i.assignedTo, dueDate: i.dueDate, status: i.status as Instruction["status"],
    createdAt: i.createdAt.toISOString(),
    completedAt: i.completedAt ? i.completedAt.toISOString() : null,
    replies: i.replies.map(serReply),
  };
}

type PrismaBulletin = {
  id: number; date: string; issuedBy: number; task: string; caseId: number | null;
  status: string; completedAt: Date | null; completedBy: number | null;
  createdAt: Date; carriedFrom: string | null; dropped: boolean;
  templateId: number | null; isTemplate: boolean; repeat: string | null;
  targets: { userId: number }[];
  replies: PrismaReply[];
};

export function serBulletin(b: PrismaBulletin): BulletinItem {
  return {
    id: b.id, date: b.date, issuedBy: b.issuedBy, task: b.task, caseId: b.caseId,
    targets: b.targets.map((t) => t.userId), status: b.status as BulletinItem["status"],
    completedAt: b.completedAt ? b.completedAt.toISOString() : null,
    completedBy: b.completedBy, createdAt: b.createdAt.toISOString(),
    carriedFrom: b.carriedFrom, dropped: b.dropped,
    repeat: (b.repeat ?? undefined) as BulletinItem["repeat"],
    templateId: b.templateId, isTemplate: b.isTemplate,
    replies: b.replies.map(serReply),
  };
}

/* ---------------- email ---------------- */

export interface EmailLogDto {
  id: number;
  caseId: number;
  subject: string;
  sender: string;
  direction: string;
  receivedAt: string;
  outlookLink: string | null;
}

type PrismaEmailLog = {
  id: number; caseId: number; subject: string; sender: string;
  direction: string; receivedAt: Date; outlookLink: string | null;
};

export function serEmail(e: PrismaEmailLog): EmailLogDto {
  return {
    id: e.id, caseId: e.caseId, subject: e.subject, sender: e.sender,
    direction: e.direction, receivedAt: e.receivedAt.toISOString(),
    outlookLink: e.outlookLink,
  };
}

/* ---------------- stage transitions ---------------- */

type PrismaStageTransition = {
  id: number; caseId: number; fromStage: string; toStage: string;
  comment: string; userId: number; at: Date;
};

export function serStageTransition(t: PrismaStageTransition): StageTransition {
  return {
    id: t.id, caseId: t.caseId, fromStage: t.fromStage, toStage: t.toStage,
    comment: t.comment, userId: t.userId, at: t.at.toISOString(),
  };
}

// `StageTransitionDto` (with the user's display name) lives in ./types and is
// shared with the client store. This serializer accepts a Prisma row whose
// `user` relation has been included.
type PrismaStageTransitionWithUser = PrismaStageTransition & {
  user: { name: string } | null;
};

export function serStageTransitionDto(t: PrismaStageTransitionWithUser): StageTransitionDto {
  return {
    ...serStageTransition(t),
    userName: t.user?.name ?? null,
  };
}

export interface UnmatchedEmailDto {
  id: number;
  subject: string;
  sender: string;
  receivedAt: string;
  bestGuessCaseId: number | null;
  status: string;
}

type PrismaUnmatchedEmail = {
  id: number; subject: string; sender: string; receivedAt: Date;
  bestGuessCaseId: number | null; status: string;
};

export function serUnmatchedEmail(u: PrismaUnmatchedEmail): UnmatchedEmailDto {
  return {
    id: u.id, subject: u.subject, sender: u.sender,
    receivedAt: u.receivedAt.toISOString(),
    bestGuessCaseId: u.bestGuessCaseId, status: u.status,
  };
}


/* ---------------- SOP master data (doc validity + fee rules) ---------------- */

type PrismaDocRuleRow = {
  id: number; code: string; name: string; category: string; validityDays: number; warnDays: number;
  verifyNotes: string; applicableEmployment: string; applicablePropertyType: string;
  applicableTransaction: string; applicableResidency: string; applicableBank?: string;
  mandatory: boolean;
  visibleToClient: boolean; clientCanUpload: boolean; expiryTrackingRequired: boolean; active: boolean;
};

function parseVec(json: string): string[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.map(String) : ["any"];
  } catch {
    return ["any"];
  }
}

export function serDocRule(d: PrismaDocRuleRow): DocRule {
  return {
    id: d.id, code: d.code, name: d.name, category: d.category,
    validityDays: d.validityDays, warnDays: d.warnDays, verifyNotes: d.verifyNotes,
    applicableEmployment: parseVec(d.applicableEmployment),
    applicablePropertyType: parseVec(d.applicablePropertyType),
    applicableTransaction: parseVec(d.applicableTransaction),
    applicableResidency: parseVec(d.applicableResidency),
    // Pre-migration rows have no applicableBank column; "any" keeps every
    // existing rule applying to every bank exactly as it did before.
    applicableBank: parseVec(d.applicableBank ?? '["any"]'),
    mandatory: d.mandatory, visibleToClient: d.visibleToClient,
    clientCanUpload: d.clientCanUpload, expiryTrackingRequired: d.expiryTrackingRequired,
    active: d.active,
  };
}

type PrismaCaseDocumentRow = {
  id: number; caseId: number; templateId: number | null; copiedFromId?: number | null; title: string; category: string;
  status: string; mandatory: boolean; visibleToClient: boolean; clientCanUpload: boolean;
  rejectionReason: string; notes: string; fileName: string | null; fileType: string | null;
  fileSize: number | null; expiryDate: string | null; uploadedByKind: string;
  uploadedAt: Date | null; verifiedAt: Date | null; createdAt: Date;
  // storage columns (nullable for legacy rows created before the R2 migration)
  storageKey?: string | null; compressedKey?: string | null; compressedSize?: number | null;
  selectedVersion?: string | null; driveFileId?: string | null; fileData?: unknown;
  displayName?: string | null; source?: string | null;
};

export function serCaseDocument(d: PrismaCaseDocumentRow): CaseDocument {
  const hasFile = !!d.storageKey || d.fileData != null;
  return {
    id: d.id, caseId: d.caseId, templateId: d.templateId, copiedFromId: d.copiedFromId ?? null, title: d.title, category: d.category,
    status: d.status as CaseDocument["status"], mandatory: d.mandatory,
    visibleToClient: d.visibleToClient, clientCanUpload: d.clientCanUpload,
    rejectionReason: d.rejectionReason, notes: d.notes, fileName: d.fileName,
    fileType: d.fileType, fileSize: d.fileSize, expiryDate: d.expiryDate,
    uploadedByKind: d.uploadedByKind,
    uploadedAt: d.uploadedAt ? d.uploadedAt.toISOString() : null,
    verifiedAt: d.verifiedAt ? d.verifiedAt.toISOString() : null,
    createdAt: d.createdAt.toISOString(),
    hasFile,
    hasCompressed: !!d.compressedKey,
    compressedSize: d.compressedSize ?? null,
    selectedVersion: d.selectedVersion === "compressed" ? "compressed" : "original",
    // independent Google Drive archive copy (never deleted by the app)
    driveFileId: d.driveFileId ?? null,
    driveLink: d.driveFileId ? `https://drive.google.com/file/d/${d.driveFileId}/view` : null,
    displayName: d.displayName ?? null,
    source: d.source ?? "vault",
  };
}

export function serChatMessage(m: {
  id: number; caseId: number; senderId: number | null; senderType: string;
  senderName: string; threadType: string; text: string | null;
  attachmentKey: string | null; attachmentName: string | null;
  attachmentSize: number | null; mimeType: string | null;
  documentId?: number | null;
  sentAt: Date; readByStaff: boolean; readByExternal: boolean;
}): import("./types").ChatMessageDto {
  return {
    id: m.id,
    caseId: m.caseId,
    senderId: m.senderId,
    senderType: m.senderType as "STAFF" | "CLIENT" | "AGENT",
    senderName: m.senderName,
    threadType: m.threadType as "CLIENT" | "AGENT",
    text: m.text,
    attachmentKey: m.attachmentKey,
    attachmentName: m.attachmentName,
    attachmentSize: m.attachmentSize,
    mimeType: m.mimeType,
    documentId: (m as { documentId?: number | null }).documentId ?? null,
    sentAt: m.sentAt.toISOString(),
    readByStaff: m.readByStaff,
    readByExternal: m.readByExternal,
  };
}

export function serUserDevice(d: {
  id: number; userId: number | null; caseId: number | null;
  deviceType: string; pwaInstalled: boolean; installedAt: Date | null;
  pushEndpoint: string | null; lastSeenAt: Date; userAgent: string | null;
}): import("./types").UserDeviceDto {
  return {
    id: d.id,
    userId: d.userId,
    caseId: d.caseId,
    deviceType: d.deviceType as "mobile" | "desktop" | "tablet",
    pwaInstalled: d.pwaInstalled,
    installedAt: d.installedAt ? d.installedAt.toISOString() : null,
    pushEndpoint: d.pushEndpoint,
    lastSeenAt: d.lastSeenAt.toISOString(),
    userAgent: d.userAgent,
  };
}

type PrismaCommTemplateRow = {
  id: number; key: string; channel: string; stageKey: string; bank: string | null;
  name: string; subject: string | null; body: string; vars: string;
  sortOrder: number; active: boolean;
};
export function serCommTemplate(t: PrismaCommTemplateRow): CommTemplate {
  let vars: string[] = [];
  try { vars = JSON.parse(t.vars || "[]"); } catch { vars = []; }
  return {
    id: t.id, key: t.key, channel: t.channel as CommTemplate["channel"],
    stageKey: t.stageKey as CommTemplate["stageKey"], bank: t.bank, name: t.name,
    subject: t.subject, body: t.body, vars, sortOrder: t.sortOrder, active: t.active,
  };
}

type PrismaFeeRuleRow = {
  id: number; emirate: string; txnType: string; label: string; amountType: string;
  amount: number; paidBy: string; note: string; sortOrder: number; active: boolean;
};
export function serFeeRule(f: PrismaFeeRuleRow): FeeRule {
  return {
    id: f.id, emirate: f.emirate as FeeRule["emirate"], txnType: f.txnType as FeeRule["txnType"],
    label: f.label, amountType: f.amountType as FeeRule["amountType"], amount: f.amount,
    paidBy: f.paidBy, note: f.note, sortOrder: f.sortOrder, active: f.active,
  };
}

type PrismaPromotionRow = {
  id: number; bankProductId: number; name: string; description: string;
  rateOptionTermYears: number | null; rateDiscountBps: number | null;
  processingFeeOverridePct: number | null; valuationFeeWaived: boolean;
  validFrom: string; validTo: string; active: boolean; createdBy: string;
};
export function serPromotion(p: PrismaPromotionRow): Promotion {
  return {
    id: p.id, bankProductId: p.bankProductId, name: p.name, description: p.description ?? "",
    rateOptionTermYears: p.rateOptionTermYears ?? null, rateDiscountBps: p.rateDiscountBps ?? null,
    processingFeeOverridePct: p.processingFeeOverridePct ?? null, valuationFeeWaived: !!p.valuationFeeWaived,
    validFrom: p.validFrom, validTo: p.validTo, active: p.active, createdBy: p.createdBy ?? "",
  };
}

type PrismaCaseUpdateRow = {
  id: number; caseId: number; date: string; note: string; onHold: boolean;
  holdReason: string; authorId: number; createdAt: Date;
  author?: { name: string } | null;
};
export function serCaseUpdate(u: PrismaCaseUpdateRow): CaseUpdate {
  return {
    id: u.id, caseId: u.caseId, date: u.date, note: u.note, onHold: u.onHold,
    holdReason: u.holdReason, authorId: u.authorId,
    authorName: (u as unknown as { author?: { name?: string } }).author?.name ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

type PrismaProposalRow = {
  id: number; caseId: number; productIds: string; inputs: string;
  mode: string; status: string; version: number; createdBy: number;
  sentAt: Date | null; decidedAt: Date | null; createdAt: Date;
  author?: { name: string } | null;
};
export function serProposal(v: PrismaProposalRow): Proposal {
  let productIds: number[] = [];
  let inputs: Record<string, unknown> = {};
  try { productIds = JSON.parse(v.productIds); } catch { }
  try { inputs = JSON.parse(v.inputs); } catch { }
  return {
    id: v.id, caseId: v.caseId, productIds, inputs,
    mode: v.mode as Proposal["mode"], status: v.status as Proposal["status"],
    version: v.version, createdBy: v.createdBy,
    authorName: (v as unknown as { author?: { name?: string } }).author?.name ?? null,
    sentAt: v.sentAt ? v.sentAt.toISOString() : null,
    decidedAt: v.decidedAt ? v.decidedAt.toISOString() : null,
    createdAt: v.createdAt.toISOString(),
  };
}
