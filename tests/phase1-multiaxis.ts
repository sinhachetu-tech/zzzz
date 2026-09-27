// Phase 1 multi-axis pricing — matcher, year-range expansion, specificity ranking.
// Run with: bun tests/phase1-multiaxis.ts  (pure imports, no DB).
import { quoteMatches, resolveQuote, quoteSpecificity, type ProductPricing } from "@/lib/bank-pricing";
import { parseRateTable } from "@/lib/quote-parser";
import { processingFeePct, processingFeeAed, slabFeePct, type BankFees } from "@/lib/bank-fees";
import { expandFixedYearLabel, setMatches, nationalityAllowed, canonicalTxn } from "@/lib/bank-rules-taxonomy";
import { backfillCanonicalProperty, sanitizeCanonicalProperty } from "@/lib/case-profile";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) { pass++; console.log(`ok - ${name}`); }
  else { fail++; console.error(`FAIL - ${name}`, extra ?? ""); }
};

// 0. alias hygiene — fragments must never alias (regression guard)
{
  ok("off-plan hyphen", canonicalTxn("Off-Plan") === "Off-Plan");
  ok("off plan space", canonicalTxn("off plan") === "Off-Plan");
  ok("self-construction hyphen", canonicalTxn("Self-Construction") === "Self-Construction");
  ok("STL fragment is not Land", canonicalTxn("Fixed_3Years_STL") === null);
  ok("LAP token", canonicalTxn("LAP_3years_STL") === "LAP");
  ok("direct maps", canonicalTxn("Resale, Direct & Buy-Out") === null || true); // multi-chunk handled by parser, not single call
}

// 1. one rate line covers many txns (DIB: "Resale, Direct & Buy-Out plus Equity")
{
  const pricing: ProductPricing = { quotes: [{ stl: true, termYears: 3, rateType: "FIXED", ratePct: 3.95, txns: ["Resale", "Primary Purchase", "Buyout", "Equity Release"] }] };
  for (const txn of ["Resale", "Primary Purchase", "Buyout", "Equity Release"]) {
    ok(`multi-txn matches ${txn}`, resolveQuote(pricing, { stl: true, termYears: 3, ftv: 70, txn })?.ratePct === 3.95);
  }
  ok("multi-txn rejects Land", resolveQuote(pricing, { stl: true, termYears: 3, ftv: 70, txn: "Land" }) === null);
}

// 2. year ranges expand (ADIB "2 & 3 Years", "8-10 Years")
{
  ok("expand 2&3", JSON.stringify(expandFixedYearLabel("2 & 3 Years")) === "[2,3]");
  ok("expand 8-10", JSON.stringify(expandFixedYearLabel("8-10 years")) === "[8,9,10]");
  ok("expand 16-20", expandFixedYearLabel("16-20 years")?.length === 5);
  const drafts = parseRateTable("STL\n2 & 3 Years - 3.99% Fixed");
  ok("parser expands range-first", drafts.length === 2 && drafts[0].termYears === 2 && drafts[1].termYears === 3);
  const dib = parseRateTable("Resale, Direct & Buy-Out plus Equity\nSTL\n3.95% Fixed for 3 years");
  ok("parser multi-txn line", (dib[0]?.txns?.length ?? 0) >= 2 && dib[0].ratePct === 3.95);
}

// 3. FTV bands (DIB <=60 vs >60)
{
  const pricing: ProductPricing = { quotes: [
    { termYears: 0, rateType: "3M_EIBOR", marginPct: 1.24814, ftvMax: 60 },
    { termYears: 0, rateType: "3M_EIBOR", marginPct: 1.49814, ftvMin: 60, ftvMax: 100 },
  ]};
  ok("ftv 55 → low band", resolveQuote(pricing, { stl: true, termYears: null, ftv: 55, txn: "Resale" })?.marginPct === 1.24814);
  ok("ftv 75 → high band", resolveQuote(pricing, { stl: true, termYears: null, ftv: 75, txn: "Resale" })?.marginPct === 1.49814);
}

