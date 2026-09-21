"use client";

// Mortgage eligibility assessment — print-ready document (View / Print / Save PDF).
// READS: localStorage["hfmc_calc_print"] — written by the calculator's View / Print
// buttons ({ input: MortgageInput-with-ROIs, meta: { dealEmirate, dealTxn, mode, preparedBy,
// eiborAsOn, roi2FromEibor, eiborTenor, eiborPct, eiborMarginPct }, stamp }).
// If `?print=1` the dialog opens once rendered. If the snapshot is missing,
// computeMortgage(defaultInput()) still renders so the page is never blank.

import { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { LogoMark } from "@/components/icons";
import { computeMortgage, defaultInput, MAX_DBR, type MortgageInput } from "@/lib/mortgage";
import { buildPrintModel, type PrintModel } from "@/lib/calc-print-model";

const num = (n: number) => Math.round(n).toLocaleString("en-US");
const aed = (n: number) => "AED " + num(n);
const pct = (n: number) => n.toFixed(2) + "%";
const todayGB = () => new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

interface Snap {
  input: MortgageInput;
  meta: {
    dealEmirate: string; dealTxn: string; mode: "full" | "summary";
    preparedBy: string; eiborAsOn: string;
    roi2FromEibor: boolean; eiborTenor: string; eiborPct: number | null; eiborMarginPct: number | null;
  };
  stamp: string;
}

function readSnap(): Snap | null {
  try {
    const raw = localStorage.getItem("hfmc_calc_print");
    if (!raw) return null;
    const s = JSON.parse(raw) as Snap;
    if (!s || !s.input) return null;
    return s;
  } catch { return null; }
}

export default function CalcPrintPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-[13px] text-[var(--ink-faint)]">Loading assessment…</div>}>
      <CalcPrintInner />
    </Suspense>
  );
}

function CalcPrintInner() {
  const params = useSearchParams();
  const [snap, setSnap] = useState<Snap | null>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- snapshot is browser-only; read once on mount
  useEffect(() => { setSnap(readSnap()); }, []);

  if (!snap) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="text-center max-w-[420px]">
          <LogoMark size={34} className="mx-auto" />
          <h1 className="font-disp font-bold text-[18px] mt-3 mb-1">No calculation to show</h1>
          <p className="text-[13px] text-[var(--ink-dim)] m-0 mb-4">
            This page reads the calculation the team portal sent it. Open the Mortgage Calculator,
            fill the figures, then use <strong>View</strong> or <strong>Print / Save PDF</strong>.
          </p>
          <a className="btn btn-primary btn-sm" href="/">← Back to the tracker</a>
        </div>
      </div>
    );
  }
  return <Doc snap={snap} autoPrint={params.get("print") === "1"} />;
}

