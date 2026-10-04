// Phase B test — DATABASE-level invariants of CaseParty, against the live demo DB.
// Everything is rolled back, so the data is left exactly as found.
//
// SCOPE, stated plainly so nobody over-reads a green result:
//   This proves what the DATABASE enforces — the unique index, the cascade, the
//   foreign keys, and that the table carries no personal data.
//   It does NOT prove the legacy-slot handover logic in
//   src/app/api/cases/[id]/parties/route.ts: that is TypeScript and this repo has
//   no tsx/ts-node, so a .cjs script cannot import it. Re-implementing the rule
//   here would make the test pass while the shipped helper was broken — worse
//   than not testing it. The handover rests on tsc + reading the route.
//
//   node scripts/phase5-test-parties.cjs

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

let pass = 0;
let fail = 0;

function check(label, cond, detail) {
  if (cond) {
    pass++;
    console.log("  PASS  " + label);
  } else {
    fail++;
    console.log("  FAIL  " + label + (detail ? "   <- " + detail : ""));
  }
}

(async () => {
  // A case with a primary applicant and no parties yet, so the test starts from a
  // known state without disturbing the one real party row.
  const kase = await prisma.loanCase.findFirst({
    where: { clientId: { not: null }, caseParties: { none: {} } },
    orderBy: { id: "asc" },
    select: { id: true, caseNumber: true, clientId: true, ownerId: true, secondPartyClientId: true },
  });
  if (!kase) {
    console.log("no suitable test case found");
    await prisma.$disconnect();
    process.exitCode = 1;
    return;
  }
  console.log("test case: " + kase.caseNumber + " (id " + kase.id + ")");
  console.log("");

  const stamp = Date.now();
  const tail = String(stamp % 100000).padStart(5, "0");
  const alice = await prisma.client.create({
    data: { fullName: "ZZ Test Alice " + stamp, phone: "97150000" + tail },
  });
  const bob = await prisma.client.create({
    data: { fullName: "ZZ Test Bob " + stamp, phone: "97150001" + tail },
  });

  try {
    // 1. unique index refuses the same person twice on one case
    await prisma.caseParty.create({
      data: { caseId: kase.id, clientId: alice.id, role: "CoBorrower", sortOrder: 0 },
    });
    let dupBlocked = false;
    try {
      await prisma.caseParty.create({
        data: { caseId: kase.id, clientId: alice.id, role: "CoApplicant", sortOrder: 1 },
      });
    } catch {
      dupBlocked = true;
    }
    check("same person cannot be added twice", dupBlocked);

    // 2. two different people coexist — the whole point of this table over
    //    secondPartyClientId, which could only ever hold one
    const bobParty = await prisma.caseParty.create({
      data: { caseId: kase.id, clientId: bob.id, role: "Guarantor", sortOrder: 1 },
    });
    const both = await prisma.caseParty.findMany({ where: { caseId: kase.id } });
    check("two parties coexist on one case", both.length === 2, "got " + both.length);

    // 3. THE BOUNDARY — a CaseParty row stores ONLY the link. No personal data is
    //    duplicated, so one Client can hold different roles on many cases without
    //    any of them disagreeing about who the person is. This is the rule the
    //    whole multi-service model rests on, so it earns an automated check.
    //    Matched case-insensitively but on WORD BOUNDARIES: a loose substring test
    //    flags "caseId" (it contains "eid") and produces a false alarm.
    const ALLOWED = new Set(["id", "caseId", "clientId", "role", "sortOrder", "createdAt"]);
    const extra = Object.keys(both[0]).filter((k) => !ALLOWED.has(k));
    check("CaseParty holds no personal data (Client only)", extra.length === 0, "unexpected columns: " + extra.join(","));

    // 4. role round-trips
    check("role round-trips", bobParty.role === "Guarantor", "got " + bobParty.role);

    // 5. cascade — deleting a case takes its parties with it, never orphaning them
    const tmp = await prisma.loanCase.create({
      data: {
        caseNumber: "ZZTMP" + stamp,
        customer: "ZZ Temp",
        clientId: kase.clientId,
        ownerId: kase.ownerId, // REQUIRED relation
        loanAmount: 0, // REQUIRED — omitting it throws and skips the cleanup below
        stage: "Lead", // also REQUIRED
      },
    });
    await prisma.caseParty.create({
      data: { caseId: tmp.id, clientId: alice.id, role: "CoBorrower" },
    });
    await prisma.loanCase.delete({ where: { id: tmp.id } });
    const orphans = await prisma.caseParty.count({ where: { caseId: tmp.id } });
    check("deleting a case cascades its parties (no orphans)", orphans === 0, "orphans " + orphans);

    // 6. FK holds — a party cannot point at a client that does not exist
    let fkBlocked = false;
    try {
      await prisma.caseParty.create({
        data: { caseId: kase.id, clientId: 99999999, role: "CoBorrower", sortOrder: 9 },
      });
    } catch {
      fkBlocked = true;
    }
    check("a party cannot reference a non-existent client", fkBlocked);
  } finally {
    // Leave the demo data exactly as found.
    await prisma.caseParty.deleteMany({ where: { caseId: kase.id } });
    await prisma.loanCase.update({
      where: { id: kase.id },
      data: { secondPartyClientId: kase.secondPartyClientId },
    });
    await prisma.client.deleteMany({ where: { id: { in: [alice.id, bob.id] } } });
    await prisma.$disconnect();
  }

  console.log("");
  console.log(pass + " passed, " + fail + " failed");
  if (fail) process.exitCode = 1;
})();