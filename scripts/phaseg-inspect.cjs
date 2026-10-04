// Inspect the LIVE ClientDocument table before reshaping it (Phase G). Read-only.
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

(async () => {
  const rows = await p.clientDocument.findMany({ orderBy: { id: "asc" } });
  console.log("rows=" + rows.length);
  console.log(JSON.stringify(rows.slice(0, 8), null, 1));

  const cases = await p.loanCase.count();
  const clients = await p.client.count();
  console.log("cases=" + cases + " clients=" + clients);

  // Are these rows attached to cases that still exist, and to clients?
  const caseIds = [...new Set(rows.map((r) => r.caseId))];
  const withCase = await p.loanCase.count({ where: { id: { in: caseIds } } });
  console.log("distinct caseIds referenced=" + caseIds.length + " still present=" + withCase);
  await p.$disconnect();
})().catch((e) => {
  console.log("ERR " + e.message);
  process.exit(1);
});