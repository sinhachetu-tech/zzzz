// HFMC seeding — all demo/master data lives in src/data/seed/*.json.
// No data arrays in code: this module only orchestrates writes.
// Behaviour: full seed when the DB is empty; idempotent master-data top-up
// (create-if-missing, never overwrites admin edits) when it already has data.

import { db } from "./db";
import designationsJson from "@/data/seed/designations.json";
import usersJson from "@/data/seed/users.json";
import stagesJson from "@/data/seed/stages.json";
import banksJson from "@/data/seed/banks.json";
import partnersJson from "@/data/seed/partners.json";
import mastersJson from "@/data/seed/masters.json";
import slaRulesJson from "@/data/seed/slaRules.json";
import docRulesJson from "@/data/seed/docRules.json";
import feeRulesJson from "@/data/seed/feeRules.json";
import casesJson from "@/data/seed/cases.json";
import tasksJson from "@/data/seed/tasks.json";
import bulletinsJson from "@/data/seed/bulletins.json";
import bankProductsJson from "@/data/seed/bankProducts.json";
import bankIntelJson from "@/data/seed/bankIntel.json";
import bankProductsAllJson from "@/data/seed/bankProductsAll.json";
import eiborJson from "@/data/seed/eibor.json";

const DAY = 86400000;
const ts = (daysBack: number, hourJitter = 0) =>
  new Date(Date.now() - daysBack * DAY - hourJitter * 3600000).toISOString();
const toISODate = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const daysAgo = (n: number) => toISODate(new Date(Date.now() + n * DAY));

const DESIGNATIONS = designationsJson as Array<{ name: string; scope: string; issueTasks: boolean; admin: boolean; super: boolean; viewRevenue?: boolean; builtIn: boolean }>;
const USERS = usersJson as Array<{ id: number; name: string; email: string; password: string; role: string; team: string; active: boolean; createdAt: string }>;
const STAGES = stagesJson as Array<{ label: string; sortOrder: number }>;
const BANKS = banksJson as Array<{ name: string; ratePct: number; active: boolean }>;
const PARTNERS = partnersJson as Array<{ kind: string; name: string; defaultSharePct: number; active: boolean }>;
const MASTERS = mastersJson as { whyPending: string[]; waitingFor: string[] };
const SLA_RULES = slaRulesJson as Array<{ stage: string; bank: string | null; maxDays: number; active: boolean }>;
const DOC_RULES = docRulesJson as Array<Record<string, unknown>>;
const FEE_RULES = feeRulesJson as Array<Record<string, unknown>>;
const CASES = casesJson as Array<{
  caseNumber: string; customer: string; banks: string[]; wonBank: string | null; loanAmount: number;
  stage: string; caseStatus: "Active" | "Closed" | "Lost"; ownerId: number;
  source: "Direct" | "Agent" | "Broker" | "Website" | "Referral";
  partner: { kind: "Agent" | "Broker" | "Referral"; name: string; sharePct: number } | null;
  whatsapp: string; waGroup: string | null; ageDays: number;
}>;
const TASK_SEED = tasksJson as Array<{
  caseId: number; description: string; ownerId: number; createdBy: number; waitingFor: string;
  whyPending: string; dueDate: number; status: "Open" | "Done";
}>;
const BULLETIN_TODAY = bulletinsJson as Array<{ issuedBy: number; task: string; caseId: number | null; targets: number[] }>;
const BANK_PRODUCTS_SEED = bankProductsJson as Array<Record<string, unknown> & { bankName: string }>;
const BANK_INTEL = bankIntelJson as Record<string, { pos: string; neg: string }>;
const BANK_PRODUCTS_ALL = bankProductsAllJson as Array<Record<string, unknown> & { bankName: string; stressBufferPct?: number | null }>;
const EIBOR = eiborJson as Array<{ tenor: string; ratePct: number; updatedOn: string; note: string }>;

export async function seedDatabase() {
  const userCount = await db.user.count();
  if (userCount === 0) {
    await fullSeed();
  }
  const ensured = await ensureMasterData();
  return userCount === 0
    ? { seeded: true, counts: { users: USERS.length, cases: CASES.length, tasks: TASK_SEED.length }, ...ensured }
    : { skipped: true, reason: "database already has data", ...ensured };
}

/* ---------------- full seed (empty database) ---------------- */

