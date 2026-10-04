// Migrates legacy "lead-stage" LoanCase rows into the real Lead table (Phase 4).
//
// WHY: before Phase 4 a lead was a LoanCase with stage === "Lead" — a full case
// row (40 mortgage date columns, a case number, a pipeline stage) for someone
// who had typed a name and a phone number. The Leads view now reads the Lead
// table, so those rows would otherwise vanish from the funnel entirely.
//
// WHAT IS AND IS NOT MOVED. The LoanCase row is LEFT ALONE. It is not deleted
// and not blanked. It keeps its case number, its client link and its document
// vault, because a lead-stage case may already have documents attached or a
// ClientSession pointing at it (Phase 3 sessions are case-scoped). The new Lead
// row POINTS BACK at that case via caseId, so:
//   - the Leads list shows it (it is a lead again)
//   - converting it adopts the SAME case rather than creating a second one
//   - nothing live is orphaned
//
// IDEMPOTENT: a case that already has a Lead pointing at it is skipped. Re-running
// after new legacy rows appear picks up only the new ones.
//
// USAGE:  node scripts/migrate-legacy-leads.cjs          (dry run, writes nothing)
//         node scripts/migrate-legacy-leads.cjs --apply

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  // MORTGAGE is the only line that existed before this migration, so every
  // legacy lead-stage case belongs to it. Nothing is GUESSED — the rows have no
  // service line because they predate the concept.
  const mortgage = await prisma.serviceLine.findUnique({ where: { code: "MORTGAGE" } });
  if (!mortgage) throw new Error("MORTGAGE service line missing — run the Phase 1 seed first");

  const alreadyLinked = await prisma.lead.findMany({ where: { caseId: { not: null } }, select: { caseId: true } });
  const linked = new Set(alreadyLinked.map((l) => l.caseId));

  const candidates = await prisma.loanCase.findMany({
    where: { stage: "Lead", caseStatus: { not: "Closed" } },
    orderBy: { id: "asc" },
    select: {
      id: true, caseNumber: true, customer: true, whatsapp: true, loanAmount: true,
      ownerId: true, source: true, createdAt: true, clientId: true, profileJson: true,
    },
  });

  const todo = candidates.filter((c) => !linked.has(c.id));
  console.log(`legacy lead-stage cases: ${candidates.length}`);
  console.log(`already have a Lead:    ${candidates.length - todo.length}`);
  console.log(`to create:              ${todo.length}`);

  for (const c of todo) {
    // Pull contact details out of the case profile snapshot when it has one —
    // that is where a returning client's email and EID live.
    let email = null;
    let eidNo = null;
    if (c.profileJson) {
      try {
        const p = JSON.parse(c.profileJson);
        email = p?.primary?.email ?? null;
        eidNo = p?.primary?.eidNo ?? null;
      } catch { /* a malformed snapshot must not abort the migration */ }
    }
    const phone = (c.whatsapp || "").replace(/\D/g, "");
    console.log(
      `  ${c.caseNumber}  ${c.customer.padEnd(22)} phone=${(phone || "none").padEnd(12)} ` +
      `amount=${c.loanAmount || 0} owner=${c.ownerId ?? "none"} ${email ? `email=${email}` : ""} ${eidNo ? `eid=${eidNo}` : ""}`,
    );
  }

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to create the Lead rows.");
    return;
  }

  let made = 0;
  for (const c of todo) {
    let email = null;
    if (c.profileJson) {
      try { email = JSON.parse(c.profileJson)?.primary?.email ?? null; } catch { /* ignore */ }
    }
    // firstContactedAt is deliberately NULL even though these rows are old: the
    // contact happened, but we cannot prove WHEN, and stamping createdAt would
    // make an untouched lead look freshly chased.
    await prisma.lead.create({
      data: {
        fullName: c.customer,
        phone: (c.whatsapp || "").replace(/\D/g, ""),
        email,
        serviceLineId: mortgage.id,
        intendedAmount: c.loanAmount > 0 ? c.loanAmount : null,
        source: c.source || "Direct",
        // The case number is the link a human needs to find the old record.
        sourceDetail: `Migrated from case ${c.caseNumber}`,
        status: "New",
        ownerId: c.ownerId,
        clientId: c.clientId,
        caseId: c.id,
        createdAt: c.createdAt,
      },
    });
    made++;
  }

  console.log(`\nAPPLIED. Lead rows created: ${made}`);
  console.log(`total leads now: ${await prisma.lead.count()}`);
  console.log(`loanCase rows unchanged: ${await prisma.loanCase.count()}`);
}

main()
  .catch((e) => { console.error("ERR", e); process.exit(1); })
  .finally(() => prisma.$disconnect());