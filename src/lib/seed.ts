// Seed data for HFMC — mirrors the original demo dataset, adapted to Prisma.

import { db } from "./db";

const DAY = 86400000;
const ts = (daysBack: number, hourJitter = 0) =>
  new Date(Date.now() - daysBack * DAY - hourJitter * 3600000).toISOString();

const DESIGNATIONS = [
  { name: "Super Admin", scope: "all", issueTasks: true, admin: true, super: true, builtIn: true },
  { name: "Head of Company", scope: "all", issueTasks: true, admin: true, super: false, builtIn: true },
  { name: "PA to HoC", scope: "all", issueTasks: true, admin: false, super: false, builtIn: true },
  { name: "Mortgage Head", scope: "all", issueTasks: true, admin: true, super: false, builtIn: true },
  { name: "Team Leader SPO", scope: "team", issueTasks: true, admin: false, super: false, builtIn: true },
  { name: "Team Leader VRM", scope: "team", issueTasks: true, admin: false, super: false, builtIn: true },
  { name: "SPO", scope: "own", issueTasks: false, admin: false, super: false, builtIn: true },
  { name: "VRM", scope: "own", issueTasks: false, admin: false, super: false, builtIn: true },
];

const USERS = [
  { id: 11, name: "Salem Al Marri", email: "super@meridian.ae", password: "super123", role: "Super Admin", team: "Management", active: true, createdAt: ts(500) },
  { id: 1, name: "Rashid Al Falasi", email: "head@meridian.ae", password: "admin123", role: "Head of Company", team: "Management", active: true, createdAt: ts(400) },
  { id: 2, name: "Layla Al Hashimi", email: "pa@meridian.ae", password: "demo123", role: "PA to HoC", team: "Management", active: true, createdAt: ts(390) },
  { id: 3, name: "Omar Al Suwaidi", email: "omar@meridian.ae", password: "demo123", role: "Mortgage Head", team: "Management", active: true, createdAt: ts(360) },
  { id: 4, name: "Imran Khan", email: "imran@meridian.ae", password: "demo123", role: "Team Leader SPO", team: "Dubai", active: true, createdAt: ts(300) },
  { id: 5, name: "Aisha Al Zaabi", email: "aisha@meridian.ae", password: "demo123", role: "SPO", team: "Dubai", active: true, createdAt: ts(240) },
  { id: 6, name: "Fatima Al Mansoori", email: "fatima@meridian.ae", password: "demo123", role: "Team Leader VRM", team: "Abu Dhabi", active: true, createdAt: ts(230) },
  { id: 7, name: "Khalid Al Nahyan", email: "khalid@meridian.ae", password: "demo123", role: "VRM", team: "Abu Dhabi", active: true, createdAt: ts(180) },
  { id: 8, name: "Priya Sharma", email: "priya@meridian.ae", password: "demo123", role: "SPO", team: "Dubai", active: true, createdAt: ts(120) },
  { id: 9, name: "Ahmed Al Maktoum", email: "ahmed@meridian.ae", password: "demo123", role: "VRM", team: "Abu Dhabi", active: true, createdAt: ts(90) },
];

const STAGES = [
  { label: "WhatsApp Group Creation", sortOrder: 1 },
  { label: "Document Collection", sortOrder: 2 },
  { label: "Pre-Approval", sortOrder: 3 },
  { label: "Property Identification", sortOrder: 4 },
  { label: "MOU / FARD", sortOrder: 5 },
  { label: "Bank Submission", sortOrder: 6 },
  { label: "Valuation", sortOrder: 7 },
  { label: "Final Approval", sortOrder: 8 },
  { label: "Disbursement", sortOrder: 9 },
];

