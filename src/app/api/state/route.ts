// GET /api/state — hydrate the frontend with everything the current user can see.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import {
  visibleCases, visibleTasks, bulletinVisible, computeEscalations,
} from "@/lib/domain";
import {
  serUser, serCase, serTask, serActivity, serBank, serPartner, serStage,
  serMaster, serSla, serInstruction, serBulletin, serEmail, serUnmatchedEmail,
} from "@/lib/ser";
import { caseStatusOf } from "@/lib/format";

export async function GET() {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const flags = await flagsFor(me);

  const [
    users, designations, cases, tasks, activities, stages, masters, banks,
    partners, slaRules, instructions, bulletinsRaw, emails, unmatchedEmails,
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
    db.emailLog.findMany({ orderBy: { receivedAt: "desc" }, take: 500 }),
    db.unmatchedEmail.findMany({ orderBy: { receivedAt: "desc" }, where: { status: "Pending" } }),
  ]);

  const usersDto = users.map(serUser);
  const casesDto = cases.map(serCase);
  const tasksDto = tasks.map(serTask);
  const meFull = usersDto.find((u) => u.id === me.id)!;

  const visible = visibleCases(casesDto, usersDto, meFull, flags);
  const visibleTasksList = visibleTasks(tasksDto, casesDto, usersDto, meFull, flags);
  const escalations = computeEscalations(visible, slaRules);

  const bulletinsDto = bulletinsRaw
    .map(serBulletin)
    .filter((b) => bulletinVisible(b, meFull, usersDto, flags));

  return NextResponse.json({
    me,
    flags,
    users: usersDto,
    designations,
    cases: casesDto,
    visibleCaseIds: visible.map((c) => c.id),
    tasks: tasksDto,
    visibleTaskIds: visibleTasksList.map((t) => t.id),
    activities: activities.map(serActivity),
    stages: stages.map(serStage),
    whyPending: masters.filter((m) => m.kind === "whyPending").map(serMaster),
    waitingFor: masters.filter((m) => m.kind === "waitingFor").map(serMaster),
    banks: banks.map(serBank),
    partners: partners.map(serPartner),
    slaRules: slaRules.map(serSla),
    instructions: instructions.map(serInstruction),
    bulletin: bulletinsDto,
    emails: emails.map(serEmail),
    unmatchedEmails: unmatchedEmails.map(serUnmatchedEmail),
    escalations: escalations.length,
  });
}
