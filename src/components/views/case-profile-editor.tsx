"use client";

/* Case Profile Editor  Comprehensive Lead & Applicant Qualification
   Captures Primary Applicant, Property Details, and Second Party with
   the strict distinction between Co-Borrower (Financial - Pooled) vs
   Co-Applicant (Non-Financial - Title Only). */

import { useState, useEffect } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { LoanCase } from "@/lib/types";
import {
  type CaseProfile,
  type SecondPartyRole,
  parseCaseProfile,
  computeJointAffordability,
  ageFromDob,
} from "@/lib/case-profile";
import { Chip } from "@/components/hfmc/ui";
import { ICheck, IUsers, ICalc } from "@/components/icons";

export type ProfileSubTab = "primary" | "property" | "joint";

interface Props {
  c: LoanCase;
  initialTab?: ProfileSubTab;
  onSaved?: (p: CaseProfile) => void;
}

/* Quick proposal generation from the qualification data itself — the Bank Match
   panel needs the same inputs this editor captures, so the button lives here
   (below the decision flags). Saves the profile first, runs the eligibility
   engine, then hands the selection to the print-ready /proposal page. */
interface QuickMatchResult {
  bankProductId: number;
  bankName: string;
  productName: string;
  verdict: "eligible" | "conditions" | "not_eligible";
  eligibleLoan: number | null;
  introEmi: number | null;
  introRatePct: number | null;
  introTermYears: number | null;
}

const VERDICT_LABEL: Record<string, { tone: "mint" | "amber" | "coral"; label: string }> = {
  eligible: { tone: "mint", label: "Eligible" },
  conditions: { tone: "amber", label: "Conditions" },
  not_eligible: { tone: "coral", label: "Not eligible" },
};

function fmtAed(n: number | null) {
  return n == null ? "—" : "AED " + Math.round(n).toLocaleString("en-US");
}

