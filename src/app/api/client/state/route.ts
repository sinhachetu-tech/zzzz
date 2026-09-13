// GET /api/client/state — returns the client's case + stage history + documents.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentClient } from "@/lib/client-auth";
import { serCase, serCaseDocument } from "@/lib/ser";

export async function GET() {
  const me = await currentClient();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const c = await db.loanCase.findUnique({
    where: { id: me.caseId },
    include: {
      owner: true,
      stageTransitions: { orderBy: { at: "desc" }, include: { user: { select: { name: true } } } },
      clientDocuments: { orderBy: { uploadedAt: "desc" } },
      vaultDocuments: { where: { visibleToClient: true }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!c) return NextResponse.json({ error: "case not found" }, { status: 404 });

  const caseDto = serCase(c);
  const stages = await db.stageItem.findMany({ orderBy: { sortOrder: "asc" } });

  return NextResponse.json({
    me,
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
    advisor: c.owner ? { name: c.owner.name, role: c.owner.role } : null,
  });
}
