// One-command Supabase region migration: Seoul → wherever you point it.
// Usage:
//   node scripts/migrate-db.mjs "<NEW_DATABASE_URL>"          # migrate
// The new DB must be EMPTY (fresh Supabase project). Steps:
//   1. prisma db push against the new URL (identical schema)
//   2. copy every table old → new in FK-safe order (including file bytes)
//   3. reset Postgres identity sequences so new inserts don't collide
//   4. verify row counts table-by-table
// The old DB is never touched. .env cutover happens after you verify.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const NEW_URL = process.argv[2];
if (!NEW_URL || !NEW_URL.startsWith("postgres")) {
  console.error("Usage: node scripts/migrate-db.mjs \"postgresql://...\" (new project URL)");
  process.exit(1);
}

// old URL straight from .env
const env = fs.readFileSync(path.resolve(".env"), "utf8");
const OLD_URL = env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1];
if (!OLD_URL) { console.error("No DATABASE_URL found in .env"); process.exit(1); }
if (OLD_URL === NEW_URL) { console.error("New URL equals the old one."); process.exit(1); }

console.log("Migrating:\n  old:", OLD_URL.replace(/:[^:@/]+@/, ":****@"), "\n  new:", NEW_URL.replace(/:[^:@/]+@/, ":****@"), "\n");

// 1) schema on the new project
console.log("[1/4] Pushing schema to the new project…");
execSync(`npx prisma db push --skip-generate --accept-data-loss`, {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: NEW_URL },
});

const old = new PrismaClient({ datasources: { db: { url: OLD_URL } } });
const neu = new PrismaClient({ datasources: { db: { url: NEW_URL } } });

// 2) tables in FK-safe order. name = prisma model accessor, table = physical name.
const TABLES = [
  ["designation", "Designation"], ["user", "User"], ["client", "Client"],
  ["stageItem", "StageItem"], ["masterItem", "MasterItem"], ["bankItem", "BankItem"],
  ["partnerItem", "PartnerItem"], ["channelItem", "ChannelItem"], ["slaRule", "SlaRule"],
  ["docRule", "DocRule"], ["feeRule", "FeeRule"], ["eiborRate", "EiborRate"],
  ["loanCase", "LoanCase"], ["task", "Task"], ["activity", "Activity"],
  ["instruction", "Instruction"], ["instrReply", "InstrReply"],
  ["bulletinItem", "BulletinItem"], ["bulletinTarget", "BulletinTarget"], ["reply", "Reply"],
  ["caseUpdate", "CaseUpdate"], ["stageTransition", "StageTransition"],
  ["clientSession", "ClientSession"], ["session", "Session"],
  ["emailLog", "EmailLog"], ["unmatchedEmail", "UnmatchedEmail"],
  ["caseDocument", "CaseDocument"], ["bankProduct", "BankProduct"],
  ["affordabilityCheck", "AffordabilityCheck"], ["proposal", "Proposal"],
];

console.log("[2/4] Copying data…");
const copied = [];
for (const [model, table] of TABLES) {
  const rows = await old[model].findMany();
  if (rows.length) await neu[model].createMany({ data: rows });
  copied.push([table, rows.length]);
  console.log(`  ${table}: ${rows.length}`);
}

// 3) identity sequences — createMany with explicit ids leaves them behind
console.log("[3/4] Resetting identity sequences…");
for (const [, table] of TABLES) {
  await neu.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('"${table}"','id'), COALESCE((SELECT MAX(id) FROM "${table}"), 1))`
  ).catch(() => {}); // tables without an id serial (EiborRate) just skip
}

// 4) verify
console.log("[4/4] Verifying…");
let ok = true;
for (const [model, table] of TABLES) {
  const a = await old[model].count();
  const b = await neu[model].count();
  if (a !== b) { ok = false; console.log(`  MISMATCH ${table}: old=${a} new=${b}`); }
}
console.log(ok ? "\n✅ All tables match. Next: verify the app, then swap DATABASE_URL in .env." : "\n❌ Mismatches found — do NOT cut over.");

await old.$disconnect();
await neu.$disconnect();