const BANKS = [
  { name: "ENBD", ratePct: 0.85, active: true },
  { name: "ADCB", ratePct: 1.0, active: true },
  { name: "FAB", ratePct: 0.9, active: true },
  { name: "Mashreq", ratePct: 0.95, active: true },
  { name: "HSBC", ratePct: 1.1, active: true },
  { name: "SCB", ratePct: 1.0, active: true },
  { name: "CBD", ratePct: 0.9, active: true },
  { name: "DIB", ratePct: 0.8, active: true },
  { name: "ADIB", ratePct: 0.85, active: true },
  { name: "UAB", ratePct: 0.9, active: true },
  { name: "RAK Bank", ratePct: 1.0, active: true },
  { name: "NBF", ratePct: 1.05, active: true },
];

const PARTNERS = [
  { kind: "Agent", name: "Faisal Properties", defaultSharePct: 20, active: true },
  { kind: "Agent", name: "Gulf Real Estate", defaultSharePct: 15, active: true },
  { kind: "Broker", name: "Prime Mortgage Brokers", defaultSharePct: 30, active: true },
  { kind: "Broker", name: "Emirates Finance Hub", defaultSharePct: 25, active: true },
  { kind: "Referral", name: "Dr. Saeed (existing client)", defaultSharePct: 10, active: true },
  { kind: "Referral", name: "Mr. Tariq (lawyer)", defaultSharePct: 10, active: true },
];

const WHY_PENDING = ["Documents awaited", "Bank query raised", "Valuation pending", "Internal review", "Client decision", "Title deed pending", "NOC pending", "Salary transfer pending"];
const WAITING_FOR = ["Client", "Bank", "Internal", "Partner", "Developer", "Valuer"];

const SLA_RULES = [
  { stage: "Document Collection", bank: null, maxDays: 5, active: true },
  { stage: "Pre-Approval", bank: null, maxDays: 3, active: true },
  { stage: "Bank Submission", bank: null, maxDays: 7, active: true },
  { stage: "Valuation", bank: null, maxDays: 4, active: true },
  { stage: "Final Approval", bank: "ENBD", maxDays: 5, active: true },
  { stage: "Final Approval", bank: null, maxDays: 6, active: true },
  { stage: "Disbursement", bank: null, maxDays: 3, active: true },
];

