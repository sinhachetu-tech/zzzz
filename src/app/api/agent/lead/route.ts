// POST /api/agent/lead — agent onboards a new lead (creates a case with the agent as partner).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentAgent } from "@/lib/agent-auth";
import { serCase } from "@/lib/ser";

export async function POST(req: NextRequest) {
  const me = await currentAgent();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { name, phone, email, description } = await req.json() as {
    name?: string; phone?: string; email?: string; description?: string;
  };

  if (!name?.trim()) return NextResponse.json({ error: "Client name is required." }, { status: 400 });
  if (!phone?.trim()) return NextResponse.json({ error: "Phone number is required." }, { status: 400 });

  const count = await db.loanCase.count();
  const caseNumber = `HFMC-${String(count + 1).padStart(4, "0")}`;

  // The agent IS the partner — the case is sourced through them.
  // Find the partner record to get the default share %.
  const partner = await db.partnerItem.findFirst({ where: { name: me.name, kind: me.kind } });

  const created = await db.loanCase.create({
    data: {
      caseNumber,
      customer: name.trim(),
      banks: JSON.stringify([]),
      loanAmount: 0,
      stage: "Lead",
      caseStatus: "Active",
      ownerId: 1, // head of company picks up and assigns
      source: me.kind as "Agent" | "Broker" | "Referral",
      partnerKind: me.kind,
      partnerName: me.name,
      partnerSharePct: partner?.defaultSharePct ?? 10,
      whatsapp: phone.trim(),
      statusNote: description?.trim() || `Lead onboarded by ${me.name} (${me.kind}).`,
      transactionType: "",
      propertyLocation: null,
      coApplicantName: null,
    },
  });

  await db.activity.create({
    data: { caseId: created.id, userId: 1, action: `agent ${me.name} onboarded lead: ${name.trim()}` },
  });

  return NextResponse.json({ case: serCase(created) });
}
