"use client";

/* Bank Match — runs the eligibility engine for this case and shows a ranked
   shortlist of bank products with computed numbers and pass/fail reasons. */

import { useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { LoanCase } from "@/lib/types";
import { Chip } from "@/components/hfmc/ui";
import { IBank, ICalc } from "@/components/icons";

interface MatchResult {
  bankProductId: number;
  bankName: string;
  productName: string;
  verdict: "eligible" | "conditions" | "not_eligible";
  reasons: string[];
  quote: { rateType: string; ratePct?: number | null; marginPct?: number | null; term?: number | null } | null;
  assessmentRatePct: number | null;
  monthlyEmi: number | null;
  maxLoanByDbr: number | null;
  maxLoanByLtv: number | null;
  eligibleLoan: number | null;
  ltvPct: number | null;
  cardObligation: number | null;
  dbrPctUsed: number | null;
  eligibleIncome: number | null;
}

const VERDICT: Record<string, { tone: "mint" | "amber" | "coral"; label: string }> = {
  eligible: { tone: "mint", label: "Eligible" },
  conditions: { tone: "amber", label: "Eligible with conditions" },
  not_eligible: { tone: "coral", label: "Not eligible" },
};

const fmt = (n: number | null) => (n == null ? "—" : "AED " + n.toLocaleString("en-US"));

export function BankMatchPanel({ c }: { c: LoanCase }) {
  const { toast } = useHfmcStore();
  const [income, setIncome] = useState("");
  const [emis, setEmis] = useState("");
  const [propertyValue, setPropertyValue] = useState("");
  const [stl, setStl] = useState(true);
  const [cardLimits, setCardLimits] = useState("");
  const [rental, setRental] = useState("");
  const [bonus, setBonus] = useState("");
  const [term, setTerm] = useState(3);
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!income || !propertyValue) {
      toast("error", "Enter the client's monthly income and the property value.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/bank-match", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: c.id,
          monthlyIncome: Number(income),
          existingEmis: Number(emis) || 0,
          cardLimitsTotal: Number(cardLimits) || 0,
          rentalIncome: Number(rental) || 0,
          bonusIncome: Number(bonus) || 0,
          propertyValue: Number(propertyValue),
          stl, termYears: term,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Match failed");
      setResults(data.results);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Match failed");
    }
    setBusy(false);
  };

  const eligibleCount = results?.filter((r) => r.verdict === "eligible").length ?? 0;

  return (
    <div className="card anim-fade-up">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
        <IBank size={14} className="text-[var(--amber)]" />
        <h3 className="font-disp font-semibold text-[14px] m-0">Bank Match</h3>
        {results && (
          <span className="mono text-[11px] px-1.5 py-0.5 rounded" style={{ background: "rgba(67,214,155,0.12)", color: "var(--mint)" }}>
            {eligibleCount} eligible of {results.length} products
          </span>
        )}
      </div>

      <div className="p-4">
        <p className="text-[11.5px] text-[var(--ink-faint)] m-0 mb-3">
          Case profile: {c.employmentProfile} · {c.residency} · {c.propertyType} · {c.transactionType || "Resale"} · requested {fmt(c.loanAmount)}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div>
            <label className="label">Monthly income</label>
            <input className="input mono" type="number" min={0} placeholder="20000" value={income} onChange={(e) => setIncome(e.target.value)} />
          </div>
          <div>
            <label className="label">Existing EMIs</label>
            <input className="input mono" type="number" min={0} placeholder="0" value={emis} onChange={(e) => setEmis(e.target.value)} />
          </div>
          <div>
            <label className="label">Property value</label>
            <input className="input mono" type="number" min={0} placeholder="1800000" value={propertyValue} onChange={(e) => setPropertyValue(e.target.value)} />
          </div>
          <div>
            <label className="label">Card limits</label>
            <input className="input mono" type="number" min={0} placeholder="0" value={cardLimits} onChange={(e) => setCardLimits(e.target.value)} />
          </div>
          <div>
            <label className="label">Rental income</label>
            <input className="input mono" type="number" min={0} placeholder="0" value={rental} onChange={(e) => setRental(e.target.value)} />
          </div>
          <div>
            <label className="label">Bonus income</label>
            <input className="input mono" type="number" min={0} placeholder="0" value={bonus} onChange={(e) => setBonus(e.target.value)} />
          </div>
          <div>
            <label className="label">Salary transfer</label>
            <button type="button" className="chip transition-all w-full justify-center" onClick={() => setStl(!stl)}
              style={stl
                ? { background: "rgba(67,214,155,0.12)", borderColor: "rgba(67,214,155,0.5)", color: "var(--mint)" }
                : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}>
              {stl ? "STL" : "NSTL"}
            </button>
          </div>
          <div>
            <label className="label">Fixed term</label>
            <select className="select" value={term} onChange={(e) => setTerm(Number(e.target.value))}>
              <option value={1}>1 year</option>
              <option value={3}>3 years</option>
              <option value={5}>5 years</option>
              <option value={0}>Day-1 variable</option>
            </select>
          </div>
        </div>
        <button className="btn btn-primary btn-sm mt-3" onClick={run} disabled={busy}>
          <ICalc size={14} /> {busy ? "Running…" : "Run bank match"}
        </button>

        {results && (
          <div className="space-y-2 mt-4">
            {results.map((r) => {
              const v = VERDICT[r.verdict];
              return (
                <div key={r.bankProductId} className="rounded-lg px-3 py-2.5" style={{ background: "var(--tint)", borderLeft: `3px solid var(--${v.tone})` }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] font-semibold">{r.bankName}</span>
                    <span className="text-[11.5px] text-[var(--ink-dim)]">{r.productName}</span>
                    <Chip tone={v.tone}>{v.label}</Chip>
                    <span className="ml-auto mono text-[12.5px] font-semibold" style={{ color: r.verdict === "eligible" ? "var(--mint)" : undefined }}>
                      {r.verdict === "not_eligible" ? "" : fmt(r.eligibleLoan)}
                    </span>
                  </div>
                  {r.assessmentRatePct != null && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 mono text-[11.5px] mt-1.5" style={{ color: "var(--ink-dim)" }}>
                      <span>rate: <strong style={{ color: "var(--amber)" }}>{r.assessmentRatePct.toFixed(2)}%</strong> stressed</span>
                      {r.quote?.ratePct != null && <span>fixed: {r.quote.ratePct}% / {r.quote.term}y</span>}
                      <span>EMI @ requested: {fmt(r.monthlyEmi)}</span>
                      {r.maxLoanByDbr != null && <span>DBR cap: {fmt(r.maxLoanByDbr)} @ {r.dbrPctUsed}%</span>}
                      {r.cardObligation != null && <span>card @ {r.cardObligation.toLocaleString()}/mo</span>}
                      {r.maxLoanByLtv != null && <span>LTV cap: {fmt(r.maxLoanByLtv)}</span>}
                    </div>
                  )}
                  {r.reasons.length > 0 && (
                    <p className="text-[11px] m-0 mt-1" style={{ color: r.verdict === "eligible" ? "var(--ink-faint)" : "var(--coral)" }}>
                      {r.reasons.join(" · ")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
