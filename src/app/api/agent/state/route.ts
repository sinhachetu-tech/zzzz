// GET /api/agent/state — returns the agent's referred cases + commission breakdown + profile.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentAgent } from "@/lib/agent-auth";
import { serCase } from "@/lib/ser";
import { commissionFor } from "@/lib/format";
import { getPortalSettings } from "@/lib/portal-settings";

export async function GET() {
  const me = await currentAgent();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Find all cases where this partner is the lead source
  const cases = await db.loanCase.findMany({
    where: { partnerName: me.name },
    orderBy: { createdAt: "desc" },
  });

  const banks = await db.bankItem.findMany();
  const stages = await db.stageItem.findMany({ orderBy: { sortOrder: "asc" }, where: { active: true } });
  const partner = await db.partnerItem.findFirst({ where: { name: me.name, kind: me.kind } });

  const casesDto = cases.map(serCase);
  const casesWithCommission = casesDto.map((c) => {
    const m = commissionFor(c, banks);
    return { ...c, commission: m };
  });

  const active = casesWithCommission.filter((c) => c.caseStatus === "Active");
  const booked = casesWithCommission.filter((c) => c.caseStatus === "Closed");
  const lost = casesWithCommission.filter((c) => c.caseStatus === "Lost");

  const totalCommissionEarned = booked.reduce((s, c) => s + (c.commission.partnerCut || 0), 0);
  const totalPipelineValue = active.reduce((s, c) => s + c.loanAmount, 0);
  const projectedCommission = active.reduce((s, c) => s + (c.commission.partnerCut || 0), 0);

  // HFMC staff representative shown on the agent's home card — Admin → Portal
  // settings. Name + number always paired from one staff record; falls back to
  // the legacy free-text desk name/phone when no staff is picked.
  const settings = await getPortalSettings();
  let desk: { name: string; phone: string | null } = { name: settings.agentDeskName, phone: settings.agentDeskPhone || null };
  if (settings.agentDeskUserId) {
    const deskUser = await db.user.findUnique({ where: { id: settings.agentDeskUserId } });
    if (deskUser?.active) desk = { name: deskUser.name, phone: deskUser.phone };
  }

  return NextResponse.json({
    me,
    cases: casesWithCommission,
    stages: stages.map((s) => ({ id: s.id, label: s.label, sortOrder: s.sortOrder })),
    desk,
    profile: partner && {
      sharePct: partner.defaultSharePct,
      email: partner.email ?? "",
      phone: partner.phone ?? "",
      about: partner.about ?? "",
      expertise: partner.expertise ?? "",
      iban: partner.iban ?? "",
      ibanVerified: partner.ibanVerified,
      licenseNo: partner.licenseNo ?? "",
      licenseVerified: partner.licenseVerified,
      avatarData: partner.avatarData ?? "",
    },
    banks: banks.filter((b) => b.active).map((b) => ({ name: b.name, ratePct: b.ratePct })),
    stats: {
      activeCount: active.length,
      bookedCount: booked.length,
      lostCount: lost.length,
      totalPipelineValue,
      totalCommissionEarned,
      projectedCommission,
    },
  });
}
