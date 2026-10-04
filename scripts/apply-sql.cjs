// Apply an additive SQL file, then verify it actually landed.
//
//   node scripts/apply-sql.cjs                     # dry run (default)
//   node scripts/apply-sql.cjs --apply             # execute
//   node scripts/apply-sql.cjs --apply phase3_client_sessions.sql
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
const file = process.argv.find((a) => a.endsWith(".sql"));
const sqlPath = path.join(root, "prisma", file || "phase1_service_lines.sql");
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
console.log(`${path.basename(sqlPath)} — ${statements} statements`);

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
  // Not a prisma-migrations-tracked change, so re-running FAILS loudly with
// "already exists" rather than silently no-opping. That is the correct signal,
// not an error: the DDL landed on an earlier run. So treat "already exists" as
// ALREADY-APPLIED and fall through to verification instead of exiting non-zero.
const alreadyApplied = /already exists/i.test(`${e.stdout || ""}${e.stderr || ""}`);
if (!alreadyApplied) {
  console.error("FAILED:\n" + (e.stdout || "") + "\n" + (e.stderr || ""));
  process.exit(1);
}
console.log("already applied (column exists) — verifying…");
}

// Verify generically: re-read the SQL and check that every table, column and
// constraint it mentions now EXISTS. Hardcoding the Phase 1 objects meant this
// script could only ever verify Phase 1 — deriving the list from the file means
// a later phase needs no edit here at all.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: envUrl() } } });

(async () => {
  const wantTables = [...new Set([...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]))];
  const wantCols = [...new Set(
    [...sql.matchAll(/ALTER TABLE "(\w+)" ADD COLUMN\s+"(\w+)"/g)].map((m) => `${m[1]}.${m[2]}`),
  )];
  const wantFks = [...new Set(
    [...sql.matchAll(/ADD CONSTRAINT "(\w+_fkey)"/g)].map((m) => m[1]),
  )];

  const tables = wantTables.length
    ? await prisma.$queryRawUnsafe(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema='public' AND table_name IN (${wantTables.map((t) => `'${t}'`).join(",")})
          ORDER BY table_name`,
      )
    : [];
  // Build an explicit VALUES list instead of unnest — unnest's two-array form is
  // easy to get wrong with Prisma's parameter binding, and these lists are tiny.
  const colPairs = wantCols.map((c) => {
    const [t, col] = c.split(".");
    return `('${t}','${col}')`;
  }).join(",");
  const cols = wantCols.length
    ? await prisma.$queryRawUnsafe(
        `SELECT table_name||'.'||column_name AS c FROM information_schema.columns
          WHERE table_schema='public'
            AND (table_name, column_name) IN (VALUES ${colPairs})
          ORDER BY table_name, column_name`,
      )
    : [];
  const fks = wantFks.length
    ? await prisma.$queryRawUnsafe(
        `SELECT constraint_name FROM information_schema.table_constraints
          WHERE table_schema='public' AND constraint_name IN (${wantFks.map((f) => `'${f}'`).join(",")})
          ORDER BY constraint_name`,
      )
    : [];

  const cases = await prisma.loanCase.count();
  const sessions = await prisma.clientSession.count();
  console.log(`\ntables      : ${tables.length}/${wantTables.length} ${tables.map((t) => t.table_name).join(", ")}`);
  console.log(`columns     : ${cols.length}/${wantCols.length} ${cols.map((c) => c.c).join(", ")}`);
  console.log(`constraints : ${fks.length}/${wantFks.length} ${fks.map((f) => f.constraint_name).join(", ")}`);
  console.log(`data intact : LoanCase=${cases} ClientSession=${sessions}`);

  const missing =
    wantTables.length - tables.length + (wantCols.length - cols.length) + (wantFks.length - fks.length);
  if (missing > 0) {
    console.error(`\nVERIFICATION FAILED — ${missing} object(s) missing.`);
    process.exitCode = 1;
  } else {
    console.log("\nverified: every object in the SQL file is present.");
  }
})()
  .catch((e) => { console.error("VERIFY FAILED:", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());