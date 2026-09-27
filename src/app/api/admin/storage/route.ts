// GET  /api/admin/storage — what the document storage is actually configured
// with, plus vault counts. Admin/super only. Secrets are never echoed back —
// each key is reported only as present or missing.
// POST /api/admin/storage — "Test connection": writes a tiny probe object to
// the bucket, reads it back, then deletes it. The only way to be sure the
// pasted keys and bucket name actually work.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { r2Configured, r2Put, r2Get, r2Delete } from "@/lib/r2";
import { driveConfigured, driveTestConnection } from "@/lib/drive";

async function guard() {
  const me = await currentUser();
  if (!me) return null;
  const flags = await flagsFor(me);
  if (!flags.admin && !flags.super) return null;
  return { me, flags };
}

function status() {
  return {
    r2: {
      configured: r2Configured(),
      accountId: !!process.env.R2_ACCOUNT_ID,
      accessKeyId: !!process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: !!process.env.R2_SECRET_ACCESS_KEY,
      bucket: !!process.env.R2_BUCKET,
      bucketName: process.env.R2_BUCKET || "",
      endpoint: process.env.R2_ACCOUNT_ID ? `${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : "",
    },
    drive: {
      // Independent archive store (NOT a mirror of R2). When configured, every
      // upload is additionally copied into Drive's per-case folder tree; the
      // app never deletes from Drive and Drive never affects R2 objects.
      configured: !!(process.env.GOOGLE_DRIVE_CLIENT_EMAIL && process.env.GOOGLE_DRIVE_PRIVATE_KEY && process.env.GOOGLE_DRIVE_FOLDER_ID),
      clientEmail: !!process.env.GOOGLE_DRIVE_CLIENT_EMAIL,
      privateKey: !!process.env.GOOGLE_DRIVE_PRIVATE_KEY,
      folderId: !!process.env.GOOGLE_DRIVE_FOLDER_ID,
      // Set = domain-wide-delegation impersonation (required for a PERSONAL
      // My Drive target; a bare service account has 0 bytes of quota there).
      // Empty = plain service account, which is what a Shared Drive needs.
      impersonate: process.env.GOOGLE_DRIVE_IMPERSONATE || "",
    },
  };
}

export async function GET() {
  const g = await guard();
  if (!g) return NextResponse.json({ error: "unauthorized" }, { status: 403 });

  const [total, onR2, compressed, legacy, onDrive, bytesAgg] = await Promise.all([
    db.caseDocument.count(),
    db.caseDocument.count({ where: { storageKey: { not: null } } }),
    db.caseDocument.count({ where: { compressedKey: { not: null } } }),
    db.caseDocument.count({ where: { fileName: { not: null }, storageKey: null } }),
    db.caseDocument.count({ where: { driveFileId: { not: null } } }),
    db.caseDocument.aggregate({ _sum: { fileSize: true, compressedSize: true } }),
  ]);

  return NextResponse.json({
    ...status(),
    stats: {
      totalDocuments: total,
      filesOnR2: onR2,
      compressedCopies: compressed,
      legacyInDatabase: legacy,
      originalBytes: bytesAgg._sum.fileSize ?? 0,
      compressedBytes: bytesAgg._sum.compressedSize ?? 0,
      archivedOnDrive: onDrive,
    },
  });
}

export async function POST(req: NextRequest) {
  const g = await guard();
  if (!g) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const body = await req.json().catch(() => ({}));

  // Google Drive probe — create a probe folder in the archive root, list it
  // back, delete it. The only way to be sure the pasted service account and
  // shared folder ID actually work.
  if (body?.kind === "drive") {
    if (!driveConfigured()) {
      return NextResponse.json({ ok: false, error: "No credentials yet — paste the three Google Drive values into .env, then restart the server." }, { status: 400 });
    }
    try {
      const { steps, target } = await driveTestConnection();
      const ok = steps.write && steps.read && steps.delete;
      return NextResponse.json({ ok, steps, target, targetKind: "google-drive" });
    } catch (e) {
      return NextResponse.json({
        ok: false,
        steps: { write: false, read: false, delete: false },
        targetKind: "google-drive",
        error: e instanceof Error ? e.message : "drive test failed",
      }, { status: 502 });
    }
  }

  if (!r2Configured()) {
    return NextResponse.json({ ok: false, error: "No credentials yet — paste the four R2 values into .env, then restart the server." }, { status: 400 });
  }

  const key = `_healthcheck/${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}.txt`;
  const payload = Buffer.from(`hfmc storage probe ${new Date().toISOString()}`, "utf8");
  const steps: Record<string, boolean> = { write: false, read: false, delete: false };
  try {
    await r2Put(key, payload, "text/plain");
    steps.write = true;
    const back = await r2Get(key);
    steps.read = back.body.length === payload.length;
    await r2Delete(key);
    steps.delete = true;
  } catch (e) {
    return NextResponse.json({
      ok: false,
      steps,
      error: e instanceof Error ? e.message : "storage test failed",
    }, { status: 502 });
  }
  const ok = steps.write && steps.read && steps.delete;
  return NextResponse.json({ ok, steps, key });
}