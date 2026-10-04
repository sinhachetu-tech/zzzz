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

// ⚠️ PRE-FLIGHT for migrations that ALTER an existing table rather than adding a new
// one. Phase 7 reshapes `ClientDocument` in place, which is only safe while the table
// is EMPTY: the generated SQL adds `clientId INTEGER NOT NULL` with no default, which
// fails against any existing row. The emptiness was checked when the SQL was written,
// but "checked then" is not "checked now" — someone may have uploaded a document since.
// Refuses to run if the count moved.
//
// ⚠️ THE REGEX MUST HANDLE MULTI-COLUMN ADD. `prisma migrate diff` emits ONE
// `ADD COLUMN` per table followed by comma-separated columns on continuation lines:
//
//     ALTER TABLE "ClientDocument" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'KYC',
//     ADD COLUMN "clientId" INTEGER NOT NULL,
//     ADD COLUMN "storageKey" TEXT, ...
//
// A naive /ADD COLUMN\s+"(\w+)" (\w+)/ only ever matches the FIRST column, so it found
// "category" and never saw "clientId" — the pre-flight silently did NOTHING on the real
// run. Same bug in the verifier, which reported 2/2 columns when 22 were added. Both
// now scan every column inside each ADD COLUMN block.
const ADD_BLOCK = /ALTER TABLE "(\w+)" ADD COLUMN([\s\S]*?);/g;
const addedColumns = [];
for (const [, table, body] of sql.matchAll(ADD_BLOCK)) {
  for (const line of body.split("\n")) {
    const m = line.match(/ADD COLUMN\s+"(\w+)"\s+([A-Z0-9()]+)(.*)$/);
    if (!m) continue;
    const rest = m[3] || "";
    addedColumns.push({ table, column: m[1], notNull: /\bNOT NULL\b/.test(rest), hasDefault: /\bDEFAULT\b/.test(rest) });
  }
}
// A NOT NULL column with NO default cannot be added to a table that already has rows.
const risky = addedColumns.filter((c) => c.notNull && !c.hasDefault);
const tablesToCheck = [...new Set(risky.map((c) => c.table))];
if (risky.length) {
  console.log(`pre-flight : NOT NULL, no default → ${risky.map((c) => `${c.table}.${c.column}`).join(", ")}`);
}
// Blocking pre-flight: adding a NOT NULL column to a table that already has rows will
// fail (or, worse, be "fixed" by hand with a wrong default). Check the live count first.
// Wrapped in an async IIFE because this is CommonJS — `await` is not valid at top level.
// IMPORTANT: this is AWAITED before the apply below, via main().then() chaining further
// down, so the DDL cannot start while the count is still being read. An un-awaited IIFE
// would race the execSync and defeat the entire point of the check.
function preflight() {
  if (!tablesToCheck.length) return Promise.resolve();
  return (async () => {
    const { PrismaClient } = require("@prisma/client");
    const pre = new PrismaClient({ datasources: { db: { url: envUrl() } } });
    try {
      for (const t of tablesToCheck) {
        const rows = await pre.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${t}"`);
        const n = rows[0]?.n ?? -1;
        console.log(`pre-flight : "${t}" currently holds ${n} row(s)`);
        if (n > 0) {
          console.error(
            `\nREFUSING TO APPLY. This migration reshapes "${t}" in place and is only safe on an\n` +
              `empty table — it adds NOT NULL columns with no default. It holds ${n} row(s) now,\n` +
              `so they would be lost or need a data migration first. Back up and write one.`,
          );
          process.exit(1);
        }
      }
    } finally {
      await pre.$disconnect();
    }
  })().catch((e) => {
    console.error("PRE-FLIGHT FAILED:", e.message);
    process.exit(1);
  });
}

// The pre-flight must COMPLETE before any DDL runs, so both are sequenced in one
// promise chain. Running execSync at top level here would let the ALTER start while the
// row count was still being read — which would defeat the entire point of the check.
preflight()
  .then(() => {
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
  })
  .then(() => verify())
  .catch((e) => { console.error("APPLY FAILED:", e.message); process.exit(1); });

function verify() {

// Verify generically: re-read the SQL and check that every table, column and
// constraint it mentions now EXISTS. Hardcoding the Phase 1 objects meant this
// script could only ever verify Phase 1 — deriving the list from the file means
// a later phase needs no edit here at all. Chained after the apply so verification
// cannot start before the DDL has landed.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: envUrl() } } });

(async () => {
  const wantTables = [...new Set([...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]))];
  // Use the SAME multi-column scan as the pre-flight. The old one-liner matched only
  // the first column of each ADD COLUMN block, so it reported "2/2 columns" on Phase 7
  // when 22 had actually been added — a verification that passes without checking.
  const wantCols = addedColumns.map((c) => `${c.table}.${c.column}`);
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
}