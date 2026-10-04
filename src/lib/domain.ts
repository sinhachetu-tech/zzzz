// Shared business logic — visibility scoping, SLA escalation, KPIs.
// Used by API routes (server) so the same rules apply as in the original client store.
import type { BulletinItem, LoanCase, Task, User, BankItem, CaseStatus, LegStatus } from "./types";
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

/* ---------- bank legs (Phase 2) ---------- */

/**
 * An ENGAGEMENT is the parent case: the row that represents "this client's
 * first-home mortgage", regardless of how many banks it was shopped to.
 * `parentCaseId === null` means the row IS its own parent — true for a
 * single-bank mortgage and for every non-mortgage service (a will has no legs).
 */
export function isParentLeg(c: LoanCase): boolean {
  return c.parentCaseId == null;
}

/**
 * The children of an engagement, plus the parent itself as the first element.
 *
 * WHY THE PARENT IS INCLUDED: today the parent row is ALSO the first bank's leg
 * (it holds `banks=[first]`, parentCaseId=null). We deliberately do NOT restructure
 * that — every existing link, document and case number points at it. So when
 * counting money we walk parents only; when walking the race we include the
 * parent's own bank as one of the contestants.
 */
export function legsOf(engagement: LoanCase, all: LoanCase[]): LoanCase[] {
  return all.filter((c) => c.id === engagement.id || c.parentCaseId === engagement.id);
}

/** Just the siblings — the other banks, excluding the row passed in. */
export function siblingsOf(c: LoanCase, all: LoanCase[]): LoanCase[] {
  return all.filter((o) => o.id !== c.id && o.parentCaseId === c.parentCaseId && o.parentCaseId != null);
}

/**
 * The engagement's competitive rollup: Won when at least one leg is Won, else
 * LostRace when every leg is decided and none won, else Active.
 *
 * NOTE ON THE LEGACY SHAPE: because the parent row is also the first bank's leg,
 * a parent whose own legStatus is "Active" but which has a Won sibling reads as
 * Won here. That is exactly the intent — one bank won, so the engagement won.
 */
export function rollupLegStatus(c: LoanCase, all: LoanCase[]): LegStatus {
  const legs = legsOf(c, all);
  if (legs.some((l) => l.legStatus === "Won")) return "Won";
  const decided = legs.filter((l) => l.legStatus !== "Active");
  if (decided.length > 0 && decided.length === legs.length) return "LostRace";
  return "Active";
}

/** Has this leg been beaten — i.e. should the UI grey it out and group it? */
export function isBeatenLeg(c: LoanCase): boolean {
  return c.legStatus === "LostRace" || c.legStatus === "Declined" || c.legStatus === "Withdrawn";
}

/**
 * ENGAGEMENTS ONLY — the replacement for `dedupeEngagements`.
 *
 * THE OLD HEURISTIC GUESSED. It keyed on client+amount+created-day, because there
 * was no row that actually represented "one deal", so consolidated money had to
 * collapse the legs by inference. That is fragile and it breaks the moment the
 * firm sells more than one service: two golden-visa applications for the same
 * client on the same day for the same amount would collapse into one.
 *
 * Now the parent case IS the engagement, so we simply filter. Deterministic, and
 * correct for any service line.
 */
export function engagementsOnly(cases: LoanCase[]): LoanCase[] {
  return cases.filter((c) => c.parentCaseId == null);
}

export interface WinRateRow {
  bank: string;
  won: number;
  lostRace: number;
  declined: number;
  withdrawn: number;
  decided: number;
  /** 0–100, won / (won + lostRace). Declines are EXCLUDED: a bank declining a
   *  client is not a bank we lost to — mixing them understates win rate. */
  winPct: number;
}

/**
 * Win rate by bank — the metric this whole phase exists to make computable.
 * Reads legs only (never engagements), because the race happens per bank.
 */
export function computeWinRates(cases: LoanCase[]): WinRateRow[] {
  const legs = cases.filter((c) => c.legStatus !== "Active");
  const map = new Map<string, WinRateRow>();
  const rowFor = (bank: string) => {
    let r = map.get(bank);
    if (!r) {
      r = { bank, won: 0, lostRace: 0, declined: 0, withdrawn: 0, decided: 0, winPct: 0 };
      map.set(bank, r);
    }
    return r;
  };
  for (const c of legs) {
    // c.banks is already string[] on the DTO — no re-parsing needed here.
    const banks = c.banks.length ? c.banks : ["(unassigned)"];
    for (const b of banks) {
      const r = rowFor(b);
      if (c.legStatus === "Won") r.won++;
      else if (c.legStatus === "LostRace") r.lostRace++;
      else if (c.legStatus === "Declined") r.declined++;
      else if (c.legStatus === "Withdrawn") r.withdrawn++;
    }
  }
  return [...map.values()]
    .map((r) => {
      const decided = r.won + r.lostRace;
      return { ...r, decided, winPct: decided ? Math.round((r.won / decided) * 100) : 0 };
    })
    .filter((r) => r.decided > 0 || r.declined > 0 || r.withdrawn > 0)
    .sort((a, b) => b.winPct - a.winPct || b.decided - a.decided);
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
 * @deprecated Since Phase 2 — use `engagementsOnly`.
 *
 * Kept for one release so any importer still compiles, but it GUESSES: it keys on
 * client+amount+created-day because there used to be no row that actually stood
 * for "one deal". That inference is wrong the moment the firm sells more than one
 * service — two same-day golden-visa applications for one client collapse into
 * one. Every money figure must read `engagementsOnly` instead.
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
  // Money counts ENGAGEMENTS, not legs: 3 banks on one mortgage is one pipeline.
  // Deterministic now (parentCaseId === null) instead of inferred.
  const uniqueEngagements = engagementsOnly(active);
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
