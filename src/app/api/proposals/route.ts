// POST /api/proposals — save a generated proposal against a case.
// PATCH /api/proposals — move status (draft -> sent -> won / lost).
// GET /api/proposals?caseId=1 — full history for the case.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { serProposal } from "@/lib/ser";

export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  const caseId = parseInt(body.caseId, 10);
  if (!caseId) return NextResponse.json({ error: "caseId required" }, { status: 400 });

  const count = await db.proposal.count({ where: { caseId } });
  const item = await db.proposal.create({
    data: {
      caseId,
      productIds: JSON.stringify(body.productIds ?? []),
      inputs: JSON.stringify(body.inputs ?? {}),
      mode: body.mode === "internal" ? "internal" : "client",
      status: "draft",
      version: count + 1,
      createdBy: me.id,
    },
  });
  const fresh = await db.proposal.findUnique({ where: { id: item.id }, include: { author: { select: { name: true } } } });
  return NextResponse.json({ item: serProposal(fresh!) });
}

export async function PATCH(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  const id = parseInt(body.id, 10);
  const status = body.status;
  if (!id || !["draft", "sent", "won", "lost"].includes(status)) {
    return NextResponse.json({ error: "id and valid status required" }, { status: 400 });
  }
  const data: Record<string, unknown> = { status };
  if (status === "sent") data.sentAt = new Date();
  if (status === "won" || status === "lost") data.decidedAt = new Date();
  const item = await db.proposal.update({ where: { id }, data });
  const fresh = await db.proposal.findUnique({ where: { id }, include: { author: { select: { name: true } } } });
  return NextResponse.json({ item: serProposal(fresh!) });
}

export async function GET(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const caseId = parseInt(new URL(req.url).searchParams.get("caseId") ?? "", 10);
  if (!caseId) return NextResponse.json({ error: "caseId required" }, { status: 400 });
  const rows = await db.proposal.findMany({
    where: { caseId }, orderBy: { version: "desc" },
    include: { author: { select: { name: true } } },
  });
  return NextResponse.json({ items: rows.map(serProposal) });
}
