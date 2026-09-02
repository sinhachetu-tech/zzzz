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
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
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

export function dueInfo(dueISO: string): DueInfo {
  const days = daysBetween(todayISO(), dueISO);
  if (days < 0) return { label: `${-days}d overdue`, tone: "coral", days, overdue: true };
  if (days === 0) return { label: "due today", tone: "amber", days, overdue: false };
  if (days === 1) return { label: "due tomorrow", tone: "amber", days, overdue: false };
  if (days <= 2) return { label: `due in ${days}d`, tone: "amber", days, overdue: false };
  return { label: `due in ${days}d`, tone: "slate", days, overdue: false };
}

export function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = iso.length > 10 ? new Date(iso) : parseDate(iso);
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

export function rateFor(banks: BankItem[], name: string | null | undefined): number {
  if (!name) return 0;
  return banks.find((b) => b.name === name)?.ratePct ?? 0;
}

export const commissionOf = (ratePct: number, loanAmount: number) => (loanAmount * ratePct) / 100;

export interface CommissionBreakdown {
  bank: string | null;
  ratePct: number;
  gross: number;
  partnerSharePct: number;
  partnerCut: number;
  net: number;
}

export function commissionFor(c: LoanCase, banks: BankItem[]): CommissionBreakdown {
  const bank = c.wonBank ?? c.banks[0] ?? null;
  const ratePct = rateFor(banks, bank);
  const gross = commissionOf(ratePct, c.loanAmount);
  const partnerSharePct = c.partner?.sharePct ?? 0;
  const partnerCut = (gross * partnerSharePct) / 100;
  return { bank, ratePct, gross, partnerCut, net: gross - partnerCut };
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
  const today = todayISO();
  const soonest = open.reduce((min, t) => (t.dueDate < min ? t.dueDate : min), open[0].dueDate);
  const gap = daysBetween(today, soonest);
  if (gap < 0) return "Overdue";
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
