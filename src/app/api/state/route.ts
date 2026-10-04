// GET /api/state — hydrate the frontend with everything the current user can see.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import {
  visibleCases, visibleTasks, bulletinVisible, computeEscalations,
} from "@/lib/domain";
import {
  serUser, serCase, serTask, serActivity, serBank, serPartner, serStage,
  serMaster, serSla, serInstruction, serBulletin, serChannel, serDocRule, serFeeRule,
  serStageTransitionDto, serCaseDocument, serCaseUpdate, serProposal, serBankProduct, serClient, serCommTemplate, serPromotion,
} from "@/lib/ser";
import { caseStatusOf } from "@/lib/format";

export async function GET() {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const flags = await flagsFor(me);

  // ── Batch 1: core entities (people, cases, tasks, workflow) ──────────────
  const [users, designations, cases, tasks, stages, masters] = await Promise.all([
    db.user.findMany({ orderBy: { id: "asc" } }),
    db.designation.findMany({ orderBy: { id: "asc" } }),
    db.loanCase.findMany({ orderBy: { id: "asc" } }),
    db.task.findMany({ orderBy: { id: "asc" } }),
    db.stageItem.findMany({ orderBy: { sortOrder: "asc" }, include: { steps: { orderBy: { sortOrder: "asc" } } } }),
    db.masterItem.findMany({ orderBy: { id: "asc" } }),
  ]);

  // ── Batch 2: reference data ───────────────────────────────────────────────
  const [banks, partners, channels, slaRules, docRules, feeRules] = await Promise.all([
    db.bankItem.findMany({ orderBy: { id: "asc" } }),
    db.partnerItem.findMany({ orderBy: { id: "asc" } }),
    db.channelItem.findMany({ orderBy: { id: "asc" } }),
    db.slaRule.findMany({ orderBy: { id: "asc" } }),
    db.docRule.findMany({ orderBy: { id: "asc" } }),
    db.feeRule.findMany({ orderBy: [{ emirate: "asc" }, { sortOrder: "asc" }] }),
  ]);

  // ── Batch 3: activity & comms ─────────────────────────────────────────────
  const [activities, instructions, bulletinsRaw, commTemplates, eiborRates] = await Promise.all([
    db.activity.findMany({ orderBy: { at: "desc" }, take: 200 }),
    db.instruction.findMany({ orderBy: { id: "asc" }, include: { replies: true } }),
    db.bulletinItem.findMany({ orderBy: { id: "asc" }, include: { targets: true, replies: true } }),
    db.commTemplate.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    db.eiborRate.findMany(),
  ]);

  // ── Batch 4: case-level data ──────────────────────────────────────────────
  const [stageTransitions, allDocs, caseUpdates, caseProposals] = await Promise.all([
    db.stageTransition.findMany({ orderBy: { at: "desc" }, take: 400, include: { user: { select: { name: true } } } }),
    db.caseDocument.findMany({ orderBy: [{ caseId: "asc" }, { sortOrder: "asc" }] }),
    db.caseUpdate.findMany({ orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 1000, include: { author: { select: { name: true } } } }),
    db.proposal.findMany({ orderBy: { version: "desc" }, include: { author: { select: { name: true } } } }),
  ]);

  // ── Batch 5: extras (tolerate missing tables) ─────────────────────────────
  const [bankProducts, emails, unmatched, clients, promotions] = await Promise.all([
    db.bankProduct.findMany({ orderBy: [{ bankId: "asc" }, { id: "asc" }], include: { bank: { select: { name: true } } } }),
    db.emailLog.findMany({ orderBy: { receivedAt: "desc" }, take: 100 }).catch(() => []),
    db.unmatchedEmail.findMany({ where: { status: "Pending" }, orderBy: { receivedAt: "desc" } }).catch(() => []),
    db.client.findMany({ orderBy: { id: "asc" } }),
    db.promotion.findMany({ orderBy: [{ validFrom: "desc" }, { id: "asc" }] }).catch(() => []),
  ]);

  const usersDto = users.map(serUser);
  const casesDto = cases.map(serCase);
  const tasksDto = tasks.map(serTask);
  const meFull = usersDto.find((u) => u.id === me.id)!;

  const visible = visibleCases(casesDto, usersDto, meFull, flags);
  const visibleTasksList = visibleTasks(tasksDto, casesDto, usersDto, meFull, flags);
  const escalations = computeEscalations(visible, slaRules);

  // Revenue is restricted: without the designation's viewRevenue permission the
  // commission ingredients (bank rates, channel cuts, partner shares) are zeroed
  // server-side, so no client can compute earnings from the state it receives.
  const banksDto = flags.viewRevenue
    ? banks.map(serBank)
    : banks.map((b) => ({ ...serBank(b), ratePct: 0 }));
  const channelsDto = flags.viewRevenue
    ? channels.map(serChannel)
    : channels.map((ch) => ({ ...serChannel(ch), commissionPct: 0 }));
  const visibleIds = new Set(visible.map((c) => c.id));
  const vaultDocs = allDocs.filter((d) => visibleIds.has(d.caseId)).map(serCaseDocument);
  const scopedCases = flags.viewRevenue
    ? casesDto
    : casesDto.map((c) => (c.partner ? { ...c, partner: { ...c.partner, sharePct: 0 } } : c));

  const bulletinsDto = bulletinsRaw
    .map(serBulletin)
    .filter((b) => bulletinVisible(b, meFull, usersDto, flags));

  return NextResponse.json({
    me,
    flags,
    users: usersDto,
    designations,
    cases: scopedCases,
    visibleCaseIds: visible.map((c) => c.id),
    tasks: tasksDto,
    visibleTaskIds: visibleTasksList.map((t) => t.id),
    activities: activities.map(serActivity),
    stages: stages.map(serStage),
    whyPending: masters.filter((m) => m.kind === "whyPending").map(serMaster),
    waitingFor: masters.filter((m) => m.kind === "waitingFor").map(serMaster),
    milestoneDates: masters.filter((m) => m.kind === "milestoneDate").map(serMaster),
    banks: banksDto,
    channels: channelsDto,
    partners: partners.map(serPartner),
    slaRules: slaRules.map(serSla),
    instructions: instructions.map(serInstruction),
    bulletin: bulletinsDto,
    escalations: escalations.length,
    docRules: docRules.map(serDocRule),
    bankProducts: bankProducts.map(serBankProduct),
    eibor: eiborRates,
    caseUpdates: caseUpdates.map(serCaseUpdate),
    caseProposals: caseProposals.map(serProposal),
    feeRules: feeRules.map(serFeeRule),
    stageTransitions: stageTransitions.map(serStageTransitionDto),
    caseDocuments: vaultDocs,
    clients: clients.map(serClient),
    commTemplates: commTemplates.map(serCommTemplate),
    promotions: promotions.map(serPromotion),
  });
}
