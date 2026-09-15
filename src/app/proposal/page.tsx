"use client";

/* Proposal generator — print-ready comparison from a Bank Match run.
   Reads the match request from sessionStorage (set by the Bank Match panel),
   assembles via /api/proposal, renders client-facing or internal view.
   The toolbar is print-hidden; browsers' "Save as PDF" produces the document. */

import { useEffect, useState } from "react";
import { LogoMark } from "@/components/icons";

interface ProposalResult {
  bankProductId: number;
  bankName: string;
  productName: string;
  logoUrl: string | null;
  verdict: string;
  quote: { rateType: string; ratePct?: number | null; marginPct?: number | null; termYears?: number | null } | null;
  schedule: { introRatePct: number | null; introTermYears: number | null; followOnRatePct: number | null; stressRatePct: number | null } | null;
  introEmi: number | null;
  followOnEmi: number | null;
  stressEmi: number | null;
  assessmentRatePct: number | null;
  eligibleLoan: number | null;
  maxLoanByDbr: number | null;
  maxLoanByLtv: number | null;
  monthlyEmi: number | null;
  reasons: string[];
  commission: { gross: number; partnerCut: number; net: number; ratePct: number; partnerSharePct: number } | null;
  bankCosts: { processingFeePct: number | null; processingFee: number | null; lifeMonthly: number | null; propertyYearly: number | null };
  dbrIntro: number | null;
  dbrFollowOn: number | null;
  dbrStress: number | null;
  earlySettlement: string | null;
  partialSettlement: string | null;
  posPoints: string | null;
  negPoints: string | null;
}
interface ProposalData {
  mode: "client" | "internal";
  generatedAt: string;
  case: { caseNumber: string; customer: string; employmentProfile: string; residency: string; transactionType: string; propertyType: string; loanAmount: number; propertyValue: number; emirate: string; feeTxn: string; goldenVisa?: boolean; islamicOnly?: boolean };
  results: ProposalResult[];
  costs: { equity: number; transferFees: { label: string; note: string; amount: number }[]; sellerFees: { label: string; note: string; amount: number }[]; transferTotal: number; grossCashNeeded: number };
  checklist: { title: string; category: string; status: string; mandatory: boolean }[];
}

const fmt = (n: number | null | undefined) => (n == null ? "—" : "AED " + Math.round(n).toLocaleString("en-US"));

