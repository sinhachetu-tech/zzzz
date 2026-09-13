// Serialization: Prisma row → API DTO matching the original HFMC types.
import type {
  Activity, BankItem, BulletinItem, CasePartner, Instruction, LoanCase,
  BankProduct, Proposal, CaseDocument, CaseUpdate, DocRule, FeeRule, MasterItem, PartnerItem, Reply, SlaRule, StageItem, StageTransition, StageTransitionDto, Task, User,
} from "./types";

type PrismaUser = {
  id: number; name: string; email: string; password: string; role: string; team: string;
  active: boolean; createdAt: Date;
};

export function serUser(u: PrismaUser): User {
  return {
    id: u.id, name: u.name, email: u.email, password: u.password, role: u.role, team: u.team,
    active: u.active, createdAt: u.createdAt.toISOString(),
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
  onHold?: boolean;
  holdReason?: string | null;
  holdUntil?: string | null;
  // --- Bank submission tracking ---
  employmentProfile: string;
  propertyType: string;
  residency: string;
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
    loanAmount: c.loanAmount, stage: c.stage, caseStatus: c.caseStatus as LoanCase["caseStatus"],
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
    onHold: c.onHold ?? false,
    holdReason: c.holdReason ?? null,
    holdUntil: c.holdUntil ?? null,
    // Bank submission
    employmentProfile: c.employmentProfile, propertyType: c.propertyType, residency: c.residency,
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
  };
}

type PrismaChannel = { id: number; name: string; commissionPct: number; active: boolean };
export function serChannel(ch: PrismaChannel) {
  return { id: ch.id, name: ch.name, commissionPct: ch.commissionPct, active: ch.active };
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

type PrismaBank = { id: number; name: string; ratePct: number; active: boolean; logoData?: Uint8Array | Buffer | null; posPoints?: string | null; negPoints?: string | null; website?: string | null };
export function serBank(b: PrismaBank): BankItem {
  return { id: b.id, name: b.name, ratePct: b.ratePct, hasLogo: !!b.logoData, posPoints: b.posPoints ?? "", negPoints: b.negPoints ?? "", website: b.website ?? "", active: b.active };
}

type PrismaBankProduct = {
  id: number; bankId: number; name: string; sheet: string; employment: string; residency: string;
  financeType: string; program: string; loanKind: string;
  maxLtvNational: number | null; maxLtvExpatriate: number | null;
  minLoan: number | null; maxLoan: number | null; tenorYears: number | null; minSalary: number | null;
  totalTatDays: number | null; paTatDays: number | null; paValidityDays: number | null;
  folValidityDays: number | null; valuationValidityDays: number | null;
  rateTable: string; stressTest: string; fees: string; insurance: string; pricingJson: string; feesJson?: string | null; insuranceJson?: string | null;
  cardRulePct?: number | null; bonusPct?: number | null; rentalIncomePct?: number | null; rentalCapPctOfSalary?: number | null; dbrPct?: number | null;
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
    rentalCapPctOfSalary: p.rentalCapPctOfSalary ?? null, dbrPct: p.dbrPct ?? null,
    totalTatDays: p.totalTatDays, paTatDays: p.paTatDays, paValidityDays: p.paValidityDays,
    folValidityDays: p.folValidityDays, valuationValidityDays: p.valuationValidityDays,
    rateTable: p.rateTable, stressTest: p.stressTest, fees: p.fees, insurance: p.insurance,
    pricingJson: (p as unknown as { pricingJson?: string }).pricingJson ?? "{}",
    feesJson: (p as unknown as { feesJson?: string }).feesJson ?? "{}", insuranceJson: (p as unknown as { insuranceJson?: string }).insuranceJson ?? "{}",
    eligibility: p.eligibility, documents: p.documents, notes: p.notes, axes,
    version: p.version, status: p.status as BankProduct["status"], effectiveDate: p.effectiveDate,
    approvedBy: p.approvedBy, sourceFiles: p.sourceFiles, active: p.active,
  };
}

type PrismaPartner = { id: number; kind: string; name: string; defaultSharePct: number; active: boolean };
export function serPartner(p: PrismaPartner): PartnerItem {
  return { id: p.id, kind: p.kind as PartnerItem["kind"], name: p.name, defaultSharePct: p.defaultSharePct, active: p.active };
}

type PrismaStage = { id: number; label: string; active: boolean; sortOrder: number };
export function serStage(s: PrismaStage): StageItem {
  return { id: s.id, label: s.label, active: s.active, sortOrder: s.sortOrder };
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
  applicableTransaction: string; applicableResidency: string; mandatory: boolean;
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
    mandatory: d.mandatory, visibleToClient: d.visibleToClient,
    clientCanUpload: d.clientCanUpload, expiryTrackingRequired: d.expiryTrackingRequired,
    active: d.active,
  };
}

type PrismaCaseDocumentRow = {
  id: number; caseId: number; templateId: number | null; title: string; category: string;
  status: string; mandatory: boolean; visibleToClient: boolean; clientCanUpload: boolean;
  rejectionReason: string; notes: string; fileName: string | null; fileType: string | null;
  fileSize: number | null; expiryDate: string | null; uploadedByKind: string;
  uploadedAt: Date | null; verifiedAt: Date | null; createdAt: Date;
};

export function serCaseDocument(d: PrismaCaseDocumentRow): CaseDocument {
  return {
    id: d.id, caseId: d.caseId, templateId: d.templateId, title: d.title, category: d.category,
    status: d.status as CaseDocument["status"], mandatory: d.mandatory,
    visibleToClient: d.visibleToClient, clientCanUpload: d.clientCanUpload,
    rejectionReason: d.rejectionReason, notes: d.notes, fileName: d.fileName,
    fileType: d.fileType, fileSize: d.fileSize, expiryDate: d.expiryDate,
    uploadedByKind: d.uploadedByKind,
    uploadedAt: d.uploadedAt ? d.uploadedAt.toISOString() : null,
    verifiedAt: d.verifiedAt ? d.verifiedAt.toISOString() : null,
    createdAt: d.createdAt.toISOString(),
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
  try { productIds = JSON.parse(v.productIds); } catch {}
  try { inputs = JSON.parse(v.inputs); } catch {}
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
