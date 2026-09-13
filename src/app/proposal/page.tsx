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
}
interface ProposalData {
  mode: "client" | "internal";
  generatedAt: string;
  case: { caseNumber: string; customer: string; employmentProfile: string; residency: string; transactionType: string; propertyType: string; loanAmount: number; propertyValue: number; emirate: string; feeTxn: string };
  results: ProposalResult[];
  costs: { equity: number; transferFees: { label: string; note: string; amount: number }[]; sellerFees: { label: string; note: string; amount: number }[]; transferTotal: number; grossCashNeeded: number };
  checklist: { title: string; category: string; status: string; mandatory: boolean }[];
}

const fmt = (n: number | null | undefined) => (n == null ? "—" : "AED " + Math.round(n).toLocaleString("en-US"));

export default function ProposalPage() {
  const [data, setData] = useState<ProposalData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async (mode: "client" | "internal") => {
    setLoading(true);
    const raw = sessionStorage.getItem("hfmc_proposal_request");
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

  useEffect(() => { load("client"); }, []);

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
          <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>🖨 Print / Save PDF</button>
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
            <div className="text-[11px] text-[var(--ink-faint)]">{new Date(data.generatedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 my-5">
          <Stat label="Property value" value={fmt(c.propertyValue)} />
          <Stat label="Finance requested" value={fmt(c.loanAmount)} highlight />
          <Stat label="Emirate" value={c.emirate} />
        </div>

        {results.map((r) => (
          <div key={r.bankProductId} className="my-4 rounded-xl p-4" style={{ border: "1px solid var(--line)", background: "var(--tint)" }}>
            <div className="flex items-center gap-3 pb-2.5" style={{ borderBottom: "1px dashed var(--line)" }}>
              {r.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
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

function Shell({ children }: { children: React.ReactNode }) {
  const printCss = "@media print { .no-print { display: none !important; } body { background: white !important; } .proposal-doc { border: none !important; } }";
  return (
    <div className="min-h-screen p-4 md:p-8" style={{ background: "var(--bg)" }}>
      <style>{printCss}</style>
      {children}
    </div>
  );
}
