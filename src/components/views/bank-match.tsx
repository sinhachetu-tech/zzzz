"use client";
import { parseCaseProfile } from "@/lib/case-profile";

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
  version?: number;
  effectiveDate?: string | null;
  expiryDate?: string;
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
  schedule: { introRatePct: number | null; introTermYears: number | null; followOnRatePct: number | null; stressRatePct: number | null } | null;
  introEmi: number | null;
  followOnEmi: number | null;
  stressEmi: number | null;
  fees: {
    processingFeePct: number | null;
    processingFeeAed: number | null;
    processingFeeNote: string | null;
    preApprovalFeeAed: number | null;
    preApprovalNote: string | null;
    earlySettlementPct: number | null;
    earlySettlementCapAed: number | null;
    earlySettlementNote: string | null;
    partialSettlementFreeYearlyPct: number | null;
    partialSettlementFreeAed: number | null;
    partialSettlementNote: string | null;
    valuationNote: string | null;
  } | null;
  insurance: {
    lifeMonthlyAed: number | null;
    propertyYearlyAed: number | null;
    lifeNote: string | null;
    propertyNote: string | null;
  } | null;
  costBreakdown: {
    totalRepayment: number;
    processingFeeAed: number | null;
    totalLifeInsurance: number | null;
    preApprovalFeeAed: number | null;
    grandTotal: number | null;
    totalInterest: number;
  } | null;
  tat: {
    totalTatDays: number | null;
    paTatDays: number | null;
    paValidityDays: number | null;
    folValidityDays: number | null;
    valuationValidityDays: number | null;
  };
  jointAffordability?: {
    isJoint: boolean;
    role: "none" | "co_borrower" | "co_applicant";
    qualifyingIncome: number;
    qualifyingBonus: number;
    qualifyingRental: number;
    qualifyingEmis: number;
    qualifyingCardLimits: number;
    effectiveAge?: number;
    summary: string;
  };
}

const VERDICT: Record<string, { tone: "mint" | "amber" | "coral"; label: string }> = {
  eligible: { tone: "mint", label: "Eligible" },
  conditions: { tone: "amber", label: "Eligible with conditions" },
  not_eligible: { tone: "coral", label: "Not eligible" },
};

const fmt = (n: number | null) => (n == null ? "—" : "AED " + n.toLocaleString("en-US"));

