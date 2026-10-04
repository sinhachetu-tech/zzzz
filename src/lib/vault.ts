// Document Vault rule engine — evaluates conditional document templates against
// a case's profile vectors (employment / property / transaction / residency)
// and syncs the per-case checklist. Used by case create + case PATCH.
import { db } from "@/lib/db";
import type { DocRule, LoanCase } from "@/lib/types";

export const EMPLOYMENT_PROFILES = ["Salaried", "Self-Employed"] as const;
export const PROPERTY_TYPES = ["Ready", "Off-Plan"] as const;
export const RESIDENCIES = ["UAE National", "Resident Expatriate", "Non-Resident"] as const;
export const TXN_CONDITIONS = ["New Purchase", "Buyout / Equity Release"] as const;

type Vec = readonly string[];

function parseVec(json: string): string[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.map(String) : ["any"];
  } catch {
    return ["any"];
  }
}

function matches(vec: string[], value: string): boolean {
  return vec.includes("all") || vec.includes("any") || vec.includes(value);
}

/** Transaction type free-text → condition value. */
export function txnConditionOf(transactionType: string): string {
  const t = (transactionType || "").toLowerCase();
  if (t.includes("buyout") || t.includes("equity") || t.includes("refinance")) return "Buyout / Equity Release";
  return "New Purchase";
}

/** Does this template apply to this case profile? */
export function templateApplies(rule: DocRule, c: Pick<LoanCase, "employmentProfile" | "propertyType" | "residency" | "transactionType"> & { banks?: string[] }): boolean {
  return (
    matches(rule.applicableEmployment, c.employmentProfile) &&
    matches(rule.applicablePropertyType, c.propertyType) &&
    matches(rule.applicableTransaction, txnConditionOf(c.transactionType)) &&
    matches(rule.applicableResidency, c.residency) &&
    bankApplies(rule, c.banks ?? [])
  );
}

/**
 * The per-bank axis. A rule scoped to a specific bank only applies when the case
 * actually sits with that bank — which is what lets Emirates and Mashreq demand
 * different documents off the same borrower.
 *
 * A case with NO bank yet must still get the full "any"/"all" checklist: we
 * cannot know which bank will take it, and silently handing a new case an empty
 * vault would hide mandatory KYC. Bank-scoped rules stay off until a bank is
 * named, which is the honest reading of "this is a Mashreq-only document".
 */
function bankApplies(rule: DocRule, banks: string[]): boolean {
  const scope = rule.applicableBank ?? ["any"];
  if (scope.includes("all") || scope.includes("any")) return true;
  if (banks.length === 0) return false;
  return banks.some((b) => scope.includes(b));
}

/** Which active templates should be on this case's vault right now? */
export function requiredTemplates(rules: DocRule[], c: Pick<LoanCase, "employmentProfile" | "propertyType" | "residency" | "transactionType"> & { banks?: string[] }): DocRule[] {
  return rules.filter((r) => r.active && templateApplies(r, c));
}

/**
 * Sync the per-case vault: create instances for templates that now apply and
 * have no instance yet. Never deletes — removing no-longer-relevant docs is a
 * human decision (per-case Delete). Returns how many were added.
 */
export async function syncCaseVault(caseId: number): Promise<number> {
  const c = await db.loanCase.findUnique({ where: { id: caseId } });
  if (!c) return 0;
  const rules = (await db.docRule.findMany({ where: { active: true } })).map(serToDocRule);
  const existing = await db.caseDocument.findMany({ where: { caseId }, select: { templateId: true } });
  const have = new Set(existing.map((e) => e.templateId));

  // `banks` is part of the profile the rules are evaluated against — it is what
  // makes a bank-scoped document requirement apply (or not) on this leg.
  let banks: string[] = [];
  try { banks = JSON.parse(c.banks); } catch { banks = []; }

  const profile = {
    employmentProfile: c.employmentProfile,
    propertyType: c.propertyType,
    residency: c.residency,
    transactionType: c.transactionType,
    banks,
  };
  let added = 0;
  let sortOrder = (await db.caseDocument.aggregate({ where: { caseId }, _max: { sortOrder: true } }))._max.sortOrder ?? 0;
  for (const t of requiredTemplates(rules, profile)) {
    if (have.has(t.id)) continue;
    await db.caseDocument.create({
      data: {
        caseId,
        templateId: t.id,
        title: t.name,
        category: t.category,
        mandatory: t.mandatory,
        visibleToClient: t.visibleToClient,
        clientCanUpload: t.clientCanUpload,
        sortOrder: ++sortOrder,
      },
    });
    added++;
  }
  return added;
}

// Prisma row → DocRule DTO (duplicated shape here to avoid an import cycle
// with ser.ts; the JSON condition vectors are parsed into typed arrays).
type PrismaDocRuleRow = {
  id: number; code: string; name: string; category: string; validityDays: number; warnDays: number;
  verifyNotes: string; applicableEmployment: string; applicablePropertyType: string;
  applicableTransaction: string; applicableResidency: string; applicableBank?: string;
  mandatory: boolean;
  visibleToClient: boolean; clientCanUpload: boolean; expiryTrackingRequired: boolean; active: boolean;
};
function serToDocRule(d: PrismaDocRuleRow): DocRule {
  return {
    id: d.id, code: d.code, name: d.name, category: d.category,
    validityDays: d.validityDays, warnDays: d.warnDays, verifyNotes: d.verifyNotes,
    applicableEmployment: parseVec(d.applicableEmployment),
    applicablePropertyType: parseVec(d.applicablePropertyType),
    applicableTransaction: parseVec(d.applicableTransaction),
    applicableResidency: parseVec(d.applicableResidency),
    // MUST be read here too, not just in ser.ts: this local copy is the one the
    // vault engine actually evaluates, so omitting it would make the bank axis
    // silently inert while the admin UI happily saved it.
    applicableBank: parseVec(d.applicableBank ?? '["any"]'),
    mandatory: d.mandatory, visibleToClient: d.visibleToClient,
    clientCanUpload: d.clientCanUpload, expiryTrackingRequired: d.expiryTrackingRequired,
    active: d.active,
  };
}

// Re-export Vec so the admin UI and API can share the vocabulary.
export type { Vec };
