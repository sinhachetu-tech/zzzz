// Comm-template placeholder renderer.
// Templates reference {{var}} only; missing values render as "—" so a copy
// never crashes on an incomplete file. Stage files hold template ids,
// wording lives in src/data/seed/commTemplates.json (later: DB table).
import type { LoanCase } from "@/lib/types";
import { fmtMoney } from "@/lib/format";
import { parseCaseProfile } from "@/lib/case-profile";

export const COMM_VARS = [
  "customer",
  "caseNumber",
  "amount",
  "bank",
  "owner",
  "mouPrice",
  "waGroup",
] as const;

export function commContext(c: LoanCase, ownerName?: string | null): Record<string, string> {
  let mouPrice = "—";
  try {
    const p = parseCaseProfile(c.profileJson, { customer: c.customer });
    void p;
  } catch {
    /* profile is best-effort for one var */
  }
  return {
    customer: c.customer ?? "—",
    caseNumber: c.caseNumber ?? "—",
    amount: c.loanAmount ? fmtMoney(c.loanAmount) : "—",
    bank: c.banks?.[0] ?? c.wonBank ?? "—",
    owner: ownerName ?? "—",
    mouPrice,
    waGroup: c.waGroup ?? "—",
  };
}

export function fillTemplate(body: string, ctx: Record<string, string>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => ctx[k] ?? "—");
}

export function renderComm(body: string, c: LoanCase, ownerName?: string | null): string {
  return fillTemplate(body, commContext(c, ownerName));
}