function Doc({ snap, autoPrint }: { snap: Snap; autoPrint: boolean }) {
  const { input, meta } = snap;
  const r = useMemo(() => computeMortgage(input), [input]);
  const model: PrintModel = useMemo(() => buildPrintModel(input, r), [input, r]);
  const [viewMode, setViewMode] = useState<"summary" | "full">(meta.mode === "summary" ? "summary" : "full");

  // auto-print once rendered — the ?print=1 entry point
  useEffect(() => {
    if (!autoPrint) return;
    const t = window.setTimeout(() => window.print(), 600);
    return () => window.clearTimeout(t);
  }, [autoPrint]);


  const downloadXlsx = async () => {
    const { buildCalcWorkbook } = await import("@/lib/calc-xlsx");
    const wb = buildCalcWorkbook(input, r, model, {
      dealEmirate: meta.dealEmirate, dealTxn: meta.dealTxn, preparedBy: meta.preparedBy, stamp: snap.stamp,
    });
    const XLSX = await import("xlsx");
    XLSX.writeFile(wb, `${snap.stamp || "HFMC-CALC"}.xlsx`);
  };

  return (
    <>
      <style>{PRINT_DOC_CSS}</style>
      {/* sticky toolbar — present on screen, stripped from paper */}
      <div className="calc-print-toolbar no-print">
        <div className="flex items-center gap-2">
          <a className="btn btn-ghost btn-sm" href="/">← Calculator</a>
          <span className="mono text-[11px] text-[var(--ink-faint)]">{snap.stamp}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex rounded-lg overflow-hidden border mr-1" style={{ borderColor: "var(--line)" }}>
            {(["summary", "full"] as const).map((m) => (
              <button key={m} className="px-3 py-1.5 text-[12px] font-disp font-semibold transition-colors"
                style={viewMode === m ? { background: "var(--amber-tint)", color: "var(--amber)" } : { color: "var(--ink-faint)" }}
                onClick={() => setViewMode(m)}>
                {m === "summary" ? "Summary" : "Full"}
              </button>
            ))}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={downloadXlsx}>Export Excel</button>
          <button className="btn btn-primary btn-sm" onClick={() => window.print()}>Print / Save PDF</button>
        </div>
      </div>

      <div className="calc-print-wrap">
        {/* ============ PAGE 1 — assessment ============ */}
        <section className="calc-sheet">
          <div className="calc-head">
            <div className="flex items-start gap-3">
              <LogoMark size={34} />
              <div>
                <div className="font-disp font-bold text-[16px] leading-tight">HFMC Home Finance</div>
                <div className="text-[9.5px] uppercase tracking-[0.16em] text-[var(--ink-faint)]">Mortgage eligibility assessment · CBUAE-style · UAE</div>
              </div>
            </div>
            <div className="text-right">
              <div className="mono text-[12px]" style={{ color: "var(--amber)" }}>{snap.stamp}</div>
              <div className="text-[10.5px] text-[var(--ink-faint)]">{todayGB()} · Page 1 / {viewMode === "full" ? 2 : 1}</div>
            </div>
          </div>

          <SectionTitle>Applicant &amp; deal</SectionTitle>
          <KV
            rows={[
              ["Applicant", input.name || "—", "Property value", aed(input.propertyValue)],
              ["Residency", input.applicantType, "Bank valuation", input.valuation ? aed(input.valuation) : "not on file"],
              ["Employment", input.employment, "Calculation basis", `${aed(r.calcBasis)} (${r.basisLabel})`],
              ["Age now / final", `${r.ageNowYears} / ${input.finalAge} yrs`, "Finance sought", input.requested > 0 ? aed(input.requested) : "—"],
              ["Emirate · transaction", `${meta.dealEmirate} · ${meta.dealTxn}`, "LTV applied", `${pct(r.ltvPct)}`],
              ["Co-borrower", input.coBorrower?.name || "none", "Usable tenor", tenorOf(r.maxTenorMonths)],
            ]}
          />

          <Verdict r={r} />

          <SectionTitle>1 · Income considered — monthly equivalent</SectionTitle>
          <OutTable
            head={["Source", "Frequency", "Amount", "Elig.", "Considered"]}
            rows={[
              ...input.incomes.map((x) => [x.source, x.frequency, aed(x.amount), `${x.eligiblePct}%`, aed(monthlyOf(x))]),
              ...(input.coBorrower ? input.coBorrower.incomes.map((x) => [`${x.source} (co)`, x.frequency, aed(x.amount), `${x.eligiblePct}%`, aed(monthlyOf(x))]) : []),
              ["", "", "", "", `ELIGIBLE ${aed(r.eligibleIncome)} / mo`],
            ]}
            lastBold
          />

          <SectionTitle>2 · Existing obligations — monthly burden</SectionTitle>
          {input.liabilities.length + (input.coBorrower?.liabilities.length ?? 0) === 0 ? (
            <p className="calc-muted">No obligations on file — DBR is driven by income alone.</p>
          ) : (
            <OutTable
              head={["Facility", "Type", "Limit / O/S", "Method", "EMI"]}
              rows={[
                ...input.liabilities.map((x) => [x.name || x.type, x.type, aed(x.limitOrOutstanding), x.method, aed(liabOf(x))]),
                ...(input.coBorrower ? input.coBorrower.liabilities.map((x) => [`${x.name || x.type} (co)`, x.type, aed(x.limitOrOutstanding), x.method, aed(liabOf(x))]) : []),
                ["", "", "", "", `TOTAL ${aed(r.existingEmis)}`],
              ]}
              lastBold
            />
          )}

          <SectionTitle>3 · Debt burden ratio</SectionTitle>
          <OutTable
            head={[]}
            rows={[
              ["Eligible monthly income", aed(r.eligibleIncome)],
              ["Less existing obligations", "− " + aed(r.existingEmis)],
              ["Income committed to existing debt", pct(r.currentDbr)],
              ["CBUAE DBR ceiling", pct(MAX_DBR)],
              ["Residual headroom", pct(r.residualDbr)],
              [`→ Available for new EMI — ${aed(r.eligibleIncome)} × ${pct(r.residualDbr)}`, aed(r.availableEmi) + " / month"],
            ]}
            lastBold
          />


          <div className="calc-minihead">DBR at each ROI, on the finance sought of {aed(r.requested)}</div>
          <OutTable
            head={["Stage", "ROI", "EMI", "+ existing", "DBR"]}
            rows={[
              ["DBR 1 · initial / fixed", r.roi ? pct(r.roi.r1) : "—", aed(Math.round(r.emi1)), aed(Math.round(r.existingEmis + r.emi1)), `${r.dbr1}%`],
              ["DBR 2 · follow-on", r.roi ? pct(r.roi.r2) : "—", aed(Math.round(r.emi2)), aed(Math.round(r.existingEmis + r.emi2)), `${r.dbr2}%`],
              ["DBR 3 · stress / qualifying", r.roi ? pct(r.roi.r3) : "—", aed(Math.round(r.emi3)), aed(Math.round(r.existingEmis + r.emi3)), `${r.dbr3}%`],
              ["", "", "", "ceiling", `${pct(MAX_DBR)}`],
            ]}
          />

          <SectionTitle>4 · Loan cap analysis — how the eligible amount is determined</SectionTitle>
          <OutTable
            head={["", "Constraint", "Value", "Working"]}
            rows={[
              ["a", `DBR capacity — ROI 3 qualifying rate ${pct(r.qualifyingRate)}`, aed(r.dbrMpbf), `PV(${pct(r.qualifyingRate)} ÷ 12, ${tenorOf(r.maxTenorMonths)}, ${aed(r.availableEmi)}/mo)`],
              ["b", "LTV ceiling", aed(r.ltvMpbf), `${aed(r.calcBasis)} × ${pct(r.ltvPct)}`],
              ...(r.multiplierCap != null ? [["c", `Income multiplier ${input.multiplierX}×`, aed(r.multiplierCap), `${aed(r.eligibleIncome)} × 12 × ${input.multiplierX}`]] : []),
              ["", `MAX ELIGIBLE = MIN — ${r.maxEligibleLimitedBy} binds`, `▶ ${aed(r.maxEligible)} ◀`, "floored to AED 5,000"],
            ]}
            lastBold
          />
          <p className="calc-muted">Eligibility capacity is tested at ROI 3. DBR 1 and DBR 2 show the finance sought at the payable stages.</p>

          <SectionTitle>5 · Payment stages & EMI</SectionTitle>
          <OutTable
            head={["Stage", "ROI", "EMI / month", "DBR", "Payable"]}
            rows={[
              [`1 · Fixed, years 1–${r.roi?.introYears ?? "—"}`, r.roi ? pct(r.roi.r1) : "—", aed(Math.round(r.emi1)), `${r.dbr1}%`, "YES"],
              [`2 · From year ${(r.roi?.introYears ?? 0) + 1} (variable)`, r.roi ? pct(r.roi.r2) : "—", aed(Math.round(r.emi2)), `${r.dbr2}%`, "YES — resets"],
              ["3 · Stress / qualifying", r.roi ? pct(r.roi.r3) : "—", aed(Math.round(r.emi3)), `${r.dbr3}%`, "NO — test only"],
            ]}
          />
          {viewMode === "full" && <EiborBlock meta={meta} />}
          {viewMode === "full" && meta.roi2FromEibor === false && (
            <p className="calc-note">The follow-on rate of {r.roi ? pct(r.roi.r2) : "—"} was entered as a final figure, not derived from EIBOR. The lender's rate card and prevailing EIBOR at the time will set the actual rate — treat the follow-on EMI as illustrative.</p>
          )}
        </section>

        {/* ============ PAGE 2 — amortisation, what-if, basis (Full only) ============ */}
        {viewMode === "full" && (
          <section className="calc-sheet">
            <div className="calc-head">
              <div>
                <div className="font-disp font-bold text-[14px]">Amortisation · What-if · Basis</div>
                <div className="text-[9.5px] uppercase tracking-[0.16em] text-[var(--ink-faint)]">HFMC eligibility working</div>
              </div>
              <div className="text-right">
                <div className="mono text-[12px]" style={{ color: "var(--amber)" }}>{snap.stamp}</div>
                <div className="text-[10.5px] text-[var(--ink-faint)]">Page 2 / 2</div>
              </div>
            </div>

            <SectionTitle>6 · Amortisation schedule</SectionTitle>
            {model.amort ? (
              <>
                <p className="calc-muted">Loan {aed(r.maxEligible)} · months 1–{Math.round((r.roi?.introYears ?? 0) * 12)} at ROI 1 ({r.roi ? pct(r.roi.r1) : "—"}), then months {Math.round((r.roi?.introYears ?? 0) * 12) + 1}–{r.maxTenorMonths} at ROI 2 ({r.roi ? pct(r.roi.r2) : "—"}). At the fixed-term end the EMI is recalculated on the outstanding balance.</p>
                <OutTable
                  head={["Year", "EMI/mo", "Opening", "Principal", "Interest", "Closing", "Rate"]}
                  rows={[
                    ...model.amort.rows.map((y) => [
                      `${y.year}${y.months < 12 ? `* (${y.months} mo)` : ""}`,
                      num(y.emi), num(y.opening), num(y.principal), num(y.interest), num(y.closing), pct(y.ratePct),
                    ]),
                    ["", "", "", "TOTAL", `P ${num(model.amort.totalPrincipal)}`, `I ${num(model.amort.totalInterest)}`, ""],
                  ]}
                  lastBold money
                />
                <p className="calc-muted">* final year is {model.amort.rows[model.amort.rows.length - 1]?.months ?? 0} months, not 12. Total repayable {aed(model.amort.totalPayable)} · interest {aed(model.amort.totalInterest)}.</p>
              </>
            ) : (
              <p className="calc-muted">No qualifying amount — nothing to amortise.</p>
            )}
            <p className="calc-note">Years after the fixed term use ROI 2, built on the present {meta.eiborTenor} EIBOR ({meta.eiborPct != null ? pct(meta.eiborPct) : "—"}, {meta.eiborAsOn}). Future EIBOR is unknown and is presumed unchanged for illustration only.</p>

            <SectionTitle>7 · What-if analysis — reducing obligations</SectionTitle>
            <p className="calc-muted">One input changed at a time; the full calculation is re-run. Rates for all rows: ROI 1 {r.roi ? pct(r.roi.r1) : "—"} · ROI 2 {r.roi ? pct(r.roi.r2) : "—"} · ROI 3 {r.roi ? pct(r.roi.r3) : "—"}.</p>
            {model.whatif.length === 0 ? (
              <p className="calc-muted">No obligations on file — nothing to reduce. What-if appears once liabilities exist.</p>
            ) : model.whatif.map((f) => {
              return (
                <OutTable
                  key={f.fam}
                  head={["Scenario", "Current DBR", "Req. DBR 1", "Req. DBR 2", "Req. DBR 3", "Maximum finance", "Δ"]}
                  rows={f.rows.map((x) => [
                    x.gain ? `▮▮ ${x.label}` : x.label,
                    `${x.currentDbr}%`, `${x.dbr1}%`, `${x.dbr2}%`, `${x.dbr3}%`,
                    num(x.eligible), x.delta === 0 ? "—" : `+${num(x.delta)}`,
                  ])}
                  boldIdx={f.rows.map((x, i) => (x.gain ? i : -1)).filter((i) => i >= 0)}
                />
              );
            })}
            {model.bestGainNote && <p className="calc-note">▮▮ = action that increases the eligible amount. {model.bestGainNote}</p>}
            {model.noGain && (
              <p className="calc-note">NO GAIN AVAILABLE — the LTV ceiling of {aed(r.ltvMpbf)} ({pct(r.ltvPct)} of property value) caps the amount. Clearing obligations lowers the DBRs but cannot increase the loan. To raise eligibility, increase the down payment or the property valuation.</p>
            )}

            <SectionTitle>8 · Basis &amp; assumptions</SectionTitle>
            <ul className="calc-list">
              <li>Max DBR {pct(MAX_DBR)} of eligible income — CBUAE-style prudent limit</li>
              <li>LTV band {pct(r.ltvPct)} — {input.applicantType}, first property</li>
              <li>Max tenor 25 yrs; age-limited to {tenorOf(r.maxTenorMonths)} — loan must end at final age {input.finalAge}{input.coBorrower ? ` (or co-borrower age ${r.coAgeYears})` : ""}</li>
              <li>Qualifying rate {pct(r.qualifyingRate)} — ROI 3 sets the eligibility capacity</li>
              <li>Card obligations at 5% of limit</li>
              <li>EIBOR reference: {meta.eiborTenor} {meta.eiborPct != null ? pct(meta.eiborPct) : "—"}, published {meta.eiborAsOn} (CBUAE) — future rate presumed</li>
              <li>Calculation basis: {r.basisLabel}</li>
              <li>Amounts in AED; eligible amount floored to the nearest AED 5,000</li>
            </ul>

            <SectionTitle>9 · Declaration</SectionTitle>
            <p className="calc-muted">A preliminary affordability assessment prepared from information supplied by the applicant. Not a bank approval, offer or commitment to lend. Final terms are subject to the lender's credit policy, property valuation, verification of income and liabilities (AECB) and the lender's prevailing rate card. The follow-on rate and all figures from year {(r.roi?.introYears ?? 0) + 1} depend on future EIBOR and will change.</p>
            <div className="calc-sign">
              <div>Prepared by _________________________ <span>name / role{meta.preparedBy ? ` — ${meta.preparedBy}` : ""} / date</span></div>
              <div>Reviewed by _________________________ <span>name / role / date</span></div>
            </div>
            <div className="calc-foot">HFMC · Meridian Home Finance Consultants · Dubai, UAE · {snap.stamp}</div>
          </section>
        )}
      </div>
    </>
  );
}