export default function ProposalPage() {
  const [data, setData] = useState<ProposalData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savedOk, setSavedOk] = useState(false);

  const load = async (mode: "client" | "internal") => {
    setLoading(true);
    const raw = localStorage.getItem("hfmc_proposal_request");
    if (!raw) { setErr("No bank match in progress — run a Bank Match from the case page first."); setLoading(false); return; }
    try {
      const body = { ...JSON.parse(raw), mode };
      const res = await fetch("/api/proposal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not assemble proposal");
      setData(json);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    }
    setLoading(false);
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage is browser-only; the initial load must set state
  useEffect(() => { load("client"); }, []);
  useEffect(() => {
    if (data) (window as unknown as { __proposalData?: ProposalData }).__proposalData = data;
  }, [data]);

  if (loading) return <Shell><div className="p-10 text-center text-[var(--ink-faint)]">Assembling proposal…</div></Shell>;
  if (err) return <Shell><div className="p-10 text-center" style={{ color: "var(--coral)" }}>{err}</div></Shell>;
  if (!data) return null;

  const { case: c, results, costs, checklist } = data;

  return (
    <Shell>
      {/* toolbar — hidden when printing */}
      <div className="no-print flex flex-wrap items-center gap-2 mb-5">
        <LogoMark size={26} />
        <span className="font-disp font-semibold text-[13px]">Proposal · {c.caseNumber}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <button className={data.mode === "client" ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"} onClick={() => load("client")}>Client version</button>
          <button className={data.mode === "internal" ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"} onClick={() => load("internal")}>Internal version</button>
          <button className="btn btn-mint btn-sm" onClick={async () => {
            const raw = localStorage.getItem("hfmc_proposal_request");
            if (!raw) return;
            const req = JSON.parse(raw);
            const res = await fetch("/api/proposals", { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ caseId: req.caseId, productIds: results.map((r) => r.bankProductId), inputs: req, mode: data.mode }) });
            if (res.ok) { setSavedOk(true); setTimeout(() => setSavedOk(false), 3000); }
          }}>
            {savedOk ? "Saved ✓" : "Save to case"}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={exportCsv}>⬇ Export Excel (CSV)</button>
          <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>🖨 Export PDF (print)</button>
        </div>
      </div>

      {/* proposal document */}
      <div className="proposal-doc" style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "28px 32px", maxWidth: 900, margin: "0 auto" }}>
        <div className="flex items-start justify-between gap-4 pb-4" style={{ borderBottom: "2px solid var(--amber)" }}>
          <div>
            <LogoMark size={34} />
            <div className="font-disp font-bold text-[16px] mt-1.5">HFMC Home Finance</div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--ink-faint)]">Mortgage proposal · UAE</div>
          </div>
          <div className="text-right">
            <div className="mono text-[13px]" style={{ color: "var(--amber)" }}>{c.caseNumber}</div>
            <div className="font-disp font-semibold text-[18px]">{c.customer}</div>
            <div className="text-[11px] text-[var(--ink-faint)]">{c.employmentProfile} · {c.residency} · {c.propertyType} · {c.transactionType || "Resale"}</div>
            {(c.goldenVisa || c.islamicOnly) && (
              <div className="flex gap-1.5 justify-end mt-1 flex-wrap">
                {c.goldenVisa && <span className="mono text-[9.5px] px-1.5 py-0.5 rounded" style={{ background: "rgba(67,214,155,0.15)", color: "var(--mint)" }}>GOLDEN VISA — ask RM for preferential pricing</span>}
                {c.islamicOnly && <span className="mono text-[9.5px] px-1.5 py-0.5 rounded" style={{ background: "rgba(87,194,234,0.15)", color: "var(--sky)" }}>SHARIA-COMPLIANT ONLY</span>}
              </div>
            )}
            <div className="text-[11px] text-[var(--ink-faint)]">{new Date(data.generatedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 my-5">
          <Stat label="Property value" value={fmt(c.propertyValue)} />
          <Stat label="Finance requested" value={fmt(c.loanAmount)} highlight />
          <Stat label="Emirate" value={c.emirate} />
        </div>

        {/* side-by-side comparison */}
        <h3 className="font-disp font-semibold text-[14px] mt-6 mb-2">Side-by-side comparison</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]" style={{ borderCollapse: "collapse", minWidth: 640 }}>
            <thead>
              <tr>
                <th className="text-left py-1.5 pr-2 font-disp text-[10px] uppercase tracking-[0.1em] text-[var(--ink-faint)]">Metric</th>
                {results.map((r) => (
                  <th key={r.bankProductId} className="text-left py-1.5 px-2 font-disp text-[11px]" style={{ borderBottom: "2px solid var(--amber)" }}>
                    {r.bankName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <CompareRow label="Eligible loan" values={results.map((r) => fmt(r.eligibleLoan))} bold />
              <CompareRow label="Intro rate" values={results.map((r) => r.schedule?.introRatePct != null ? r.schedule.introRatePct.toFixed(2) + "%" : "—")} />
              <CompareRow label="Intro EMI" values={results.map((r) => fmt(r.introEmi))} />
              <CompareRow label="After-intro rate" values={results.map((r) => r.schedule?.followOnRatePct != null ? r.schedule.followOnRatePct.toFixed(2) + "%" : "—")} />
              <CompareRow label="Follow-on EMI" values={results.map((r) => fmt(r.followOnEmi))} />
              <CompareRow label="Stress rate" values={results.map((r) => r.schedule?.stressRatePct != null ? r.schedule.stressRatePct.toFixed(2) + "%" : "—")} />
              <CompareRow label="Stress EMI" values={results.map((r) => fmt(r.stressEmi))} />
              <CompareRow label="Income consumed — intro" values={results.map((r) => r.dbrIntro != null ? r.dbrIntro + "%" : "—")} />
              <CompareRow label="Income consumed — after intro" values={results.map((r) => r.dbrFollowOn != null ? r.dbrFollowOn + "%" : "—")} />
              <CompareRow label="Income consumed — stress" values={results.map((r) => r.dbrStress != null ? r.dbrStress + "%" : "—")} />
              <CompareRow label="Bank processing fee" values={results.map((r) => r.bankCosts?.processingFee != null ? fmt(r.bankCosts.processingFee) : "—")} />
              <CompareRow label="Life insurance" values={results.map((r) => r.bankCosts?.lifeMonthly != null ? fmt(r.bankCosts.lifeMonthly) + "/mo" : "—")} />
              <CompareRow label="Property insurance" values={results.map((r) => r.bankCosts?.propertyYearly != null ? fmt(r.bankCosts.propertyYearly) + "/yr" : "—")} />
              <CompareRow label="Early settlement" values={results.map((r) => r.earlySettlement ?? "—")} />
              <CompareRow label="Partial settlement" values={results.map((r) => r.partialSettlement ?? "—")} />
              {data.mode === "internal" && <CompareRow label="Positives (negotiating)" values={results.map((r) => r.posPoints || "—")} />}
              {data.mode === "internal" && <CompareRow label="Watch-outs (negotiating)" values={results.map((r) => r.negPoints || "—")} />}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-[var(--ink-faint)] m-0 mt-1">Government &amp; transfer fees are identical across banks — see the cost sheet below. "Income consumed" = EMI as % of the income supplied to the match.</p>

        {results.map((r) => (
          <div key={r.bankProductId} className="my-4 rounded-xl p-4" style={{ border: "1px solid var(--line)", background: "var(--tint)" }}>
            <div className="flex items-center gap-3 pb-2.5" style={{ borderBottom: "1px dashed var(--line)" }}>
              {r.logoUrl ? (
                <img src={r.logoUrl} alt={r.bankName} style={{ height: 30, objectFit: "contain" }} />
              ) : (
                <span className="font-disp font-bold text-[15px]">{r.bankName}</span>
              )}
              <span className="text-[12px] text-[var(--ink-dim)]">{r.productName}</span>
              <span className="ml-auto mono text-[15px] font-bold" style={{ color: "var(--mint)" }}>{fmt(r.eligibleLoan)}</span>
            </div>

            <div className="grid grid-cols-3 gap-2.5 my-3 mono text-[12px]">
              <RateBox n="1" label={`Intro · ${r.schedule?.introTermYears ? r.schedule.introTermYears + "y" : "day 1"}`} rate={r.schedule?.introRatePct} emi={r.introEmi} tone="mint" />
              <RateBox n="2" label="After intro" rate={r.schedule?.followOnRatePct} emi={r.followOnEmi} />
              <RateBox n="3" label="Stress-qualified" rate={r.schedule?.stressRatePct} emi={r.stressEmi} tone="amber" />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 mono text-[11.5px]" style={{ color: "var(--ink-dim)" }}>
              <span>Max by DBR: {fmt(r.maxLoanByDbr)}</span>
              <span>Max by LTV: {fmt(r.maxLoanByLtv)}</span>
              <span>EMI on requested: {fmt(r.monthlyEmi)}</span>
              {r.reasons.length > 0 && <span style={{ color: "var(--coral)" }}>{r.reasons.join(" · ")}</span>}
            </div>
            {r.bankCosts && (r.bankCosts.processingFee != null || r.bankCosts.lifeMonthly != null) && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 mono text-[11px] mt-1.5" style={{ color: "var(--ink-dim)" }}>
                {r.bankCosts.processingFee != null && <span>bank processing fee: {fmt(r.bankCosts.processingFee)}{r.bankCosts.processingFeePct != null ? " (" + r.bankCosts.processingFeePct + "%)" : ""}</span>}
                {r.bankCosts.lifeMonthly != null && <span>life insurance: ~{fmt(r.bankCosts.lifeMonthly)}/mo</span>}
                {r.bankCosts.propertyYearly != null && <span>property insurance: ~{fmt(r.bankCosts.propertyYearly)}/yr</span>}
              </div>
            )}
          </div>
        ))}

        {/* cost to close */}
        <h3 className="font-disp font-semibold text-[14px] mt-6 mb-2">Estimated cash needed at transfer — {c.emirate}</h3>
        <table className="w-full text-[12px]" style={{ borderCollapse: "collapse" }}>
          <tbody>
            <tr><td className="py-1.5">Equity / self contribution</td><td className="mono text-right">{fmt(costs.equity)}</td></tr>
            {costs.transferFees.map((f) => (
              <tr key={f.label}>
                <td className="py-1.5" style={{ color: "var(--ink-dim)" }}>{f.label}{f.note ? <span className="text-[10.5px] text-[var(--ink-faint)]"> · {f.note}</span> : null}</td>
                <td className="mono text-right">{fmt(f.amount)}</td>
              </tr>
            ))}
            <tr style={{ borderTop: "1px dashed var(--line)" }}>
              <td className="py-2 font-disp font-semibold">Gross cash needed (fees to client side)</td>
              <td className="mono text-right font-bold" style={{ color: "var(--amber)" }}>{fmt(costs.grossCashNeeded)}</td>
            </tr>
          </tbody>
        </table>
        {costs.sellerFees.length > 0 && (
          <p className="text-[10.5px] text-[var(--ink-faint)] m-0 mt-1.5">
            Seller-side (not client cost): {costs.sellerFees.map((f) => `${f.label} ${fmt(f.amount)}`).join(" · ")}
          </p>
        )}
        <p className="text-[10px] text-[var(--ink-faint)] m-0 mt-1">Government and bank charges per the HFMC fee matrices — indicative, confirm at transfer.</p>

        {/* internal-only commission — the server only includes it for viewRevenue users */}
        {data.mode === "internal" && (
          <div className="mt-5 rounded-lg p-4" style={{ background: "var(--amber-tint)", border: "1px solid var(--amber)" }}>
            <div className="text-[10px] uppercase tracking-[0.12em] font-disp font-semibold text-[var(--amber)] mb-2">Internal · revenue (restricted)</div>
            <table className="w-full text-[12px]" style={{ borderCollapse: "collapse" }}>
              <tbody>
                {results.map((r) => r.commission ? (
                  <tr key={r.bankProductId}>
                    <td className="py-1">{r.bankName} @ {r.commission.ratePct}%</td>
                    <td className="mono text-right">gross {fmt(r.commission.gross)}</td>
                    <td className="mono text-right" style={{ color: "var(--coral)" }}>− partner {fmt(r.commission.partnerCut)}</td>
                    <td className="mono text-right font-semibold" style={{ color: "var(--mint)" }}>net {fmt(r.commission.net)}</td>
                  </tr>
                ) : null)}
              </tbody>
            </table>
          </div>
        )}

        {/* documents */}
        <h3 className="font-disp font-semibold text-[14px] mt-6 mb-2">Document checklist</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {checklist.map((d) => (
            <div key={d.title} className="flex items-center gap-2 text-[11.5px] rounded px-2 py-1" style={{ background: "var(--tint)" }}>
              <span className="flex-1 truncate">{d.title}{d.mandatory ? " *" : ""}</span>
              <span className="mono text-[10px]" style={{ color: d.status === "Verified" ? "var(--mint)" : d.status === "Rejected" ? "var(--coral)" : "var(--ink-faint)" }}>{d.status}</span>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-[var(--ink-faint)] mt-4 text-center">
          Indicative figures per HFMC rule engine (source: bank rate cards & HFMC-SOP-MASTER-2026) · not a bank approval · terms confirmed by the final offer letter.
        </p>
      </div>
    </Shell>
  );
}

function exportCsv() {
  const d = (window as unknown as { __proposalData?: ProposalData }).__proposalData;
  if (!d) return;
  const banks = d.results;
  const metrics: [string, (r: ProposalResult) => string][] = [
    ["Verdict", (r) => r.verdict],
    ["Eligible loan (AED)", (r) => num(r.eligibleLoan)],
    ["Intro rate %", (r) => num(r.schedule?.introRatePct)],
    ["Intro EMI (AED)", (r) => num(r.introEmi)],
    ["After-intro rate %", (r) => num(r.schedule?.followOnRatePct)],
    ["Follow-on EMI (AED)", (r) => num(r.followOnEmi)],
    ["Stress rate %", (r) => num(r.schedule?.stressRatePct)],
    ["Stress EMI (AED)", (r) => num(r.stressEmi)],
    ["Income consumed intro %", (r) => num(r.dbrIntro)],
    ["Income consumed after-intro %", (r) => num(r.dbrFollowOn)],
    ["Income consumed stress %", (r) => num(r.dbrStress)],
    ["Processing fee (AED)", (r) => num(r.bankCosts?.processingFee)],
    ["Life insurance (AED/mo)", (r) => num(r.bankCosts?.lifeMonthly)],
    ["Property insurance (AED/yr)", (r) => num(r.bankCosts?.propertyYearly)],
    ["Early settlement", (r) => r.earlySettlement ?? ""],
    ["Partial settlement", (r) => r.partialSettlement ?? ""],
  ];
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [
    [`Metric`, ...banks.map((b) => `${b.bankName} — ${b.productName}`)].map(esc).join(","),
    ...metrics.map(([label, get]) => [esc(label), ...banks.map((b) => esc(get(b)))].join(",")),
    "",
    [esc("Cost to close — " + d.case.emirate)].map(esc).join(","),
    ...d.costs.transferFees.map((f) => [esc(f.label), esc(String(f.amount))].join(",")),
    [esc("Gross cash needed"), esc(String(d.costs.grossCashNeeded))].join(","),
  ];
  const csv = "\uFEFF" + lines.join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = `proposal-${d.case.caseNumber}.csv`; a.click();
  URL.revokeObjectURL(url);
}
const num = (v: number | null | undefined) => (v == null ? "" : String(v));


function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: "var(--tint)" }}>
      <div className="text-[9.5px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)]">{label}</div>
      <div className="mono text-[14px] mt-0.5" style={{ fontWeight: highlight ? 700 : 500, color: highlight ? "var(--amber)" : "var(--ink)" }}>{value}</div>
    </div>
  );
}

function RateBox({ n, label, rate, emi, tone }: { n: string; label: string; rate: number | null | undefined; emi: number | null; tone?: "mint" | "amber" }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: tone === "amber" ? "var(--amber-tint)" : "var(--bg2)", border: tone === "amber" ? "1px solid var(--amber)" : "1px solid var(--line)" }}>
      <div className="text-[10px] font-disp font-semibold" style={{ color: tone === "amber" ? "var(--amber)" : "var(--ink-faint)" }}>{n} · {label}</div>
      <div className="mt-0.5">{rate != null ? <strong style={{ color: tone === "mint" ? "var(--mint)" : undefined }}>{rate.toFixed(2)}%</strong> : "—"}{emi != null ? <span className="text-[var(--ink-dim)]"> · {fmt(emi)}/mo</span> : null}</div>
    </div>
  );
}

function CompareRow({ label, values, bold }: { label: string; values: string[]; bold?: boolean }) {
  return (
    <tr style={{ borderBottom: "1px dashed var(--line)" }}>
      <td className="py-1.5 pr-2" style={{ color: "var(--ink-dim)", fontWeight: bold ? 700 : 400 }}>{label}</td>
      {values.map((v, i) => (
        <td key={i} className="py-1.5 px-2 mono" style={{ fontWeight: bold ? 700 : 400, color: bold ? "var(--amber)" : undefined }}>{v}</td>
      ))}
    </tr>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const printCss = "@media print { .no-print { display: none !important; } body { background: white !important; } .proposal-doc { border: none !important; } }";
  return (
    <div className="min-h-screen p-4 md:p-8" style={{ background: "var(--bg)" }}>
      <style>{printCss}</style>
      {children}
    </div>
  );
}