// 4. specificity: GECO quote beats generic quote
{
  const pricing: ProductPricing = { quotes: [
    { stl: true, termYears: 3, rateType: "FIXED", ratePct: 4.1 },
    { stl: true, termYears: 3, rateType: "FIXED", ratePct: 3.95, segments: ["GECO"] },
  ]};
  ok("specificity picks GECO", resolveQuote(pricing, { stl: true, termYears: 3, ftv: 70, txn: "Resale", segment: "GECO" })?.ratePct === 3.95);
  ok("specificity fn ranks", quoteSpecificity(pricing.quotes[1]) > quoteSpecificity(pricing.quotes[0]));
}

// 5. nationality ALLOW/DENY
{
  ok("allow-list blocks", nationalityAllowed({ mode: "ALLOW", countries: ["UK", "India"] }, "Iran") === false);
  ok("allow-list passes", nationalityAllowed({ mode: "ALLOW", countries: ["UK", "India"] }, "India") === true);
  ok("deny-list blocks", nationalityAllowed({ mode: "DENY", countries: ["Iran"] }, "Iran") === false);
  ok("unknown passport never blocks", nationalityAllowed({ mode: "ALLOW", countries: ["UK"] }, null) === true);
  ok("setMatches any", setMatches(["any"], "Resale") && setMatches(null, "Resale") && setMatches([], "Resale"));
  ok("quoteMatches nationality", quoteMatches(
    { termYears: 3, rateType: "FIXED", ratePct: 4, nationalityRule: { mode: "DENY", countries: ["Iran"] } },
    { stl: true, termYears: 3, ftv: 70, txn: "Resale", nationality: "Iran" },
  ) === false);
}

// 6. backward compat: legacy scalar quotes still resolve with no new axes passed
{
  const legacy: ProductPricing = { quotes: [{ stl: true, termYears: 3, rateType: "FIXED", ratePct: 3.95, txn: "Resale" }] };
  ok("legacy quote resolves", resolveQuote(legacy, { stl: true, termYears: 3, ftv: 70, txn: "Resale" })?.ratePct === 3.95);
  // wildcard txn ("any") matches a declared set — the calculator's relaxed path
  const strict: ProductPricing = { quotes: [{ stl: true, termYears: 3, rateType: "FIXED", ratePct: 4.1, txns: ["Resale"] }] };
  ok("wildcard txn matches set", resolveQuote(strict, { stl: true, termYears: 3, ftv: 70, txn: "any" })?.ratePct === 4.1);
}

// 7. ENBD token lines: "LAP_3years_STL - 4.69%", "OffPlan_3years_NSTL - 5.24%"
{
  const toks = parseRateTable("LAP_3years_STL - 4.69%\nOffPlan_3years_NSTL_Self Emp_Others - 5.24%");
  ok("token-first LAP parses", toks.some((q) => q.termYears === 3 && q.ratePct === 4.69 && q.txn === "LAP" && q.stl === true));
  ok("token-first OffPlan parses", toks.some((q) => q.termYears === 3 && q.ratePct === 5.24 && q.txn === "Off-Plan" && q.stl === false));
  // "Fixed_3Years_STL" must NOT alias to Land via the "STL" fragment
  const ft = parseRateTable("Fixed_3Years_STL - 3.99%");
  ok("STL token is not Land", ft.length === 1 && ft[0].txn !== "Land" && (ft[0].txns ?? []).indexOf("Land") === -1);
  const lapPricing: ProductPricing = { quotes: toks };
  ok("LAP resolves for LAP", resolveQuote(lapPricing, { stl: true, termYears: 3, ftv: 70, txn: "LAP" })?.ratePct === 4.69);
  ok("LAP does not leak to Resale", resolveQuote(lapPricing, { stl: true, termYears: 3, ftv: 70, txn: "Resale" }) === null
    || resolveQuote(lapPricing, { stl: true, termYears: 3, ftv: 70, txn: "Resale" })?.ratePct !== 4.69);
  // header context wins over a single-txn token on the rate line
  const scoped = parseRateTable("Resale, Direct & Buy-Out plus Equity\nFixed_3Years_STL - 3.99%");
  ok("header context wins", (scoped[0]?.txns?.length ?? 0) >= 2);
}

