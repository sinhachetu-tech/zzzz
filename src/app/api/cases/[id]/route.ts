// PATCH /api/cases/:id — update a case (stage, status, wonBank, owner, partner, banks, etc.)
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { serCase } from "@/lib/ser";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const caseId = parseInt(id, 10);
  const body = await req.json();

  const existing = await db.loanCase.findUnique({ where: { id: caseId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  const actions: string[] = [];

  if (body.stage && body.stage !== existing.stage) {
    data.stage = body.stage;
    actions.push(`stage → ${body.stage}`);
  }
  if (body.caseStatus && body.caseStatus !== existing.caseStatus) {
    data.caseStatus = body.caseStatus;
    if (body.caseStatus === "Closed" || body.caseStatus === "Lost") {
      data.closedDate = new Date().toISOString().slice(0, 10);
    }
    actions.push(`status → ${body.caseStatus}`);
  }
  if (body.wonBank !== undefined && body.wonBank !== existing.wonBank) {
    data.wonBank = body.wonBank;
    actions.push(body.wonBank ? `won by ${body.wonBank}` : "cleared winning bank");
  }
  if (body.ownerId !== undefined && body.ownerId !== existing.ownerId) {
    data.ownerId = body.ownerId;
    const u = await db.user.findUnique({ where: { id: body.ownerId } });
    actions.push(`owner → ${u?.name ?? body.ownerId}`);
  }
  if (body.banks !== undefined) {
    data.banks = JSON.stringify(body.banks);
  }
  if (body.source !== undefined) data.source = body.source;
  if (body.partner !== undefined) {
    data.partnerKind = body.partner?.kind ?? null;
    data.partnerName = body.partner?.name ?? null;
    data.partnerSharePct = body.partner?.sharePct ?? null;
  }
  if (body.whatsapp !== undefined) data.whatsapp = body.whatsapp;
  if (body.waGroup !== undefined) data.waGroup = body.waGroup;
  if (body.customer !== undefined) data.customer = body.customer;
  if (body.loanAmount !== undefined) data.loanAmount = body.loanAmount;

  const updated = await db.loanCase.update({ where: { id: caseId }, data });

  for (const a of actions) {
    await db.activity.create({
      data: { caseId, userId: me.id, action: a },
    });
  }

  return NextResponse.json({ case: serCase(updated) });
}