const CASES = [
  { caseNumber: "HFMC-0001", customer: "Mohammed Al Mansoori", banks: ["ENBD", "ADCB"], wonBank: null, loanAmount: 1850000, stage: "Document Collection", caseStatus: "Active" as const, ownerId: 5, source: "Direct" as const, partner: null, whatsapp: "+971501234567", waGroup: null, ageDays: 8 },
  { caseNumber: "HFMC-0002", customer: "Sara Al Rashid", banks: ["FAB"], wonBank: "FAB", loanAmount: 2400000, stage: "Disbursement", caseStatus: "Closed" as const, ownerId: 4, source: "Direct" as const, partner: null, whatsapp: "+971552345678", waGroup: "https://chat.whatsapp.com/abc", ageDays: 60 },
  { caseNumber: "HFMC-0003", customer: "John Mathews", banks: ["Mashreq", "HSBC"], wonBank: null, loanAmount: 1200000, stage: "Bank Submission", caseStatus: "Active" as const, ownerId: 7, source: "Agent" as const, partner: { kind: "Agent" as const, name: "Faisal Properties", sharePct: 20 }, whatsapp: "+971523456789", waGroup: null, ageDays: 14 },
  { caseNumber: "HFMC-0004", customer: "Aisha Al Suwaidi", banks: ["ADCB"], wonBank: null, loanAmount: 3500000, stage: "Valuation", caseStatus: "Active" as const, ownerId: 8, source: "Referral" as const, partner: { kind: "Referral" as const, name: "Dr. Saeed (existing client)", sharePct: 10 }, whatsapp: "+971534567890", waGroup: "https://chat.whatsapp.com/def", ageDays: 20 },
  { caseNumber: "HFMC-0005", customer: "Rahul Verma", banks: ["SCB", "CBD"], wonBank: null, loanAmount: 950000, stage: "Pre-Approval", caseStatus: "Active" as const, ownerId: 5, source: "Website" as const, partner: null, whatsapp: "+971545678901", waGroup: null, ageDays: 3 },
  { caseNumber: "HFMC-0006", customer: "Maryam Al Marri", banks: ["DIB"], wonBank: "DIB", loanAmount: 1600000, stage: "Disbursement", caseStatus: "Closed" as const, ownerId: 6, source: "Broker" as const, partner: { kind: "Broker" as const, name: "Prime Mortgage Brokers", sharePct: 30 }, whatsapp: "+971556789012", waGroup: null, ageDays: 75 },
  { caseNumber: "HFMC-0007", customer: "Vikram Patel", banks: ["ADIB", "ENBD"], wonBank: null, loanAmount: 2750000, stage: "MOU / FARD", caseStatus: "Active" as const, ownerId: 7, source: "Direct" as const, partner: null, whatsapp: "+971567890123", waGroup: "https://chat.whatsapp.com/ghi", ageDays: 12 },
  { caseNumber: "HFMC-0008", customer: "Fatima Al Zahra", banks: ["UAB"], wonBank: null, loanAmount: 800000, stage: "Document Collection", caseStatus: "Lost" as const, ownerId: 8, source: "Agent" as const, partner: { kind: "Agent" as const, name: "Gulf Real Estate", sharePct: 15 }, whatsapp: "+971578901234", waGroup: null, ageDays: 45 },
  { caseNumber: "HFMC-0009", customer: "Hassan Al Falasi", banks: ["RAK Bank"], wonBank: null, loanAmount: 4200000, stage: "Final Approval", caseStatus: "Active" as const, ownerId: 4, source: "Direct" as const, partner: null, whatsapp: "+971589012345", waGroup: "https://chat.whatsapp.com/jkl", ageDays: 25 },
  { caseNumber: "HFMC-0010", customer: "Lakshmi Nair", banks: ["NBF", "FAB"], wonBank: null, loanAmount: 1300000, stage: "Property Identification", caseStatus: "Active" as const, ownerId: 5, source: "Referral" as const, partner: { kind: "Referral" as const, name: "Mr. Tariq (lawyer)", sharePct: 10 }, whatsapp: "+971590123456", waGroup: null, ageDays: 5 },
  { caseNumber: "HFMC-0011", customer: "Abdullah Al Mheiri", banks: ["Mashreq"], wonBank: null, loanAmount: 2100000, stage: "Bank Submission", caseStatus: "Active" as const, ownerId: 7, source: "Direct" as const, partner: null, whatsapp: "+971501112233", waGroup: null, ageDays: 9 },
  { caseNumber: "HFMC-0012", customer: "Sunita Reddy", banks: ["HSBC", "ADCB"], wonBank: null, loanAmount: 1750000, stage: "WhatsApp Group Creation", caseStatus: "Active" as const, ownerId: 8, source: "Website" as const, partner: null, whatsapp: "+971502223344", waGroup: null, ageDays: 1 },
];

