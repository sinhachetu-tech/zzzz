// POST /api/agent/lead — agent onboards a new lead (creates a case with the agent as partner).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentAgent } from "@/lib/agent-auth";
import { serCase } from "@/lib/ser";
import { syncCaseClients } from "@/lib/client-master";

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
      // The agent's form collects an email but LoanCase has no email column —
      // it lives on the Client master, which is written from profileJson. Write
      // it into the profile now (was silently dropped) so the team actually
      // sees the address the agent typed. syncCaseClients below promotes it.
      profileJson: JSON.stringify({
        primary: { fullName: name.trim(), phone: phone.trim(), email: email?.trim() || undefined },
      }),
    },
  });

  // Link the Client master so the lead's name/phone/email are queryable from
  // the Leads tab. Best-effort: a lead must still be creatable if this fails.
  await syncCaseClients(created.id).catch((e) => console.error("agent lead client sync failed:", e));

  await db.activity.create({
    data: { caseId: created.id, userId: 1, action: `agent ${me.name} onboarded lead: ${name.trim()}` },
  });

  // Re-read rather than serialising `created`: syncCaseClients writes clientId,
  // so the original object would report a null clientId to the agent's screen.
  const fresh = (await db.loanCase.findUnique({ where: { id: created.id } })) ?? created;
  return NextResponse.json({ case: serCase(fresh) });
}
