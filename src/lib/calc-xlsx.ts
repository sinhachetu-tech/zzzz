// Excel workbook for a mortgage eligibility assessment — 9 sheets, live formulas.
// The Working sheet uses real PV/PMT/MIN formulas (not pasted values) so a banker can
// change an input cell and watch MAX ELIGIBLE recalculate. SheetJS does not evaluate
// formulas; Excel does that on open, which is exactly what we want.
import * as XLSX from "xlsx";
import { amortizationYears, type AmortSchedule, type MortgageInput, type MortgageResult } from "@/lib/mortgage";
import type { PrintModel } from "@/lib/calc-print-model";

export interface XlsxMeta {
  dealEmirate: string;
  dealTxn: string;
  preparedBy: string;
  stamp: string;
}

const num = (n: number) => Math.round(n);
const f2 = (n: number) => Math.round(n * 100) / 100;

type Cell = string | number | null | { f: string };
type Row = Cell[];

function sheet(rows: Row[], widths?: number[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows as (string | number | null)[][]);
  // attach formulas — aoa_to_sheet writes values, so overwrite the target cells
  rows.forEach((r, ri) => {
    r.forEach((c, ci) => {
      if (c && typeof c === "object" && "f" in c) {
        ws[XLSX.utils.encode_cell({ r: ri, c: ci })] = { t: "n", f: c.f, z: "0.00" } as XLSX.CellObject;
      }
    });
  });
  if (widths) ws["!cols"] = widths.map((w) => ({ wch: w }));
  Object.values(ws).forEach((cell) => {
    if (cell && typeof cell === "object" && "t" in cell && cell.t === "n") cell.z = "0.00";
  });
  return ws;
}

