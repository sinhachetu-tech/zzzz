"use client";

/* Case Profile Editor  Comprehensive Lead & Applicant Qualification
   Captures Primary Applicant, Property Details, and Second Party with
   the strict distinction between Co-Borrower (Financial - Pooled) vs
   Co-Applicant (Non-Financial - Title Only). */

import { useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { LoanCase } from "@/lib/types";
import {
  type CaseProfile,
  type SecondPartyRole,
  parseCaseProfile,
  computeJointAffordability,
} from "@/lib/case-profile";
import { Chip } from "@/components/hfmc/ui";
import { ICheck, IUsers } from "@/components/icons";

interface Props {
  c: LoanCase;
  onSaved?: (p: CaseProfile) => void;
}

export function CaseProfileEditor({ c, onSaved }: Props) {
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
    })
  );
  const [activeTab, setActiveTab] = useState<"primary" | "property" | "joint">("primary");
  const [saving, setSaving] = useState(false);

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
    try {
      const json = JSON.stringify(profile);
      await updateCase(c.id, {
        profileJson: json,
        customer: p.fullName.trim() || c.customer,
        whatsapp: p.phone.trim() || c.whatsapp,
        loanAmount: prop.loanAmount || c.loanAmount,
        employmentProfile: p.employmentProfile,
        residency: p.residency,
        propertyType: prop.propertyType,
        transactionType: prop.transactionType,
        propertyLocation: prop.propertyLocation || null,
        coApplicantName: s.role !== "none" && s.fullName.trim() ? s.fullName.trim() : null,
      });
      toast("success", "Applicant & loan profile saved.");
      onSaved?.(profile);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to save profile.");
    }
    setSaving(false);
  };

  const ltvPct = prop.propertyValue > 0 && prop.loanAmount > 0
    ? Math.round((prop.loanAmount / prop.propertyValue) * 1000) / 10
    : null;

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

      {/* Tabs */}
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
                  <label className="label">Age (years)</label>
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
                <label className="label">Property Type</label>
                <select className="select" value={prop.propertyType} onChange={(e) => updateProperty({ propertyType: e.target.value as CaseProfile["property"]["propertyType"] })}>
                  <option value="Ready">Ready / Completed Property</option>
                  <option value="Off-Plan">Off-Plan / Under Construction</option>
                </select>
              </div>
              <div>
                <label className="label">Property Location / Emirate</label>
                <input className="input" placeholder="e.g. Dubai, Abu Dhabi, Sharjah" value={prop.propertyLocation ?? ""} onChange={(e) => updateProperty({ propertyLocation: e.target.value })} />
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
                      <label className="label">Age (years)</label>
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
