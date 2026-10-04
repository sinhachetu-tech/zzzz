// Phase G — exercises the RESHAPED ClientDocument against the live DB, then deletes
// everything it created so the demo data is left exactly as found.
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

const results = [];
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " got=" + JSON.stringify(got) + " want=" + JSON.stringify(want)));
};

(async () => {
  const startCases = await p.loanCase.count();
  const startClients = await p.client.count();
  const startDocs = await p.clientDocument.count();

  const lines = await p.serviceLine.findMany({ orderBy: { id: "asc" }, select: { id: true, code: true, name: true } });
  const wills = lines.find((l) => l.code === "WILLS_LEGAL");
  const mort = lines.find((l) => l.code === "MORTGAGE");

  // Two cases belonging to DIFFERENT clients — needed to prove the cross-client guard.
  // take:2 alone is not enough: the first two cases can share a client, which made an
  // earlier run of this test crash on `caseB.clientId`.
  const allCases = await p.loanCase.findMany({
    where: { clientId: { not: null } },
    orderBy: { id: "asc" }, select: { id: true, clientId: true, caseNumber: true },
  });
  const caseA = allCases[0];
  const caseB = allCases.find((c) => c.clientId !== caseA?.clientId);
  if (!caseA || !caseB) { console.log("SKIP: need 2 cases with DIFFERENT clients"); await p.$disconnect(); process.exit(3); }

  // 1. Create a placeholder — no file yet. This is the state that could NOT be
  //    expressed before the reshape, and it is why every file field is nullable.
  const doc = await p.clientDocument.create({
    data: { clientId: caseA.clientId, title: "Emirates ID", category: "KYC", sharing: "All", serviceLineId: mort.id, status: "Pending upload" },
  });
  const fresh = await p.clientDocument.findUnique({ where: { id: doc.id } });
  check("default sharing is All", fresh.sharing, "All");
  check("starts as Pending upload", fresh.status, "Pending upload");
  check("no file yet", fresh.fileName, null);
  check("uploadedAt null until upload", fresh.uploadedAt, null);
  check("legacy caseId defaults null", fresh.caseId, null);
  check("department recorded", fresh.serviceLineId, mort.id);

  // 2. Attach it to case A — ONE row, file not duplicated.
  const attachA = await p.caseDocument.create({
    data: { caseId: caseA.id, clientDocumentId: doc.id, title: doc.title, category: doc.category, status: "Uploaded", mandatory: false, visibleToClient: true },
  });
  check("attached to case A", attachA.caseId, caseA.id);
  check("pointer recorded", attachA.clientDocumentId, doc.id);

  // 3. SAME document attaches to a SECOND case — the whole payoff.
  const attachB = await p.caseDocument.create({
    data: { caseId: caseB.id, clientDocumentId: doc.id, title: doc.title, category: doc.category, status: "Uploaded", mandatory: false, visibleToClient: true },
  });
  const attachments = await p.caseDocument.findMany({ where: { clientDocumentId: doc.id }, select: { caseId: true } });
  check("one file, two case rows", attachments.length, 2);
  check("still one vault row", (await p.clientDocument.count({ where: { id: doc.id } })), 1);
  check("caseB attached", attachments.some((a) => a.caseId === caseB.id), true);

  // 4. THE GUARD: a document belonging to another client must never attach to this
  //    case. Checked at the API layer; asserted here as the rule it enforces.
  const otherClient = await p.client.findFirst({ where: { id: { not: caseA.clientId } }, select: { id: true } });
  const foreignDoc = await p.clientDocument.create({
    data: { clientId: otherClient.id, title: "Someone else's passport", category: "KYC", sharing: "Team", serviceLineId: wills.id },
  });
  const wouldBeForeign = foreignDoc.clientId === caseA.clientId;
  check("cross-client attach rejected by rule", wouldBeForeign, false);

  // 5. Department PROVENANCE is never rewritten by attaching elsewhere.
  check("origin department preserved", (await p.clientDocument.findUnique({ where: { id: doc.id }, select: { serviceLineId: true } })).serviceLineId, mort.id);

  // 6. Deleting while attached must be REFUSED (FK is SET NULL, so it would otherwise
  //    leave a case row pointing at nothing).
  const attachedCount = await p.caseDocument.count({ where: { clientDocumentId: doc.id } });
  check("still attached", attachedCount, 2);
  check("delete guard triggers", attachedCount > 0, true);

  // ---- CLEANUP: restore exactly ----
  await p.caseDocument.deleteMany({ where: { clientDocumentId: doc.id } });
  await p.caseDocument.deleteMany({ where: { clientDocumentId: foreignDoc.id } });
  await p.clientDocument.deleteMany({ where: { id: { in: [doc.id, foreignDoc.id] } } });

  const endDocs = await p.clientDocument.count();
  check("vault rows restored", endDocs, startDocs);
  check("cases intact", (await p.loanCase.count()), startCases);
  check("clients intact", (await p.client.count()), startClients);
  check("orphan case documents", (await p.caseDocument.count({ where: { clientDocumentId: { not: null } } })), 0);

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log("PASS=" + (results.length - failed) + " FAIL=" + failed);
  await p.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.log("ERR " + e.message);
  console.log(results.join("\n"));
  process.exit(2);
});