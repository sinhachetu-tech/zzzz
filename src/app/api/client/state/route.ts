// GET /api/client/state — returns the client's case + stage history + documents.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentClient } from "@/lib/client-auth";
import { serCase, serCaseDocument } from "@/lib/ser";

export async function GET(req: Request) {
  const me = await currentClient();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // One client, many bank journeys: a per-bank split creates several cases for
  // the same client. The portal shows them ALL under one login — the requested
  // case (default: the login case) must share the client, or it is refused.
  const url = new URL(req.url);
  const requestedId = Number(url.searchParams.get("caseId")) || me.caseId;

  const anchor = await db.loanCase.findUnique({ where: { id: me.caseId }, select: { clientId: true, customer: true, whatsapp: true } });
  if (!anchor) return NextResponse.json({ error: "case not found" }, { status: 404 });

  let selectedId = me.caseId;
  if (requestedId !== me.caseId) {
    const requested = await db.loanCase.findUnique({ where: { id: requestedId }, select: { clientId: true, customer: true, whatsapp: true } });
    const sameClient = requested && (
      (anchor.clientId && requested.clientId === anchor.clientId) ||
      (!anchor.clientId && !requested.clientId && anchor.customer === requested.customer && anchor.whatsapp === requested.whatsapp)
    );
    if (!sameClient) return NextResponse.json({ error: "case not linked to this client" }, { status: 403 });
    selectedId = requestedId;
  }

  // engagement list: every case of this client (any bank journey)
  const engagements = anchor.clientId
    ? await db.loanCase.findMany({ where: { clientId: anchor.clientId }, orderBy: { id: "asc" }, select: { id: true, caseNumber: true, banks: true, stage: true, caseStatus: true, loanAmount: true, wonBank: true } })
    : [];

  const c = await db.loanCase.findUnique({
    where: { id: selectedId },
    include: {
      owner: true,
      advisor: true,
      stageTransitions: { orderBy: { at: "desc" }, include: { user: { select: { name: true } } } },
      clientDocuments: { orderBy: { uploadedAt: "desc" } },
      vaultDocuments: { where: { visibleToClient: true }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!c) return NextResponse.json({ error: "case not found" }, { status: 404 });

  const caseDto = serCase(c);
  const stages = await db.stageItem.findMany({ orderBy: { sortOrder: "asc" } });

  return NextResponse.json({
    me: { ...me, caseId: selectedId, caseNumber: caseDto.caseNumber },
    engagements: engagements.map((e) => ({
      id: e.id, caseNumber: e.caseNumber,
      banks: (() => { try { return JSON.parse(e.banks); } catch { return []; } })(),
      stage: e.stage, caseStatus: e.caseStatus, loanAmount: e.loanAmount, wonBank: e.wonBank,
    })),
    case: caseDto,
    stages: stages.map((s) => ({ id: s.id, label: s.label, sortOrder: s.sortOrder, active: s.active })),
    stageTransitions: c.stageTransitions.map((t) => ({
      id: t.id, fromStage: t.fromStage, toStage: t.toStage, comment: t.comment,
      userName: t.user?.name ?? "—", at: t.at.toISOString(),
    })),
    vaultDocuments: c.vaultDocuments.map(serCaseDocument),
    documents: c.clientDocuments.map((d) => ({
      id: d.id, fileName: d.fileName, fileType: d.fileType, fileSize: d.fileSize,
      uploadedAt: d.uploadedAt.toISOString(),
    })),
    advisor: (c.advisor ?? c.owner) ? { name: (c.advisor ?? c.owner).name, role: (c.advisor ?? c.owner).role } : null,
    profile: c.profileJson ? (() => { try { return JSON.parse(c.profileJson); } catch { return null; } })() : null,
    profileClientVerifiedAt: c.profileClientVerifiedAt ? c.profileClientVerifiedAt.toISOString() : null,
  });
}
