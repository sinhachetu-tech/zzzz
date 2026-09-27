// POST /api/documents/download-zip — create a ZIP of selected documents for email attachment.
// Returns a presigned download URL for the ZIP file (stored temporarily in R2).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { requireDocManager } from "@/lib/domain";
import { r2Configured, r2Get, r2Put, r2Delete, docKey } from "@/lib/r2";

export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!(await requireDocManager(me, flags))) {
    return NextResponse.json({ error: "Your designation does not allow document operations." }, { status: 403 });
  }

  if (!r2Configured()) {
    return NextResponse.json(
      { error: "Cloud storage is not configured — ask the admin to paste the Cloudflare R2 keys in Admin → Storage." },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const docIds: number[] = Array.isArray(body.docIds) ? body.docIds : [];
  const zipName = typeof body.zipName === "string" && body.zipName.trim() ? body.zipName.trim() : "documents.zip";
  const useCompressed = body.useCompressed === true;

  if (docIds.length === 0) {
    return NextResponse.json({ error: "No documents selected." }, { status: 400 });
  }

  const docs = await db.caseDocument.findMany({
    where: { id: { in: docIds } },
    select: { id: true, caseId: true, fileName: true, fileType: true, storageKey: true, compressedKey: true, compressedSize: true, fileData: true },
  });

  if (docs.length === 0) {
    return NextResponse.json({ error: "No valid documents found." }, { status: 404 });
  }

  // Use JSZip to create the zip file
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  for (const doc of docs) {
    if (!doc.fileName) continue;
    let source: Buffer | null = null;
    if (useCompressed && doc.compressedKey) {
      try {
        const got = await r2Get(doc.compressedKey);
        source = got.body;
      } catch {
        // fall through to original
      }
    }
    if (!source) {
      if (doc.storageKey) {
        try {
          const got = await r2Get(doc.storageKey);
          source = got.body;
        } catch {}
      } else if (doc.fileData) {
        source = Buffer.from(doc.fileData);
      }
    }
    if (source && source.length > 0) {
      zip.file(doc.fileName, source);
    }
  }

  const zipBuffer = Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }));

  // Store ZIP in R2 with a temporary key (will be cleaned up by lifecycle or manual delete)
  const caseId = docs[0].caseId;
  const key = docKey(caseId, 0, zipName, "zip");
  await r2Put(key, zipBuffer, "application/zip");

  // Generate presigned URL (handled by the file route)
  const downloadUrl = `/api/documents/zip-file?key=${encodeURIComponent(key)}`;

  return NextResponse.json({
    downloadUrl,
    zipName,
    fileCount: docs.length,
    size: zipBuffer.length,
  });
}