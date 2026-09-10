"use client";

import type { ReactNode } from "react";
import type { CaseState, CaseSource, LoanCase } from "@/lib/types";
import { commissionFor, fmtMoney, fmtRate } from "@/lib/format";
import { useHfmcStore } from "@/lib/client-store";
import { Chip } from "./ui";
import { Avatar } from "./ui";
import { IWhatsapp, IX } from "../icons";

export function CaseStateChip({ state }: { state: CaseState }) {
  if (state === "Active") return <Chip tone="mint">Active</Chip>;
  if (state === "Closed") return <Chip tone="sky">Booked</Chip>;
  return <Chip tone="coral">Lost</Chip>;
}

export function SourceChip({ source }: { source: CaseSource }) {
  const tone = source === "Direct" ? "mint" : source === "Website" ? "slate" : source === "Agent" ? "amber" : source === "Broker" ? "sky" : "coral";
  return <Chip tone={tone as "mint" | "slate" | "amber" | "sky" | "coral"}>{source}</Chip>;
}

export function BankChips({ c, max = 2 }: { c: LoanCase; max?: number }) {
  if (c.banks.length === 0 && !c.wonBank) return <Chip tone="slate">Bank TBC</Chip>;
  const list = c.wonBank ? [c.wonBank] : c.banks;
  const shown = list.slice(0, max);
  const rest = list.length - shown.length;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {shown.map((b) => (
        <Chip key={b} tone={b === c.wonBank ? "mint" : "sky"}>{b}{b === c.wonBank ? " ✓" : ""}</Chip>
      ))}
      {rest > 0 && <span className="mono text-[10.5px] text-[var(--ink-faint)] self-center">+{rest}</span>}
    </span>
  );
}

/** Live money panel: our commission, partner cut, net — recomputed from master data */
export function CommissionPanel({ c, compact = false }: { c: LoanCase; compact?: boolean }) {
  const { banks } = useHfmcStore();
  const m = commissionFor(c, banks);
  if (!m.bank)
    return (
      <div className="card p-4">
        <h3 className="font-disp font-semibold text-[13.5px] m-0 mb-1">Commission</h3>
        <p className="text-[12.5px] text-[var(--ink-faint)] m-0">No bank submitted yet — pick a bank to project earnings.</p>
      </div>
    );
  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-disp font-semibold text-[13.5px] m-0">Commission · {m.bank}</h3>
        <span className="mono text-[11.5px] text-[var(--ink-faint)]">@ {fmtRate(m.ratePct)}</span>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between text-[13px]">
          <span className="text-[var(--ink-dim)]">Bank pays (gross)</span>
          <span className="mono font-semibold">{fmtMoney(m.gross)}</span>
        </div>
        {/* Submission commission loss — channel cut */}
        {m.submissionType === "channel" && m.channelCut > 0 && (
          <div className="flex justify-between text-[13px]">
            <span className="text-[var(--ink-dim)]">Channel · {m.channelName} @ {m.channelRatePct}% of loan</span>
            <span className="mono font-semibold" style={{ color: "var(--coral)" }}>− {fmtMoney(m.channelCut)}</span>
          </div>
        )}
        {m.submissionType === "direct" && (
          <div className="flex justify-between text-[13px]">
            <span className="text-[var(--ink-dim)]">Submission</span>
            <span className="mono text-[var(--ink-faint)]">direct to bank — no channel cut</span>
          </div>
        )}
        {/* Lead commission loss — partner cut */}
        {c.partner ? (
          <div className="flex justify-between text-[13px]">
            <span className="text-[var(--ink-dim)]">{c.partner.kind} · {c.partner.name} @ {c.partner.sharePct}% of commission</span>
            <span className="mono font-semibold" style={{ color: "var(--coral)" }}>− {fmtMoney(m.partnerCut)}</span>
          </div>
        ) : (
          <div className="flex justify-between text-[13px]">
            <span className="text-[var(--ink-dim)]">Lead partner</span>
            <span className="mono text-[var(--ink-faint)]">none · {c.source}</span>
          </div>
        )}
        <div className="flex justify-between text-[14px] pt-2" style={{ borderTop: "1px dashed var(--line)" }}>
          <span className="font-disp font-semibold">We keep</span>
          <span className="mono font-bold" style={{ color: "var(--mint)" }}>{fmtMoney(m.net)}</span>
        </div>
      </div>
      {!compact && (
        <p className="text-[10.5px] text-[var(--ink-faint)] mt-2 mb-0">
          Two-way commission: {m.submissionType === "channel" ? `channel takes ${m.channelRatePct}% of loan amount` : "direct to bank, no submission loss"}
          {c.partner ? `, lead partner takes ${c.partner.sharePct}% of commission` : ", no lead partner"}.
        </p>
      )}
    </div>
  );
}

export function waClientLink(number: string, caseNumber: string, customer: string, agent: string): string {
  const digits = number.replace(/\D/g, "");
  const first = customer ? customer.split(" ")[0] : "";
  const text = `Hello${first ? " " + first : ""}, this is ${agent} from HFMC regarding your home finance file ${caseNumber}. `;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function WaButtons({ c, agentName }: { c: LoanCase; agentName: string }) {
  if (!c.whatsapp && !c.waGroup) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {c.whatsapp && (
        <a className="btn btn-mint btn-sm" href={waClientLink(c.whatsapp, c.caseNumber, c.customer, agentName)} target="_blank" rel="noreferrer" title={`Chat with ${c.customer} on WhatsApp (${c.whatsapp})`}>
          <IWhatsapp size={14} /> Chat with client
        </a>
      )}
      {c.waGroup && (
        <a className="btn btn-ghost btn-sm" href={c.waGroup} target="_blank" rel="noreferrer" title="Open the WhatsApp group to chase documents">
          <IWhatsapp size={14} /> Chase in group
        </a>
      )}
    </div>
  );
}

export function ConfirmModal({
  open, onClose, onConfirm, title, body, confirmLabel, tone = "danger",
}: {
  open: boolean; onClose: () => void; onConfirm: () => void;
  title: string; body: ReactNode; confirmLabel: string; tone?: "danger" | "mint" | "primary";
}) {
  if (!open) return null;
  const cls = tone === "mint" ? "btn-mint" : tone === "primary" ? "btn-primary" : "btn-danger";
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 anim-fade-in"
      style={{ background: "rgba(4, 12, 15, 0.72)", backdropFilter: "blur(3px)" }}
      onClick={onClose}
    >
      <div
        className="card anim-scale-in w-full max-w-[420px] p-5"
        style={{ background: "var(--raised)", boxShadow: "0 30px 80px -20px rgba(0,0,0,0.7)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <h3 className="font-disp font-semibold text-[16px] m-0">{title}</h3>
          <button className="text-[var(--ink-faint)] hover:text-[var(--ink)] transition-colors" onClick={onClose} aria-label="Close">
            <IX size={17} />
          </button>
        </div>
        <div className="text-[13.5px] text-[var(--ink-dim)] mb-5">{body}</div>
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className={`btn ${cls}`} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function PersonLine({ name, label }: { name: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Avatar name={name} size={20} />
      <span className="text-[12px] text-[var(--ink-dim)]">{label} <span className="text-[var(--ink)]">{name}</span></span>
    </span>
  );
}
