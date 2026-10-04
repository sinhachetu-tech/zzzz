// Product detail sheet — "tell me everything about this one product".
//
// The owner asked what else belongs on a product summary; the answer is in the
// LAYOUT, not more fields. Grouped so a broker reads it in the order they think:
//
//   1. WHO IT'S FOR      (axes, limits, minimums)
//   2. WHAT IT COSTS    (every rate line, resolved against today's EIBOR)
//   3. WHAT ELSE CHARGES (bank fees, insurance, early settlement)
//   4. HOW LONG         (TAT + validity)
//   5. THE RAW SOURCE   (the bank's own words, when a field above is wrong)
//
// Everything is read from the same structured sources the pricing engine reads, so
// this sheet can never disagree with what the engine will actually quote. Where a
// field is missing we print "not recorded" — never a plausible-looking guess.
"use client";

import { useCallback, useEffect, useState } from "react";
import { Chip } from "@/components/hfmc/ui";
import { fmtDateTime, fmtMoney, fmtRate } from "@/lib/format";

interface Detail {
  product: {
    id: number; name: string; sheet: string; status: string; version: number;
    effectiveDate: string | null; expiryDate: string | null; updatedAt: string;
    approvedBy: string; sourceFiles: string;
    bank: { name: string; logoUrl: string | null; posPoints: string; negPoints: string };
    mortgageType: string; employment: string; residency: string;
    financeType: string; program: string; isExclusive: boolean;
    maxLtvNational: number | null; maxLtvExpatriate: number | null;
    minLoan: number | null; maxLoan: number | null; minSalary: number | null;
    serviceMonthsMin: number | null; propertyAgeYearsMax: number | null;
    firstPropertyOnly: boolean; tenorYears: number | null;
    maxAgeSalaried: number | null; maxAgeSelfEmp: number | null;
    dbrPct: number | null; cardRulePct: number | null; bonusPct: number | null;
    rentalIncomePct: number | null; stressBufferPct: number | null;
    tat: {
      totalTatDays: number | null; paTatDays: number | null;
      paValidityDays: number | null; folValidityDays: number | null;
      valuationValidityDays: number | null;
    };
  };
  quotes: Array<{
    rateType: string; termYears?: number | null; ratePct?: number | null; marginPct?: number | null;
    floorPct?: number | null; ftvMax?: number | null; ftvMin?: number | null;
    txns?: string[] | null; salaryTransfer?: string[] | null; residency?: string[] | null;
    employment?: string[] | null; emirates?: string[] | null; profiles?: string[] | null;
    stages?: string[] | null; nationalityRule?: { mode: string; countries: string[] } | null;
    effectiveFrom?: string | null; effectiveTo?: string | null; note?: string;
    eiborBasis: string | null; eiborRateNow: number | null;
    effectiveRatePct: number | null; followOnRatePct: number | null;
    worked: { emi: number; followOnEmi: number | null } | null;
  }>;
  fees: {
    processing?: { default?: number | null; minFee?: number | null; maxFee?: number | null; note?: string } | null;
    preApproval?: { fee?: number | null; feeStl?: number | null; feeNstl?: number | null; feeSelfEmployed?: number | null; note?: string } | null;
    earlySettlement?: { pct?: number | null; minFee?: number | null; cap?: number | null; freeAfterYears?: number | null; note?: string } | null;
    partialSettlement?: { freeYearlyPct?: number | null; pct?: number | null; cap?: number | null; note?: string } | null;
    valuation?: { note?: string } | null;
  } | null;
  insurance: {
    life?: { basis?: string; rate?: number | null; note?: string } | null;
    property?: { basis?: string; rate?: number | null; note?: string } | null;
  } | null;
  sampleLoan: number;
  maxAtSample: number | null;
  eibor: Record<string, number>;
  raw: { rateTable: string; fees: string; insurance: string; eligibility: string; documents: string; notes: string };
}

/** "not recorded" is a real answer. Never invent a figure to fill a gap. */
const NA = <span className="text-[11.5px]" style={{ color: "var(--amber)" }}>not recorded</span>;
const or = (v: React.ReactNode, fallback: React.ReactNode = NA) => (v == null || v === "" ? fallback : v);
const money = (v: number | null | undefined) => (v == null ? null : fmtMoney(v));

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--ink-faint)] font-semibold">{label}</div>
      <div className="text-[12.5px] mt-0.5 break-words">{children}</div>
      {hint && <div className="text-[10.5px]" style={{ color: "var(--ink-faint)" }}>{hint}</div>}
    </div>
  );
}

