// Shared business logic — visibility scoping, SLA escalation, KPIs.
// Used by API routes (server) so the same rules apply as in the original client store.
import type { BulletinItem, LoanCase, Task, User, BankItem, CaseStatus } from "./types";
import { caseStatusOf, commissionFor, daysBetween, primaryBank, todayISO } from "./format";

export interface RoleFlags {
  scope: "all" | "team" | "own";
  issueTasks: boolean;
  admin: boolean;
  super: boolean;
  viewRevenue: boolean;
  editEibor: boolean; // may update the daily EIBOR benchmark table (granted per designation)
  manageDocs: boolean; // may upload/verify/reject/waive/delete/compress vault documents
  clientChat: boolean; // may reply to client & agent chats
}

/* ---------- visibility scoping ---------- */

export function visibleCases(cases: LoanCase[], users: User[], user: User, flags: RoleFlags): LoanCase[] {
  if (flags.super || flags.scope === "all") return cases;
  if (flags.scope === "team") {
    const teamIds = new Set(users.filter((u) => u.team === user.team).map((u) => u.id));
    return cases.filter((c) => teamIds.has(c.ownerId) || c.backup1Id === user.id || c.backup2Id === user.id);
  }
  // "own" scope — the owner plus any backup staffers covering the file
  // (a backup assignment IS the authorization to open and work the case
  // while the owner is away; actions stay logged under the doer's userId).
  return cases.filter((c) => c.ownerId === user.id || c.backup1Id === user.id || c.backup2Id === user.id);
}

// Access guard for document routes: staff need the manageDocs designation
// permission (plus an authenticated session); clients are validated separately
// in the route via currentClient() + doc.caseId/visibleToClient checks.
export async function requireDocManager(
  me: { id: number } | null,
  flags: RoleFlags | null
): Promise<boolean> {
  return !!(me && flags && (flags.manageDocs || flags.super || flags.admin));
}

export function visibleTasks(tasks: Task[], cases: LoanCase[], users: User[], user: User, flags: RoleFlags): Task[] {
  const caseIds = new Set(visibleCases(cases, users, user, flags).map((c) => c.id));
  if (flags.super || flags.scope === "all") return tasks;
  if (flags.scope === "team") {
    const teamIds = new Set(users.filter((u) => u.team === user.team).map((u) => u.id));
    return tasks.filter((t) => caseIds.has(t.caseId) || teamIds.has(t.ownerId));
  }
  return tasks.filter((t) => caseIds.has(t.caseId) || t.ownerId === user.id || t.createdBy === user.id);
}

/* ---------- SLA escalation ---------- */

export interface SlaMatch {
  caseId: number;
  stage: string;
  bank: string | null;
  maxDays: number;
  ageDays: number;
  breachDays: number;
}

export function computeEscalations(
  cases: LoanCase[],
  slaRules: { stage: string; bank: string | null; maxDays: number; active: boolean }[]
): SlaMatch[] {
  const today = todayISO();
  const out: SlaMatch[] = [];
  for (const c of cases) {
    if (c.caseStatus !== "Active") continue;
    const age = daysBetween(c.createdAt.slice(0, 10), today);
    const bank = primaryBank(c) ?? null;
    const rules = slaRules.filter((r) => r.active && r.stage === c.stage && (r.bank == null || r.bank === bank));
    if (rules.length === 0) continue;
    const rule = rules.find((r) => r.bank === bank) ?? rules[0];
    const breach = age - rule.maxDays;
    if (breach > 0) out.push({ caseId: c.id, stage: c.stage, bank, maxDays: rule.maxDays, ageDays: age, breachDays: breach });
  }
  return out;
}

/* ---------- KPIs ---------- */

export interface DashboardKpis {
  openCases: number;
  overdue: number;
  atRisk: number;
  noAction: number;
  onTrack: number;
  openTasks: number;
  pipelineValue: number;
  estCommission: number;
  escalations: number;
}

/**
 * Per-bank case splits (one engagement filed at several banks) must not
 * multiply consolidated money numbers. Group cases by client + amount +
 * creation day and keep one representative per engagement.
 */
export function dedupeEngagements(cases: LoanCase[]): LoanCase[] {
  const seen = new Set<string>();
  return cases.filter((c) => {
    const key = (c.clientId ?? "c" + c.customer) + "|" + c.loanAmount + "|" + c.createdAt.slice(0, 10);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function computeKpis(
  cases: LoanCase[],
  tasks: Task[],
  statusOf: (c: LoanCase) => CaseStatus,
  banks: BankItem[],
  escalations: number
): DashboardKpis {
  const active = cases.filter((c) => c.caseStatus === "Active");
  const statuses = active.map(statusOf);
  const openTasks = tasks.filter((t) => t.status === "Open");
  // money numbers dedupe per-bank splits — 3 banks on one engagement = one pipeline
  const uniqueEngagements = dedupeEngagements(active);
  const pipeline = uniqueEngagements.reduce((s, c) => s + c.loanAmount, 0);
  const commission = uniqueEngagements.reduce((s, c) => s + commissionFor(c, banks).gross, 0);
  return {
    openCases: active.length,
    overdue: statuses.filter((s) => s === "Overdue").length,
    atRisk: statuses.filter((s) => s === "At Risk").length,
    noAction: statuses.filter((s) => s === "No Action").length,
    onTrack: statuses.filter((s) => s === "On Track").length,
    openTasks: openTasks.length,
    pipelineValue: pipeline,
    estCommission: commission,
    escalations,
  };
}

/* ---------- bulletin visibility ---------- */

export function bulletinVisible(b: BulletinItem, user: User, users: User[], flags: RoleFlags): boolean {
  if (flags.super) return true;
  if (b.issuedBy === user.id) return true;
  if (flags.scope === "all") return true;
  if (flags.scope === "team") {
    const teamIds = new Set(users.filter((u) => u.team === user.team).map((u) => u.id));
    return b.targets.some((t) => teamIds.has(t)) || teamIds.has(b.issuedBy);
  }
  return b.targets.includes(user.id);
}

export function bulletinCanAct(b: BulletinItem, user: User, flags: RoleFlags): boolean {
  return b.targets.includes(user.id) || flags.super;
}

export function bulletinCanDelete(b: BulletinItem, user: User, flags: RoleFlags): boolean {
  return b.issuedBy === user.id || flags.super;
}

export function bulletinCanManage(user: User, flags: RoleFlags): boolean {
  return flags.issueTasks || flags.super;
}

/* ---------- activity spark ---------- */

export function activityPerDay(activities: { at: string }[], days: number): number[] {
  const today = todayISO();
  const buckets: number[] = new Array(days).fill(0);
  for (const a of activities) {
    const d = a.at.slice(0, 10);
    const gap = daysBetween(d, today);
    if (gap >= 0 && gap < days) buckets[days - 1 - gap] += 1;
  }
  return buckets;
}

/* ---------- helper: build a LoanCase status for a single case ---------- */

export function statusForCase(c: LoanCase, tasks: Task[]): CaseStatus {
  return caseStatusOf(c, tasks);
}
