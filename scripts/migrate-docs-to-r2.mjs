// One-off migration: move documents still stored as bytes inside Postgres
// (CaseDocument.fileData — the legacy 4 MB path) into Cloudflare R2, then
// clear the byte column so the database stays lean.
//
// Usage:
//   node scripts/migrate-docs-to-r2.mjs --dry-run   # report only, changes nothing
//   node scripts/migrate-docs-to-r2.mjs             # move the files
//
// Safe to re-run: it only ever looks at rows with fileData set and storageKey
// still null, so already-migrated documents are skipped. R2 is written BEFORE
// the byte column is cleared — a failed upload leaves the row untouched.
//
// Requires the four R2_* values in .env and a reachable DATABASE_URL.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const DRY = process.argv.includes("--dry-run");

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
  console.error(" Cloudflare R2 is not configured. Paste R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,");
  console.error("  R2_SECRET_ACCESS_KEY and R2_BUCKET into .env first (Admin → Storage shows what is missing).");
  process.exit(1);
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const prisma = new PrismaClient();

// mirrors docKey() in src/lib/r2.ts — cases/{caseId}/{docId}/{timestamp}-{safeName}
function docKey(caseId, docId, fileName) {
  const safe = String(fileName || "file").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120) || "file";
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `cases/${caseId}/${docId}/${ts}-${safe}`;
}

const kb = (n) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`);

async function main() {
  const rows = await prisma.caseDocument.findMany({
    where: { storageKey: null, fileData: { not: null } },
    select: { id: true, caseId: true, title: true, fileName: true, fileType: true, fileSize: true, fileData: true },
    orderBy: { id: "asc" },
  });

  if (rows.length === 0) {
    console.log("✓ Nothing to migrate — no documents are stored in the database.");
    return;
  }

  const totalBytes = rows.reduce((s, r) => s + (r.fileData?.length ?? 0), 0);
  console.log(`${DRY ? "[dry run] " : ""}${rows.length} document(s) in the database, ${kb(totalBytes)} in total.\n`);

  let moved = 0;
  let failed = 0;

  for (const r of rows) {
    const label = `#${r.id} ${r.fileName ?? r.title}`;
    if (DRY) {
      console.log(`  → would upload ${label} (${kb(r.fileData.length)}) as ${docKey(r.caseId, r.id, r.fileName)}`);
      continue;
    }
    const key = docKey(r.caseId, r.id, r.fileName);
    try {
      await s3.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: Buffer.from(r.fileData),
        ContentType: r.fileType || "application/octet-stream",
      }));
      // only clear the bytes once the object is safely in the bucket
      await prisma.caseDocument.update({
        where: { id: r.id },
        data: { storageKey: key, fileData: null, selectedVersion: "original" },
      });
      moved++;
      console.log(`  ✓ ${label} → ${key}`);
    } catch (e) {
      failed++;
      console.error(`  ✗ ${label}: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log("");
  if (DRY) {
    console.log("Dry run complete — nothing was changed. Re-run without --dry-run to move the files.");
  } else {
    console.log(`✓ Moved ${moved} document(s) to Cloudflare R2${failed ? `, ${failed} failed (left in the database — safe to re-run)` : ""}.`);
    console.log(`  The database shrank by about ${kb(totalBytes)}.`);
  }
}

main()
  .catch((e) => {
    console.error("Migration failed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());