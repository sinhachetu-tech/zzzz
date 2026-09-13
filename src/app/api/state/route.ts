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
  serStageTransitionDto, serCaseDocument, serBankProduct,
} from "@/lib/ser";
import { caseStatusOf } from "@/lib/format";

export async function GET() {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const flags = await flagsFor(me);

  const [
    users, designations, cases, tasks, activities, stages, masters, banks,
    partners, slaRules, instructions, bulletinsRaw, channels, docRules, feeRules, stageTransitions, allDocs, bankProducts,
  ] = await Promise.all([
    db.user.findMany({ orderBy: { id: "asc" } }),
    db.designation.findMany({ orderBy: { id: "asc" } }),
    db.loanCase.findMany({ orderBy: { id: "asc" } }),
    db.task.findMany({ orderBy: { id: "asc" } }),
    db.activity.findMany({ orderBy: { at: "desc" }, take: 200 }),
    db.stageItem.findMany({ orderBy: { sortOrder: "asc" } }),
    db.masterItem.findMany({ orderBy: { id: "asc" } }),
    db.bankItem.findMany({ orderBy: { id: "asc" } }),
    db.partnerItem.findMany({ orderBy: { id: "asc" } }),
    db.slaRule.findMany({ orderBy: { id: "asc" } }),
    db.instruction.findMany({ orderBy: { id: "asc" }, include: { replies: true } }),
    db.bulletinItem.findMany({ orderBy: { id: "asc" }, include: { targets: true, replies: true } }),
    db.channelItem.findMany({ orderBy: { id: "asc" } }),
    db.docRule.findMany({ orderBy: { id: "asc" } }),
    db.feeRule.findMany({ orderBy: [{ emirate: "asc" }, { sortOrder: "asc" }] }),
    db.stageTransition.findMany({ orderBy: { at: "desc" }, take: 400, include: { user: { select: { name: true } } } }),
    db.caseDocument.findMany({ orderBy: [{ caseId: "asc" }, { sortOrder: "asc" }] }),
    db.bankProduct.findMany({ orderBy: [{ bankId: "asc" }, { id: "asc" }], include: { bank: { select: { name: true } } } }),
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
    banks: banksDto,
    channels: channelsDto,
    partners: partners.map(serPartner),
    slaRules: slaRules.map(serSla),
    instructions: instructions.map(serInstruction),
    bulletin: bulletinsDto,
    escalations: escalations.length,
    docRules: docRules.map(serDocRule),
    bankProducts: bankProducts.map(serBankProduct),
    feeRules: feeRules.map(serFeeRule),
    stageTransitions: stageTransitions.map(serStageTransitionDto),
    caseDocuments: vaultDocs,
  });
}
