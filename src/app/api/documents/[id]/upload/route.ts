// POST /api/documents/:id/upload — multipart file upload.
// Staff with the designation's manageDocs permission may upload on behalf of
// client or bank. Clients may upload ONLY their own case's documents flagged
// clientCanUpload. Files go to Cloudflare R2 when configured (env-driven);
// otherwise fall back to the legacy Postgres-bytes path so nothing breaks
// before credentials are pasted. Original quality is preserved — no
// automatic compression (bank submissions need the pristine file).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { currentClient, clientOwnsCase } from "@/lib/client-auth";
import { requireDocManager } from "@/lib/domain";
import { r2Configured, r2Put, docKey } from "@/lib/r2";
import { driveConfigured, driveArchiveFile } from "@/lib/drive";
import { serCaseDocument } from "@/lib/ser";

const MAX_BYTES = 25 * 1024 * 1024; // scanned EIDs / multi-month statements
const LEGACY_MAX_BYTES = 4 * 1024 * 1024; // old Postgres-bytes cap

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const docId = parseInt(id, 10);
  if (Number.isNaN(docId)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const doc = await db.caseDocument.findUnique({ where: { id: docId } });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });

  // who is uploading?
  const staff = await currentUser();
  const client = staff ? null : await currentClient();
  let byKind = "";
  let byId: number | null = null;
  let useR2 = false;

  if (staff) {
    const flags = await flagsFor(staff);
    if (!(await requireDocManager(staff, flags))) {
      return NextResponse.json({ error: "Your designation does not allow document uploads." }, { status: 403 });
    }
    byKind = "staff";
    byId = staff.id;
    useR2 = r2Configured();
  } else if (client && (await clientOwnsCase(client, doc.caseId))) {
    if (!doc.visibleToClient || !doc.clientCanUpload) {
      return NextResponse.json({ error: "This document must be handled by your advisor." }, { status: 403 });
    }
    byKind = "client";
    byId = null;
  } else {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds the 25 MB limit — send large files via your advisor." }, { status: 400 });
  }
  if (!useR2 && file.size > LEGACY_MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds the 4 MB limit (cloud storage not yet configured — ask the admin to add R2 keys in Admin → Storage)." }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // R2 path — original untouched; DB keeps only the key
  let storageKey: string | null = null;
  if (useR2) {
    storageKey = docKey(doc.caseId, doc.id, file.name);
    await r2Put(storageKey, bytes, file.type || "application/octet-stream");
  }

  // Independent Google Drive archive — a separate dump, NOT a mirror: the copy
  // lives its own life in Drive's per-case folder tree ({CASE-NO — Customer}/
  // {category}/), deleting the document here never deletes it there, and
  // nothing in Drive touches the R2 object. Best-effort: a Drive hiccup must
  // never fail the upload itself.
  let driveFileId: string | null = null;
  if (driveConfigured()) {
    try {
      const caseRow = await db.loanCase.findUnique({
        where: { id: doc.caseId },
        select: { caseNumber: true, customer: true },
      });
      if (caseRow) {
        const archived = await driveArchiveFile({
          caseNumber: caseRow.caseNumber,
          customer: caseRow.customer,
          category: doc.category,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          bytes,
        });
        driveFileId = archived.fileId;
      }
    } catch (e) {
      console.error("drive archive failed (non-fatal):", e);
    }
  }

  const updated = await db.caseDocument.update({
    where: { id: docId },
    data: {
      fileName: file.name,
      fileType: file.type || "application/octet-stream",
      fileSize: file.size,
      ...(useR2
        ? { storageKey, selectedVersion: "original" }
        : { fileData: bytes }),
      // a new upload clears any stale compressed version state
      compressedKey: null,
      compressedSize: null,
      ...(driveFileId ? { driveFileId } : {}),
      uploadedByKind: byKind,
      uploadedById: byId,
      uploadedAt: new Date(),
      status: "Uploaded",
      rejectionReason: "",
    },
  });
  await db.activity.create({
    data: { caseId: doc.caseId, userId: staff?.id ?? 0, action: `uploaded document: ${doc.title} (${byKind})` },
  });
  return NextResponse.json({ item: serCaseDocument(updated) });
}