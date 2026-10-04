// Phase A backfill — one CaseParty row per existing secondPartyClientId.
//
// The legacy column is LEFT ALONE. client-master.ts still reads and writes it, so
// clearing it would silently drop a co-borrower off a live file. Phase B keeps the
// two in step going forward; this only ADDS the rows the new relation can see.
//
// Idempotent: skips any (caseId, clientId) already present, which is exactly what
// the (caseId, clientId) unique index protects.

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

(async () => {
  const candidates = await prisma.loanCase.findMany({
    where: { secondPartyClientId: { not: null } },
    select: {
      id: true,
      caseNumber: true,
      secondPartyClientId: true,
      client: { select: { fullName: true } },
    },
    orderBy: { id: "asc" },
  });

  const existing = new Set(
    (await prisma.caseParty.findMany({ select: { caseId: true, clientId: true } })).map(
      (p) => `${p.caseId}:${p.clientId}`,
    ),
  );
  const todo = candidates.filter((c) => !existing.has(`${c.id}:${c.secondPartyClientId}`));

  console.log(APPLY ? `APPLYING — ${todo.length} row(s):` : `DRY RUN — ${todo.length} row(s) would be created:`);
  for (const c of todo) {
    console.log(`  ${c.caseNumber}  CoBorrower  ${c.client.fullName}`);
  }
  if (!todo.length) console.log("  (nothing to do — already backfilled)");

  if (!APPLY || !todo.length) {
    if (!APPLY) console.log("\nNothing written.");
    await prisma.$disconnect();
    return;
  }

  // A dangling secondPartyClientId would violate the FK and abort the whole
  // batch; skip those rather than losing the good rows with them.
  const data = todo
    .filter((c) => c.client && c.secondPartyClientId)
    .map((c) => ({
      caseId: c.id,
      clientId: c.secondPartyClientId as number,
      role: "CoBorrower",
      sortOrder: 0,
    }));
  const res = await prisma.caseParty.createMany({ data, skipDuplicates: true });
  console.log(`\ncreated ${res.count} row(s).`);
  await prisma.$disconnect();
})();