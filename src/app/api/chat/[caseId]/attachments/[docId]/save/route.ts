// POST /api/chat/:caseId/attachments/:docId/save
// "Save to Vault" from inside chat: staff re-files a chat attachment into a
// proper vault category (Emirates ID, Payslips, …) and makes it visible to
// the client if needed. The file already lives in the vault (auto-created on
// upload) — this just categorises it without leaving the chat.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { serCaseDocument } from "@/lib/ser";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ caseId: string; docId: string }> }
) {
  const { caseId: caseIdStr, docId: docIdStr } = await params;
  const caseId = parseInt(caseIdStr, 10);
  const docId = parseInt(docIdStr, 10);
  if (isNaN(caseId) || isNaN(docId))
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const staff = await currentUser();
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const flags = await flagsFor(staff);
  if (!flags.manageDocs && !flags.admin && !flags.super)
    return NextResponse.json(
      { error: "Your designation does not allow document changes." },
      { status: 403 }
    );

  const doc = await db.caseDocument.findUnique({ where: { id: docId } });
  if (!doc || doc.caseId !== caseId)
    return NextResponse.json({ error: "Document not found for this case" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const category = body.category ? String(body.category).trim() : null;
  const displayName = body.displayName ? String(body.displayName).trim() : null;

  const updated = await db.caseDocument.update({
    where: { id: docId },
    data: {
      ...(category ? { category } : {}),
      ...(displayName ? { displayName, title: displayName } : {}),
      status: "Uploaded",
      source: "chat",
    },
  });

  await db.activity
    .create({
      data: {
        caseId,
        userId: staff.id,
        action: `saved chat file to vault (${updated.category}): ${updated.fileName ?? updated.title}`,
      },
    })
    .catch(() => {});

  return NextResponse.json({ document: serCaseDocument(updated) });
}
