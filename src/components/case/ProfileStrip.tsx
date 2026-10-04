"use client";

/* Brief profile strip — Personal / Employment & Income / Property & Finance.
   Provides quick visibility into key qualification parameters, completeness %,
   live status chips, and direct deep-linking into CaseProfileEditor sub-tabs. */
import { useMemo } from "react";
import type { LoanCase } from "@/lib/types";
import { parseCaseProfile, computeJointAffordability } from "@/lib/case-profile";
import { fmtMoney } from "@/lib/format";
import { Chip } from "@/components/hfmc/ui";
import { IArrowR } from "@/components/icons";
import type { ProfileSubTab } from "@/components/views/case-profile-editor";

function pct(done: number, total: number): number {
  return total ? Math.round((done / total) * 100) : 0;
}

export function ProfileStrip({
  c,
  onEdit,
}: {
  c: LoanCase;
  /** Jump to a section of the Client tab. There is no tab argument any more:
   *  the strip used to hand back "profile" as a tab AND a sub-tab, which only
   *  worked while profile and data sheet were separate tabs. Now it lives inside
   *  Client and only needs to say WHICH section. */
  onEdit: (subTab: ProfileSubTab) => void;
}) {
  const prof = useMemo(
    () =>
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
      }),
    [c]
  );
  const p = prof.primary;
  const prop = prof.property;
  const s = prof.secondParty;
  const joint = computeJointAffordability(prof);

  const personalTotal = 5;
  const personalDone = [p.fullName, p.phone, p.eidNo || p.passportNo, p.residency, p.nationality || p.email].filter(Boolean).length;
  const empTotal = 6;
  const empDone = [p.employmentProfile, p.companyName || p.monthlySalary > 0, p.monthlySalary > 0, p.existingEmis >= 0, p.creditCardLimits >= 0, joint.badgeLabel].filter(Boolean).length;
  const propTotal = 5;
  const propDone = [prop.propertyValue > 0, prop.loanAmount > 0, prop.transactionType, prop.propertyType, prop.propertyLocation].filter(Boolean).length;

  // LTV computation
  const ltv = prop.propertyValue > 0 && prop.loanAmount > 0 ? Math.round((prop.loanAmount / prop.propertyValue) * 100) : null;

  // KYC chip resolution for Personal
  const personalChip = c.profileClientVerifiedAt ? (
    <Chip key="kyc" tone="mint">Verified by client</Chip>
  ) : p.eidNo || p.passportNo ? (
    <Chip key="kyc" tone="mint">KYC on file</Chip>
  ) : (
    <Chip key="kyc" tone="amber">KYC pending</Chip>
  );

  // Property & Finance chips
  const propertyChips = [
    ltv != null ? <Chip key="ltv" tone="sky">{ltv}% LTV</Chip> : null,
    prop.transactionType ? <Chip key="txn" tone="slate">{prop.transactionType}</Chip> : null,
  ].filter(Boolean);

  const cards = [
    {
      title: "Personal",
      subTab: "primary" as ProfileSubTab,
      pct: pct(personalDone, personalTotal),
      lines: [
        [p.fullName || "Name pending", p.phone || "No phone"].filter(Boolean).join(" · "),
        [
          p.eidNo ? `EID ${p.eidNo}` : "No EID",
          p.passportNo ? `Passport ${p.passportNo}` : "No passport",
          p.residency || "UAE Resident",
        ].filter(Boolean).join(" · "),
      ],
      chips: [personalChip, p.residency ? <Chip key="res" tone="slate">{p.residency}</Chip> : null].filter(Boolean),
    },
    {
      title: "Employment & Income",
      subTab: (s.role === "co_borrower" ? "joint" : "primary") as ProfileSubTab,
      pct: pct(empDone, empTotal),
      lines: [
        [p.employmentProfile || "Employment pending", p.companyName].filter(Boolean).join(" · "),
        [
          p.monthlySalary > 0 ? `${fmtMoney(p.monthlySalary)}/mo` : "Salary pending",
          p.existingEmis > 0 ? `EMIs ${fmtMoney(p.existingEmis)}` : null,
          p.creditCardLimits > 0 ? `Cards ${fmtMoney(p.creditCardLimits)}` : null,
        ].filter(Boolean).join(" · ") || "No external debt reported",
      ],
      chips: [
        <Chip key="j" tone={joint.badgeTone}>{joint.badgeLabel}</Chip>,
        p.employmentProfile ? <Chip key="emp" tone="slate">{p.employmentProfile}</Chip> : null,
      ].filter(Boolean),
    },
    {
      title: "Property & Finance",
      subTab: "property" as ProfileSubTab,
      pct: pct(propDone, propTotal),
      lines: [
        [
          prop.propertyValue > 0 ? `${fmtMoney(prop.propertyValue)} val` : null,
          prop.loanAmount > 0 ? `loan ${fmtMoney(prop.loanAmount)}` : null,
          prop.downPayment > 0 ? `down ${fmtMoney(prop.downPayment)}` : null,
        ].filter(Boolean).join(" · ") || "Loan figures pending",
        [prop.transactionType, prop.propertyType, prop.propertyLocation].filter(Boolean).join(" · ") || "Property details pending",
      ],
      chips: propertyChips.length > 0 ? propertyChips : [<Chip key="none" tone="amber">Deal pending</Chip>],
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
      {cards.map((k) => (
        <button
          key={k.title}
          type="button"
          onClick={() => onEdit(k.subTab)}
          className="group card p-3.5 text-left transition-all hover:border-[var(--amber)] hover:shadow-sm cursor-pointer relative overflow-hidden"
          title={`Open ${k.title} tab in Profile Editor`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-disp font-semibold text-[13px]">{k.title}</span>
            <span className="mono text-[11px] font-semibold" style={{ color: k.pct === 100 ? "var(--mint)" : "var(--amber)" }}>
              {k.pct}%
            </span>
          </div>
          <div className="h-1 rounded-full mt-2" style={{ background: "var(--line-soft)" }}>
            <div
              className="h-1 rounded-full transition-all"
              style={{ width: `${k.pct}%`, background: k.pct === 100 ? "var(--mint)" : "var(--amber)" }}
            />
          </div>
          {k.lines.map((l, idx) => (
            <p key={idx} className="text-[12px] text-[var(--ink-dim)] m-0 mt-1.5 truncate">
              {l}
            </p>
          ))}
          <div className="flex items-center justify-between mt-2.5 pt-2 border-t" style={{ borderColor: "var(--line-soft)" }}>
            <div className="flex flex-wrap items-center gap-1.5">{k.chips}</div>
            <span className="mono text-[10.5px] text-[var(--ink-faint)] group-hover:text-[var(--amber)] transition-colors flex items-center gap-1 shrink-0 ml-1">
              Edit <IArrowR size={10} className="transition-transform group-hover:translate-x-0.5" />
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