export function BankMatchPanel({ c }: { c: LoanCase }) {
  const { toast } = useHfmcStore();
  const initProf = parseCaseProfile(c.profileJson, {
    customer: c.customer, whatsapp: c.whatsapp, loanAmount: c.loanAmount,
    employmentProfile: c.employmentProfile, residency: c.residency,
    propertyType: c.propertyType, transactionType: c.transactionType,
    propertyLocation: c.propertyLocation, coApplicantName: c.coApplicantName,
  });

  const [income, setIncome] = useState(initProf.primary.monthlySalary > 0 ? String(initProf.primary.monthlySalary) : "");
  const [emis, setEmis] = useState(initProf.primary.existingEmis > 0 ? String(initProf.primary.existingEmis) : "");
  const [propertyValue, setPropertyValue] = useState(initProf.property.propertyValue > 0 ? String(initProf.property.propertyValue) : "");
  const [stl, setStl] = useState(true);
  const [cardLimits, setCardLimits] = useState(initProf.primary.creditCardLimits > 0 ? String(initProf.primary.creditCardLimits) : "");
  const [rental, setRental] = useState(initProf.primary.rentalIncome > 0 ? String(initProf.primary.rentalIncome) : "");
  const [bonus, setBonus] = useState(initProf.primary.variableIncome > 0 ? String(initProf.primary.variableIncome) : "");
  const [term, setTerm] = useState(3);
  const [ratePref, setRatePref] = useState<"best" | "fixed" | "flexible">("best");
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);

  // Second Party / Co-Borrower vs Co-Applicant state
  const [secondPartyRole, setSecondPartyRole] = useState<"none" | "co_borrower" | "co_applicant">(initProf.secondParty.role);
  const [coBorrowerIncome, setCoBorrowerIncome] = useState(initProf.secondParty.monthlySalary > 0 ? String(initProf.secondParty.monthlySalary) : "");
  const [coBorrowerEmis, setCoBorrowerEmis] = useState(initProf.secondParty.existingEmis > 0 ? String(initProf.secondParty.existingEmis) : "");
  const [coBorrowerCardLimits, setCoBorrowerCardLimits] = useState(initProf.secondParty.creditCardLimits > 0 ? String(initProf.secondParty.creditCardLimits) : "");

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
          stl, termYears: ratePref === "flexible" ? 0 : term,
          ratePref,
          processingMonths: initProf.processingMonths ?? 3,
          primaryAge: initProf.primary.age,
          coBorrowerAge: initProf.secondParty.age,
          secondPartyRole,
          coBorrowerIncome: secondPartyRole === "co_borrower" ? Number(coBorrowerIncome) || 0 : 0,
          coBorrowerEmis: secondPartyRole === "co_borrower" ? Number(coBorrowerEmis) || 0 : 0,
          coBorrowerCardLimits: secondPartyRole === "co_borrower" ? Number(coBorrowerCardLimits) || 0 : 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Match failed");
      setResults(data.results);
      localStorage.setItem("hfmc_proposal_request", JSON.stringify({ caseId: c.id, monthlyIncome: Number(income), existingEmis: Number(emis) || 0, cardLimitsTotal: Number(cardLimits) || 0, rentalIncome: Number(rental) || 0, bonusIncome: Number(bonus) || 0, propertyValue: Number(propertyValue), loanAmount: c.loanAmount, stl, termYears: ratePref === "flexible" ? 0 : term, ratePref, processingMonths: initProf.processingMonths ?? 3, primaryAge: initProf.primary.age, coBorrowerAge: initProf.secondParty.age }));
      // preselect eligible + conditions products for the proposal
      const pre: Record<number, boolean> = {};
      for (const r of data.results) if (r.verdict !== "not_eligible") pre[r.bankProductId] = true;
      setSelected(pre);
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
        {/* Joint application role banner */}
        <div className={`p-2.5 rounded-lg border text-[11.5px] mb-3 flex flex-wrap items-center justify-between gap-2 ${secondPartyRole === "co_borrower" ? "bg-[var(--mint-tint)] border-[var(--mint)]" : secondPartyRole === "co_applicant" ? "bg-[var(--amber-tint)] border-[var(--amber)]" : "bg-[var(--bg2)] border-[var(--line-soft)]"}`}>
          <div className="flex items-center gap-2">
            <span className="font-semibold uppercase tracking-wider text-[10px]">Application Type:</span>
            {secondPartyRole === "co_borrower" && (
              <span className="text-[var(--mint)] font-semibold">
                Joint Co-Borrower ({initProf.secondParty.fullName || "Co-Borrower"}) � Incomes & Debts Pooled for DBR
              </span>
            )}
            {secondPartyRole === "co_applicant" && (
              <span className="text-[var(--amber)] font-semibold">
                Single Borrower with Co-Applicant ({initProf.secondParty.fullName || "Co-Applicant"}) for Title Only � Financials Excluded
              </span>
            )}
            {secondPartyRole === "none" && (
              <span className="text-[var(--ink-dim)]">Single Borrower Application</span>
            )}
          </div>
          <div className="flex gap-1">
            {(["none", "co_borrower", "co_applicant"] as const).map((r) => (
              <button
                key={r}
                type="button"
                className={`px-2 py-0.5 rounded text-[10.5px] font-semibold transition-all ${secondPartyRole === r ? "bg-[var(--ink)] text-[var(--bg)]" : "bg-[var(--surface)] text-[var(--ink-faint)]"}`}
                onClick={() => setSecondPartyRole(r)}
              >
                {r === "none" ? "Single" : r === "co_borrower" ? "Co-Borrower (Financial)" : "Co-Applicant (Title)"}
              </button>
            ))}
          </div>
        </div>

        {/* If co_borrower is active, show the pooled second party inputs */}
        {secondPartyRole === "co_borrower" && (
          <div className="p-2.5 rounded-lg bg-[var(--surface)] border border-[var(--mint)] mb-3 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-[var(--mint)]">
              Co-Borrower Financial Inputs ({initProf.secondParty.fullName || "Co-Borrower"})
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="label">Co-Borrower Salary</label>
                <input className="input mono" type="number" min={0} placeholder="15000" value={coBorrowerIncome} onChange={(e) => setCoBorrowerIncome(e.target.value)} />
              </div>
              <div>
                <label className="label">Co-Borrower Loan EMIs</label>
                <input className="input mono" type="number" min={0} placeholder="0" value={coBorrowerEmis} onChange={(e) => setCoBorrowerEmis(e.target.value)} />
              </div>
              <div>
                <label className="label">Co-Borrower Card Limits</label>
                <input className="input mono" type="number" min={0} placeholder="0" value={coBorrowerCardLimits} onChange={(e) => setCoBorrowerCardLimits(e.target.value)} />
              </div>
            </div>
          </div>
        )}

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
            <label className="label">Rate type</label>
            <select className="select" value={ratePref} onChange={(e) => setRatePref(e.target.value as typeof ratePref)}>
              <option value="best">Best available</option>
              <option value="fixed">Fixed for term</option>
              <option value="flexible">Flexible (EIBOR-linked)</option>
            </select>
          </div>
          {ratePref === "fixed" ? (
            <div>
              <label className="label">Fixed tenure</label>
              <select className="select" value={term} onChange={(e) => setTerm(Number(e.target.value))}>
                <option value={1}>1 year</option>
                <option value={2}>2 years</option>
                <option value={3}>3 years</option>
                <option value={4}>4 years</option>
                <option value={5}>5 years</option>
                <option value={-1}>All terms — best</option>
              </select>
            </div>
          ) : ratePref === "flexible" ? (
            <div>
              <label className="label">Benchmark</label>
              <select className="select" disabled>
                <option>Day-1 EIBOR-linked</option>
              </select>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <button className="btn btn-primary btn-sm" onClick={run} disabled={busy}>
            <ICalc size={14} /> {busy ? "Running…" : "Run bank match"}
          </button>
          {results && results.some((r) => selected[r.bankProductId]) && (
            <button className="btn btn-mint btn-sm" onClick={() => {
              const raw = localStorage.getItem("hfmc_proposal_request");
              if (!raw) return;
              const body = JSON.parse(raw);
              body.productIds = Object.entries(selected).filter(([, v]) => v).map(([k]) => Number(k));
              localStorage.setItem("hfmc_proposal_request", JSON.stringify(body));
              window.open("/proposal", "_blank");
            }}>
              Generate proposal ({Object.values(selected).filter(Boolean).length})
            </button>
          )}
        </div>

        {results && (
          <div className="space-y-2 mt-4">
            {results.map((r) => {
              const v = VERDICT[r.verdict];
              return (
                <div key={r.bankProductId} className="rounded-lg px-3 py-2.5" style={{ background: "var(--tint)", borderLeft: `3px solid var(--${v.tone})` }}>
                  <div className="flex flex-wrap items-center gap-2">
                    {r.verdict !== "not_eligible" && (
                      <input type="checkbox" checked={!!selected[r.bankProductId]} onChange={(e) => setSelected({ ...selected, [r.bankProductId]: e.target.checked })} title="Include in proposal" />
                    )}
                    <span className="text-[12.5px] font-semibold">{r.bankName}</span>
                    <span className="text-[11.5px] text-[var(--ink-dim)]">{r.productName}</span>
                    <Chip tone={v.tone}>{v.label}</Chip>
                    {r.version && (
                      <span className="mono text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: "var(--amber-tint)", color: "var(--amber)" }}>
                        v{r.version}{r.effectiveDate ? ` · ${r.effectiveDate.slice(0, 10)}` : ""}
                      </span>
                    )}
                    <span className="ml-auto mono text-[12.5px] font-semibold" style={{ color: r.verdict === "eligible" ? "var(--mint)" : undefined }}>
                      {r.verdict === "not_eligible" ? "" : fmt(r.eligibleLoan)}
                    </span>
                  </div>
                  {r.schedule && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2 mono text-[11.5px]">
                      <div className="rounded px-2 py-1" style={{ background: "var(--bg2)" }}>
                        <span className="text-[var(--ink-faint)]">1 · intro</span><br />
                        {r.introEmi != null
                          ? <><strong style={{ color: "var(--mint)" }}>{fmt(r.introEmi)}</strong>/mo{r.schedule.introTermYears ? <span className="text-[var(--ink-faint)]"> · {r.schedule.introRatePct}% for {r.schedule.introTermYears}y</span> : null}</>
                          : "—"}
                      </div>
                      <div className="rounded px-2 py-1" style={{ background: "var(--bg2)" }}>
                        <span className="text-[var(--ink-faint)]">2 · after intro</span><br />
                        {r.followOnEmi != null
                          ? <><strong>{fmt(r.followOnEmi)}</strong>/mo{r.schedule.followOnRatePct != null ? <span className="text-[var(--ink-faint)]"> · {r.schedule.followOnRatePct.toFixed(2)}%</span> : null}</>
                          : "—"}
                      </div>
                      <div className="rounded px-2 py-1" style={{ background: "var(--amber-tint)" }}>
                        <span className="text-[var(--amber)]">3 · stress (qualifies)</span><br />
                        {r.stressEmi != null
                          ? <><strong style={{ color: "var(--amber)" }}>{fmt(r.stressEmi)}</strong>/mo{r.schedule.stressRatePct != null ? <span className="text-[var(--ink-faint)]"> · {r.schedule.stressRatePct.toFixed(2)}%</span> : null}</>
                          : "—"}
                      </div>
                    </div>
                  )}
                  {r.schedule?.introRatePct != null && r.introEmi != null && r.followOnEmi != null && r.followOnEmi > r.introEmi && (
                    <p className="text-[11px] m-0 mt-1" style={{ color: "var(--coral)" }}>
                      payment shock: EMI rises by {fmt(r.followOnEmi - r.introEmi)}/mo ({Math.round(((r.followOnEmi - r.introEmi) / r.introEmi) * 100)}%) when the intro period ends
                    </p>
                  )}
                  {r.assessmentRatePct != null && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 mono text-[11.5px] mt-1.5" style={{ color: "var(--ink-dim)" }}>
                      {r.maxLoanByDbr != null && <span>DBR cap: {fmt(r.maxLoanByDbr)} @ {r.dbrPctUsed}%</span>}
                      {r.maxLoanByLtv != null && <span>LTV cap: {fmt(r.maxLoanByLtv)}</span>}
                      {r.cardObligation != null && <span>card @ {r.cardObligation.toLocaleString()}/mo</span>}
                      <span>eligible: <strong style={{ color: "var(--mint)" }}>{fmt(r.eligibleLoan)}</strong></span>
                    </div>
                  )}
                  {(r.fees || r.insurance) && (
                    <div className="rounded-md p-2 mt-2 space-y-1.5" style={{ background: "var(--bg2)" }}>
                      <div className="text-[10px] uppercase tracking-[0.08em] font-semibold text-[var(--ink-faint)] flex items-center justify-between">
                        <span>Bank Charges & Insurance</span>
                        {r.costBreakdown?.grandTotal != null && (
                          <span className="mono text-[10.5px] text-[var(--ink)]">
                            Est. Total Outflow: <strong style={{ color: "var(--mint)" }}>{fmt(r.costBreakdown.grandTotal)}</strong>
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 mono text-[11px]">
                        {r.fees?.processingFeeAed != null && (
                          <span title={r.fees.processingFeeNote || "Processing fee"}>
                            Proc: <strong>{fmt(r.fees.processingFeeAed)}</strong>
                            {r.fees.processingFeePct != null ? <span className="text-[var(--ink-faint)]"> ({r.fees.processingFeePct}%)</span> : null}
                          </span>
                        )}
                        {r.fees?.preApprovalFeeAed != null && (
                          <span title={r.fees.preApprovalNote || "Pre-approval fee"}>
                            PA Fee: <strong>{r.fees.preApprovalFeeAed === 0 ? "Free" : fmt(r.fees.preApprovalFeeAed)}</strong>
                          </span>
                        )}
                        {r.fees?.earlySettlementPct != null && (
                          <span title={r.fees.earlySettlementNote || "Early settlement"}>
                            Early settle: <strong>{r.fees.earlySettlementPct}%</strong>
                            {r.fees.earlySettlementCapAed ? <span className="text-[var(--ink-faint)]"> (max {fmt(r.fees.earlySettlementCapAed)})</span> : null}
                          </span>
                        )}
                        {r.fees?.partialSettlementFreeYearlyPct != null && (
                          <span title={r.fees.partialSettlementNote || "Partial settlement"}>
                            Free partial: <strong>{r.fees.partialSettlementFreeYearlyPct}%/yr</strong>
                            {r.fees.partialSettlementFreeAed ? <span className="text-[var(--ink-faint)]"> ({fmt(r.fees.partialSettlementFreeAed)})</span> : null}
                          </span>
                        )}
                        {r.insurance?.lifeMonthlyAed != null && (
                          <span title={r.insurance.lifeNote || "Life insurance"}>
                            Life ins: <strong>{fmt(r.insurance.lifeMonthlyAed)}/mo</strong>
                          </span>
                        )}
                        {r.insurance?.propertyYearlyAed != null && (
                          <span title={r.insurance.propertyNote || "Property insurance"}>
                            Property ins: <strong>{fmt(r.insurance.propertyYearlyAed)}/yr</strong>
                          </span>
                        )}
                        {r.costBreakdown?.totalInterest != null && (
                          <span>
                            Total interest: <strong>{fmt(r.costBreakdown.totalInterest)}</strong>
                          </span>
                        )}
                        {r.fees?.valuationNote && (
                          <span className="col-span-2 truncate text-[var(--ink-faint)]" title={r.fees.valuationNote}>
                            Valuation: {r.fees.valuationNote}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  {r.tat && (r.tat.paTatDays != null || r.tat.paValidityDays != null || r.tat.folValidityDays != null || r.tat.totalTatDays != null) && (
                    <div className="flex flex-wrap gap-2 mt-1.5 text-[10.5px] mono text-[var(--ink-faint)]">
                      {r.tat.paTatDays != null && <span className="px-1.5 py-0.5 rounded bg-[var(--surface)]">PA TAT: {r.tat.paTatDays} wd</span>}
                      {r.tat.totalTatDays != null && <span className="px-1.5 py-0.5 rounded bg-[var(--surface)]">Total TAT: {r.tat.totalTatDays} wd</span>}
                      {r.tat.paValidityDays != null && <span className="px-1.5 py-0.5 rounded bg-[var(--surface)]">PA Validity: {r.tat.paValidityDays} d</span>}
                      {r.tat.folValidityDays != null && <span className="px-1.5 py-0.5 rounded bg-[var(--surface)]">FOL Validity: {r.tat.folValidityDays} d</span>}
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
