// Backfill LoanCase.convertedAt for rows converted BEFORE the stamp existed.
//
// WHY: the conversion stamp was added when the Leads/Cases work was rebuilt, but
// every existing case had already passed through the funnel, so all of them have
// convertedAt = null. That made the "Converted leads" archive — the only place a
// qualified file can be re-owned or re-shopped — render as empty, i.e. the
// feature was useless on real data.
//
// RULE: a row whose stage is no longer "Lead" HAS left the funnel, so it gets
// convertedAt = createdAt. That is deliberately a lower bound: createdAt is when
// the enquiry arrived, and the real conversion was later. We have no better
// signal for historical rows.
//
// ACCURACY NOTE (matters, do not "fix" it by assuming otherwise):
//   · source Website / Agent / Broker / Referral — these ALWAYS entered through a
//     Lead (portal registration and agent onboarding both create at stage
//     "Lead"), so for them the backfill is not just a guess: they were leads.
//   · source Direct — AMBIGUOUS. It may have been a converted direct enquiry OR
//     opened straight into the pipeline from the New Case modal. Historical data
//     cannot tell the two apart, so they are stamped too. This slightly
//     over-counts the Cases tab's "From lead" saved view; it does not affect any
//     document rule, vault or pricing behaviour.
//
// SAFE / REVERSIBLE: it only fills a NULL column, never overwrites an existing
// stamp, so the 2 genuinely-stamped rows are left alone. Set convertedById to
// null because the person who converted a 2025 file is genuinely unknown.
//
//   node scripts/backfill-converted-at.js          # dry run (default)
//   node scripts/backfill-converted-at.js --apply  # write

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");

async function main() {
  const targets = await prisma.loanCase.findMany({
    where: { convertedAt: null, stage: { not: "Lead" } },
    select: { id: true, caseNumber: true, stage: true, source: true, createdAt: true },
  });

  const certainlyLeads = targets.filter((c) => ["Website", "Agent", "Broker", "Referral"].includes(c.source));
  const ambiguous = targets.filter((c) => c.source === "Direct");

  console.log(`rows needing a stamp : ${targets.length}`);
  console.log(`  certainly a lead   : ${certainlyLeads.length}  (Website / Agent / Broker / Referral)`);
  console.log(`  ambiguous (Direct) : ${ambiguous.length}  (converted enquiry OR opened straight in)`);
  console.log("");

  if (targets.length === 0) {
    console.log("nothing to do.");
    return;
  }

  if (!APPLY) {
    console.log("DRY RUN — sample of what would be written:");
    for (const c of targets.slice(0, 8)) {
      console.log(`  ${c.caseNumber}  ${c.stage.padEnd(26)} ${c.source.padEnd(9)} → convertedAt ${c.createdAt.toISOString()}`);
    }
    if (targets.length > 8) console.log(`  … and ${targets.length - 8} more`);
    console.log("");
    console.log("re-run with --apply to write.");
    return;
  }

  // One transaction so a mid-way failure cannot leave half the funnel stamped.
  // convertedById stays null: for a historical file the person who converted it
  // is genuinely unknown, and a wrong name is worse than no name.
  await prisma.$transaction(
    targets.map((t) =>
      prisma.loanCase.update({
        where: { id: t.id },
        data: { convertedAt: t.createdAt, convertedById: null },
      }),
    ),
  );

  const stamped = await prisma.loanCase.count({ where: { NOT: { convertedAt: null } } });
  const stillNull = await prisma.loanCase.count({ where: { convertedAt: null, stage: { not: "Lead" } } });
  console.log(`APPLIED. rows with a stamp: ${stamped}`);
  console.log(`still unstamped past the funnel: ${stillNull}  (expected 0)`);
}

main()
  .catch((e) => {
    console.error("ERROR", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