export function buildCalcWorkbook(
  input: MortgageInput, r: MortgageResult, model: PrintModel, meta: XlsxMeta,
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const introMonths = Math.round((r.roi?.introYears ?? 0) * 12);
  const roi1 = r.roi?.r1 ?? r.actualRate;
  const roi2 = r.roi?.r2 ?? r.actualRate;
  const roi3 = r.roi?.r3 ?? r.qualifyingRate;

  /* ---------- 1 · Summary ---------- */
  const summary: Row[] = [
    ["HFMC HOME FINANCE — MORTGAGE ELIGIBILITY ASSESSMENT"],
    ["Ref", meta.stamp, "Prepared by", meta.preparedBy || "—"],
    ["Emirate · transaction", `${meta.dealEmirate} · ${meta.dealTxn}`],
    [],
    ["APPLICANT & DEAL"],
    ["Applicant", input.name || "—"],
    ["Residency", input.applicantType],
    ["Employment", input.employment],
    ["Age now / final", `${r.ageNowYears} / ${input.finalAge}`],
    ["Property value", input.propertyValue],
    ["Bank valuation", input.valuation ?? "not on file"],
    ["Calculation basis", r.calcBasis, r.basisLabel],
    ["Finance sought", input.requested],
    ["LTV applied %", r.ltvPct],
    ["Usable tenor (months)", r.maxTenorMonths],
    [],
    ["RATES — three ROIs"],
    ["ROI 1 introductory (payable)", roi1, `fixed ${r.roi?.introYears ?? 0} years`],
    ["ROI 2 follow-on (payable)", roi2, `from year ${(r.roi?.introYears ?? 0) + 1}`],
    ["ROI 3 stress (qualification only)", roi3, "NOT payable"],
    ["Qualifying rate used", r.qualifyingRate, `ROI ${r.qualifyingBindsRoi} binds`],
    [],
    ["EMI — on the finance sought"],
    ["Initial EMI (ROI 1)", num(r.emi1), "payable"],
    ["Follow-on EMI (ROI 2)", num(r.emi2), "payable, resets"],
    ["Stress EMI (ROI 3)", num(r.emi3), "test only"],
    [],
    ["DBR — on the finance sought"],
    ["DBR 1 %", f2(r.dbr1)],
    ["DBR 2 %", f2(r.dbr2)],
    ["DBR 3 %", f2(r.dbr3)],
    ["CBUAE ceiling %", 50],
    [],
    ["REQUEST DECISION — READ THIS FIRST"],
    ["Finance sought", input.requested],
    ["Requested status", r.requestEligible ? "ELIGIBLE" : "NOT ELIGIBLE"],
    ["Requested ROI 3 DBR %", f2(r.dbr3)],
    ["Maximum permissible finance", r.maxEligible],
    ["Amount above maximum", r.requestShortfall],
    [],
    ["RESULT"],
    ["MAX ELIGIBLE", r.maxEligible],
    ["Binding constraint", r.maxEligibleLimitedBy],
    ["Down payment", Math.max(0, r.calcBasis - r.maxEligible)],
    ["Total interest over term", model.amort ? num(model.amort.totalInterest) : "—"],
    ["Total repayable", model.amort ? num(model.amort.totalPayable) : "—"],
  ];
  XLSX.utils.book_append_sheet(wb, sheet(summary, [34, 22, 30]), "Summary");

  /* ---------- 2 · Income ---------- */
  const income: Row[] = [
    ["INCOME CONSIDERED — monthly equivalent"],
    ["Source", "Frequency", "Amount", "Eligible %", "Monthly equivalent"],
    ...input.incomes.map((x) => [x.source, x.frequency, x.amount, x.eligiblePct] as Row),
    ...(input.coBorrower ? input.coBorrower.incomes.map((x) => [`${x.source} (co-borrower)`, x.frequency, x.amount, x.eligiblePct] as Row) : []),
    [],
    ["ELIGIBLE MONTHLY INCOME", null, null, null, num(r.eligibleIncome)],
  ];
  input.incomes.forEach((x, i) => {
    const row = 3 + i; // sheet is 1-based; header sits on row 2
    const factor = x.frequency === "Annual" ? "1/12" : x.frequency === "Quarterly" ? "1/3" : x.frequency === "Semi-Annual" ? "1/6" : x.frequency === "Weekly" ? "52/12" : "1";
    income[row - 1][4] = { f: `C${row}*(${factor})*(D${row}/100)` };
  });
  XLSX.utils.book_append_sheet(wb, sheet(income, [30, 14, 14, 12, 20]), "Income");

  /* ---------- 3 · Obligations ---------- */
  const liabs = [...input.liabilities, ...(input.coBorrower?.liabilities ?? []).map((x) => ({ ...x, name: `${x.name} (co)` }))];
  const liab: Row[] = [
    ["EXISTING OBLIGATIONS — monthly burden"],
    ["Facility", "Type", "Limit / Outstanding", "Method", "EMI"],
    ...liabs.map((x) => [x.name || x.type, x.type, x.limitOrOutstanding, x.method, null] as Row),
    [],
    ["TOTAL OBLIGATIONS", null, null, null, num(r.existingEmis)],
  ];
  liabs.forEach((x, i) => {
    const row = 3 + i;
    const card = x.method === "5% of Limit" || x.method === "5% of Outstanding";
    liab[row - 1][4] = card ? { f: `C${row}*0.05` } : num(x.monthlyEmi); // actual EMI is typed, not derived
  });
  XLSX.utils.book_append_sheet(wb, sheet(liab, [28, 16, 20, 18, 14]), "Obligations");


  /* ---------- 4 · Working — live formulas ---------- */
  // Fixed cell map (all 1-based sheet rows, column B):
  //   B4 income · B5 obligations · B6 DBR ceiling · B7 LTV · B8 basis · B9 tenor
  //   B10 ROI 1 · B11 ROI 2 · B12 ROI 3
  //   B15 current DBR · B16 residual · B17 available EMI · B18 qualifying rate · B19 DBR capacity
  //   B22 LTV capacity · B25 MAX ELIGIBLE · B26/27/28 EMI 1/2/3 · B29/30/31 DBR 1/2/3 · B32 check
  const working: Row[] = [
    ["CALCULATION WORKING — live formulas. Change an input cell and Excel recalculates."],
    [],
    ["INPUTS", "Value", "Unit"],
    ["Eligible monthly income", num(r.eligibleIncome), "AED/mo"],           // B4
    ["Existing obligations", num(r.existingEmis), "AED/mo"],                // B5
    ["DBR ceiling", 50, "%"],                                              // B6
    ["LTV applied", r.ltvPct, "%"],                                        // B7
    ["Calculation basis", r.calcBasis, "AED"],                             // B8
    ["Usable tenor", r.maxTenorMonths, "months"],                          // B9
    ["ROI 1 introductory", roi1, "%"],                                     // B10
    ["ROI 2 follow-on", roi2, "%"],                                        // B11
    ["ROI 3 stress", roi3, "%"],                                           // B12
    [],                                                                    // 13
    ["DBR CAPACITY", "Value", "Working"],                                  // 14
    ["current DBR %", { f: "B5/B4*100" }, "existing obligations ÷ eligible income"],        // 15
    ["residual DBR %", { f: "MAX(0,B6-B15)" }, "ceiling − current DBR"],                    // 16
    ["available EMI", { f: "B4*B16/100" }, "income × residual headroom"],                   // 17
    ["qualifying rate %", { f: "B12" }, "ROI 3 sets eligibility capacity"],                 // 18
    ["DBR capacity", { f: "PV(B18/1200,B9,-B17)" }, "PV of available EMI at the qualifying rate"], // 19
    [],                                                                    // 20
    ["LTV CAPACITY", "Value", "Working"],                                  // 21
    ["LTV capacity", { f: "B8*B7/100" }, "calculation basis × LTV"],                        // 22
    [],                                                                    // 23
    ["RESULT", "Value", "Working"],                                        // 24
    ["MAX ELIGIBLE", { f: "MAX(0,FLOOR(MIN(B19,B22)/5000,1)*5000)" }, "MIN(DBR, LTV) floored to 5,000"], // 25
    ["EMI at ROI 1", { f: "PMT(B10/1200,B9,-" + num(input.requested) + ")" }, "on finance sought — fixed term"], // 26
    ["EMI at ROI 2", { f: "PMT(B11/1200,B9,-" + num(input.requested) + ")" }, "on finance sought — resets"], // 27
    ["EMI at ROI 3", { f: "PMT(B12/1200,B9,-" + num(input.requested) + ")" }, "on finance sought — test only"], // 28
    ["DBR 1 %", { f: "(B26+B5)/B4*100" }, "(EMI 1 + obligations) ÷ income"],                // 29
    ["DBR 2 %", { f: "(B27+B5)/B4*100" }, null],                                            // 30
    ["DBR 3 %", { f: "(B28+B5)/B4*100" }, "the qualifying test"],                           // 31
    ["all within ceiling?", { f: 'IF(B31<=B6,"YES — within ceiling","NO — review")' }, null], // 32
    [],
    ["ENGINE FIGURES — must reconcile with the rows above"],
    ["MAX ELIGIBLE", num(r.maxEligible)],
    ["EMI 1 / 2 / 3", `${num(r.emi1)} / ${num(r.emi2)} / ${num(r.emi3)}`],
    ["DBR 1 / 2 / 3", `${f2(r.dbr1)} / ${f2(r.dbr2)} / ${f2(r.dbr3)}`],
  ];
  XLSX.utils.book_append_sheet(wb, sheet(working, [30, 16, 44]), "Working");

  /* ---------- 5 · Rate stages & DBR ---------- */
  const stages: Row[] = [
    ["RATES, EMI AND DBR — ROI 1 and ROI 2 are payable; ROI 3 is a qualification test only"],
    [],
    ["Stage", "ROI %", "EMI / month", "Existing obligations", "Total outflow", "DBR %", "Payable"],
    ["ROI 1 · introductory", roi1, num(r.emi1), num(r.existingEmis), num(r.existingEmis + r.emi1), f2(r.dbr1), `YES — fixed ${r.roi?.introYears ?? 0} yrs`],
    ["ROI 2 · follow-on", roi2, num(r.emi2), num(r.existingEmis), num(r.existingEmis + r.emi2), f2(r.dbr2), `YES — from year ${(r.roi?.introYears ?? 0) + 1}`],
    ["ROI 3 · stress / qualifying", roi3, num(r.emi3), num(r.existingEmis), num(r.existingEmis + r.emi3), f2(r.dbr3), "NO — test only"],
    [],
    ["CBUAE DBR ceiling %", 50],
    ["All three within ceiling?", r.dbr1 <= 50 && r.dbr2 <= 50 && r.dbr3 <= 50 ? "YES" : "NO — review"],
  ];
  XLSX.utils.book_append_sheet(wb, sheet(stages, [26, 10, 16, 20, 16, 10, 24]), "Rate stages");

  /* ---------- 6 · Amortisation monthly, ROI 1 → ROI 2 ---------- */
  const monthly = r.roi && r.maxEligible > 0 && r.maxTenorMonths > 0
    ? amortizationMonths(r.maxEligible, r.roi.r1, introMonths, r.roi.r2, r.maxTenorMonths)
    : [];
  const amRows: Row[] = [
    ["AMORTISATION — monthly. ROI 1 for the fixed term, then ROI 2 on the outstanding balance."],
    ["Future EIBOR is unknown; the present rate is presumed unchanged for illustration only."],
    [],
    ["Month", "EMI", "Interest", "Principal", "Closing balance", "Rate %"],
    ...monthly.map((m, i) => [i + 1, num(m.emi), num(m.interest), num(m.principal), num(m.closing), f2(m.ratePct)] as Row),
    [],
    ["TOTAL", null, num(monthly.reduce((s, m) => s + m.interest, 0)), num(monthly.reduce((s, m) => s + m.principal, 0)), null, null],
  ];
  XLSX.utils.book_append_sheet(wb, sheet(amRows, [8, 14, 14, 14, 18, 10]), "Amortisation");

  /* ---------- 7 · Amortisation at ROI 3 (stressed, reference only) ---------- */
  const stressed = r.roi && r.maxEligible > 0 && r.maxTenorMonths > 0
    ? amortizationMonths(r.maxEligible, roi3, r.maxTenorMonths, roi3, r.maxTenorMonths)
    : [];
  const stRows: Row[] = [
    ["AMORTISATION AT ROI 3 — STRESSED, REFERENCE ONLY. ROI 3 is never a payable rate."],
    [`Whole term priced at ${f2(roi3)}% — the downside if rates rose to the stress level.`],
    [],
    ["Month", "EMI", "Interest", "Principal", "Closing balance", "Rate %"],
    ...stressed.map((m, i) => [i + 1, num(m.emi), num(m.interest), num(m.principal), num(m.closing), f2(m.ratePct)] as Row),
    [],
    ["TOTAL", null, num(stressed.reduce((s, m) => s + m.interest, 0)), num(stressed.reduce((s, m) => s + m.principal, 0)), null, null],
  ];
  XLSX.utils.book_append_sheet(wb, sheet(stRows, [8, 14, 14, 14, 18, 10]), "Amortisation stress");

  /* ---------- 8 · What-if ---------- */
  const whatif: Row[] = [
    ["WHAT-IF ANALYSIS — one input changed at a time, full calculation re-run"],
    [`Rates held: ROI 1 ${f2(roi1)}% · ROI 2 ${f2(roi2)}% · ROI 3 ${f2(roi3)}%`],
    [],
    ["Scenario", "Current DBR %", "Req. DBR 1 %", "Req. DBR 2 %", "Req. DBR 3 %", "Residual DBR %", "Maximum finance AED", "Δ vs baseline", "Gain?"],
  ];
  if (model.whatif.length === 0) {
    whatif.push(["No obligations on file — nothing to model."]);
  } else {
    for (const f of model.whatif) {
      for (const x of f.rows) {
        whatif.push([
          x.gain ? `▮▮ ${x.label}` : x.label,
          f2(x.currentDbr), f2(x.dbr1), f2(x.dbr2), f2(x.dbr3), f2(x.residual), num(x.eligible),
          x.delta === 0 ? 0 : num(x.delta), x.gain ? "YES" : "—",
        ]);
      }
    }
  }
  XLSX.utils.book_append_sheet(wb, sheet(whatif, [32, 12, 12, 12, 12, 14, 20, 14, 10]), "What-if");

  /* ---------- 9 · Assumptions ---------- */
  const assum: Row[] = [
    ["BASIS & ASSUMPTIONS"],
    ["Max DBR %", 50, "CBUAE-style prudent limit"],
    ["LTV band %", r.ltvPct, `${input.applicantType}, first property`],
    ["Max tenor (years)", 25, "regulatory cap"],
    ["Tenor by age (months)", r.maxTenorMonths, `final age ${input.finalAge}, margin ${input.marginMonths} mo${input.coBorrower ? `, co-borrower age ${r.coAgeYears}` : ""}`],
    ["Card obligation rule", "5% of limit", "CBUAE default"],
    ["Qualifying rate rule", "ROI 3", "ROI 3 sets maximum eligibility"],
    ["Eligible amount rounding", 5000, "floored to the nearest AED 5,000"],
    ["Calculation basis", r.basisLabel, `AED ${num(r.calcBasis)}`],
    [],
    ["DECLARATION"],
    ["Preliminary affordability assessment prepared from information supplied by the applicant."],
    ["Not a bank approval, offer or commitment to lend. Subject to the lender's credit policy,"],
    ["property valuation, verification of income and liabilities (AECB) and prevailing rate card."],
    [`The follow-on rate and all figures from year ${(r.roi?.introYears ?? 0) + 1} depend on future EIBOR and will change.`],
  ];
  XLSX.utils.book_append_sheet(wb, sheet(assum, [30, 26, 60]), "Assumptions");

  return wb;
}

