// Verify the product browser's ROW SHAPE against the live database.
//
// WHY this exists: /api/products flattens BankProduct + its quote lines into a
// broker-facing list, and a silent mistake there (a product with no quotes, a
// malformed pricingJson, a quote whose follow-on recipe is missing) would show up as
// an empty catalogue with no error anywhere. This prints what the browser would
// actually list so it can be eyeballed against a known bank.
//
//   node scripts/check-products.mjs
import { PrismaClient } from "@prisma/client";

/** Mirrors parsePricing() in src/lib/bank-pricing.ts. Duplicated deliberately: that
 *  module imports via the "@/lib" alias, which plain node cannot resolve, and this
 *  diagnostic must stay runnable without a bundler. Keep the two in step. */
const parsePricing = (json) => {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return v?.quotes ? v : null;
  } catch {
    return null;
  }
};

const db = new PrismaClient();

try {
  const products = await db.bankProduct.findMany({
    where: { status: "approved", active: true },
    include: { bank: { select: { name: true, logoData: true } } },
  });
  const today = new Date().toISOString().slice(0, 10);

  let rows = 0, noQuotes = 0, badJson = 0, fixedNoFollowOn = 0, exclusive = 0;
  const byBank = {};
  const samples = [];

  for (const p of products) {
    const exp = p.expiryDate ? p.expiryDate.slice(0, 10) : "2099-12-31";
    if (exp < today) continue;
    const pricing = parsePricing(p.pricingJson);
    if (pricing === null && p.pricingJson && p.pricingJson !== "{}") badJson += 1;
    if (!pricing?.quotes?.length) { noQuotes += 1; continue; }
    for (const q of pricing.quotes) {
      rows += 1;
      byBank[p.bank.name] = (byBank[p.bank.name] ?? 0) + 1;
      if (q.rateType === "FIXED" && !q.variableAfter) fixedNoFollowOn += 1;
      if (p.isExclusive || (q.profiles ?? []).some((x) => /exclusive/i.test(x))) exclusive += 1;
      if (samples.length < 8) {
        samples.push({
          bank: p.bank.name,
          logo: !!p.bank.logoData,
          product: p.name,
          covers: [
            p.loanKind || "—",
            q.salaryTransfer?.[0] ?? (q.stl != null ? (q.stl ? "STL" : "NSTL") : null),
            q.residency?.[0] ?? p.residency,
            q.employment?.[0] ?? p.employment,
            q.profiles?.[0] ?? null,
            (q.txns?.length ? q.txns : (q.txn ? [q.txn] : [])).join("/") || "Any",
          ].filter(Boolean).join(" ∙ "),
          rate: q.rateType === "FIXED" ? `${q.ratePct ?? "?"}% fixed ${q.termYears ?? 0}y` : `+${q.marginPct ?? "?"}% ${q.rateType}`,
          ltv: q.ftvMax != null ? `≤${q.ftvMax}%` : "any",
        });
      }
    }
  }

  console.log("--- what /api/products will list ------------------------");
  console.log(`approved+active products : ${products.length}`);
  console.log(`rate lines (rows)        : ${rows}`);
  console.log(`products with NO quotes  : ${noQuotes}  ← invisible in the browser`);
  console.log(`unparseable pricingJson  : ${badJson}  ← will not appear at all`);
  console.log(`fixed lines w/o follow-on: ${fixedNoFollowOn}  ← flagged "no follow-on"`);
  console.log(`exclusive / project-tied : ${exclusive}`);
  console.log(`banks                    : ${Object.keys(byBank).length}`);
  console.log("\nrows per bank:");
  for (const [b, n] of Object.entries(byBank).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${b.padEnd(26)} ${n}`);
  }
  console.log("\nsample rows (axis signature → rate):");
  for (const s of samples) {
    console.log(`  ${s.bank}${s.logo ? " [logo]" : " [no logo]"}`);
    console.log(`    ${s.covers}`);
    console.log(`    ${s.rate}   LTV ${s.ltv}`);
  }
} finally {
  await db.$disconnect();
}
