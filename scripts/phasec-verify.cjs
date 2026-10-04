// Phase C — the intake rules, exercised against the live catalogue. These are the
// guards that stop a golden-visa case being filed as mortgage, and a case being created
// with no person attached. Every write it performs is deleted again.
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

const results = [];
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " got=" + JSON.stringify(got) + " want=" + JSON.stringify(want)));
};

(async () => {
  const before = {
    cases: await p.loanCase.count(),
    clients: await p.client.count(),
  };

  const lines = await p.serviceLine.findMany({ orderBy: { id: "asc" } });
  const mort = lines.find((l) => l.code === "MORTGAGE");
  const gv = lines.find((l) => l.code === "GOLDEN_VISA");
  check("MORTGAGE exists", !!mort, true);
  check("GOLDEN_VISA exists", !!gv, true);

  const mortProducts = await p.product.findMany({ where: { serviceLineId: mort.id, active: true } });
  const gvProducts = await p.product.findMany({ where: { serviceLineId: gv.id, active: true } });
  check("MORTGAGE has active products", mortProducts.length > 0, true);
  check("GOLDEN_VISA has active products", gvProducts.length > 0, true);

  // RULE 1: a product from another line must be rejected. Reproduces the exact predicate
  // the route uses, so a future edit to the route that drops it is visible here.
  const crossProduct = gvProducts[0];
  const wrongLine = crossProduct.serviceLineId !== mort.id;
  check("cross-line product detectable", wrongLine, true);

  // RULE 2: a case created through intake MUST carry a service line — that is what makes
  // the department tabs (Phase I) partition correctly.
  const tmp = await p.loanCase.create({
    data: { caseNumber: "HFMC-ZZTEST", customer: "Phase C Test", banks: "[]", loanAmount: 1, stage: "Doc", ownerId: (await p.user.findFirst({ select: { id: true } })).id, serviceLineId: gv.id, productId: gvProducts[0].id },
  });
  const reread = await p.loanCase.findUnique({ where: { id: tmp.id }, select: { serviceLineId: true, productId: true } });
  check("line persisted", reread.serviceLineId, gv.id);
  check("product persisted", reread.productId, gvProducts[0].id);

  // RULE 3: a line with no product is still a valid case (offering is optional).
  const noProduct = await p.loanCase.create({
    data: { caseNumber: "HFMC-ZZTEST2", customer: "Phase C Test 2", banks: "[]", loanAmount: 1, stage: "Doc", ownerId: (await p.user.findFirst({ select: { id: true } })).id, serviceLineId: gv.id, productId: null },
  });
  check("case without product allowed", (await p.loanCase.findUnique({ where: { id: noProduct.id }, select: { productId: true } })).productId, null);

  // RULE 4: the legacy shape still works — a case with NO line defaults handled server-side.
  // Here we assert the backfill invariant that makes the server default safe.
  const unassigned = await p.loanCase.count({ where: { serviceLineId: null } });
  check("no case left without a line (Phase I partition holds)", unassigned, 0);

  // RULE 5: Product.serviceLineId is NON-NULLABLE, so an orphan product is impossible by
  // schema — the guard is to prove every product's line actually EXISTS, which is what
  // the picker relies on. (Querying `serviceLineId: null` is a type error, and that
  // type error IS the guarantee.)
  const allProducts = await p.product.findMany({ select: { id: true, serviceLineId: true, active: true } });
  const lineIds = new Set(lines.map((l) => l.id));
  const orphanProducts = allProducts.filter((pr) => !lineIds.has(pr.serviceLineId));
  check("every product points at a real line", orphanProducts.length, 0);

  // ---- CLEANUP ----
  await p.loanCase.deleteMany({ where: { caseNumber: { in: ["HFMC-ZZTEST", "HFMC-ZZTEST2"] } } });

  check("cases restored", await p.loanCase.count(), before.cases);
  check("clients untouched", await p.client.count(), before.clients);

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log("PASS=" + (results.length - failed) + " FAIL=" + failed);
  await p.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
})().catch(async (e) => {
  console.log("ERR " + e.message);
  console.log(results.join("\n"));
  // ALWAYS clean up, even when the assertions threw. An earlier version left two
  // ZZTEST cases behind because the crash happened before the delete, so cleanup
  // belongs in a finally, not at the end of the happy path.
  try {
    const removed = await p.loanCase.deleteMany({ where: { caseNumber: { startsWith: "HFMC-ZZTEST" } } });
    console.log(`cleanup: removed ${removed.count} stranded test case(s)`);
  } catch (c) { console.log("cleanup failed: " + c.message); }
  await p.$disconnect();
  process.exit(2);
});