export function CaseProfileEditor({ c, initialTab, onSaved }: Props) {
  const { updateCase, toast } = useHfmcStore();
  const [profile, setProfile] = useState<CaseProfile>(() =>
    parseCaseProfile(c.profileJson, {
      customer: c.customer,
      whatsapp: c.whatsapp,
      loanAmount: c.loanAmount,
      employmentProfile: c.employmentProfile,
      residency: c.residency,
      propertyType: c.propertyType,
      transactionType: c.transactionType,
      propertyLocation: c.propertyLocation,
      coApplicantName: c.coApplicantName,
      // canonical classification lives on the case row too — preload it so the
      // 5 questions show what was already answered (profileJson still wins)
      propertyTypeCanonical: c.propertyTypeCanonical,
      commercialSubtype: c.commercialSubtype,
      propertyStage: c.propertyStage,
      constructionStatus: c.constructionStatus,
      partyRelationship: c.partyRelationship,
      existingFinance: c.existingFinance,
      transactionPurpose: c.transactionPurpose,
    })
  );
  const [activeTab, setActiveTab] = useState<ProfileSubTab>(() => initialTab ?? "primary");

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);
  const [saving, setSaving] = useState(false);
  const [quick, setQuick] = useState<{
    busy: boolean;
    results: QuickMatchResult[] | null;
    selected: Record<number, boolean>;
    opening: boolean;
  }>({ busy: false, results: null, selected: {}, opening: false });

  const p = profile.primary;
  const prop = profile.property;
  const s = profile.secondParty;
  const jointSummary = computeJointAffordability(profile);

  const updatePrimary = (patch: Partial<CaseProfile["primary"]>) => {
    setProfile((prev) => ({ ...prev, primary: { ...prev.primary, ...patch } }));
  };

  const updateProperty = (patch: Partial<CaseProfile["property"]>) => {
    setProfile((prev) => {
      const nextProp = { ...prev.property, ...patch };
      // Auto-compute down payment if value and loan change
      if (patch.propertyValue !== undefined || patch.loanAmount !== undefined) {
        const val = nextProp.propertyValue || 0;
        const loan = nextProp.loanAmount || 0;
        if (val > 0 && loan > 0) {
          nextProp.downPayment = Math.max(0, val - loan);
        }
      }
      return { ...prev, property: nextProp };
    });
  };

  const updateSecondParty = (patch: Partial<CaseProfile["secondParty"]>) => {
    setProfile((prev) => ({ ...prev, secondParty: { ...prev.secondParty, ...patch } }));
  };

  const save = async () => {
    setSaving(true);
    const ok = await persistProfile();
    if (ok) {
      toast("success", "Applicant & loan profile saved.");
      onSaved?.(profile);
    }
    setSaving(false);
  };

  // one persistence path shared by "Save profile" and the quick proposal generator
  const persistProfile = async (): Promise<boolean> => {
    try {
      // canonical dims → case row (validated server-side); transaction purpose is
      // derived from the user's explicit Transaction Type pick (not guessed) and
      // stored SEPARATELY from the property dims per the classification plan.
      const txn = prop.transactionType.toLowerCase();
      const purpose = txn.includes("buyout") && txn.includes("equity") ? "REFINANCE_AND_EQUITY"
        : txn.includes("buyout") ? "REFINANCE"
        : txn.includes("equity") ? "EQUITY_RELEASE"
        : "PURCHASE";
      await updateCase(c.id, {
        profileJson: JSON.stringify(profile),
        customer: p.fullName.trim() || c.customer,
        whatsapp: p.phone.trim() || c.whatsapp,
        loanAmount: prop.loanAmount || c.loanAmount,
        employmentProfile: p.employmentProfile,
        residency: p.residency,
        propertyType: prop.propertyType,
        transactionType: prop.transactionType,
        propertyLocation: prop.propertyLocation || null,
        coApplicantName: s.role !== "none" && s.fullName.trim() ? s.fullName.trim() : null,
        propertyTypeCanonical: prop.canonicalPropertyType ?? "UNKNOWN",
        commercialSubtype: (prop.canonicalPropertyType ?? "UNKNOWN") === "COMMERCIAL" ? (prop.canonicalCommercialSubtype ?? "UNKNOWN") : null,
        propertyStage: prop.canonicalPropertyStage ?? "UNKNOWN",
        constructionStatus: prop.canonicalConstructionStatus ?? "UNKNOWN",
        partyRelationship: prop.canonicalPartyRelationship ?? "UNKNOWN",
        existingFinance: prop.canonicalExistingFinance ?? "UNKNOWN",
        transactionPurpose: purpose,
      });
      return true;
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to save profile.");
      return false;
    }
  };

  const ltvPct = prop.propertyValue > 0 && prop.loanAmount > 0
    ? Math.round((prop.loanAmount / prop.propertyValue) * 1000) / 10
    : null;

  // Quick proposal: persist the profile as-is, run the eligibility engine with
  // exactly the inputs this form captured, list the ranked shortlist.
  const runQuickMatch = async () => {
    if (p.monthlySalary <= 0 && s.role !== "co_borrower") { toast("error", "Fill the monthly salary first (tab 1)."); return; }
    if (prop.propertyValue <= 0) { toast("error", "Fill the property value first (tab 2)."); return; }
    setQuick((q) => ({ ...q, busy: true }));
    const saved = await persistProfile();
    if (!saved) { setQuick((q) => ({ ...q, busy: false })); return; }
    try {
      const res = await fetch("/api/bank-match", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: c.id,
          monthlyIncome: p.monthlySalary,
          existingEmis: p.existingEmis,
          cardLimitsTotal: p.creditCardLimits,
          rentalIncome: p.rentalIncome,
          bonusIncome: p.variableIncome,
          propertyValue: prop.propertyValue,
          stl: true,
          termYears: 3,
          ratePref: "best",
          processingMonths: profile.processingMonths ?? 3,
          primaryAge: p.age,
          coBorrowerAge: s.age,
          secondPartyRole: s.role,
          coBorrowerIncome: s.role === "co_borrower" ? s.monthlySalary : 0,
          coBorrowerEmis: s.role === "co_borrower" ? s.existingEmis : 0,
          coBorrowerCardLimits: s.role === "co_borrower" ? s.creditCardLimits : 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Match failed");
      const results: QuickMatchResult[] = data.results;
      const pre: Record<number, boolean> = {};
      for (const r of results) if (r.verdict !== "not_eligible") pre[r.bankProductId] = true;
      setQuick({ busy: false, results, selected: pre, opening: false });
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Match failed");
      setQuick((q) => ({ ...q, busy: false }));
    }
  };

  const openProposal = () => {
    const productIds = Object.entries(quick.selected).filter(([, v]) => v).map(([k]) => Number(k));
    if (productIds.length === 0) { toast("error", "Select at least one bank."); return; }
    setQuick((q) => ({ ...q, opening: true }));
    localStorage.setItem("hfmc_proposal_request", JSON.stringify({
      caseId: c.id,
      monthlyIncome: p.monthlySalary,
      existingEmis: p.existingEmis,
      cardLimitsTotal: p.creditCardLimits,
      rentalIncome: p.rentalIncome,
      bonusIncome: p.variableIncome,
      propertyValue: prop.propertyValue,
      loanAmount: prop.loanAmount || c.loanAmount,
      stl: true,
      termYears: 3,
      ratePref: "best",
      processingMonths: profile.processingMonths ?? 3,
      primaryAge: p.age,
      coBorrowerAge: s.age,
      productIds,
    }));
    window.open("/proposal", "_blank");
    setQuick((q) => ({ ...q, opening: false }));
  };

  return (
    <div className="card anim-fade-up">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
        <div className="flex items-center gap-2">
          <IUsers size={16} className="text-[var(--amber)]" />
          <h3 className="font-disp font-semibold text-[14px] m-0">Lead & Applicant Profile</h3>
          <Chip tone={jointSummary.badgeTone}>{jointSummary.badgeLabel}</Chip>
        </div>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
          <ICheck size={14} /> {saving ? "Saving" : "Save profile"}
        </button>
      </div>

      {/* Tabs — numbered stepper with progress so qualification feels guided */}
      <div className="px-4 pt-3">
        <div className="flex items-center gap-1.5" aria-label="Qualification progress">
          {(["primary", "property", "joint"] as const).map((t, i) => {
            const labels = ["Personal", "Property", "Joint"];
            const order = { primary: 0, property: 1, joint: 2 } as const;
            const done = order[activeTab] > i;
            const cur = activeTab === t;
            return (
              <button key={t} onClick={() => setActiveTab(t)} className="flex-1 flex items-center gap-1.5 group">
                <span className="w-5 h-5 rounded-full flex items-center justify-center mono text-[10.5px] font-semibold shrink-0"
                  style={cur ? { background: "var(--amber)", color: "#fff" } : done ? { background: "var(--mint)", color: "#fff" } : { background: "var(--track)", color: "var(--ink-faint)" }}>
                  {done ? <ICheck size={11} /> : i + 1}
                </span>
                <span className="text-[11px] font-disp font-semibold hidden sm:inline" style={{ color: cur ? "var(--ink)" : "var(--ink-faint)" }}>{labels[i]}</span>
                {i < 2 && <span className="flex-1 h-px mx-1" style={{ background: done ? "var(--mint)" : "var(--line)" }} />}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex border-b text-[12px] font-disp font-semibold px-4 pt-2 gap-4" style={{ borderColor: "var(--line-soft)" }}>
        <button
          className={`pb-2 border-b-2 transition-colors ${activeTab === "primary" ? "border-[var(--amber)] text-[var(--ink)]" : "border-transparent text-[var(--ink-faint)]"}`}
          onClick={() => setActiveTab("primary")}
        >
          1. Primary Applicant {p.fullName ? `(${p.fullName})` : ""}
        </button>
        <button
          className={`pb-2 border-b-2 transition-colors ${activeTab === "property" ? "border-[var(--amber)] text-[var(--ink)]" : "border-transparent text-[var(--ink-faint)]"}`}
          onClick={() => setActiveTab("property")}
        >
          2. Property & Finance
        </button>
        <button
          className={`pb-2 border-b-2 transition-colors ${activeTab === "joint" ? "border-[var(--amber)] text-[var(--ink)]" : "border-transparent text-[var(--ink-faint)]"}`}
          onClick={() => setActiveTab("joint")}
        >
          3. Co-Borrower / Co-Applicant {s.role !== "none" ? `(${s.role === "co_borrower" ? "Pooled" : "Title"})` : ""}
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* TAB 1: PRIMARY APPLICANT */}
        {activeTab === "primary" && (
          <div className="space-y-4">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-faint)]">
                Personal & Demographics
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-1.5">
                <div>
                  <label className="label">Full Name</label>
                  <input className="input" placeholder="e.g. Mohammed Al Mansoori" value={p.fullName} onChange={(e) => updatePrimary({ fullName: e.target.value })} />
                </div>
                <div>
                  <label className="label">Residency Status</label>
                  <select className="select" value={p.residency} onChange={(e) => updatePrimary({ residency: e.target.value as CaseProfile["primary"]["residency"] })}>
                    <option value="UAE National">UAE National (Max LTV 85%)</option>
                    <option value="Resident Expatriate">Resident Expatriate (Max LTV 80%)</option>
                    <option value="Non-Resident">Non-Resident (Max LTV 50-60%)</option>
                  </select>
                </div>
                <div>
                  <label className="label">Nationality</label>
                  <input className="input" placeholder="e.g. Emirati, British, Indian" value={p.nationality ?? ""} onChange={(e) => updatePrimary({ nationality: e.target.value })} />
                </div>
                <div>
                  <label className="label">Date of birth · <span style={{ color: "var(--amber)" }}>drives the tenure cap</span></label>
                  <input className="input mono" type="date" value={p.dob ?? ""} onChange={(e) => updatePrimary({ dob: e.target.value || undefined, age: ageFromDob(e.target.value) ?? p.age })} />
                </div>
                <div>
                  <label className="label">Age (years){p.dob ? " — from DOB" : " (fallback if DOB unknown)"}</label>
                  <input className="input mono" type="number" min={21} max={70} placeholder="38" value={p.age ?? ""} onChange={(e) => updatePrimary({ age: e.target.value ? Number(e.target.value) : undefined })} />
                </div>
                <div>
                  <label className="label">Phone / WhatsApp</label>
                  <input className="input mono" placeholder="+971 50 123 4567" value={p.phone} onChange={(e) => updatePrimary({ phone: e.target.value })} />
                </div>
                <div>
                  <label className="label">Emirates ID No. · <span style={{ color: "var(--amber)" }}>links their client file</span></label>
                  <input className="input mono" placeholder="784-XXXX-XXXXXXX-X" value={p.eidNo ?? ""} onChange={(e) => updatePrimary({ eidNo: e.target.value })} />
                </div>
                <div>
                  <label className="label">Passport No.</label>
                  <input className="input mono" placeholder="e.g. A1234567" value={p.passportNo ?? ""} onChange={(e) => updatePrimary({ passportNo: e.target.value })} />
                </div>
                <div>
                  <label className="label">Email Address</label>
                  <input className="input" type="email" placeholder="client@example.com" value={p.email ?? ""} onChange={(e) => updatePrimary({ email: e.target.value })} />
                </div>
              </div>
            </div>

            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-faint)]">
                Employment & Income (Primary)
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-1.5">
                <div>
                  <label className="label">Employment Profile</label>
                  <select className="select" value={p.employmentProfile} onChange={(e) => updatePrimary({ employmentProfile: e.target.value as CaseProfile["primary"]["employmentProfile"] })}>
                    <option value="Salaried">Salaried</option>
                    <option value="Self-Employed">Self-Employed</option>
                  </select>
                </div>
                <div>
                  <label className="label">Company / Employer Name</label>
                  <input className="input" placeholder="e.g. Emirates NBD, Emaar" value={p.companyName ?? ""} onChange={(e) => updatePrimary({ companyName: e.target.value })} />
                </div>
                <div>
                  <label className="label">Monthly Net Salary (AED)</label>
                  <input className="input mono" type="number" min={0} step={1000} placeholder="25000" value={p.monthlySalary || ""} onChange={(e) => updatePrimary({ monthlySalary: Number(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="label">Monthly Bonus / Variable (AED)</label>
                  <input className="input mono" type="number" min={0} step={500} placeholder="0" value={p.variableIncome || ""} onChange={(e) => updatePrimary({ variableIncome: Number(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="label">Existing Rental Income (AED/mo)</label>
                  <input className="input mono" type="number" min={0} step={500} placeholder="0" value={p.rentalIncome || ""} onChange={(e) => updatePrimary({ rentalIncome: Number(e.target.value) || 0 })} />
                </div>
              </div>
            </div>

            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-faint)]">
                Liabilities & Monthly Obligations (Primary)
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1.5">
                <div>
                  <label className="label">Existing Loan EMIs (Auto, Personal, etc. AED/mo)</label>
                  <input className="input mono" type="number" min={0} step={200} placeholder="0" value={p.existingEmis || ""} onChange={(e) => updatePrimary({ existingEmis: Number(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="label">Total Credit Card Limits across all banks (AED)</label>
                  <input className="input mono" type="number" min={0} step={1000} placeholder="0" value={p.creditCardLimits || ""} onChange={(e) => updatePrimary({ creditCardLimits: Number(e.target.value) || 0 })} />
                  <span className="text-[10.5px] text-[var(--ink-faint)] mt-0.5 block">
                    CBUAE counts 5% of card limit as monthly obligation (DIB counts 2%).
                  </span>
                </div>
              </div>
            </div>

            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-faint)]">
                Decision flags — affect pricing &amp; product choice
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1.5">
                <label className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 cursor-pointer" style={{ background: "var(--tint)", border: "1px solid var(--line-soft)" }}>
                  <input type="checkbox" checked={!!p.goldenVisa} onChange={(e) => updatePrimary({ goldenVisa: e.target.checked })} />
                  <span className="text-[12.5px]"><strong>Golden Visa holder</strong> — several banks quote preferential rates/LTV; show it to the RM</span>
                </label>
                <label className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 cursor-pointer" style={{ background: "var(--tint)", border: "1px solid var(--line-soft)" }}>
                  <input type="checkbox" checked={!!p.islamicOnly} onChange={(e) => updatePrimary({ islamicOnly: e.target.checked })} />
                  <span className="text-[12.5px]"><strong>Sharia-compliant only</strong> — restrict to Islamic products (Islamic / mixed banks)</span>
                </label>
              </div>
            </div>

            {/* Quick proposal — the engine needs exactly the inputs captured above */}
            <div className="rounded-lg p-3.5 space-y-3" style={{ background: "var(--amber-tint)", border: "1px solid color-mix(in srgb, var(--amber) 40%, var(--line))" }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[12.5px] font-disp font-semibold flex items-center gap-1.5">
                    <ICalc size={13} className="text-[var(--amber)]" /> Generate proposal
                  </div>
                  <p className="text-[11px] text-[var(--ink-faint)] m-0 mt-0.5">
                    Runs every bank against the profile above — salary, EMIs, cards, property, co-borrower, decision flags.
                  </p>
                </div>
                <button className="btn btn-primary btn-sm" onClick={runQuickMatch} disabled={quick.busy}>
                  {quick.busy ? "Running…" : quick.results ? "Re-run match" : "Run bank match"}
                </button>
              </div>

              {quick.results && (
                <div className="space-y-1.5">
                  {quick.results.length === 0 && (
                    <p className="text-[11.5px] text-[var(--ink-faint)] m-0">No approved bank products matched this profile.</p>
                  )}
                  {quick.results.map((r) => {
                    const v = VERDICT_LABEL[r.verdict];
                    const usable = r.verdict !== "not_eligible";
                    return (
                      <div key={r.bankProductId} className="rounded-lg px-2.5 py-2 flex items-center gap-2"
                        style={{ background: "var(--surface)", border: "1px solid var(--line-soft)" }}>
                        {usable && (
                          <input type="checkbox" checked={!!quick.selected[r.bankProductId]}
                            onChange={(e) => setQuick((q) => ({ ...q, selected: { ...q.selected, [r.bankProductId]: e.target.checked } }))} />
                        )}
                        <span className="text-[12px] font-semibold">{r.bankName}</span>
                        <span className="text-[10.5px] text-[var(--ink-faint)] truncate hidden sm:inline">{r.productName}</span>
                        <Chip tone={v.tone}>{v.label}</Chip>
                        <span className="ml-auto mono text-[11.5px]" style={{ color: r.verdict === "eligible" ? "var(--mint)" : "var(--ink-dim)" }}>
                          {usable ? fmtAed(r.eligibleLoan) : ""}
                        </span>
                        {usable && r.introEmi != null && (
                          <span className="mono text-[10.5px] text-[var(--ink-faint)] hidden sm:inline">
                            {fmtAed(r.introEmi)}/mo{r.introRatePct != null ? ` @ ${r.introRatePct}%` : ""}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {quick.results.some((r) => r.verdict !== "not_eligible") && (
                    <button className="btn btn-mint btn-sm w-full justify-center" onClick={openProposal} disabled={quick.opening}>
                      Open proposal ({Object.values(quick.selected).filter(Boolean).length} banks) →
                    </button>
                  )}
                  <p className="text-[10.5px] text-[var(--ink-faint)] m-0">
                    Opens the print-ready proposal — save it to the case as a draft, then move it to &quot;sent&quot; once shared with the client.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: PROPERTY & FINANCE */}
        {activeTab === "property" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="label">Property Value / Purchase Price (AED)</label>
                <input className="input mono" type="number" min={0} step={50000} placeholder="2500000" value={prop.propertyValue || ""} onChange={(e) => updateProperty({ propertyValue: Number(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="label">Requested Loan Amount (AED)</label>
                <input className="input mono" type="number" min={0} step={25000} placeholder="2000000" value={prop.loanAmount || ""} onChange={(e) => updateProperty({ loanAmount: Number(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="label">Processing time (months) · <span style={{ color: "var(--amber)" }}>tenure is capped at disbursement age</span></label>
                <select className="select" value={profile.processingMonths ?? 3} onChange={(e) => setProfile((prev) => ({ ...prev, processingMonths: Number(e.target.value) }))}>
                  <option value={2}>2 months</option>
                  <option value={3}>3 months</option>
                  <option value={4}>4 months</option>
                  <option value={5}>5 months</option>
                  <option value={6}>6 months</option>
                </select>
              </div>
              <div>
                <label className="label">Down Payment / Equity (AED)</label>
                <input className="input mono" type="number" min={0} step={25000} placeholder="500000" value={prop.downPayment || ""} onChange={(e) => updateProperty({ downPayment: Number(e.target.value) || 0 })} />
              </div>
            </div>

            {ltvPct != null && (
              <div className="p-2.5 rounded-lg bg-[var(--bg2)] flex items-center justify-between text-[11.5px] mono">
                <span>Calculated LTV: <strong>{ltvPct}%</strong></span>
                <span style={{ color: ltvPct <= 80 ? "var(--mint)" : "var(--coral)" }}>
                  {ltvPct <= 80 ? "? Complies with UAE 80% expat limit" : "? Exceeds 80% LTV  increase down payment"}
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="label">Transaction Type</label>
                <select className="select" value={prop.transactionType} onChange={(e) => updateProperty({ transactionType: e.target.value })}>
                  <option value="Resale">Resale / Secondary Market</option>
                  <option value="Primary Handover">Primary Handover / Developer</option>
                  <option value="Buyout">Buyout / Refinance</option>
                  <option value="Equity Release">Equity Release / Cashout</option>
                  <option value="Buyout + Equity Release">Buyout + Equity Release</option>
                </select>
              </div>
              <div>
                <label className="label">Property Location / Emirate</label>
                <input className="input" placeholder="e.g. Dubai, Abu Dhabi, Sharjah" value={prop.propertyLocation ?? ""} onChange={(e) => updateProperty({ propertyLocation: e.target.value })} />
              </div>
            </div>

            {/* FINAL PROPERTY CLASSIFICATION — plain-language questions writing
                canonical backend dims. Stage and construction are SEPARATE fields:
                an answer only fills the field it directly names; anything unstated
                stays UNKNOWN (never guessed). See prisma/schema.prisma. */}
            <div className="rounded-lg p-3.5 space-y-3" style={{ background: "var(--surface)", border: "1px solid var(--line-soft)" }}>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-faint)]">
                Property classification
              </div>

              {/* Q1 — property type */}
              <div>
                <label className="label">What type of property is this?</label>
                <select
                  className="select"
                  value={prop.canonicalPropertyType ?? "UNKNOWN"}
                  onChange={(e) => {
                    const v = e.target.value as NonNullable<CaseProfile["property"]["canonicalPropertyType"]>;
                    // subtype must be NULL unless COMMERCIAL — enforced here + server-side
                    updateProperty(v === "COMMERCIAL"
                      ? { canonicalPropertyType: v, canonicalCommercialSubtype: prop.canonicalCommercialSubtype ?? "UNKNOWN" }
                      : { canonicalPropertyType: v, canonicalCommercialSubtype: null });
                  }}
                >
                  <option value="RESIDENTIAL">Residential</option>
                  <option value="COMMERCIAL">Commercial</option>
                  <option value="UNKNOWN">Not sure / To Verify</option>
                </select>
              </div>

              {/* Q2 — conditional: ONLY when Commercial */}
              {(prop.canonicalPropertyType ?? "UNKNOWN") === "COMMERCIAL" && (
                <div>
                  <label className="label">What type of commercial property is this?</label>
                  <select
                    className="select"
                    value={prop.canonicalCommercialSubtype ?? "UNKNOWN"}
                    onChange={(e) => updateProperty({ canonicalCommercialSubtype: e.target.value as NonNullable<CaseProfile["property"]["canonicalCommercialSubtype"]> })}
                  >
                    <option value="OFFICE">Office</option>
                    <option value="RETAIL_SHOP">Retail / Shop</option>
                    <option value="WAREHOUSE">Warehouse</option>
                    <option value="INDUSTRIAL">Industrial</option>
                    <option value="HOTEL_HOSPITALITY">Hotel / Hospitality</option>
                    <option value="MIXED_USE">Mixed-use</option>
                    <option value="LAND_PLOT">Land / Plot</option>
                    <option value="OTHER_COMMERCIAL">Other Commercial</option>
                    <option value="UNKNOWN">Not sure / To Verify</option>
                  </select>
                </div>
              )}

              {/* Q3 — current status: one human answer, TWO backend fields written
                  conservatively (Off-plan never implies Under-construction;
                  Handover never implies construction Completed). */}
              <div>
                <label className="label">What is the current status of the property?</label>
                {(() => {
                  const stage = prop.canonicalPropertyStage ?? "UNKNOWN";
                  const cons = prop.canonicalConstructionStatus ?? "UNKNOWN";
                  // reverse-map the paired fields to one select value for display
                  const current =
                    stage === "OFF_PLAN" && cons === "UNKNOWN" ? "OFF_PLAN"
                    : stage === "UNKNOWN" && cons === "UNDER_CONSTRUCTION" ? "UNDER_CONSTRUCTION"
                    : stage === "HANDOVER" && cons === "UNKNOWN" ? "HANDOVER"
                    : stage === "COMPLETED" && cons === "COMPLETED" ? "READY"
                    : "UNKNOWN";
                  return (
                    <select
                      className="select"
                      value={current}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "OFF_PLAN") updateProperty({ canonicalPropertyStage: "OFF_PLAN", canonicalConstructionStatus: "UNKNOWN", propertyType: "Off-Plan" });
                        else if (v === "UNDER_CONSTRUCTION") updateProperty({ canonicalPropertyStage: "UNKNOWN", canonicalConstructionStatus: "UNDER_CONSTRUCTION", propertyType: "Off-Plan" });
                        else if (v === "HANDOVER") updateProperty({ canonicalPropertyStage: "HANDOVER", canonicalConstructionStatus: "UNKNOWN" });
                        else if (v === "READY") updateProperty({ canonicalPropertyStage: "COMPLETED", canonicalConstructionStatus: "COMPLETED", propertyType: "Ready" });
                        else updateProperty({ canonicalPropertyStage: "UNKNOWN", canonicalConstructionStatus: "UNKNOWN" });
                      }}
                    >
                      <option value="OFF_PLAN">Off-plan</option>
                      <option value="UNDER_CONSTRUCTION">Under construction</option>
                      <option value="HANDOVER">At handover</option>
                      <option value="READY">Ready / completed</option>
                      <option value="UNKNOWN">Not sure / To Verify</option>
                    </select>
                  );
                })()}
                <p className="text-[10.5px] text-[var(--ink-faint)] m-0 mt-1">
                  Off-plan and under-construction are tracked separately — answer only what you know.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Q4 — party relationship (separate from transaction purpose) */}
                <div>
                  <label className="label">Who is the customer dealing with for this property?</label>
                  <select
                    className="select"
                    value={prop.canonicalPartyRelationship ?? "UNKNOWN"}
                    onChange={(e) => updateProperty({ canonicalPartyRelationship: e.target.value as NonNullable<CaseProfile["property"]["canonicalPartyRelationship"]> })}
                  >
                    <option value="DEVELOPER">Developer</option>
                    <option value="EXISTING_OWNER">Existing property owner / seller</option>
                    <option value="SELF">Customer already owns the property</option>
                    <option value="UNKNOWN">Not sure / To Verify</option>
                  </select>
                </div>

                {/* Q5 — existing finance (never decides the bank's transaction classification alone) */}
                <div>
                  <label className="label">Is there an existing mortgage on this property?</label>
                  <select
                    className="select"
                    value={prop.canonicalExistingFinance ?? "UNKNOWN"}
                    onChange={(e) => updateProperty({ canonicalExistingFinance: e.target.value as NonNullable<CaseProfile["property"]["canonicalExistingFinance"]> })}
                  >
                    <option value="NONE">No</option>
                    <option value="MORTGAGE">Yes</option>
                    <option value="UNKNOWN">Not sure / To Verify</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: CO-BORROWER VS CO-APPLICANT */}
        {activeTab === "joint" && (
          <div className="space-y-4">
            <div>
              <label className="label">Second Party Status & Legal Role</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  type="button"
                  className={`p-3 rounded-lg border text-left transition-all ${s.role === "none" ? "border-[var(--amber)] bg-[var(--amber-tint)]" : "border-[var(--line)] bg-[var(--surface)]"}`}
                  onClick={() => updateSecondParty({ role: "none" })}
                >
                  <div className="font-disp font-semibold text-[13px]">Single Borrower</div>
                  <div className="text-[11px] text-[var(--ink-faint)] mt-0.5">No co-applicant or joint borrower.</div>
                </button>

                <button
                  type="button"
                  className={`p-3 rounded-lg border text-left transition-all ${s.role === "co_borrower" ? "border-[var(--mint)] bg-[var(--mint-tint)]" : "border-[var(--line)] bg-[var(--surface)]"}`}
                  onClick={() => updateSecondParty({ role: "co_borrower" })}
                >
                  <div className="font-disp font-semibold text-[13px] text-[var(--mint)]">Co-Borrower (Financial)</div>
                  <div className="text-[11px] text-[var(--ink-faint)] mt-0.5">
                    <strong>Incomes & Debts Pooled.</strong> Legally co-signs loan to pass DBR.
                  </div>
                </button>

                <button
                  type="button"
                  className={`p-3 rounded-lg border text-left transition-all ${s.role === "co_applicant" ? "border-[var(--amber)] bg-[var(--amber-tint)]" : "border-[var(--line)] bg-[var(--surface)]"}`}
                  onClick={() => updateSecondParty({ role: "co_applicant" })}
                >
                  <div className="font-disp font-semibold text-[13px] text-[var(--amber)]">Co-Applicant (Title Only)</div>
                  <div className="text-[11px] text-[var(--ink-faint)] mt-0.5">
                    <strong>Non-Financial.</strong> Added for Title Deed & KYC only. No debt pooling.
                  </div>
                </button>
              </div>
            </div>

            {/* Context Alert */}
            <div className={`p-3 rounded-lg text-[12px] leading-relaxed border ${s.role === "co_borrower" ? "bg-[var(--mint-tint)] border-[var(--mint)]" : s.role === "co_applicant" ? "bg-[var(--amber-tint)] border-[var(--amber)]" : "bg-[var(--bg2)] border-[var(--line)]"}`}>
              {s.role === "co_borrower" && (
                <p className="m-0 text-[var(--ink)]">
                  <strong>Financial Co-Borrower:</strong> Under CBUAE rules, their monthly income will be added to the primary borrower's income, and their existing loan EMIs and credit cards will be factored into the 50% DBR cap. Maximum loan tenor will be restricted to the oldest applicant's retirement age (65 expats / 70 nationals).
                </p>
              )}
              {s.role === "co_applicant" && (
                <p className="m-0 text-[var(--ink)]">
                  <strong>Non-Financial Co-Applicant:</strong> Added for property title deed co-ownership and KYC documentation. Their income and personal debts will <em>NOT</em> be considered for loan eligibility, and their age does not limit the mortgage tenor.
                </p>
              )}
              {s.role === "none" && (
                <p className="m-0 text-[var(--ink-faint)]">
                  Only the primary applicant's income, age, and liabilities will be used by the Bank Match engine.
                </p>
              )}
            </div>

            {/* Form fields if not none */}
            {s.role !== "none" && (
              <div className="space-y-4 pt-2">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-faint)]">
                    Second Party Information ({s.role === "co_borrower" ? "Co-Borrower" : "Co-Applicant"})
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-1.5">
                    <div>
                      <label className="label">Full Name</label>
                      <input className="input" placeholder="e.g. Aisha Al Mansoori" value={s.fullName} onChange={(e) => updateSecondParty({ fullName: e.target.value })} />
                    </div>
                    <div>
                      <label className="label">Relationship</label>
                      <select className="select" value={s.relationship ?? "Spouse"} onChange={(e) => updateSecondParty({ relationship: e.target.value })}>
                        <option value="Spouse">Spouse (Wife / Husband)</option>
                        <option value="Sibling">Sibling (Brother / Sister)</option>
                        <option value="Parent">Parent (Father / Mother)</option>
                        <option value="Child">Child (Son / Daughter)</option>
                        <option value="Business Partner">Business Partner</option>
                        <option value="Other">Other / Co-Investor</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Date of birth</label>
                      <input className="input mono" type="date" value={s.dob ?? ""} onChange={(e) => updateSecondParty({ dob: e.target.value || undefined, age: ageFromDob(e.target.value) ?? s.age })} />
                    </div>
                    <div>
                      <label className="label">Age (years){s.dob ? " — from DOB" : ""}</label>
                      <input className="input mono" type="number" min={21} max={70} placeholder="35" value={s.age ?? ""} onChange={(e) => updateSecondParty({ age: e.target.value ? Number(e.target.value) : undefined })} />
                    </div>
                    <div>
                      <label className="label">Nationality</label>
                      <input className="input" placeholder="e.g. Emirati, British" value={s.nationality ?? ""} onChange={(e) => updateSecondParty({ nationality: e.target.value })} />
                    </div>
                    <div>
                      <label className="label">Residency Status</label>
                      <select className="select" value={s.residency ?? "Resident Expatriate"} onChange={(e) => updateSecondParty({ residency: e.target.value as any })}>
                        <option value="UAE National">UAE National</option>
                        <option value="Resident Expatriate">Resident Expatriate</option>
                        <option value="Non-Resident">Non-Resident</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Phone / WhatsApp</label>
                      <input className="input mono" placeholder="+971 50..." value={s.phone ?? ""} onChange={(e) => updateSecondParty({ phone: e.target.value })} />
                    </div>
                    <div>
                      <label className="label">Emirates ID No. · <span style={{ color: "var(--amber)" }}>links their client file</span></label>
                      <input className="input mono" placeholder="784-XXXX-XXXXXXX-X" value={s.eidNo ?? ""} onChange={(e) => updateSecondParty({ eidNo: e.target.value })} />
                    </div>
                    <div>
                      <label className="label">Passport No.</label>
                      <input className="input mono" placeholder="e.g. A1234567" value={s.passportNo ?? ""} onChange={(e) => updateSecondParty({ passportNo: e.target.value })} />
                    </div>
                    <div>
                      <label className="label">Email Address</label>
                      <input className="input" type="email" placeholder="coapplicant@example.com" value={s.email ?? ""} onChange={(e) => updateSecondParty({ email: e.target.value })} />
                    </div>
                  </div>
                </div>

                {/* Co-Borrower financial fields */}
                {s.role === "co_borrower" && (
                  <div className="space-y-3 pt-2 border-t" style={{ borderColor: "var(--line-soft)" }}>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--mint)]">
                      Co-Borrower Income & Liabilities (Pooled for DBR)
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="label">Employment Type</label>
                        <select className="select" value={s.employmentProfile} onChange={(e) => updateSecondParty({ employmentProfile: e.target.value as CaseProfile["secondParty"]["employmentProfile"] })}>
                          <option value="Salaried">Salaried</option>
                          <option value="Self-Employed">Self-Employed</option>
                        </select>
                      </div>
                      <div>
                        <label className="label">Monthly Net Salary (AED)</label>
                        <input className="input mono" type="number" min={0} step={1000} placeholder="15000" value={s.monthlySalary || ""} onChange={(e) => updateSecondParty({ monthlySalary: Number(e.target.value) || 0 })} />
                      </div>
                      <div>
                        <label className="label">Monthly Variable / Bonus (AED)</label>
                        <input className="input mono" type="number" min={0} step={500} placeholder="0" value={s.variableIncome || ""} onChange={(e) => updateSecondParty({ variableIncome: Number(e.target.value) || 0 })} />
                      </div>
                      <div>
                        <label className="label">Existing Loan EMIs (AED/mo)</label>
                        <input className="input mono" type="number" min={0} step={200} placeholder="0" value={s.existingEmis || ""} onChange={(e) => updateSecondParty({ existingEmis: Number(e.target.value) || 0 })} />
                      </div>
                      <div>
                        <label className="label">Credit Card Limits Total (AED)</label>
                        <input className="input mono" type="number" min={0} step={1000} placeholder="0" value={s.creditCardLimits || ""} onChange={(e) => updateSecondParty({ creditCardLimits: Number(e.target.value) || 0 })} />
                      </div>
                    </div>

                    {/* Joint affordability summary bar */}
                    <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--line)] space-y-1">
                      <div className="text-[11px] font-disp font-semibold uppercase text-[var(--ink-faint)]">
                        Combined Household Eligibility (Engine Inputs)
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px] mono mt-1">
                        <div>
                          <span className="text-[var(--ink-faint)]">Total Income:</span><br />
                          <strong className="text-[var(--mint)]">AED {jointSummary.qualifyingIncome.toLocaleString()}/mo</strong>
                        </div>
                        <div>
                          <span className="text-[var(--ink-faint)]">Total Loan EMIs:</span><br />
                          <strong>AED {jointSummary.qualifyingExistingEmis.toLocaleString()}/mo</strong>
                        </div>
                        <div>
                          <span className="text-[var(--ink-faint)]">Combined Card Limits:</span><br />
                          <strong>AED {jointSummary.qualifyingCardLimits.toLocaleString()}</strong>
                        </div>
                        {jointSummary.effectiveAge && (
                          <div>
                            <span className="text-[var(--ink-faint)]">Oldest Age:</span><br />
                            <strong>{jointSummary.effectiveAge} years</strong>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
