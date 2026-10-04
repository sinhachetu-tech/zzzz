// Remove debris left by CRASHED runs of phaseg-verify.cjs. Scoped deliberately: only
// rows whose title matches what that test creates, and only pointers into those rows —
// so this can never touch real data even if run by accident on a populated database.
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

(async () => {
  const beforeVault = await p.clientDocument.count();
  const beforeCases = await p.caseDocument.count();

  const junk = await p.clientDocument.findMany({ where: { title: "Emirates ID" }, select: { id: true } });
  const junkIds = junk.map((d) => d.id);
  console.log("vault rows to remove: " + junkIds.length + (junkIds.length ? " " + junkIds.join(",") : ""));

  const ptrs = await p.caseDocument.findMany({ where: { clientDocumentId: { in: junkIds } }, select: { id: true } });
  console.log("case documents to remove: " + ptrs.length);

  if (ptrs.length) await p.caseDocument.deleteMany({ where: { id: { in: ptrs.map((c) => c.id) } } });
  if (junkIds.length) await p.clientDocument.deleteMany({ where: { id: { in: junkIds } } });

  console.log(`vault   : ${beforeVault} -> ${await p.clientDocument.count()}`);
  console.log(`caseDoc : ${beforeCases} -> ${await p.caseDocument.count()}`);
  console.log("pointers left: " + (await p.caseDocument.count({ where: { clientDocumentId: { not: null } } })));
  console.log("cases=" + (await p.loanCase.count()) + " clients=" + (await p.client.count()));
  await p.$disconnect();
})().catch((e) => { console.log("ERR " + e.message); process.exit(1); });