/* ---------------- document atoms (screen + paper share them) ---------------- */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="calc-sec">{children}</h2>;
}

function KV({ rows }: { rows: [string, string, string, string][] }) {
  return (
    <div className="calc-kv">
      {rows.map(([k1, v1, k2, v2], i) => (
        <div key={i} className="calc-kv-row">
          <span className="calc-k">{k1}</span><span className="calc-v">{v1}</span>
          <span className="calc-k">{k2}</span><span className="calc-v mono">{v2}</span>
        </div>
      ))}
    </div>
  );
}

function Verdict({ r }: { r: ReturnType<typeof computeMortgage> }) {
  return (
    <div className="calc-verdict">
      <div className="calc-verdict-row">
        <span>MAXIMUM PERMISSIBLE FINANCE</span>
        <strong>{aed(r.maxEligible)}</strong>
      </div>
      <div className="calc-verdict-row dim">
        <span>Binding constraint — {r.maxEligibleLimitedBy === "DBR / Income" ? `income capacity at ${pct(r.qualifyingRate)}` : r.maxEligibleLimitedBy === "LTV" ? `LTV ceiling ${pct(r.ltvPct)} of ${aed(r.calcBasis)}` : `income multiplier`}</span>
        <span>Down payment {aed(Math.max(0, r.calcBasis - r.maxEligible))}</span>
      </div>
      {r.requested > 0 && (
        <>
          <div className="calc-div" />
          <div className="calc-verdict-row">
            <span>REQUESTED {aed(r.requested)}</span>
            <strong style={{ color: r.requestEligible ? "var(--mint)" : "var(--coral)" }}>{r.requestEligible ? "ELIGIBLE" : "NOT ELIGIBLE"}</strong>
          </div>
          <div className="calc-verdict-row dim">
            <span>ROI 3 DBR {pct(r.dbr3)} of {pct(MAX_DBR)}</span>
            <span>{r.requestEligible ? `within ${aed(r.maxEligible)} maximum` : `exceeds maximum by ${aed(r.requestShortfall)}`}</span>
          </div>
        </>
      )}
      <div className="calc-div" />
      <div className="calc-verdict-sub">Interest basis</div>
      <div className="calc-verdict-row dim">
        <span>Payable — ROI 1 introductory{r.roi?.introYears ? `, fixed ${r.roi.introYears} yrs` : ""}</span>
        <span className="mono">{r.roi ? pct(r.roi.r1) : pct(r.actualRate)}</span>
      </div>
      <div className="calc-verdict-row dim">
        <span>Payable — ROI 2 follow-on from year {(r.roi?.introYears ?? 0) + 1}</span>
        <span className="mono">{r.roi ? pct(r.roi.r2) : "—"}</span>
      </div>
      <div className="calc-verdict-row dim">
        <span>Qualification only — ROI 3 stress, never payable</span>
        <span className="mono">{r.roi ? pct(r.roi.r3) : pct(r.assessmentRate)}</span>
      </div>
      <div className="calc-div" />
      <div className="calc-verdict-sub">EMI</div>
      <div className="calc-verdict-row dim">
        <span>Initial EMI · years 1–{r.roi?.introYears || "—"} @ ROI 1</span>
        <span className="mono">{aed(Math.round(r.emi1))} / month</span>
      </div>
      <div className="calc-verdict-row dim">
        <span>Follow-on EMI · from year {(r.roi?.introYears ?? 0) + 1} @ ROI 2 — resets</span>
        <span className="mono">{aed(Math.round(r.emi2))} / month</span>
      </div>
      <div className="calc-verdict-row dim">
        <span>Stress EMI · test only @ ROI 3</span>
        <span className="mono">{aed(Math.round(r.emi3))} / month</span>
      </div>
      <div className="calc-div" />
      <div className="calc-verdict-sub">
        {`DBR at each ROI — on the finance sought of ${aed(r.requested)}`}
      </div>
      <div className="calc-dbrs">
        <span>DBR 1 <strong>{r.dbr1}%</strong></span>
        <span>DBR 2 <strong>{r.dbr2}%</strong></span>
        <span>DBR 3 <strong>{r.dbr3}%</strong></span>
      </div>
      <div className="calc-verdict-row dim">
        <span>CBUAE ceiling {pct(MAX_DBR)} — ROI 3 sets maximum permissible finance</span>
      </div>
      {r.roi && r.roi3BelowHigher && (
        <div className="calc-note">⚑ ROI 3 ({pct(r.roi.r3)}) is below ROI 1 or ROI 2; eligibility still uses ROI 3.</div>
      )}
      {r.roi && r.roi.r2 === r.roi.r3 && (
        <div className="calc-note">ROI 2 and ROI 3 are equal in this file, so the DBRs are equal and the stress test adds no further tightening.</div>
      )}
    </div>
  );
}

