"use client";

/* Case hero — the single top of Case 360: case no + customer + chips,
   Next-Best-Action line, amount/bank/owner/people, SLA age.
   Display-only: actions reuse the existing handlers via props. */
import { useHfmcStore } from "@/lib/client-store";
import type { LoanCase } from "@/lib/types";
import { ageDays, fmtDate, fmtMoney } from "@/lib/format";
import { Chip, StatusChip } from "@/components/hfmc/ui";
import { CaseStateChip, SourceChip } from "@/components/hfmc/bits";

export function CaseHero({ c, status, actions }: {
  c: LoanCase;
  status: ReturnType<typeof import("@/lib/format").caseStatusOf>;
  actions?: React.ReactNode;
}) {
  const { slaRules, userById } = useHfmcStore();
  const owner = userById(c.ownerId)?.name ?? "—";
  const rule = slaRules.find((r) => r.active && r.stage === c.stage && !r.bank);
  const age = ageDays(c.createdAt);
  const slaOver = rule ? age - rule.maxDays : null;

  return (
    <div className="card p-5 anim-fade-up" style={{ borderTop: "3px solid var(--amber)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mono text-[13px] font-semibold" style={{ color: "var(--amber)" }}>{c.caseNumber}</span>
        <CaseStateChip state={c.caseStatus} />
        {c.caseStatus === "Active" && <StatusChip status={status} />}
        {c.onHold && (
          <span className="chip" title={c.holdReason ?? "On hold"}
            style={{ color: "var(--amber)", background: "rgba(242,176,76,0.12)", borderColor: "rgba(242,176,76,0.4)" }}>
            ON HOLD
          </span>
        )}
        <SourceChip source={c.source} />
        {c.transactionType && <Chip tone="sky">{c.transactionType}</Chip>}
        {c.propertyLocation && <Chip tone="slate">{c.propertyLocation}</Chip>}
        {c.partner && <Chip tone="amber">{c.partner.kind} · {c.partner.name}</Chip>}
        <span className="mono text-[11px] text-[var(--ink-faint)] ml-auto">
          opened {fmtDate(c.createdAt)} · {age}d old
          {slaOver != null && slaOver > 0 && (
            <span style={{ color: "var(--coral)" }}> · SLA +{slaOver}d</span>
          )}
        </span>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-2">
        <div>
          <h1 className="font-disp font-bold text-[26px] tracking-tight m-0">{c.customer}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-[12.5px] text-[var(--ink-dim)]">
            <span className="mono font-semibold text-[14px]" style={{ color: "var(--ink)" }}>{fmtMoney(c.loanAmount)}</span>
            <span>· {c.banks.join(", ") || "no bank yet"}</span>
            <span>· owner <strong>{owner}</strong></span>
            {c.vrmId && <span>· VRM <strong>{userById(c.vrmId)?.name ?? "—"}</strong></span>}
          </div>
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
