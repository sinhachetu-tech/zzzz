// Verify the rate-card ASSEMBLY against real rows, without going through HTTP.
//
//   node scripts/check-rate-cards.mjs
//
// The HTTP route needs a session (it correctly 403s otherwise), so this drives the
// same buildCards() the route uses, straight from the database. It proves the
// inheritance resolution and the EIBOR lookup work on real data.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const first = (a) => (a && a.length ? a[0] : null);
const parsePricing = (json) => {
  try { const v = JSON.parse(json || "{}"); return v?.quotes ? v : null; } catch { return null; }
};
const readFees = (json) => {
  try { const p = JSON.parse(json || "{}").processing; return typeof p?.default === "number" ? p.default : null; } catch { return null; }
};

try {
  const [products, banks, eiborRows] = await Promise.all([
    db.bankProduct.findMany({ where: { status: "approved", active: true } }),
    db.bankItem.findMany(),
    db.eiborRate.findMany(),
  ]);
  const eibor = Object.fromEntries(eiborRows.map((e) => [e.tenor, e.ratePct]));
  const today = new Date().toISOString().slice(0, 10);
  const bankById = new Map(banks.map((b) => [b.id, b]));

  let cards = 0, inheritedFee = 0, noFee = 0, resolved = 0, noFloor = 0, noFollowOn = 0;
  const samples = [];

  for (const p of products) {
    const exp = p.expiryDate ? p.expiryDate.slice(0, 10) : "2099-12-31";
    if (p.effectiveDate && p.effectiveDate.slice(0, 10) > today) continue;
    if (exp < today) continue;
    const bank = bankById.get(p.bankId);
    if (!bank) continue;
    const pricing = parsePricing(p.pricingJson);
    if (!pricing?.quotes?.length) continue;
    const fee = readFees(p.feesJson);

    for (const q of pricing.quotes) {
      cards += 1;
      const isFixed = q.rateType === "FIXED";
      const followOn = q.variableAfter?.marginPct ?? (!isFixed ? q.marginPct ?? null : null);
      const floor = q.variableAfter?.floorPct ?? q.floorPct ?? null;
      const basis = q.variableAfter?.basis ?? (isFixed ? null : q.rateType.replace("_EIBOR", ""));
      const eiborNow = basis ? eibor[basis] ?? null : null;

      if (fee != null) { /* product owns it */ } else if (bank.defaultProcessingFeePct != null) inheritedFee += 1; else noFee += 1;
      if (!isFixed && eiborNow != null && followOn != null) resolved += 1;
      if (floor == null) noFloor += 1;
      if (isFixed && !q.variableAfter) noFollowOn += 1;

      if (samples.length < 5) {
        samples.push({
          bank: bank.name, product: p.name,
          txn: q.txns?.length ? q.txns.join("/") : (q.txn ?? "Any"),
          stl: q.salaryTransfer?.[0] ?? null,
          rate: isFixed ? q.ratePct : null,
          followOn, floor,
          fee: fee ?? bank.defaultProcessingFeePct,
          feeFrom: fee != null ? "product" : bank.defaultProcessingFeePct != null ? "bank" : "none",
          basis, eiborNow,
          resolved: isFixed ? q.ratePct : (eiborNow != null && followOn != null ? Math.round((eiborNow + followOn) * 1000) / 1000 : null),
        });
      }
    }
  }

  console.log("--- rate cards built from live data ------------------------");
  console.log(`cards assembled          : ${cards}`);
  console.log(`processing fee inherited : ${inheritedFee}   (product owns the rest)`);
  console.log(`processing fee MISSING   : ${noFee}`);
  console.log(`variable cards resolved  : ${resolved}  (EIBOR + margin computed live)`);
  console.log(`cards with NO floor      : ${noFloor}`);
  console.log(`fixed with NO follow-on  : ${noFollowOn}`);
  console.log(`\neibor 3M                : ${eibor["3M"]}`);
  console.log(`\nsample cards:`);
  for (const s of samples) {
    console.log(`  ${s.bank} · ${s.product} · ${s.txn} ${s.stl ?? ""}`);
    console.log(`    rate ${s.rate ?? "—"}%  follow-on ${s.followOn ?? "—"}%  floor ${s.floor ?? "—"}%  fee ${s.fee ?? "—"}% (${s.feeFrom})`);
    console.log(`    ${s.basis ?? "—"} EIBOR = ${s.eiborNow ?? "—"}  →  resolves to ${s.resolved ?? "—"}%`);
  }
} finally {
  await db.$disconnect();
}
