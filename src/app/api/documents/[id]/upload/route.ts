// POST /api/documents/:id/upload — multipart file upload.
// Staff (any signed-in team user) may upload on behalf of client or bank.
// Clients may upload ONLY their own case's documents flagged clientCanUpload.
// Files are stored in SQLite (Bytes) with a 4 MB cap — swap for object storage later.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { currentClient } from "@/lib/client-auth";
import { serCaseDocument } from "@/lib/ser";

const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const docId = parseInt(id, 10);
  const doc = await db.caseDocument.findUnique({ where: { id: docId } });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File exceeds the 4 MB limit — send large files via your advisor." }, { status: 400 });

  // who is uploading?
  const staff = await currentUser();
  const client = staff ? null : await currentClient();
  let byKind = "";
  let byId: number | null = null;
  if (staff) {
    byKind = "staff";
    byId = staff.id;
  } else if (client && client.caseId === doc.caseId) {
    if (!doc.visibleToClient || !doc.clientCanUpload) {
      return NextResponse.json({ error: "This document must be handled by your advisor." }, { status: 403 });
    }
    byKind = "client";
    byId = null;
  } else {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const updated = await db.caseDocument.update({
    where: { id: docId },
    data: {
      fileName: file.name,
      fileType: file.type || "application/octet-stream",
      fileSize: file.size,
      fileData: bytes,
      uploadedByKind: byKind,
      uploadedById: byId,
      uploadedAt: new Date(),
      status: "Uploaded",
      rejectionReason: "",
    },
  });
  return NextResponse.json({ item: serCaseDocument(updated) });
}
