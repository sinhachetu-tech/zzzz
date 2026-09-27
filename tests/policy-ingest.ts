// Needs-based policy ingestion — deterministic map + missing-info questions.
// Run: npx tsx tests/policy-ingest.ts
import { ingestPolicyText, textToAxes, rateHints, missingInfo, ingestWorkbook } from "@/lib/policy-ingest";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) { pass++; console.log(`ok - ${name}`); }
  else { fail++; console.error(`FAIL - ${name}`, extra ?? ""); }
};

// 1. full sheet text: axes map + no false gaps
{
  const doc = [
    "Loan Type: Islamic Only",
    "Fixed Rate: 3.95% Fixed for 3 years, STL — thereafter 1% + 3M EIBOR with floor 1%",
    "Fixed Rate: 4.10% Fixed for 3 years, NSTL",
    "Resale, Direct & Buy-Out plus Equity",
    "FTV up to 60%",
    "Processing Fee: 1.05% capped at 10,500",
    "Early Settlement: 1% or 10k whichever lower",
    "Life Insurance: 0.03 p.m on loan outstanding",
    "Property Insurance: 0.035% p.a",
    "Minimum salary: 15000",
    "Consider Rental Income? 65% - Local rental (UAE)",
    "Valid from 01 September 2026 until 31 December 2026",
  ].join("\n");
  const ing = ingestPolicyText(doc);
  ok("axes capture Fixed Rate", (ing.axes["Fixed Rate"] ?? "").includes("3.95%"));
  ok("axes merge duplicate labels", (ing.axes["Fixed Rate"] ?? "").includes("4.10%"));
  ok("rate hints found", ing.quoteHints.length >= 2);
  ok("txns present — no txn gap", !ing.needs.some((n) => n.key === "txns"));
  ok("STL present — no salary gap", !ing.needs.some((n) => n.key === "salaryTransfer"));
  ok("follow-on present — no followOn gap", !ing.needs.some((n) => n.key === "followOn"));
  ok("processing present — no fee gap", !ing.needs.some((n) => n.key === "processingFee"));
  ok("nationality absent — improvement asked", ing.needs.some((n) => n.key === "nationalityRule" && n.importance === "improvement"));
}

// 2. sparse circular: every gap asked, nothing invented
{
  const doc = ["Fixed Rate: Rates revised to 3.99%", "Something changed this month"].join("\n");
  const ing = ingestPolicyText(doc);
  const keys = ing.needs.map((n) => n.key);
  ok("sparse doc asks txns", keys.includes("txns"));
  ok("sparse doc asks salaryTransfer", keys.includes("salaryTransfer"));
  ok("sparse doc asks followOn", keys.includes("followOn"));
  ok("sparse doc asks processingFee", keys.includes("processingFee"));
  ok("sparse doc asks validity", keys.includes("validity"));
  ok("blocking flagged", ing.needs.filter((n) => n.importance === "blocking").length >= 4);
}

// 3. token lines: ENBD shorthand still hints rates
{
  const hints = rateHints("LAP_3years_STL - 4.69%\nOffPlan_3years_NSTL - 5.24%");
  ok("token hints parsed", hints.length === 2 && hints[0].ratePct === 4.69 && hints[0].termYears === 3);
  ok("token stl hint", hints[0].stlHint === true && hints[1].stlHint === false);
}

// 4. workbook rows → axes map (zz_extract.mjs shape)
{
  const out = ingestWorkbook(
    [{ name: "Salaried", rows: [["Fixed Rate", "3.95% Fixed for 3 years"], ["", ""], ["Processing Fee", "1.05%"], ["Fixed Rate", "GECO approval text"]] }],
    { bank: "DIB", sheets: ["Salaried"] },
  );
  ok("workbook one product", out.length === 1 && out[0].key === "DIB||Salaried");
  ok("workbook merges duplicate labels", (out[0].axes["Fixed Rate"] ?? "").includes("GECO"));
  ok("workbook skips empty rows", !(" " in out[0].axes));
}

// 5. answers fold back: gaps close when the admin answers
{
  const first = ingestPolicyText("Fixed Rate: 3.99% fixed for 3 years");
  ok("first pass asks processing", first.needs.some((n) => n.key === "processingFee"));
  const secondText = "Fixed Rate: 3.99% fixed for 3 years, resale\nprocessingFee: 1.05% capped at 10,500 – salary transfer STL and NSTL\nthereafter 1.5% + 3M EIBOR with floor\nvalid from 2026-09-01 until 2026-12-31";
  const second = missingInfo(first.axes, first.quoteHints, secondText);
  const left = second.map((n) => n.key).join(",");
  ok("answered gaps close (txns/salary/followOn/validity/processing)",
    !second.some((n) => ["processingFee", "salaryTransfer", "followOn", "validity", "txns"].includes(n.key)),
    `left=[${left}]`);
}

// 6. textToAxes ignores prose, keeps two-column rows
{
  const axes = textToAxes("Some narrative sentence without a colon value\nFixed Rate: 3.95%\nFixed Rate\t4.10% NSTL");
  ok("prose ignored", !("Some narrative sentence without a colon value" in axes));
  ok("colon + tab rows kept", (axes["Fixed Rate"] ?? "").includes("3.95%") && (axes["Fixed Rate"] ?? "").includes("4.10%"));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) throw new Error(`${fail} policy-ingest assertions failed`);
