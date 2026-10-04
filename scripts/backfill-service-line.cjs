// Phase 1 backfill — assign every EXISTING row to the MORTGAGE service line.
//
// WHY THIS IS SAFE TO CALL FACTUAL: the firm had only ever run mortgage work
// before this migration (Wills/Insurance/Real Estate were hardcoded "Coming soon"
// cards in the client portal, and there is no service table anywhere in the old
// schema). So "every existing row is a mortgage" is not an assumption — it is
// what the code could previously express.
//
// SCOPE, deliberately narrow:
//   · LoanCase     → serviceLineId = MORTGAGE   (productId stays NULL — we do
//     NOT guess which product; transactionType could inform it, but a wrong
//     product is worse than none, so null means "not classified yet")
//   · StageItem    → its own default StageSet under MORTGAGE (the 5 stages)
//   · DocRule      → MORTGAGE (every axis on it is mortgage vocabulary)
//   · SlaRule      → MORTGAGE
//   · CommTemplate → MORTGAGE (stageKey is one of the 5 mortgage keys)
//
// NEVER touches rows that already have a value, so re-running is safe.
// Dry run by default; the whole thing is one transaction.
//
//   node scripts/backfill-service-line.mjs           # dry run
//   node scripts/backfill-service-line.mjs --apply

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const lines = await prisma.$queryRawUnsafe(`SELECT id, code FROM "ServiceLine" WHERE code = 'MORTGAGE'`);
  if (!lines.length) {
    console.error("MORTGAGE service line is missing — run scripts/seed-service-lines.cjs --apply first.");
    process.exitCode = 1;
    return;
  }
  const mortgageId = lines[0].id;

  // Counts of what still needs filling — these are the "before" numbers.
  const count = async (sql, ...p) => (await prisma.$queryRawUnsafe(sql, ...p))[0].n;
  const before = {
    cases: await count(`SELECT count(*)::int AS n FROM "LoanCase" WHERE "serviceLineId" IS NULL`),
    stages: await count(`SELECT count(*)::int AS n FROM "StageItem" WHERE "stageSetId" IS NULL`),
    docRules: await count(`SELECT count(*)::int AS n FROM "DocRule" WHERE "serviceLineId" IS NULL`),
    slaRules: await count(`SELECT count(*)::int AS n FROM "SlaRule" WHERE "serviceLineId" IS NULL`),
    comms: await count(`SELECT count(*)::int AS n FROM "CommTemplate" WHERE "serviceLineId" IS NULL`),
  };

  console.log("rows still needing a service line (MORTGAGE)");
  console.log(`  LoanCase      : ${before.cases}`);
  console.log(`  StageItem     : ${before.stages}`);
  console.log(`  DocRule       : ${before.docRules}`);
  console.log(`  SlaRule       : ${before.slaRules}`);
  console.log(`  CommTemplate  : ${before.comms}`);
  console.log(`\nproductId is intentionally left NULL on cases — we do not guess`);
  console.log(`which product; null reads as "not classified yet".\n`);

  if (before.cases + before.stages + before.docRules + before.slaRules + before.comms === 0) {
    console.log("Nothing to do — every row already has a service line.");
    return;
  }
  if (!APPLY) {
    console.log("DRY RUN — nothing written. Re-run with --apply.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    // A default stage set for the mortgage journey, so the 5 existing stages can
    // hang off something. Phase 5 gives each service line its own set.
    await tx.$executeRawUnsafe(
      `INSERT INTO "StageSet" ("serviceLineId", name, active, "sortOrder", "isDefault", "createdAt", "updatedAt")
       VALUES ($1, 'Mortgage journey', true, 1, true, now(), now())
       ON CONFLICT ("serviceLineId", name) DO NOTHING`,
      mortgageId,
    );
    const sets = await tx.$queryRawUnsafe(
      `SELECT id FROM "StageSet" WHERE "serviceLineId" = $1 AND name = 'Mortgage journey'`,
      mortgageId,
    );
    const stageSetId = sets[0].id;

    await tx.$executeRawUnsafe(`UPDATE "LoanCase" SET "serviceLineId" = $1 WHERE "serviceLineId" IS NULL`, mortgageId);
    await tx.$executeRawUnsafe(`UPDATE "StageItem" SET "stageSetId" = $1 WHERE "stageSetId" IS NULL`, stageSetId);
    await tx.$executeRawUnsafe(`UPDATE "DocRule" SET "serviceLineId" = $1 WHERE "serviceLineId" IS NULL`, mortgageId);
    await tx.$executeRawUnsafe(`UPDATE "SlaRule" SET "serviceLineId" = $1 WHERE "serviceLineId" IS NULL`, mortgageId);
    await tx.$executeRawUnsafe(`UPDATE "CommTemplate" SET "serviceLineId" = $1 WHERE "serviceLineId" IS NULL`, mortgageId);
  });

  const after = {
    cases: await count(`SELECT count(*)::int AS n FROM "LoanCase" WHERE "serviceLineId" IS NULL`),
    stages: await count(`SELECT count(*)::int AS n FROM "StageItem" WHERE "stageSetId" IS NULL`),
    docRules: await count(`SELECT count(*)::int AS n FROM "DocRule" WHERE "serviceLineId" IS NULL`),
  };
  const staged = await count(`SELECT count(*)::int AS n FROM "StageItem" WHERE "stageSetId" IS NOT NULL`);
  console.log(`APPLIED. LoanCase unassigned: ${before.cases} → ${after.cases}`);
  console.log(`StageItem in the mortgage journey: ${after.stages === 0 ? staged : 0} of ${before.stages}`);
  console.log(`DocRule unassigned: ${before.docRules} → ${after.docRules}`);
}

main()
  .catch((e) => { console.error("ERROR", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());