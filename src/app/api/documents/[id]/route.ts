// PATCH/DELETE /api/documents/:id — manage a vault document.
// PATCH covers edits (title/category/visibility/mandatory/notes/expiry), the
// review workflow (verify / reject with reason / waive / reopen), and picking
// which stored version downloads (selectedVersion).
// Every write needs the designation's manageDocs permission.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { requireDocManager } from "@/lib/domain";
import { r2Delete } from "@/lib/r2";
import { serCaseDocument } from "@/lib/ser";

const STATUSES = ["Pending upload", "Uploaded", "Verified", "Rejected", "Waived"];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!(await requireDocManager(me, flags))) {
    return NextResponse.json({ error: "Your designation does not allow document changes." }, { status: 403 });
  }
  const { id } = await params;
  const docId = parseInt(id, 10);
  const existing = await db.caseDocument.findUnique({ where: { id: docId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json();

  const data: Record<string, unknown> = {};
  const actions: string[] = [];

  if (body.title !== undefined) data.title = String(body.title).trim();
  if (body.category !== undefined) data.category = body.category;
  if (body.mandatory !== undefined) data.mandatory = !!body.mandatory;
  if (body.visibleToClient !== undefined) data.visibleToClient = !!body.visibleToClient;
  if (body.clientCanUpload !== undefined) data.clientCanUpload = !!body.clientCanUpload;
  if (body.notes !== undefined) data.notes = body.notes;
  if (body.expiryDate !== undefined) data.expiryDate = body.expiryDate || null;
  // which stored version downloads/ZIPs use — "compressed" only if it exists
  if (body.selectedVersion !== undefined) {
    const v = body.selectedVersion === "compressed" ? "compressed" : "original";
    if (v === "compressed" && !existing.compressedKey) {
      return NextResponse.json({ error: "No compressed version exists for this document yet." }, { status: 400 });
    }
    data.selectedVersion = v;
    actions.push(`set download version to ${v}: ${existing.title}`);
  }
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return NextResponse.json({ error: "bad status" }, { status: 400 });
    data.status = body.status;
    if (body.status === "Verified") {
      data.verifiedById = me.id;
      data.verifiedAt = new Date();
      data.rejectionReason = "";
      actions.push(`verified document: ${existing.title}`);
    } else if (body.status === "Rejected") {
      data.rejectionReason = String(body.rejectionReason ?? "").trim();
      if (!data.rejectionReason) return NextResponse.json({ error: "A rejection reason is required." }, { status: 400 });
      data.verifiedById = me.id;
      actions.push(`rejected document: ${existing.title}`);
    } else if (body.status === "Waived") {
      data.notes = String(body.notes ?? existing.notes ?? "").trim() || "Waived by " + me.name;
      actions.push(`waived document: ${existing.title}`);
    } else if (body.status === "Pending upload") {
      // reopen — clears any uploaded file review state but keeps the file
      data.verifiedById = null;
      data.verifiedAt = null;
    }
  }

  const updated = await db.caseDocument.update({ where: { id: docId }, data });
  for (const a of actions) {
    await db.activity.create({ data: { caseId: existing.caseId, userId: me.id, action: a } });
  }
  return NextResponse.json({ item: serCaseDocument(updated) });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!(await requireDocManager(me, flags))) {
    return NextResponse.json({ error: "Your designation does not allow document deletion." }, { status: 403 });
  }
  const { id } = await params;
  const docId = parseInt(id, 10);
  const existing = await db.caseDocument.findUnique({ where: { id: docId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  await db.caseDocument.delete({ where: { id: docId } });
  // best-effort storage cleanup — the DB row is already gone either way
  if (existing.storageKey) await r2Delete(existing.storageKey);
  if (existing.compressedKey) await r2Delete(existing.compressedKey);
  await db.activity.create({ data: { caseId: existing.caseId, userId: me.id, action: `removed document requirement: ${existing.title}` } });
  return NextResponse.json({ ok: true });
}
