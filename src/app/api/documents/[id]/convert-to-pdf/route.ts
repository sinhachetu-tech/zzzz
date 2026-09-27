// POST /api/documents/:id/convert-to-pdf — convert an image document to PDF with optional cropping.
// Requires manageDocs permission and Cloudflare R2.
// Body: { crop?: { x: number, y: number, width: number, height: number }, outputName?: string }
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { requireDocManager } from "@/lib/domain";
import { r2Configured, r2Get, r2Put, r2Delete, docKey } from "@/lib/r2";
import { serCaseDocument } from "@/lib/ser";

const MAX_EDGE = 2000;
const JPEG_QUALITY = 85;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!(await requireDocManager(me, flags))) {
    return NextResponse.json({ error: "Your designation does not allow document operations." }, { status: 403 });
  }

  const { id } = await params;
  const docId = parseInt(id, 10);
  if (Number.isNaN(docId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const doc = await db.caseDocument.findUnique({ where: { id: docId } });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!doc.fileName) return NextResponse.json({ error: "No file uploaded yet." }, { status: 400 });

  const type = (doc.fileType || "").toLowerCase();
  if (!type.startsWith("image/")) {
    return NextResponse.json({ error: "Only image files can be converted to PDF." }, { status: 400 });
  }

  if (!r2Configured()) {
    return NextResponse.json(
      { error: "Cloud storage is not configured — ask the admin to paste the Cloudflare R2 keys in Admin → Storage." },
      { status: 400 },
    );
  }
  if (!doc.storageKey) {
    return NextResponse.json(
      { error: "This file still lives in the database (legacy row). Re-upload it once R2 is configured, then convert." },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const crop = body.crop && typeof body.crop === "object" ? body.crop : null;
  const outputName = typeof body.outputName === "string" && body.outputName.trim()
    ? body.outputName.trim()
    : doc.fileName.replace(/\.[^.]+$/, ".pdf");

  // Fetch original image
  let source: Buffer;
  try {
    const got = await r2Get(doc.storageKey);
    source = got.body;
  } catch {
    return NextResponse.json({ error: "Could not read the original from storage." }, { status: 503 });
  }
  if (source.length === 0) return NextResponse.json({ error: "The stored original is empty." }, { status: 400 });

  // Process image with optional crop
  const sharpMod = await import("sharp");
  const sharp = sharpMod.default;
  let img = sharp(source, { failOn: "none" }).rotate();

  if (crop && typeof crop.x === "number" && typeof crop.y === "number" && typeof crop.width === "number" && typeof crop.height === "number") {
    // Validate crop bounds
    const meta = await img.metadata();
    const maxX = (meta.width ?? 0) - 1;
    const maxY = (meta.height ?? 0) - 1;
    if (crop.x >= 0 && crop.y >= 0 && crop.width > 0 && crop.height > 0 &&
        crop.x + crop.width <= meta.width && crop.y + crop.height <= meta.height) {
      img = img.extract({ left: Math.round(crop.x), top: Math.round(crop.y), width: Math.round(crop.width), height: Math.round(crop.height) });
    }
  }

  // Resize if needed
  const meta = await img.metadata();
  const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
  if (longEdge > MAX_EDGE) {
    img = img.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true });
  }

  const jpegBuffer = await img.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();

  // Create PDF with the image
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const pdfImg = await pdf.embedJpg(jpegBuffer);
  const page = pdf.addPage([pdfImg.width, pdfImg.height]);
  page.drawImage(pdfImg, { x: 0, y: 0, width: pdfImg.width, height: pdfImg.height });

  const outBytes = Buffer.from(await pdf.save({ useObjectStreams: true }));

  // Store as new compressed version (or new document if no compressed version exists)
  const key = docKey(doc.caseId, doc.id, outputName, "converted");
  await r2Put(key, outBytes, "application/pdf");

  // If there's an existing compressed version, delete it
  if (doc.compressedKey) await r2Delete(doc.compressedKey);

  const updated = await db.caseDocument.update({
    where: { id: docId },
    data: {
      compressedKey: key,
      compressedSize: outBytes.length,
      fileType: "application/pdf", // update type since now it's a PDF
      fileName: outputName,
    },
  });

  const savedPct = doc.fileSize ? Math.round((1 - outBytes.length / doc.fileSize) * 100) : 0;

  await db.activity.create({
    data: {
      caseId: doc.caseId,
      userId: me.id,
      action: `converted "${doc.fileName}" to PDF${crop ? " (cropped)" : ""} (${doc.fileSize ? fmtKb(doc.fileSize) : "?"} → ${fmtKb(outBytes.length)}${savedPct ? `, −${savedPct}%` : ""})`,
    },
  });

  return NextResponse.json({
    item: serCaseDocument(updated),
    originalSize: doc.fileSize ?? 0,
    convertedSize: outBytes.length,
    savedPct,
  });
}

function fmtKb(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}