export function Block({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="px-4 py-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
        <h3 className="font-disp font-semibold text-[14px] m-0">{title}</h3>
        {sub && <p className="text-[11.5px] text-[var(--ink-faint)] mt-0.5 mb-0">{sub}</p>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function ProductDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch(`/api/products/${id}`);
      if (!res.ok) throw new Error("could not load");
      setD(await res.json() as Detail);
    } catch {
      setErr("Could not load this product.");
      setD(null);
    }
  }, [id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch; the setStates are inside an async callback, not the effect body
  useEffect(() => { void load(); }, [load]);

  if (err) {
    return (
      <div className="card p-8 text-center">
        <p className="text-[13px] m-0 mb-3" style={{ color: "var(--coral)" }}>{err}</p>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back to products</button>
      </div>
    );
  }
  if (!d) {
    return <div className="card p-8 text-center text-[13px]" style={{ color: "var(--ink-faint)" }}>Loading product…</div>;
  }

  const p = d.product;
  const f = d.fees ?? {};
  const ins = d.insurance ?? {};
  const paFee = f.preApproval?.feeStl ?? f.preApproval?.feeNstl ?? f.preApproval?.fee;
  const top = d.quotes[0];

  return (
    <div className="space-y-4 anim-fade-up">
      {/* ---- header: bank logo + identity, then the headline rate ---- */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-4 px-4 py-4">
          <button className="btn btn-ghost btn-sm" onClick={onBack} title="Back to the product list">←</button>
          {p.bank.logoUrl ? (
            <img src={p.bank.logoUrl} alt="" className="h-12 w-12 rounded-lg object-contain shrink-0" style={{ background: "var(--bg2)" }} />
          ) : (
            <div className="h-12 w-12 rounded-lg flex items-center justify-center text-[13px] font-bold shrink-0"
              style={{ background: "var(--bg2)", color: "var(--ink-faint)" }}>
              {p.bank.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="font-disp font-semibold text-[17px] leading-tight">{p.bank.name}</div>
            <div className="text-[12px]" style={{ color: "var(--ink-dim)" }}>{p.name}</div>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <Chip tone={p.status === "approved" ? "mint" : "amber"}>{p.status}</Chip>
              <span className="mono text-[10.5px]" style={{ color: "var(--ink-faint)" }}>ID {p.id} · v{p.version}</span>
              {p.isExclusive && <Chip tone="amber">exclusive</Chip>}
            </div>
          </div>
          {top?.effectiveRatePct != null && (
            <div className="ml-auto text-right">
              <div className="mono font-bold" style={{ fontSize: 26, color: "var(--mint)" }}>{top.effectiveRatePct}%</div>
              <div className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
                {top.rateType === "FIXED" ? `fixed ${top.termYears ?? 0} years` : "variable, all-in at today's EIBOR"}
              </div>
            </div>
          )}
        </div>
        {(p.bank.posPoints || p.bank.negPoints) && (
          <div className="px-4 pb-3 text-[11.5px]" style={{ color: "var(--ink-dim)" }}>
            {p.bank.posPoints && <><span style={{ color: "var(--mint)", fontWeight: 600 }}>Strengths </span>{p.bank.posPoints}{" · "}</>}
            {p.bank.negPoints && <><span style={{ color: "var(--coral)", fontWeight: 600 }}>Watch </span>{p.bank.negPoints}</>}
          </div>
        )}
      </div>

      {/* ---- 1. who it's for ---- */}
      <Block title="Who this suits" sub="The eligibility axes. A blank here is a data gap, not a silent pass.">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          <Field label="Mortgage type">{or(p.mortgageType)}</Field>
          <Field label="Employment">{or(p.employment)}</Field>
          <Field label="Residency">{or(p.residency)}</Field>
          <Field label="Property type">{or(p.financeType)}</Field>
          <Field label="Min. monthly salary">
            {p.minSalary == null ? NA
              : p.minSalary < 1000
                ? <span style={{ color: "var(--coral)" }}>AED {p.minSalary.toLocaleString()} — implausible, verify</span>
                : `AED ${p.minSalary.toLocaleString()}`}
          </Field>
          <Field label="Min. service" hint={p.serviceMonthsMin ? "with current employer" : undefined}>
            {p.serviceMonthsMin ? `${p.serviceMonthsMin} months` : NA}
          </Field>
          <Field label="Max LTV — UAE National">{p.maxLtvNational != null ? `${p.maxLtvNational}%` : NA}</Field>
          <Field label="Max LTV — Expatriate">{p.maxLtvExpatriate != null ? `${p.maxLtvExpatriate}%` : NA}</Field>
          <Field label="Loan range">
            {p.minLoan == null && p.maxLoan == null ? NA
              : <>{p.minLoan != null ? fmtMoney(p.minLoan) : "—"} → {p.maxLoan != null ? fmtMoney(p.maxLoan) : "—"}</>}
          </Field>
          <Field label="Max tenure">{p.tenorYears ? `${p.tenorYears} years` : NA}</Field>
          <Field label="Age at maturity" hint="the borrower, not the building">
            {p.maxAgeSalaried == null && p.maxAgeSelfEmp == null ? NA
              : <>{p.maxAgeSalaried ?? "—"} salaried · {p.maxAgeSelfEmp ?? "—"} self-employed</>}
          </Field>
          <Field label="Property age cap">{p.propertyAgeYearsMax ? `${p.propertyAgeYearsMax} years` : NA}</Field>
          <Field label="First property only">{p.firstPropertyOnly ? "Yes — first purchase" : "No"}</Field>
        </div>
      </Block>

      {/* ---- 2. what it costs: every rate line, resolved ---- */}
      <Block
        title="Rates"
        sub={`Each line resolved against today's EIBOR, with a worked example on a ${fmtMoney(d.sampleLoan)} loan.`}
      >
        {/* The rates table below is genuinely tabular (rate per coverage), so it keeps
            its columns aligned and scrolls sideways rather than becoming cards —
            cards would destroy the alignment that makes the rates comparable.
            `.rf-scroll .rf-scroll-x` replaces a bare `overflow-x-auto`: it adds
            `overscroll-behavior: contain` (a sideways pan can't drag the page with
            it) and the edge-fade that makes the pan discoverable. */}
        {d.quotes.length === 0 ? (
          <p className="text-[12px] m-0" style={{ color: "var(--coral)" }}>
            No rate lines filed — this product cannot be quoted until one is added in Admin → Bank Rules.
          </p>
        ) : (
          <div className="rf-scroll rf-scroll-x">
            <table className="tbl w-full">
              <thead>
                <tr>
                  <th>Covers</th>
                  <th className="text-right">Rate</th>
                  <th>Fixed for</th>
                  <th>Then</th>
                  <th>Floor</th>
                  <th className="text-right">EMI on {fmtMoney(d.sampleLoan)}</th>
                  <th className="text-right">EMI after</th>
                </tr>
              </thead>
              <tbody>
                {d.quotes.map((q, i) => {
                  const covers = [
                    ...(q.txns?.length ? [q.txns.join("/")] : []),
                    ...(q.salaryTransfer?.length ? [q.salaryTransfer.join("/")] : []),
                    ...(q.emirates?.length ? [q.emirates.join("/")] : []),
                    ...(q.stages?.length ? [q.stages.join("/")] : []),
                    ...(q.profiles?.length ? [q.profiles.join("/")] : []),
                  ].join(" · ") || "All cases";
                  return (
                    <tr key={i}>
                      <td className="text-[11.5px] max-w-[260px]" style={{ color: "var(--ink-dim)" }}>{covers}</td>
                      <td className="text-right mono font-semibold" style={{ color: "var(--mint)" }}>
                        {q.effectiveRatePct != null ? `${q.effectiveRatePct}%` : "—"}
                      </td>
                      <td className="mono text-[11.5px]">
                        {q.rateType === "FIXED" ? `${q.termYears ?? 0} years` : "day 1"}
                      </td>
                      <td className="mono text-[11.5px]">
                        {q.rateType === "FIXED"
                          ? q.followOnRatePct != null
                            ? <>{q.followOnRatePct}% <span style={{ color: "var(--ink-faint)" }}>({q.eiborBasis} EIBOR + margin)</span></>
                            : <span style={{ color: "var(--coral)" }}>no follow-on filed</span>
                          : "variable"}
                      </td>
                      <td className="mono text-[11.5px]">{q.floorPct != null ? `${q.floorPct}%` : "—"}</td>
                      <td className="text-right mono">{q.worked ? fmtMoney(q.worked.emi) : "—"}</td>
                      <td className="text-right mono" style={{ color: q.worked?.followOnEmi ? "var(--amber)" : undefined }}>
                        {q.worked?.followOnEmi ? fmtMoney(q.worked.followOnEmi) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] m-0 mt-3" style={{ color: "var(--ink-faint)" }}>
          EIBOR today: {Object.entries(d.eibor).map(([t, v]) => `${t} ${v}%`).join(" · ") || "not recorded"}
        </p>
      </Block>

      {/* ---- 3. what else it charges ---- */}
      <Block title="Bank fees & insurance" sub="The charges that decide the real cost, not the headline rate.">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          <Field label="Processing fee">
            {f.processing?.default == null ? NA
              : f.processing.default === 0 ? <>Free</>
                : <>{f.processing.default}% of loan{f.processing.minFee ? ` (min ${fmtMoney(f.processing.minFee)})` : ""}</>}
          </Field>
          <Field label="Pre-approval fee">{paFee == null ? NA : paFee === 0 ? <>Free</> : fmtMoney(paFee)}</Field>
          <Field label="Property valuation">{f.valuation?.note || NA}</Field>
          <Field label="Early settlement">
            {f.earlySettlement?.pct == null ? NA
              : <>{f.earlySettlement.pct}%{f.earlySettlement.cap ? `, cap ${fmtMoney(f.earlySettlement.cap)}` : ""}
                {f.earlySettlement.freeAfterYears ? `, free after ${f.earlySettlement.freeAfterYears}y` : ""}</>}
          </Field>
          <Field label="Overpayment (partial)">
            {f.partialSettlement?.freeYearlyPct != null ? `${f.partialSettlement.freeYearlyPct}% free per year`
              : f.partialSettlement?.pct != null ? `${f.partialSettlement.pct}%` : NA}
          </Field>
          <Field label="Life insurance" hint={ins.life?.note ?? undefined}>
            {ins.life?.rate == null ? NA : <>{ins.life.rate}% <span style={{ color: "var(--ink-faint)" }}>{ins.life.basis?.replace(/_/g, " ")}</span></>}
          </Field>
          <Field label="Property insurance" hint={ins.property?.note ?? undefined}>
            {ins.property?.rate == null ? NA : <>{ins.property.rate}% <span style={{ color: "var(--ink-faint)" }}>{ins.property.basis?.replace(/_/g, " ")}</span></>}
          </Field>
          <Field label="Stress buffer">
            {p.stressBufferPct != null ? `+${p.stressBufferPct}% on the follow-on rate`
              : <span style={{ color: "var(--amber)" }}>not recorded — assumed 0</span>}
          </Field>
        </div>
      </Block>

      {/* ---- 4. how long ---- */}
      <Block title="Timeline & validity" sub="Working days, and how long each stage stays valid once granted.">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <Field label="Total TAT">{p.tat.totalTatDays != null ? `${p.tat.totalTatDays} days` : NA}</Field>
          <Field label="Pre-approval TAT">{p.tat.paTatDays != null ? `${p.tat.paTatDays} days` : NA}</Field>
          <Field label="Pre-approval valid">{p.tat.paValidityDays != null ? `${p.tat.paValidityDays} days` : NA}</Field>
          <Field label="FOL valid">{p.tat.folValidityDays != null ? `${p.tat.folValidityDays} days` : NA}</Field>
          <Field label="Valuation valid">{p.tat.valuationValidityDays != null ? `${p.tat.valuationValidityDays} days` : NA}</Field>
        </div>
      </Block>

      {/* ---- 5. the bank's own words ---- */}
      <Block title="Source & provenance" sub="Where this came from, and the bank's original text when a field above is wrong.">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Field label="Source files">{or(p.sourceFiles)}</Field>
          <Field label="Approved by">{or(p.approvedBy)}</Field>
          <Field label="Effective from">{p.effectiveDate ?? "always"}</Field>
          <Field label="Last modified">{fmtDateTime(p.updatedAt)}</Field>
        </div>
        <button className="btn btn-ghost btn-sm mt-3" onClick={() => setShowRaw((v) => !v)}>
          {showRaw ? "Hide" : "Show"} the bank's original text
        </button>
        {showRaw && (
          <div className="mt-3 space-y-3">
            {([["Rate card", d.raw.rateTable], ["Fees", d.raw.fees], ["Insurance", d.raw.insurance],
               ["Eligibility", d.raw.eligibility], ["Documents", d.raw.documents], ["Notes", d.raw.notes]] as const)
              .filter(([, v]) => v?.trim())
              .map(([label, v]) => (
                <div key={label}>
                  <div className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--ink-faint)] font-semibold">{label}</div>
                  <pre className="text-[11.5px] whitespace-pre-wrap m-0 p-2 rounded"
                    style={{ background: "var(--bg2)", color: "var(--ink-dim)", fontFamily: "inherit" }}>
                    {v}
                  </pre>
                </div>
              ))}
          </div>
        )}
      </Block>
    </div>
  );
}
