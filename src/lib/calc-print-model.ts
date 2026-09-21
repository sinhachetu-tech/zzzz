// Pure document model for the printed assessment ("View / Print / Save PDF") and the
// Excel export. Assembles every row of the A4 document from an already-computed
// MortgageInput + MortgageResult, plus the amortisation schedule and the obligation
// what-if families with MAX-ELIGIBLE gains — computed, sorted best-first, and pruned
// of rows that move nothing. No React, no formatting framework: numbers come out raw.
import {
  amortizationYears, computeMortgage, scenarioCardsPct, scenarioRemoveCards,
  scenarioRemoveLiab, type AmortSchedule, type MortgageInput, type MortgageResult,
} from "@/lib/mortgage";

export interface WhatIfRow {
  label: string;
  currentDbr: number;
  dbr1: number;
  dbr2: number;
  dbr3: number;
  residual: number;
  eligible: number;
  delta: number;
  gain: boolean;
}

export interface PrintModel {
  r: MortgageResult;
  amort: AmortSchedule | null;
  whatif: { fam: string; rows: WhatIfRow[] }[];
  noGain: boolean; // true when LTV binds — no obligation reduction can raise eligibility
  bestGain: number;
  bestGainNote: string | null;
}

export function buildPrintModel(input: MortgageInput, r: MortgageResult): PrintModel {
  const base: WhatIfRow = {
    label: "Baseline", currentDbr: r.currentDbr, dbr1: r.dbr1, dbr2: r.dbr2, dbr3: r.dbr3,
    residual: r.residualDbr, eligible: r.maxEligible, delta: 0, gain: false,
  };

  const famOf = (fam: string, scenarios: { label: string; input: MortgageInput }[]): { fam: string; rows: WhatIfRow[] } => {
    const rows: WhatIfRow[] = scenarios.map(({ label, input: si }) => {
      const q = computeMortgage(si);
      const delta = q.maxEligible - r.maxEligible;
      return { 
        label, currentDbr: q.currentDbr, dbr1: q.dbr1, dbr2: q.dbr2, dbr3: q.dbr3,
        residual: q.residualDbr, eligible: q.maxEligible, delta, gain: delta > 0 
      };
    });
    // keep rows that move eligibility OR move DBR — drop ones that change nothing at all
    const kept = rows.filter((x) => x.delta !== 0 || x.dbr1 !== base.dbr1 || x.dbr2 !== base.dbr2 || x.dbr3 !== base.dbr3);
    kept.sort((a, b) => b.delta - a.delta); // gains first, best-first
    return { fam, rows: [base, ...kept] };
  };

  // obligation families only — rate scenarios are a separate view, not the printout
  const cards = input.liabilities.filter((l) => l.type === "Credit Card");
  const liabSc: { label: string; input: MortgageInput }[] = [];
  if (cards.length) {
    liabSc.push({ label: "Credit cards −25%", input: scenarioCardsPct(input, 0.75) });
    liabSc.push({ label: "Credit cards −50%", input: scenarioCardsPct(input, 0.5) });
    liabSc.push({ label: "Credit cards removed", input: scenarioRemoveCards(input) });
  }
  for (const l of input.liabilities.filter((x) => x.type !== "Credit Card"))
    liabSc.push({ label: `Remove ${l.name || l.type}`, input: scenarioRemoveLiab(input, l.id) });

  const fams = liabSc.length ? [famOf("Obligations", liabSc)] : [];
  const gainRows = fams.flatMap((f) => f.rows.filter((x) => x.gain));
  const best = [...gainRows].sort((a, b) => b.delta - a.delta)[0] ?? null;

  // year-wise amortisation across the two PAYABLE ROIs only; ROI 3 never appears here
  const introMonths = Math.round((r.roi?.introYears ?? 0) * 12);
  const amort = r.roi && r.maxEligible > 0 && r.maxTenorMonths > 0
    ? amortizationYears(r.maxEligible, r.roi.r1, introMonths, r.roi.r2, r.maxTenorMonths)
    : null;

  return {
    r, amort, whatif: fams,
    noGain: liabSc.length > 0 && gainRows.length === 0,
    bestGain: best ? best.delta : 0,
    bestGainNote: best
      ? `${best.label} raises the eligible amount by AED ${Math.round(best.delta).toLocaleString("en-US")} and lowers DBR 1 from ${base.dbr1}% to ${best.dbr1}%. Ranked best-first.`
      : null,
  };
}
