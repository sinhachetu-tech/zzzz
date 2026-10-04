// Generate the ADDITIVE SQL for the current schema change by diffing the LIVE
// database against the updated datamodel. Deliberately NOT `prisma migrate dev`:
//
//   prisma migrate dev reported "Drift detected… We need to reset the public
//   schema. All data will be lost."
//
// because this repo has NO migration history (prisma/migrations has no
// migration_lock.toml — the database was created with `prisma db push`). So
// migrate dev wants to drop everything and replay from zero. Never run it here.
//
// Instead we diff live-DB → datamodel and apply only the CREATE TABLE /
// ALTER TABLE ADD COLUMN statements, which are additive by construction.
//
//   node scripts/phase3-gen-sql.cjs

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const SQL_OUT = process.env.SQL_OUT || "prisma/phase3_client_sessions.sql";

function envUrl() {
  const envFile = fs.readFileSync(path.join(root, ".env"), "utf8");
  const m = envFile.match(/^DATABASE_URL\s*=\s*(.+)$/m);
  if (!m) throw new Error("DATABASE_URL not found in .env");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

const out = execSync(
  `npx prisma migrate diff --from-url "${envUrl()}" --to-schema-datamodel prisma/schema.prisma --script`,
  { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
);

const dest = path.join(root, SQL_OUT);
fs.writeFileSync(dest, out, "utf8");

const destructive = out
  .split("\n")
  .filter((l) => /^\s*(DROP|TRUNCATE|DELETE FROM|ALTER COLUMN.*TYPE)\b/i.test(l));
console.log(`wrote ${dest}`);
console.log(`statements: ${out.split(";").length - 1}`);
if (destructive.length) {
  console.error("\nDESTRUCTIVE STATEMENTS DETECTED — do not apply as-is:");
  for (const d of destructive) console.error("  " + d.trim());
  process.exitCode = 1;
} else {
  console.log("safety check: purely additive (no DROP/TRUNCATE/DELETE/ALTER TYPE)");
}