/* Monthly rows for the workbook — same rate-change logic as the engine's year-wise view. */
function amortizationMonths(
  principal: number, roi1Pct: number, introMonths: number, roi2Pct: number, totalMonths: number,
): { emi: number; interest: number; principal: number; closing: number; ratePct: number }[] {
  const out: { emi: number; interest: number; principal: number; closing: number; ratePct: number }[] = [];
  if (principal <= 0 || totalMonths <= 0) return out;
  const emiFor = (p: number, rate: number, n: number) => {
    if (p <= 0 || n <= 0) return 0;
    const rr = rate / 1200;
    if (rr === 0) return p / n;
    const f = Math.pow(1 + rr, n);
    return (p * rr * f) / (f - 1);
  };
  let bal = principal;
  let ratePct = introMonths > 0 ? roi1Pct : roi2Pct;
  let emi = emiFor(bal, ratePct, totalMonths);
  for (let m = 1; m <= totalMonths && bal > 0.005; m++) {
    if (m === introMonths + 1 && introMonths > 0 && introMonths < totalMonths) {
      ratePct = roi2Pct;
      emi = emiFor(bal, ratePct, totalMonths - introMonths);
    }
    const rr = ratePct / 1200;
    const interest = bal * rr;
    let pay = rr === 0 ? bal / (totalMonths - m + 1) : emi;
    if (pay >= bal + interest) pay = bal + interest;
    const princ = Math.max(0, pay - interest);
    const closing = Math.max(0, bal - princ);
    out.push({ emi: pay, interest, principal: princ, closing, ratePct });
    bal = closing;
  }
  return out;
}
