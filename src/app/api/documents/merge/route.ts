// POST /api/documents/merge — merge multiple documents into a single PDF.
// Supports merging PDFs and converting images (JPG/PNG) to PDF pages.
// Requires manageDocs permission and Cloudflare R2.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { requireDocManager } from "@/lib/domain";
import { r2Configured, r2Get, r2Put, docKey } from "@/lib/r2";

const MAX_EDGE = 2000;
const JPEG_QUALITY = 85;

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
  const outputName = typeof body.outputName === "string" && body.outputName.trim() ? body.outputName.trim() : "merged-document.pdf";

  if (docIds.length < 2) {
    return NextResponse.json({ error: "Select at least 2 documents to merge." }, { status: 400 });
  }

  const docs = await db.caseDocument.findMany({
    where: { id: { in: docIds } },
    select: { id: true, caseId: true, fileName: true, fileType: true, storageKey: true, fileData: true, compressedKey: true },
  });

  if (docs.length !== docIds.length) {
    return NextResponse.json({ error: "One or more documents not found." }, { status: 404 });
  }

  const caseIds = new Set(docs.map((d) => d.caseId));
  if (caseIds.size > 1) {
    return NextResponse.json({ error: "All documents must belong to the same case." }, { status: 400 });
  }
  const caseId = docs[0].caseId;

  // Fetch all document bytes
  const pages: { buffer: Buffer; type: string }[] = [];
  for (const doc of docs) {
    if (!doc.fileName) continue;
    let source: Buffer;
    if (doc.storageKey) {
      const got = await r2Get(doc.storageKey);
      source = got.body;
    } else if (doc.fileData) {
      source = Buffer.from(doc.fileData);
    } else {
      continue;
    }
    if (source.length === 0) continue;

    const type = (doc.fileType || "").toLowerCase();

    if (type === "application/pdf") {
      pages.push({ buffer: source, type: "pdf" });
    } else if (type.startsWith("image/")) {
      // Convert image to PDF page
      const sharpMod = await import("sharp");
      const sharp = sharpMod.default;
      const img = sharp(source, { failOn: "none" }).rotate();
      const meta = await img.metadata();
      const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
      const pipeline = longEdge > MAX_EDGE
        ? img.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
        : img;
      const jpegBuffer = await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
      pages.push({ buffer: jpegBuffer, type: "image" });
    }
  }

  if (pages.length === 0) {
    return NextResponse.json({ error: "No valid documents to merge." }, { status: 400 });
  }

  // Merge using pdf-lib
  const { PDFDocument } = await import("pdf-lib");
  const mergedPdf = await PDFDocument.create();

  for (const page of pages) {
    if (page.type === "pdf") {
      const pdf = await PDFDocument.load(page.buffer, { ignoreEncryption: true });
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach((p) => mergedPdf.addPage(p));
    } else {
      // Image page
      const img = await mergedPdf.embedJpg(page.buffer);
      const newPage = mergedPdf.addPage([img.width, img.height]);
      newPage.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }
  }

  const outBytes = Buffer.from(await mergedPdf.save({ useObjectStreams: true }));

  // Store merged PDF in R2
  const key = docKey(caseId, 0, outputName, "merged");
  await r2Put(key, outBytes, "application/pdf");

  // Create a new CaseDocument record for the merged file
  const newDoc = await db.caseDocument.create({
    data: {
      caseId,
      templateId: null,
      title: outputName.replace(/\.pdf$/i, ""),
      category: "Other",
      status: "Verified",
      mandatory: false,
      visibleToClient: true,
      clientCanUpload: false,
      rejectionReason: "",
      notes: `Merged from ${docIds.length} documents on ${new Date().toISOString().split("T")[0]}`,
      fileName: outputName,
      fileType: "application/pdf",
      fileSize: outBytes.length,
      storageKey: key,
      selectedVersion: "original",
      source: "vault",
      uploadedByKind: "staff",
      uploadedById: me.id,
      uploadedAt: new Date(),
    },
  });

  await db.activity.create({
    data: {
      caseId,
      userId: me.id,
      action: `merged ${docIds.length} documents into "${outputName}"`,
    },
  });

  return NextResponse.json({
    id: newDoc.id,
    fileName: newDoc.fileName,
    fileSize: newDoc.fileSize,
    message: `Successfully merged ${docIds.length} documents into ${outputName}`,
  });
}