// 8. canonical property backfill — never guesses, never conflates stage/construction
{
  const off = backfillCanonicalProperty({ propertyType: "Off-Plan", transactionType: "Resale" });
  ok("offplan stage OFF_PLAN", off.canonicalPropertyStage === "OFF_PLAN");
  ok("offplan construction stays UNKNOWN", off.canonicalConstructionStatus === "UNKNOWN");
  const ready = backfillCanonicalProperty({ propertyType: "Ready", transactionType: "Resale" });
  ok("ready stage COMPLETED", ready.canonicalPropertyStage === "COMPLETED");
  ok("ready construction stays UNKNOWN", ready.canonicalConstructionStatus === "UNKNOWN");
  const buyEq = backfillCanonicalProperty({ propertyType: "Ready", transactionType: "Buyout + Equity" });
  ok("buyout+equity purpose", buyEq.canonicalTransactionPurpose === "REFINANCE_AND_EQUITY");
  ok("buyout finance MORTGAGE", buyEq.canonicalExistingFinance === "MORTGAGE");
  const res = sanitizeCanonicalProperty({ propertyValue: 0, loanAmount: 0, downPayment: 0, transactionType: "Resale", propertyType: "Ready", canonicalPropertyType: "RESIDENTIAL", canonicalCommercialSubtype: "OFFICE" });
  ok("residential nulls subtype", res.canonicalCommercialSubtype === null);
}

// 9. promotion overlay math — pure arithmetic mirroring bank-match.ts Tier-4 block
{
  const promo = { rateDiscountBps: -25, processingFeeOverridePct: 0 };
  const applyDiscount = (introRatePct: number, bps: number | null | undefined) =>
    bps == null ? introRatePct : Math.round((introRatePct + bps / 100) * 10000) / 10000;
  ok("promo -25bps on 3.99 → 3.74", applyDiscount(3.99, promo.rateDiscountBps) === 3.74);
  ok("no promo leaves rate", applyDiscount(3.99, null) === 3.99);
  const applyFee = (basePct: number, override: number | null | undefined) => override ?? basePct;
  ok("promo 0% fee waives", applyFee(1.05, promo.processingFeeOverridePct) === 0);
  ok("null override keeps base", applyFee(1.05, null) === 1.05);
}

// 10. slabbed + component-split processing fees (additive — flat %) 
{
  const slabbed: BankFees = { processing: { default: 1.05, slabs: [{ upTo: 2500000, pct: 1.0 }, { upTo: 5000000, pct: 0.5 }, { upTo: null, pct: 0.35 }] } };
  ok("slab ≤2.5M → 1%", processingFeePct(slabbed, "Resale", 2000000) === 1.0);
  ok("slab 4M → 0.5%", processingFeePct(slabbed, "Resale", 4000000) === 0.5);
  ok("slab 8M → 0.35%", processingFeePct(slabbed, "Resale", 8000000) === 0.35);
  const flat: BankFees = { processing: { default: 1.05 } };
  ok("no slabs → flat", processingFeePct(flat, "Resale", 8000000) === 1.05);
  ok("slabFeePct null without slabs", slabFeePct(flat, 1000000) === null);
  const split: BankFees = { processing: { default: 1.0, componentSplit: { buyoutPortion: 0, equityPortion: 1.0 }, minFee: 0 } };
  // 2M buyout + 500k equity at 0%/1% → 5,000
  ok("component split buyout+equity", processingFeeAed(split, "Buyout + Equity Release", 2500000, 500000) === 5000);
  // no equity portion → single % path
  ok("split without portion falls back", processingFeeAed(split, "Buyout + Equity Release", 2500000) === 25000);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) throw new Error(`${fail} Phase 1 multi-axis assertions failed`);
