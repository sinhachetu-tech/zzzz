// POST /api/documents — create an ad-hoc document requirement on a case
// (bank underwriter stipulations, case-specific requests).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { serCaseDocument } from "@/lib/ser";

export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  const caseId = parseInt(body.caseId, 10);
  if (!caseId || !body.title?.trim()) return NextResponse.json({ error: "caseId and title are required." }, { status: 400 });

  const exists = await db.loanCase.findUnique({ where: { id: caseId }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: "case not found" }, { status: 404 });

  const max = await db.caseDocument.aggregate({ where: { caseId }, _max: { sortOrder: true } });
  const item = await db.caseDocument.create({
    data: {
      caseId,
      templateId: null,
      title: body.title.trim(),
      category: body.category ?? "KYC",
      mandatory: !!body.mandatory,
      visibleToClient: body.visibleToClient ?? true,
      clientCanUpload: body.clientCanUpload ?? true,
      notes: body.notes ?? "",
      sortOrder: (max._max.sortOrder ?? 0) + 1,
    },
  });
  await db.activity.create({ data: { caseId, userId: me.id, action: `added document requirement: ${item.title}` } });
  return NextResponse.json({ item: serCaseDocument(item) });
}
