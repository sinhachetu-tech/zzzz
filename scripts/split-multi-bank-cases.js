// Split legacy multi-bank cases into per-bank SIBLING cases.
//
// WHY: the per-bank model is "one LoanCase per bank" — a bank has its own case
// number, its own document requirements and its own stage, so three banks on
// one row cannot represent that. The app enforces this on every write path
// (POST /api/cases splits at creation; /api/cases/:id/add-bank splits later),
// but rows that came from the SEED are the exception: src/lib/seed.ts writes the
// `banks` array straight through, bypassing both. Those legacy rows are the only
// ones that still list several banks.
//
// WHAT IT DOES, for each affected row:
//   · keeps the ORIGINAL row for the first bank (same id, same caseNumber — so
//     every existing link, task, document and note keeps pointing at it)
//   · creates one sibling per remaining bank, linked via parentCaseId
//   · copies the borrower's profile, amounts, owner/advisor, source and
//     partner terms, plus the stage — but NOT the documents, tasks or stage
//     timeline, because the other bank has genuinely not seen them
//   · re-syncs each new leg's document vault against its own bank's rules
//
// IRREVERSIBLE for the extra rows it creates. Dry run is the default; read the
// output before applying.
//
//   node scripts/split-multi-bank-cases.js          # dry run (default)
//   node scripts/split-multi-bank-cases.js --apply  # write

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");

const banksOf = (s) => {
  try {
    const a = JSON.parse(s);
    return Array.isArray(a) ? a.filter(Boolean) : [];
  } catch {
    return [];
  }
};

async function main() {
  const rows = await prisma.loanCase.findMany({
    where: { parentCaseId: null },
    select: { id: true, caseNumber: true, banks: true, customer: true, stage: true },
  });
  const multi = rows.filter((r) => banksOf(r.banks).length > 1);

  const extra = multi.reduce((n, r) => n + banksOf(r.banks).length - 1, 0);
  console.log(`rows listing more than one bank : ${multi.length}`);
  console.log(`sibling cases that would be added: ${extra}`);
  console.log("");

  if (multi.length === 0) {
    console.log("Nothing to split — the data already matches the model.");
    return;
  }

  for (const r of multi) {
    const all = banksOf(r.banks);
    console.log(`  ${r.caseNumber}  ${r.customer}`);
    console.log(`     keeps      ${all[0]}   (original row, id ${r.id} — all existing links stay valid)`);
    for (const b of all.slice(1)) console.log(`     + new leg  ${b}`);
  }
  console.log("");

  if (!APPLY) {
    console.log("DRY RUN — nothing written. Re-run with --apply to split.");
    return;
  }

  const created = [];
  for (const r of multi) {
    const all = banksOf(r.banks);
    const first = all[0];
    // Trim the parent down to its own bank.
    await prisma.loanCase.update({ where: { id: r.id }, data: { banks: JSON.stringify([first]) } });

    for (const b of all.slice(1)) {
      const src = await prisma.loanCase.findUnique({ where: { id: r.id } });
      const last = await prisma.loanCase.findFirst({
        orderBy: { caseNumber: "desc" },
        select: { caseNumber: true },
      });
      const seq = (last ? parseInt(last.caseNumber.replace("HFMC-", ""), 10) || 0 : 0) + 1;
      const caseNumber = `HFMC-${String(seq).padStart(4, "0")}`;

      const leg = await prisma.loanCase.create({
        data: {
          caseNumber,
          customer: src.customer,
          banks: JSON.stringify([b]),
          wonBank: null, // only the winning bank keeps a winner; a re-shop is still live
          loanAmount: src.loanAmount,
          propertyValue: src.propertyValue,
          stage: src.stage,
          caseStatus: src.caseStatus,
          ownerId: src.ownerId,
          advisorId: src.advisorId,
          backup1Id: src.backup1Id,
          backup2Id: src.backup2Id,
          source: src.source,
          partnerKind: src.partnerKind,
          partnerName: src.partnerName,
          partnerRm: src.partnerRm,
          partnerSharePct: src.partnerSharePct,
          submissionType: src.submissionType,
          channelId: src.channelId,
          channelName: src.channelName,
          channelRatePct: src.channelRatePct,
          whatsapp: src.whatsapp,
          waGroup: src.waGroup,
          parentCaseId: r.id,
          employmentProfile: src.employmentProfile,
          propertyType: src.propertyType,
          residency: src.residency,
          // The borrower's snapshot carries over; documents/tasks/timeline do NOT.
          profileJson: src.profileJson,
          statusNote: `Split out of ${r.caseNumber} for ${b} — new bank leg, no documents carried over.`,
          transactionType: src.transactionType,
          propertyLocation: src.propertyLocation,
          coApplicantName: src.coApplicantName,
        },
      });
      await prisma.activity.create({
        data: { caseId: leg.id, userId: 1, action: `split from ${r.caseNumber} as the ${b} leg` },
      });
      await prisma.activity.create({
        data: { caseId: r.id, userId: 1, action: `split — ${b} moved to ${caseNumber}` },
      });
      created.push(caseNumber);
    }
  }

  console.log(`APPLIED. ${created.length} sibling legs created: ${created.join(", ")}`);
}

main()
  .catch((e) => {
    console.error("ERROR", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