async function fullSeed() {
  for (const d of DESIGNATIONS) {
    await db.designation.create({ data: { ...d, viewRevenue: d.viewRevenue ?? false } as never });
  }
  for (const u of USERS) {
    await db.user.create({ data: { ...u, createdAt: new Date(u.createdAt) } as never });
  }
  for (const s of STAGES) await db.stageItem.create({ data: { ...s, active: true } });
  for (const b of BANKS) await db.bankItem.create({ data: b });
  for (const p of PARTNERS) await db.partnerItem.create({ data: p });
  for (const w of MASTERS.whyPending) await db.masterItem.create({ data: { kind: "whyPending", label: w, active: true } });
  for (const w of MASTERS.waitingFor) await db.masterItem.create({ data: { kind: "waitingFor", label: w, active: true } });
  for (const s of SLA_RULES) await db.slaRule.create({ data: s });
  for (const d of DOC_RULES) await db.docRule.create({ data: d as never });
  for (const f of FEE_RULES) await db.feeRule.create({ data: f as never });

  for (const c of CASES) {
    const created = await db.loanCase.create({
      data: {
        caseNumber: c.caseNumber,
        customer: c.customer,
        banks: JSON.stringify(c.banks),
        wonBank: c.wonBank,
        loanAmount: c.loanAmount,
        stage: c.stage,
        caseStatus: c.caseStatus,
        closedDate: c.caseStatus === "Closed" ? ts(c.ageDays - 10) : null,
        ownerId: c.ownerId,
        source: c.source,
        partnerKind: c.partner?.kind ?? null,
        partnerName: c.partner?.name ?? null,
        partnerSharePct: c.partner?.sharePct ?? null,
        whatsapp: c.whatsapp,
        waGroup: c.waGroup,
        createdAt: ts(c.ageDays),
        updatedAt: ts(Math.max(0, c.ageDays - 2)),
      },
    });
    await db.activity.create({
      data: { caseId: created.id, userId: c.ownerId, at: ts(c.ageDays), action: "opened case" },
    });
    if (c.caseStatus === "Closed") {
      await db.activity.create({
        data: { caseId: created.id, userId: c.ownerId, at: ts(c.ageDays - 10), action: `marked Closed (won by ${c.wonBank})` },
      });
    }
    if (c.caseStatus === "Lost") {
      await db.activity.create({
        data: { caseId: created.id, userId: c.ownerId, at: ts(c.ageDays - 5), action: "marked Lost" },
      });
    }
  }

  for (const t of TASK_SEED) {
    await db.task.create({
      data: {
        caseId: t.caseId,
        description: t.description,
        ownerId: t.ownerId,
        createdBy: t.createdBy,
        waitingFor: t.waitingFor,
        whyPending: t.whyPending,
        dueDate: daysAgo(-t.dueDate),
        status: t.status,
        completedAt: t.status === "Done" ? ts(Math.abs(t.dueDate) + 1) : null,
        createdAt: ts(7),
        remarks: t.status === "Done" ? "Completed." : "",
      },
    });
  }

  const today = toISODate(new Date());
  for (const b of BULLETIN_TODAY) {
    await db.bulletinItem.create({
      data: {
        date: today,
        issuedBy: b.issuedBy,
        task: b.task,
        caseId: b.caseId,
        status: "Open",
        createdAt: ts(0),
        targets: { create: b.targets.map((userId) => ({ userId })) },
      },
    });
  }
}

/* ---------------- idempotent master-data top-up ---------------- */

