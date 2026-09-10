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
}

export interface ChannelItem {
  id: number;
  name: string;
  commissionPct: number;
  active: boolean;
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

export interface BankItem {
  id: number;
  name: string;
  ratePct: number;
  active: boolean;
}

export interface PartnerItem {
  id: number;
  kind: PartnerKind;
  name: string;
  defaultSharePct: number;
  active: boolean;
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

export type Tone = "mint" | "amber" | "coral" | "sky" | "slate";

export const SOURCES: CaseSource[] = ["Direct", "Agent", "Broker", "Website", "Referral"];
export const PARTNER_SHARES = [10, 15, 20, 30];

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
