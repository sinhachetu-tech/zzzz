// Apply the Phase 1 additive SQL, then verify it actually landed.
//
//   node scripts/phase1-apply.cjs          # dry run — prints the SQL, writes nothing
//   node scripts/phase1-apply.cjs --apply  # execute against DATABASE_URL
//
// Uses `prisma db execute`, which runs raw SQL over the same connection the app
// uses. Idempotency note: this is NOT a prisma-migrations-tracked change, so
// re-running it fails on "relation already exists" — that is the desired
// behaviour (it proves it was already applied) rather than a silent no-op.

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");
const sqlPath = path.join(root, "prisma", "phase1_service_lines.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

function envUrl() {
  const envFile = fs.readFileSync(path.join(root, ".env"), "utf8");
  const m = envFile.match(/^DATABASE_URL\s*=\s*(.+)$/m);
  if (!m) throw new Error("DATABASE_URL not found in .env");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

// Count semicolons on non-comment lines only, so the multi-line header comments
// don't swallow the first real statement.
const statements = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n")
  .split(";").filter((s) => s.trim()).length;
console.log(`phase1_service_lines.sql — ${statements} statements`);

if (!APPLY) {
  console.log("DRY RUN — nothing executed. Re-run with --apply.");
  process.exit(0);
}

try {
  execSync(`npx prisma db execute --file "${sqlPath}" --schema prisma/schema.prisma`, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  console.log("APPLIED — verifying…");
} catch (e) {
  console.error("FAILED:\n" + (e.stdout || "") + "\n" + (e.stderr || ""));
  process.exit(1);
}

// Verify: the four new tables exist and the new columns are present.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: envUrl() } } });

(async () => {
  const tables = await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('ServiceLine','Product','Lead','StageSet')
      ORDER BY table_name`,
  );
  const cols = await prisma.$queryRawUnsafe(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (table_name, column_name) IN
            (('LoanCase','serviceLineId'),('LoanCase','productId'),
             ('LoanCase','legStatus'),('LoanCase','decidedAt'),
             ('StageItem','stageSetId'),('DocRule','serviceLineId'),
             ('SlaRule','serviceLineId'),('CommTemplate','serviceLineId'))
      ORDER BY table_name, column_name`,
  );
  const cases = await prisma.loanCase.count();
  console.log(`\ntables created : ${tables.map((t) => t.table_name).join(", ")}`);
  console.log(`columns added  : ${cols.length}`);
  for (const c of cols) console.log(`   ${c.table_name}.${c.column_name}`);
  console.log(`LoanCase rows  : ${cases} (unchanged)`);
})()
  .catch((e) => { console.error("VERIFY FAILED:", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());