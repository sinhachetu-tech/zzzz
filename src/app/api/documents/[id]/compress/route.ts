// POST /api/documents/:id/compress — create a compressed COPY of the uploaded
// file for fast previews / WhatsApp / email, while the pristine original stays
// untouched for bank submissions.
//
// Human-in-the-loop by design: compression never auto-selects the smaller file.
// A team member with the designation's manageDocs permission triggers it, sees
// the real saving, then chooses which version downloads (selectedVersion).
//
//   images (jpeg/png/webp) → sharp: cap the long edge, re-encode
//   PDFs                   → pdf-lib: re-save with object streams (modest —
//                            text/scans keep their embedded images)
//
// Requires Cloudflare R2: the legacy Postgres-bytes path holds a single blob,
// so a second version has nowhere to live. Rows still on legacy bytes are told
// to re-upload once the admin has pasted the R2 keys in Admin → Storage.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { requireDocManager } from "@/lib/domain";
import { r2Configured, r2Put, r2Get, r2Delete, docKey } from "@/lib/r2";
import { serCaseDocument } from "@/lib/ser";

// Preview-grade: big enough to read a scanned EID on a phone, small enough to
// send over WhatsApp. Originals keep full resolution for the bank.
const MAX_EDGE = 2000;
const JPEG_QUALITY = 72;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!(await requireDocManager(me, flags))) {
    return NextResponse.json({ error: "Your designation does not allow document compression." }, { status: 403 });
  }

  const { id } = await params;
  const docId = parseInt(id, 10);
  if (Number.isNaN(docId)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const doc = await db.caseDocument.findUnique({ where: { id: docId } });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!doc.fileName) return NextResponse.json({ error: "No file uploaded yet." }, { status: 400 });

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";

  if (!r2Configured()) {
    return NextResponse.json(
      { error: "Cloud storage is not configured — ask the admin to paste the Cloudflare R2 keys in Admin → Storage." },
      { status: 400 },
    );
  }
  if (!doc.storageKey) {
    return NextResponse.json(
      { error: "This file still lives in the database (legacy row). Re-upload it once R2 is configured, then compress." },
      { status: 400 },
    );
  }
  if (doc.compressedKey && !force) {
    return NextResponse.json({ error: "A compressed version already exists. Use replace to rebuild it." }, { status: 409 });
  }

  // ---- fetch the original bytes ----
  let source: Buffer;
  try {
    const got = await r2Get(doc.storageKey);
    source = got.body;
  } catch {
    return NextResponse.json({ error: "Could not read the original from storage — check the R2 keys and bucket." }, { status: 503 });
  }
  if (source.length === 0) return NextResponse.json({ error: "The stored original is empty." }, { status: 400 });

  const type = (doc.fileType || "").toLowerCase();
  const name = doc.fileName || "document";
  let out: Buffer;
  let outType = type || "application/octet-stream";

  try {
    if (type.startsWith("image/")) {
      // images: resize + re-encode (the big win — phone photos are 4-8 MB)
      const sharpMod = await import("sharp");
      const sharp = sharpMod.default;
      const img = sharp(source, { failOn: "none" }).rotate(); // honour EXIF orientation
      const meta = await img.metadata();
      const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
      const pipeline = longEdge > MAX_EDGE
        ? img.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
        : img;
      if (type === "image/png") {
        out = await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer();
        outType = "image/png";
      } else if (type === "image/webp") {
        out = await pipeline.webp({ quality: JPEG_QUALITY }).toBuffer();
        outType = "image/webp";
      } else {
        out = await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
        outType = "image/jpeg";
      }
    } else if (type === "application/pdf") {
      // PDFs: object-stream re-save. Embedded scans are already compressed, so
      // expect a small saving — the UI reports the honest number either way.
      const { PDFDocument } = await import("pdf-lib");
      const pdf = await PDFDocument.load(source, { ignoreEncryption: true, updateMetadata: false });
      out = Buffer.from(await pdf.save({ useObjectStreams: true }));
      outType = "application/pdf";
    } else {
      return NextResponse.json(
        { error: `Compression is only available for images and PDFs (this file is ${type || "an unknown type"}).` },
        { status: 400 },
      );
    }
  } catch (e) {
    return NextResponse.json(
      { error: `Could not compress this file: ${e instanceof Error ? e.message : "unknown error"}` },
      { status: 400 },
    );
  }

  // Never store a "compressed" file that is bigger than the original.
  if (out.length >= source.length) {
    return NextResponse.json({
      error: `No saving available — the original is already smaller (${fmtKb(source.length)}). Nothing was changed.`,
      originalSize: source.length,
      sameSize: true,
    });
  }

  // ---- store the compressed copy (original untouched) ----
  const key = docKey(doc.caseId, doc.id, name, "compressed");
  try {
    await r2Put(key, out, outType);
  } catch {
    return NextResponse.json({ error: "Could not write the compressed copy to storage." }, { status: 503 });
  }
  if (doc.compressedKey) await r2Delete(doc.compressedKey); // replace: drop the stale object

  const updated = await db.caseDocument.update({
    where: { id: docId },
    data: { compressedKey: key, compressedSize: out.length },
  });
  const savedPct = Math.round((1 - out.length / source.length) * 100);
  await db.activity.create({
    data: {
      caseId: doc.caseId,
      userId: me.id,
      action: `compressed document: ${doc.title} (${fmtKb(source.length)} → ${fmtKb(out.length)}, −${savedPct}%)`,
    },
  });

  return NextResponse.json({
    item: serCaseDocument(updated),
    originalSize: source.length,
    compressedSize: out.length,
    savedPct,
  });
}

function fmtKb(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}