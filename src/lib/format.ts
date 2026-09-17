// Formatting & derived-status helpers — ported from the original smallhfmc.

import type { BankItem, CaseStatus, LoanCase, Task, Tone } from "./types";

const DAY = 86400000;

export function todayISO(): string {
  return toISODate(new Date());
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function daysAgoISO(n: number): string {
  return toISODate(new Date(Date.now() - n * DAY));
}

export function inDaysISO(n: number): string {
  return toISODate(new Date(Date.now() + n * DAY));
}

export function parseDate(iso: string): Date {
  // tolerant: accepts "YYYY-MM-DD" and "YYYY-MM-DDTHH:mm" (task datetimes)
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return new Date(NaN);
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}

export function daysBetween(aISO: string, bISO: string): number {
  return Math.round((parseDate(bISO).getTime() - parseDate(aISO).getTime()) / DAY);
}

export function ageDays(createdAtISO: string): number {
  return daysBetween(createdAtISO.slice(0, 10), todayISO());
}

export interface DueInfo {
  label: string;
  tone: Tone;
  days: number;
  overdue: boolean;
}

/* Task deadlines use UAE wall-clock time (UTC+4, no DST). Legacy dates
   remain end-of-day; the existing String column needs no migration. */
export function taskToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 4 * 3600000).toISOString().slice(0, 10);
}
export function dueDay(dueISO: string): string {
  return (dueISO || "").slice(0, 10);
}