const TASK_SEED = [
  { caseId: 1, description: "Collect KYC & income documents", ownerId: 5, createdBy: 4, waitingFor: "Client", whyPending: "Documents awaited", dueDate: 2, status: "Open" as const },
  { caseId: 1, description: "Create WhatsApp group with client", ownerId: 5, createdBy: 5, waitingFor: "Internal", whyPending: "Internal review", dueDate: -2, status: "Open" as const },
  { caseId: 3, description: "Submit to Mashreq pre-approval", ownerId: 7, createdBy: 4, waitingFor: "Bank", whyPending: "Bank query raised", dueDate: 1, status: "Open" as const },
  { caseId: 3, description: "Verify agent share agreement", ownerId: 4, createdBy: 4, waitingFor: "Partner", whyPending: "Internal review", dueDate: 4, status: "Open" as const },
  { caseId: 4, description: "Chase bank valuation report", ownerId: 8, createdBy: 6, waitingFor: "Valuer", whyPending: "Valuation pending", dueDate: 0, status: "Open" as const },
  { caseId: 5, description: "Run affordability calculator", ownerId: 5, createdBy: 5, waitingFor: "Internal", whyPending: "Internal review", dueDate: -1, status: "Open" as const },
  { caseId: 7, description: "Draft MOU and send to client", ownerId: 7, createdBy: 6, waitingFor: "Client", whyPending: "Documents awaited", dueDate: 3, status: "Open" as const },
  { caseId: 9, description: "Follow up RAK Bank final offer letter", ownerId: 4, createdBy: 4, waitingFor: "Bank", whyPending: "Bank query raised", dueDate: 5, status: "Open" as const },
  { caseId: 9, description: "Confirm property valuation matches sale price", ownerId: 4, createdBy: 1, waitingFor: "Internal", whyPending: "Valuation pending", dueDate: 2, status: "Open" as const },
  { caseId: 10, description: "Shortlist properties in budget", ownerId: 5, createdBy: 5, waitingFor: "Client", whyPending: "Client decision", dueDate: 7, status: "Open" as const },
  { caseId: 11, description: "Submit application to Mashreq", ownerId: 7, createdBy: 4, waitingFor: "Bank", whyPending: "Documents awaited", dueDate: 4, status: "Open" as const },
  { caseId: 12, description: "Onboard client to portal", ownerId: 8, createdBy: 8, waitingFor: "Internal", whyPending: "Internal review", dueDate: 6, status: "Open" as const },
  { caseId: 2, description: "Coordinate disbursement with developer", ownerId: 4, createdBy: 1, waitingFor: "Developer", whyPending: "NOC pending", dueDate: -30, status: "Done" as const },
  { caseId: 6, description: "Obtain final NOC from developer", ownerId: 6, createdBy: 3, waitingFor: "Developer", whyPending: "NOC pending", dueDate: -40, status: "Done" as const },
];

const BULLETIN_TODAY = [
  { issuedBy: 1, task: "Push Mohammed Al Mansoori (HFMC-0001) — documents 2 days overdue.", caseId: 1, targets: [4, 5] },
  { issuedBy: 1, task: "Confirm Mashreq submission status for John Mathews (HFMC-0003).", caseId: 3, targets: [7] },
  { issuedBy: 3, task: "All SPOs: clear your Open queue before EOD — 3 files are At Risk.", caseId: null, targets: [5, 8] },
  { issuedBy: 4, task: "Rahul Verma (HFMC-0005) — run affordability and report back.", caseId: 5, targets: [5] },
  { issuedBy: 6, task: "Aisha Al Suwaidi (HFMC-0004) valuation due today — escalate if no response.", caseId: 4, targets: [8] },
];

export async function seedDatabase() {
  // Only seed if empty
  const userCount = await db.user.count();
  if (userCount > 0) {
    return { skipped: true, reason: "database already has data" };
  }

  for (const d of DESIGNATIONS) {
    await db.designation.create({ data: d });
  }

  for (const u of USERS) {
    await db.user.create({ data: { ...u, createdAt: new Date(u.createdAt) } });
  }

  for (const s of STAGES) {
    await db.stageItem.create({ data: { ...s, active: true } });
  }

  for (const b of BANKS) {
    await db.bankItem.create({ data: b });
  }

  for (const p of PARTNERS) {
    await db.partnerItem.create({ data: p });
  }

  for (const w of WHY_PENDING) {
    await db.masterItem.create({ data: { kind: "whyPending", label: w, active: true } });
  }
  for (const w of WAITING_FOR) {
    await db.masterItem.create({ data: { kind: "waitingFor", label: w, active: true } });
  }

  for (const s of SLA_RULES) {
    await db.slaRule.create({ data: s });
  }

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
    // activity: case opened
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

  return { seeded: true, counts: { users: USERS.length, cases: CASES.length, tasks: TASK_SEED.length } };
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function daysAgo(n: number): string {
  return toISODate(new Date(Date.now() + n * DAY));
}
