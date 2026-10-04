import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { requireDocManager } from "@/lib/domain";
import type { ClientDocDto } from "@/lib/types";

// SHARING — who may read/attach a document. "All" is the DEFAULT (chosen deliberately:
// the person-level vault is overwhelmingly KYC every department needs, and the realistic
// failure is a missing passport, not a leaked one).
export const SHARING_LEVELS = ["All", "Team", "Department"] as const;
export const DOC_CATEGORIES = ["KYC", "Income", "Asset", "Property", "Other"] as const;

// Lists a client's person-level vault. Every doc the staff member may see, with the
// cases each is attached to, so the "uploaded once, used everywhere" payoff is visible.
export async function GET(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const clientId = Number(url.searchParams.get("clientId"));
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const docs = await db.clientDocument.findMany({
    where: { clientId },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
    include: {
      serviceLine: { select: { id: true, code: true, shortName: true, name: true } },
      attachments: { select: { id: true, caseId: true, case: { select: { caseNumber: true } } } },
    },
  });

  return NextResponse.json({
    documents: docs.map((d) => ({
      id: d.id,
      title: d.title,
      category: d.category,
      status: d.status,
      sharing: d.sharing,
      serviceLineId: d.serviceLineId,
      serviceLineName: d.serviceLine?.shortName || d.serviceLine?.name || null,
      fileName: d.fileName,
      fileType: d.fileType,
      fileSize: d.fileSize,
      hasFile: !!d.storageKey || !!d.fileData,
      uploadedAt: d.uploadedAt ? d.uploadedAt.toISOString() : null,
      createdAt: d.createdAt.toISOString(),
      expiryDate: d.expiryDate,
      notes: d.notes,
      attachedTo: d.attachments.map((a) => ({ caseId: a.caseId, caseNumber: a.case.caseNumber })),
    })),
  });
}

// Create a vault entry, or attach an existing one to a case.
//
// A row is created as a PLACEHOLDER ("Pending upload") before any file exists — that is
// how the client is asked for a passport, and why every file field is nullable.
export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!(await requireDocManager(me, flags))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await req.json();

  // "attach" creates the attachment pointer on a case WITHOUT re-uploading — the whole
  // point of the vault. Handled here because it is the most common write.
  if (body.attachToCaseId && body.clientDocumentId) {
    const doc = await db.clientDocument.findUnique({ where: { id: Number(body.clientDocumentId) } });
    if (!doc) return NextResponse.json({ error: "document not found" }, { status: 404 });
    const target = await db.loanCase.findUnique({
      where: { id: Number(body.attachToCaseId) },
      select: { id: true, clientId: true, caseNumber: true },
    });
    if (!target) return NextResponse.json({ error: "case not found" }, { status: 404 });
    // The case must belong to the SAME person, or this would let anyone staple any
    // client's passport onto any file they can see.
    if (target.clientId !== doc.clientId) {
      return NextResponse.json(
        { error: `That document belongs to a different client than ${target.caseNumber}` },
        { status: 400 },
      );
    }
    const existing = await db.caseDocument.findFirst({ where: { caseId: target.id, clientDocumentId: doc.id } });
    if (existing) return NextResponse.json({ ok: true, alreadyAttached: true, caseDocumentId: existing.id });

    const created = await db.caseDocument.create({
      data: {
        caseId: target.id,
        clientDocumentId: doc.id,
        title: doc.title,
        category: doc.category,
        // Mirrors the vault row's state so the case checklist behaves as if it had been
        // uploaded here — "Pending upload" still needs chasing on this case.
        status: doc.status === "Pending upload" ? "Pending upload" : "Uploaded",
        mandatory: false,
        visibleToClient: true,
        clientCanUpload: true,
        fileName: doc.fileName,
        fileType: doc.fileType,
        fileSize: doc.fileSize,
        storageKey: doc.storageKey,
        compressedKey: doc.compressedKey,
        compressedSize: doc.compressedSize,
        selectedVersion: doc.selectedVersion,
        uploadedByKind: "staff",
        uploadedById: me.id,
        uploadedAt: doc.uploadedAt,
      },
    });
    return NextResponse.json({ ok: true, caseDocumentId: created.id });
  }

  const clientId = Number(body.clientId);
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });
  const title = String(body.title || "").trim();
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });

  const sharing = body.sharing ?? "All";
  if (!SHARING_LEVELS.includes(sharing)) {
    return NextResponse.json({ error: `sharing must be one of ${SHARING_LEVELS.join(", ")}` }, { status: 400 });
  }
  const category = body.category ?? "KYC";
  if (!DOC_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: `category must be one of ${DOC_CATEGORIES.join(", ")}` }, { status: 400 });
  }
  // A department must exist if named — an unknown id would otherwise silently mean
  // firm-wide, which is the one value nobody can see.
  if (body.serviceLineId) {
    const line = await db.serviceLine.findUnique({ where: { id: Number(body.serviceLineId) }, select: { id: true } });
    if (!line) return NextResponse.json({ error: "unknown service line" }, { status: 400 });
  }

  const created = await db.clientDocument.create({
    data: {
      clientId,
      title,
      category,
      status: "Pending upload",
      sharing,
      serviceLineId: body.serviceLineId ? Number(body.serviceLineId) : null,
      expiryDate: body.expiryDate ? String(body.expiryDate) : null,
      notes: body.notes ? String(body.notes) : "",
      uploadedByKind: "staff",
      uploadedById: me.id,
    },
  });
  return NextResponse.json({ document: created }, { status: 201 });
}

// Edit metadata / sharing / department / status. Never touches the file bytes.
export async function PATCH(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!(await requireDocManager(me, flags))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const body = await req.json();

  const data: Record<string, unknown> = {};
  if (body.title !== undefined) data.title = String(body.title).trim();
  if (body.notes !== undefined) data.notes = String(body.notes);
  if (body.expiryDate !== undefined) data.expiryDate = body.expiryDate ? String(body.expiryDate) : null;
  if (body.sharing !== undefined) {
    if (!SHARING_LEVELS.includes(body.sharing)) {
      return NextResponse.json({ error: `sharing must be one of ${SHARING_LEVELS.join(", ")}` }, { status: 400 });
    }
    data.sharing = body.sharing;
  }
  if (body.category !== undefined) {
    if (!DOC_CATEGORIES.includes(body.category)) {
      return NextResponse.json({ error: `category must be one of ${DOC_CATEGORIES.join(", ")}` }, { status: 400 });
    }
    data.category = body.category;
  }
  if (body.serviceLineId !== undefined) data.serviceLineId = body.serviceLineId ? Number(body.serviceLineId) : null;
  if (body.status !== undefined) data.status = String(body.status);

  const updated = await db.clientDocument.update({ where: { id }, data });
  return NextResponse.json({ document: updated });
}

// Delete. Refuses while attached: the FK is SET NULL so the CaseDocuments would SURVIVE
// the delete, leaving a case vault row that resolves to no file — worse than not deleting.
export async function DELETE(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!(await requireDocManager(me, flags))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const attached = await db.caseDocument.count({ where: { clientDocumentId: id } });
  if (attached > 0) {
    return NextResponse.json(
      { error: `Still attached to ${attached} case(s). Detach it from those files first — a case must never end up with a document that resolves to nothing.` },
      { status: 400 },
    );
  }
  await db.clientDocument.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}