export function dueTime(dueISO: unknown): string | null {
  const s = typeof dueISO === "string" ? dueISO : "";
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  let h = parseInt(m[2], 10);
  const min = m[3];
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${ap}`;
}

/** Strict UAE deadline parser. Date-only remains valid through 23:59:59.999. */
export function parseTaskDue(dueISO: unknown): Date | null {
  if (typeof dueISO !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(dueISO);
  if (!m) return null;
  const [, y, mo, d, h, min] = m;
  if (+y < 1000 || +mo < 1 || +mo > 12 || +d < 1 || +d > 31 || (h !== undefined && (+h > 23 || +min > 59))) return null;
  const calendar = new Date(Date.UTC(+y, +mo - 1, +d));
  if (calendar.getUTCMonth() !== +mo - 1 || calendar.getUTCDate() !== +d) return null;
  return new Date(`${y}-${mo}-${d}T${h === undefined ? "23:59:59.999" : `${h}:${min}:00.000`}+04:00`);
}

export function compareTaskDue(a: string, b: string): number {
  const x = parseTaskDue(a)?.getTime() ?? Infinity;
  const y = parseTaskDue(b)?.getTime() ?? Infinity;
  return x === y ? 0 : x < y ? -1 : 1;
}

export function isOverdueDue(dueISO: unknown, now: Date = new Date()): boolean {
  const d = parseTaskDue(dueISO);
  return !!d && d.getTime() < now.getTime();
}

/** "17 Sep" or "17 Sep · 3:30 PM (GST)" — compact due stamp, UAE time. */
export function fmtDue(dueISO: unknown): string {
  const s = typeof dueISO === "string" ? dueISO : "";
  if (!s) return "—";
  const day = fmtDate(s.slice(0, 10));
  const t = dueTime(s);
  return t ? `${day} · ${t}` : day;
}

export function dueInfo(dueISO: unknown, now: Date = new Date()): DueInfo {
  const s = typeof dueISO === "string" ? dueISO : "";
  const days = daysBetween(taskToday(now), s.slice(0, 10));
  const t = dueTime(s);
  const overdue = isOverdueDue(s, now);
  if (overdue) {
    if (days < 0) return { label: `${-days}d overdue`, tone: "coral", days, overdue: true };
    // overdue earlier today — name the missed time so it stings usefully
    return { label: t ? `overdue · ${t}` : "overdue today", tone: "coral", days, overdue: true };
  }
  if (days === 0) return { label: t ? `today · ${t}` : "due today", tone: "amber", days, overdue: false };
  if (days === 1) return { label: t ? `tomorrow · ${t}` : "due tomorrow", tone: "amber", days, overdue: false };
  if (days <= 2) return { label: `due in ${days}d${t ? ` · ${t}` : ""}`, tone: "amber", days, overdue: false };
  return { label: `due in ${days}d${t ? ` · ${t}` : ""}`, tone: "slate", days, overdue: false };
}

export function fmtDate(iso: string): string {
  if (!iso) return "—";
  // slice-first: task datetimes ("YYYY-MM-DDTHH:mm") render as their day
  const d = parseDate((iso || "").slice(0, 10));
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export function fmtDateTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) +
    " · " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true })
  );
}

export function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(iso);
}

/* ---------------- money (AED) ---------------- */

export function fmtMoney(v: number): string {
  if (Math.abs(v) >= 1e6) {
    const m = (v / 1e6).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    return `AED ${m}M`;
  }
  if (Math.abs(v) >= 1e3) return `AED ${Math.round(v / 1e3)}K`;
  return `AED ${Math.round(v)}`;
}

export function fmtMoneyFull(v: number): string {
  return `AED ${Math.round(v).toLocaleString("en-US")}`;
}

export function fmtRate(r: number): string {
  return `${r}%`;
}

export const fmtMoneyCompact = fmtMoney;

/* ---------------- commission engine ---------------- */

export function rateFor(banks: { name: string; ratePct: number }[], name: string | null | undefined): number {
  if (!name) return 0;
  return banks.find((b) => b.name === name)?.ratePct ?? 0;
}

export const commissionOf = (ratePct: number, loanAmount: number) => (loanAmount * ratePct) / 100;

export interface CommissionBreakdown {
  bank: string | null;
  ratePct: number;
  gross: number;               // what the bank pays (loanAmount × bank rate %)
  // Two-way commission loss:
  submissionType: "direct" | "channel";
  channelName: string | null;
  channelRatePct: number;     // channel's % of loan amount (e.g. 0.4)
  channelCut: number;         // channel takes this from the gross (loanAmount × channelRatePct)
  afterChannel: number;       // what's left after channel takes their cut
  // Lead partner cut (from what's left after channel):
  partnerSharePct: number;
  partnerCut: number;
  net: number;                 // what HFMC keeps
}

export function commissionFor(c: LoanCase, banks: { name: string; ratePct: number }[]): CommissionBreakdown {
  const bank = c.wonBank ?? c.banks[0] ?? null;
  const ratePct = rateFor(banks, bank);
  const gross = commissionOf(ratePct, c.loanAmount);
  // Submission commission loss: channel takes a % of the loan amount
  const channelRatePct = c.channelRatePct ?? 0;
  const channelCut = (c.loanAmount * channelRatePct) / 100;
  const afterChannel = gross - channelCut;
  // Lead commission loss: partner takes a % of the remaining commission
  const partnerSharePct = c.partner?.sharePct ?? 0;
  const partnerCut = (afterChannel * partnerSharePct) / 100;
  const net = afterChannel - partnerCut;
  return {
    bank, ratePct, gross,
    submissionType: (c as { submissionType?: string }).submissionType === "channel" ? "channel" : "direct",
    channelName: (c as { channelName?: string | null }).channelName ?? null,
    channelRatePct, channelCut, afterChannel,
    partnerSharePct, partnerCut, net,
  };
}

export function primaryBank(c: LoanCase): string | null {
  return c.wonBank ?? c.banks[0] ?? null;
}

/* ---------------- misc ---------------- */

export function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/* ------------ status computation (never stored, always derived) ------------ */

export function caseStatusOf(c: LoanCase, tasks: Task[]): CaseStatus {
  if (c.caseStatus !== "Active") return "On Track";
  const open = tasks.filter((t) => t.caseId === c.id && t.status === "Open");
  if (open.length === 0) return "No Action";
  const today = taskToday();
  // instant-aware: a timed task due 09:00 today is stricter than a date-only one
  const soonest = open.reduce((min, t) => (compareTaskDue(t.dueDate, min) < 0 ? t.dueDate : min), open[0].dueDate);
  if (isOverdueDue(soonest)) return "Overdue";
  const gap = daysBetween(today, soonest.slice(0, 10));
  if (gap <= 2) return "At Risk";
  return "On Track";
}

export const STATUS_TONE: Record<CaseStatus, Tone> = {
  "On Track": "mint",
  "At Risk": "amber",
  Overdue: "coral",
  "No Action": "slate",
};

export const TONE_HEX: Record<Tone, string> = {
  mint: "#43d69b",
  amber: "#f2b04c",
  coral: "#f27363",
  sky: "#57c2ea",
  slate: "#8ca6b0",
};

export function openTasksOf(tasks: Task[], caseId: number): Task[] {
  return tasks.filter((t) => t.caseId === caseId && t.status === "Open");
}

/* ------------ CSV export ------------ */

export function downloadCSV(filename: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
