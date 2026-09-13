// GET /api/agent/state — returns the agent's referred cases + commission breakdown.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentAgent } from "@/lib/agent-auth";
import { serCase } from "@/lib/ser";
import { commissionFor } from "@/lib/format";

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

  return NextResponse.json({
    me,
    cases: casesWithCommission,
    stages: stages.map((s) => ({ id: s.id, label: s.label, sortOrder: s.sortOrder })),
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