// Create-if-missing only — never overwrites admin edits. Runs on every seed
// call so existing installs pick up rule catalogs without a wipe.
async function ensureMasterData() {
  let docRules = 0, feeRules = 0, slaRules = 0, bankProducts = 0;

  if ((await db.docRule.count()) === 0) {
    for (const d of DOC_RULES) await db.docRule.create({ data: d as never });
    docRules = DOC_RULES.length;
  }
  if ((await db.feeRule.count()) === 0) {
    for (const f of FEE_RULES) await db.feeRule.create({ data: f as never });
    feeRules = FEE_RULES.length;
  }
  for (const s of SLA_RULES) {
    const exists = await db.slaRule.findFirst({ where: { stage: s.stage, bank: null } });
    if (!exists) {
      await db.slaRule.create({ data: s });
      slaRules++;
    }
  }
  // "Lead" stage — self-registrations from the client portal land here
  const lead = await db.stageItem.findFirst({ where: { label: "Lead" } });
  if (!lead) await db.stageItem.create({ data: { label: "Lead", active: true, sortOrder: 0 } });

  // Bank rule products — phase 0 banks (DIB + ENBD), decoded from the workbooks
  if ((await db.bankProduct.count()) === 0) {
    for (const p of BANK_PRODUCTS_SEED) {
      const bank = await db.bankItem.findFirst({ where: { name: p.bankName } });
      if (!bank) continue;
      await db.bankProduct.create({
        data: {
          bankId: bank.id, name: p.name as string, sheet: p.sheet as string, employment: p.employment as string,
          residency: p.residency as string, financeType: p.financeType as string, program: p.program as string, loanKind: p.loanKind as string,
          maxLtvNational: p.maxLtvNational as number | null,
          maxLtvExpatriate: p.maxLtvExpatriate as number | null,
          minLoan: p.minLoan as number | null, maxLoan: p.maxLoan as number | null,
          tenorYears: p.tenorYears as number | null, minSalary: p.minSalary as number | null,
          totalTatDays: p.totalTatDays as number | null, paTatDays: p.paTatDays as number | null,
          paValidityDays: p.paValidityDays as number | null, folValidityDays: p.folValidityDays as number | null,
          valuationValidityDays: p.valuationValidityDays as number | null,
          rateTable: p.rateTable as string, stressTest: p.stressTest as string, fees: p.fees as string,
          insurance: p.insurance as string, eligibility: p.eligibility as string, documents: p.documents as string,
          axesJson: p.axesJson as string, sourceFiles: p.sourceFiles as string,
          cardRulePct: p.cardRulePct as number | null, bonusPct: p.bonusPct as number | null,
          rentalIncomePct: p.rentalIncomePct as number | null, rentalCapPctOfSalary: p.rentalCapPctOfSalary as number | null,
          dbrPct: p.dbrPct as number | null,
          pricingJson: (p.pricing as string) ?? "{}",
          status: "approved", approvedBy: "Excel import (Sep 2026)", effectiveDate: "2026-09-01",
        },
      });
    }
    bankProducts = BANK_PRODUCTS_SEED.length;
  } else {
    // backfill structured pricing for products imported before pricingJson existed
    for (const p of BANK_PRODUCTS_SEED) {
      if (!p.pricing || p.pricing === "{}") continue;
      const bank = await db.bankItem.findFirst({ where: { name: p.bankName } });
      if (!bank) continue;
      await db.bankProduct.updateMany({
        where: { bankId: bank.id, name: p.name as string },
        data: {
          pricingJson: p.pricing as string,
          cardRulePct: p.cardRulePct as number | null, bonusPct: p.bonusPct as number | null,
          rentalIncomePct: p.rentalIncomePct as number | null, rentalCapPctOfSalary: p.rentalCapPctOfSalary as number | null,
          dbrPct: p.dbrPct as number | null,
        },
      });
    }
  }
  // Full bank universe — decode-all drafts (create-if-missing by bank+name)
  for (const p of BANK_PRODUCTS_ALL) {
    let bank = await db.bankItem.findFirst({ where: { name: p.bankName } });
    if (!bank) bank = await db.bankItem.create({ data: { name: p.bankName, ratePct: 0, active: true } });
    const exists = await db.bankProduct.findFirst({ where: { bankId: bank.id, name: p.name } });
    if (!exists) {
      await db.bankProduct.create({
        data: {
          bankId: bank.id, name: p.name, sheet: p.sheet as string, employment: p.employment as string,
          residency: p.residency as string, financeType: p.financeType as string, program: p.program as string, loanKind: p.loanKind as string,
          maxLtvNational: p.maxLtvNational as number | null, maxLtvExpatriate: p.maxLtvExpatriate as number | null,
          minLoan: p.minLoan as number | null, maxLoan: p.maxLoan as number | null,
          tenorYears: p.tenorYears as number | null, minSalary: p.minSalary as number | null,
          totalTatDays: p.totalTatDays as number | null, paTatDays: p.paTatDays as number | null,
          paValidityDays: p.paValidityDays as number | null, folValidityDays: p.folValidityDays as number | null,
          valuationValidityDays: p.valuationValidityDays as number | null,
          rateTable: p.rateTable as string, stressTest: p.stressTest as string, fees: p.fees as string,
          insurance: p.insurance as string, eligibility: p.eligibility as string, documents: p.documents as string,
          axesJson: p.axesJson as string, sourceFiles: p.sourceFiles as string,
          stressBufferPct: p.stressBufferPct as number | null,
          status: "draft", notes: "Draft decode — structured pricing quotes pending review",
        },
      });
    }
  }

  // EIBOR benchmark curve — upsert by tenor
  for (const e of EIBOR) {
    await db.eiborRate.upsert({ where: { tenor: e.tenor }, create: e, update: { ratePct: e.ratePct, updatedOn: e.updatedOn, note: e.note } });
  }
  // negotiating intel onto the bank profile
  for (const [bankName, it] of Object.entries(BANK_INTEL)) {
    const bank = await db.bankItem.findFirst({ where: { name: bankName } });
    if (bank && !bank.posPoints && !bank.negPoints) {
      await db.bankItem.update({ where: { id: bank.id }, data: { posPoints: it.pos, negPoints: it.neg } });
    }
  }
  return { ensured: { docRules, feeRules, slaRules, bankProducts } };
}
