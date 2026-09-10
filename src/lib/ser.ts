// Serialization: Prisma row → API DTO matching the original HFMC types.
import type {
  Activity, BankItem, BulletinItem, CasePartner, Instruction, LoanCase,
  MasterItem, PartnerItem, Reply, SlaRule, StageItem, Task, User,
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
    submissionType: (c as { submissionType?: string }).submissionType === "channel" ? "channel" : "direct",
    channelId: (c as { channelId?: number | null }).channelId ?? null,
    channelName: (c as { channelName?: string | null }).channelName ?? null,
    channelRatePct: (c as { channelRatePct?: number }).channelRatePct ?? 0,
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

type PrismaBank = { id: number; name: string; ratePct: number; active: boolean };
export function serBank(b: PrismaBank): BankItem {
  return { id: b.id, name: b.name, ratePct: b.ratePct, active: b.active };
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