function OutTable({ head, rows, lastBold, money, boldIdx }: {
  head: string[]; rows: string[][]; lastBold?: boolean; money?: boolean; boldIdx?: number[];
}) {
  const bold = (i: number) => (lastBold && i === rows.length - 1) || (boldIdx?.includes(i) ?? false);
  return (
    <table className="calc-tbl">
      {head.length > 0 && (
        <thead><tr>{head.map((h, i) => <th key={i} className={i > 0 ? "num" : ""}>{h}</th>)}</tr></thead>
      )}
      <tbody>
        {rows.map((cells, i) => (
          <tr key={i} className={bold(i) ? "hl" : ""}>
            {cells.map((c, j) => <td key={j} className={j > 0 ? "num" : ""}>{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EiborBlock({ meta }: { meta: Snap["meta"] }) {
  return (
    <div className="calc-note">
      ⚠ FOLLOW-ON RATE BASIS — READ · ROI 2 uses the {meta.eiborTenor} EIBOR prevailing today
      ({meta.eiborPct != null ? pct(meta.eiborPct) : "—"}, CBUAE, as at {meta.eiborAsOn})
      {meta.eiborMarginPct != null ? ` plus a margin of ${pct(meta.eiborMarginPct)}` : ""}.
      The EIBOR that will actually apply after the fixed term is NOT known at the date of this
      assessment. Today's rate is presumed unchanged for illustration only — it is an assumption,
      not a forecast or a commitment.
    </div>
  );
}

function tenorOf(months: number): string {
  return `${Math.floor(months / 12)} yrs${months % 12 ? ` ${months % 12} mo` : ""}`;
}

function monthlyOf(x: { amount: number; frequency: string; eligiblePct: number }): number {
  const f = x.frequency === "Annual" ? 1 / 12 : x.frequency === "Quarterly" ? 1 / 3 : x.frequency === "Semi-Annual" ? 1 / 6 : x.frequency === "Weekly" ? 52 / 12 : 1;
  return x.amount * f * (x.eligiblePct / 100);
}

function liabOf(x: { method: string; limitOrOutstanding: number; monthlyEmi: number }): number {
  return x.method === "5% of Limit" || x.method === "5% of Outstanding" ? x.limitOrOutstanding * 0.05 : x.monthlyEmi;
}

const PRINT_DOC_CSS = `
@page { size: A4; margin: 12mm; }
.calc-print-toolbar { position: sticky; top: 0; z-index: 40; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; background: color-mix(in srgb, var(--raised) 96%, transparent); border-bottom: 1px solid var(--line); margin: -16px -16px 18px; }
.calc-print-wrap { max-width: 860px; margin: 0 auto; padding: 0 14px 40px; display: grid; gap: 26px; }
.calc-sheet { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 26px 30px; box-shadow: var(--shadow); }
.calc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding-bottom: 14px; border-bottom: 2px solid var(--amber); margin-bottom: 16px; }
.calc-sec { font-family: var(--font-disp); font-size: 12.5px; font-weight: 700; margin: 20px 0 8px; letter-spacing: 0.02em; }
.calc-muted { font-size: 10.5px; color: var(--ink-faint); margin: 6px 0 0; line-height: 1.6; }
.calc-note { font-size: 11px; line-height: 1.65; color: var(--ink-dim); background: var(--amber-tint); border: 1px solid var(--amber-line); border-radius: 8px; padding: 8px 11px; margin: 10px 0 0; }
.calc-kv { display: grid; border: 1px solid var(--line-soft); border-radius: 10px; overflow: hidden; }
.calc-kv-row { display: grid; grid-template-columns: 150px 1fr 150px 1fr; }
.calc-kv-row + .calc-kv-row { border-top: 1px solid var(--line-soft); }
.calc-k { font-size: 10.5px; color: var(--ink-faint); background: var(--tint); padding: 7px 10px; font-weight: 600; }
.calc-v { font-size: 11.5px; padding: 7px 10px; color: var(--ink); }
.calc-v.mono { font-family: var(--font-mono); }
.calc-verdict { border: 2px solid var(--amber); border-radius: 12px; padding: 14px 16px; margin-top: 14px; }
.calc-verdict-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; font-size: 12.5px; padding: 2.5px 0; }
.calc-verdict-row strong { font-family: var(--font-disp); font-size: 24px; }
.calc-verdict-row.dim { color: var(--ink-dim); }
.calc-verdict-sub { font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--ink-faint); font-weight: 700; margin: 8px 0 2px; }
.calc-div { border-top: 1px dashed var(--line); margin: 8px 0; }
.calc-dbrs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 6px 0; }
.calc-dbrs span { font-size: 11px; color: var(--ink-dim); background: var(--tint); border: 1px solid var(--line-soft); border-radius: 8px; padding: 7px 10px; text-align: center; }
.calc-dbrs strong { display: block; font-family: var(--font-disp); font-size: 19px; color: var(--ink); }
.calc-minihead { font-size: 11px; font-weight: 600; color: var(--ink-dim); margin: 10px 0 6px; }
.calc-tbl { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 6px; color: var(--ink); }
.calc-tbl th { text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-faint); padding: 5px 6px; border-bottom: 1px solid var(--line); }
.calc-tbl td { padding: 5.5px 6px; border-top: 1px dashed var(--line); vertical-align: top; }
.calc-tbl th.num, .calc-tbl td.num { text-align: right; font-family: var(--font-mono); }
.calc-tbl tr.hl td { font-weight: 700; background: var(--amber-tint); }
.calc-list { font-size: 11px; color: var(--ink-dim); line-height: 1.7; margin: 6px 0 0; padding-left: 18px; }
.calc-sign { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 16px; font-size: 11.5px; }
.calc-sign span { display: block; font-size: 10px; color: var(--ink-faint); margin-top: 2px; }
.calc-foot { text-align: center; font-size: 9.5px; color: var(--ink-faint); margin-top: 16px; padding-top: 8px; border-top: 1px solid var(--line-soft); }
@media print {
  .calc-print-toolbar { display: none !important; }
  .calc-print-wrap { max-width: none; padding: 0; gap: 0; display: block; }
  .calc-sheet { border: none; border-radius: 0; box-shadow: none; padding: 0 0 18px; background: white !important; color: black; }
  .calc-sheet + .calc-sheet { page-break-before: always; }
  .calc-verdict, .calc-tbl, .calc-tbl tr { break-inside: avoid; }
  body { background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;
