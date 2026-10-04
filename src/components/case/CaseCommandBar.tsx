"use client";

/* CaseCommandBar — THE top of Case 360, and the only place identity is shown.
 *
 * WHY THIS FILE REPLACES TWO OTHERS: the screen used to open with a sticky
 * action bar (case no, customer, status, stage, amount, next-best-action,
 * Nudge/Task/Stage/Match/Details) immediately followed by a CaseHero card
 * carrying the SAME case no, customer, status, stage, amount and a second set of
 * action buttons. Two headers, one piece of information, ~180px of vertical
 * space, and the user's eye forced to check both for a difference. Everything
 * they both showed now appears exactly once, here.
 *
 * THE ONE HIERARCHY RULE: exactly one primary button on this bar, and its label
 * is derived from the highest-ranked blocker (see lib/case-blockers). Everything
 * else is a quiet ghost button or one level down in "⋯". Before, Nudge / Task /
 * Stage / Match / Details / WA / Set outcome / Delete were eight peers of
 * identical visual weight, so the real next action was indistinguishable from
 * "delete this file" — which is exactly the kind of thing you do not want one
 * misclick away from seven equals.
 */

import { useMemo, type ReactNode } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { LoanCase } from "@/lib/types";
import { ageDays, fmtDate, fmtMoney } from "@/lib/format";
import type { Blocker } from "@/lib/case-blockers";
import { Chip, StatusChip } from "@/components/hfmc/ui";
import { CaseStateChip, SourceChip } from "@/components/hfmc/bits";
import { ContactLine, resolveContact, telHref, mailtoHref } from "@/components/case/ContactBits";
import { OverflowMenu } from "@/components/case/OverflowMenu";
import {
  IChevronL, IFlag, IPlus, IBriefcase, IShield, IWhatsapp, IRobot, IHistory, IChart, IBank, ITrash,
} from "@/components/icons";

export type CaseStatusValue = ReturnType<typeof import("@/lib/format").caseStatusOf>;

/** Which tabs the command bar can jump to. Chat and activity are real tabs but
 *  not primaries — they are reached from "⋯", not from the top of the file. */
export type JumpTab = "documents" | "money" | "chat" | "activity";

const IPhone = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.1a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" />
  </svg>
);

const IMailGlyph = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m2 7 10 6 10-6" />
  </svg>
);

function waHref(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}`;
}

export function CaseCommandBar({
  c,
  status,
  blockers,
  onBack,
  onTab,
  onAddTask,
  onMoveStage,
  onSetOutcome,
  onDeleteCase,
  onOpenDetails,
  canDelete,
}: {
  c: LoanCase;
  status: CaseStatusValue;
  blockers: Blocker[];
  onBack: () => void;
  onTab: (t: JumpTab) => void;
  onAddTask: () => void;
  onMoveStage: () => void;
  onSetOutcome: () => void;
  onDeleteCase: () => void;
  onOpenDetails: () => void;
  canDelete: boolean;
}) {
  const { slaRules, userById, clients } = useHfmcStore();
  const client = clients.find((cl) => cl.id === c.clientId) ?? null;
  const contact = resolveContact(c, client);
  const owner = userById(c.ownerId)?.name ?? "—";
  const rule = slaRules.find((r) => r.active && r.stage === c.stage && !r.bank);
  const age = ageDays(c.createdAt);
  const slaOver = rule ? age - rule.maxDays : null;
  const top = blockers[0] ?? null;

  /* Secondary chips are capped so a long property/partner list cannot push the
   * action buttons around. The fold is intentional — these qualify a file, none
   * of them tells you whether it is stuck. */
  const chips = useMemo(() => {
    const list: { key: string; node: ReactNode }[] = [];
    if (c.onHold) {
      list.push({
        key: "ON HOLD",
        node: (
          <span key="hold" className="chip" title={c.holdReason ?? "On hold"}
            style={{ color: "var(--amber)", background: "rgba(242,176,76,0.12)", borderColor: "rgba(242,176,76,0.4)" }}>
            ON HOLD
          </span>
        ),
      });
    }
    list.push({ key: "Source: " + c.source, node: <SourceChip key="src" source={c.source} /> });
    if (c.convertedAt) {
      list.push({
        key: `Converted from a lead on ${fmtDate(c.convertedAt.slice(0, 10))}`,
        node: (
          <span key="conv" className="chip"
            style={{ color: "var(--mint)", background: "rgba(67,214,155,0.12)", borderColor: "rgba(67,214,155,0.35)" }}>
            Converted from lead
          </span>
        ),
      });
    }
    if (c.transactionType) list.push({ key: c.transactionType, node: <Chip key="txn" tone="sky">{c.transactionType}</Chip> });
    if (c.partner) list.push({ key: c.partner.name, node: <Chip key="partner" tone="amber">{c.partner.name}</Chip> });
    return list;
  }, [c]);

  const toneColor = top
    ? top.tone === "block" ? "var(--coral)" : top.tone === "wait" ? "var(--amber)" : "var(--ink-dim)"
    : "var(--mint)";

  return (
    <div className="case-stickybar flex-col !items-stretch gap-2">
      <div className="flex items-start gap-2.5">
        <button className="btn btn-ghost btn-sm !px-2 shrink-0 mt-0.5" onClick={onBack} title="Back to pipeline" aria-label="Back to pipeline">
          <IChevronL size={16} />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="mono text-[11.5px] font-semibold shrink-0" style={{ color: "var(--amber)" }}>{c.caseNumber}</span>
            <CaseStateChip state={c.caseStatus} />
            {c.caseStatus === "Active" && <StatusChip status={status} />}
            <span className="chip" style={{ fontSize: 10, background: "rgba(242,176,76,0.1)", color: "var(--amber)", borderColor: "rgba(242,176,76,0.3)" }}>
              {c.stage}
            </span>
            <span className="mono text-[10.5px] text-[var(--ink-faint)] ml-auto shrink-0">
              opened {fmtDate(c.createdAt)} · {age}d
              {slaOver != null && slaOver > 0 && <span style={{ color: "var(--coral)" }}> · SLA +{slaOver}d</span>}
            </span>
          </div>

          <h1 className="font-disp font-bold text-[22px] leading-tight tracking-tight m-0 mt-0.5 truncate">{c.customer}</h1>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--ink-dim)]">
            <span className="mono font-semibold text-[13.5px]" style={{ color: "var(--ink)" }}>{fmtMoney(c.loanAmount)}</span>
            <span>· {c.banks.join(", ") || "no bank yet"}</span>
            <span>· owner <strong>{owner}</strong></span>
            {c.vrmId && <span>· VRM <strong>{userById(c.vrmId)?.name ?? "—"}</strong></span>}
          </div>

          {/* contact — the three ways to reach the client, as icons. The numbers stay
              available: hover titles, and the full text in the Client tab. */}
          <div className="flex items-center gap-1.5 mt-1.5">
            {contact.phone ? (
              <>
                <a className="btn btn-ghost btn-sm !px-2" href={telHref(contact.phone)} title={`Call ${contact.phone}`} aria-label={`Call ${contact.phone}`}>
                  <IPhone />
                </a>
                <a className="btn btn-mint btn-sm !px-2" href={waHref(contact.phone)} target="_blank" rel="noreferrer" title={`WhatsApp ${contact.phone}`} aria-label={`WhatsApp ${contact.phone}`}>
                  <IWhatsapp size={14} />
                </a>
              </>
            ) : (
              <span className="text-[11px]" style={{ color: "var(--amber)" }}>no phone on file</span>
            )}
            {contact.email && (
              <a className="btn btn-ghost btn-sm !px-2" href={mailtoHref(contact.email)} title={`Email ${contact.email}`} aria-label={`Email ${contact.email}`}>
                <IMailGlyph />
              </a>
            )}
            <span className="ml-1 min-w-0"><ContactLine contact={contact} size={11} /></span>
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              {chips.slice(0, 3).map((x) => x.node)}
              {chips.length > 3 && (
                <span className="chip" style={{ color: "var(--ink-faint)" }} title={chips.slice(3).map((h) => h.key).join(" · ")}>
                  +{chips.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
{/* actions: ONE primary, drawn from the top blocker. Everything else is a
            peer-free ghost button or an overflow item. */}
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          {top ? (
            <button className="btn btn-primary btn-sm" onClick={() => onTab(top.tab as JumpTab)} title={top.detail ?? top.label}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: "currentColor" }} />
              {top.label}
            </button>
          ) : (
            <span className="chip" style={{ color: "var(--mint)", background: "rgba(67,214,155,0.1)", borderColor: "rgba(67,214,155,0.3)" }}>
              nothing outstanding
            </span>
          )}

          <button className="btn btn-ghost btn-sm !px-2.5" onClick={onAddTask} title="Add a task">
            <IPlus size={14} /><span className="hidden lg:inline">Task</span>
          </button>
          <button className="btn btn-ghost btn-sm !px-2.5" onClick={onMoveStage} title="Move to another stage">
            <IFlag size={14} /><span className="hidden lg:inline">Move</span>
          </button>
          <button className="btn btn-ghost btn-sm !px-2.5" onClick={onOpenDetails} title="Case details, people and numbers">
            <IBriefcase size={14} /><span className="hidden lg:inline">Details</span>
          </button>

          <OverflowMenu
            label="More case actions"
            items={[
              { key: "banks", label: "Bank match & proposals", icon: <IBank size={14} />, onSelect: () => onTab("money") },
              { key: "docs", label: "Document vault", icon: <IShield size={14} />, onSelect: () => onTab("documents") },
              { key: "chat", label: "Chat", icon: <IRobot size={14} />, onSelect: () => onTab("chat") },
              { key: "activity", label: "Activity log", icon: <IHistory size={14} />, onSelect: () => onTab("activity") },
              ...(c.caseStatus === "Active"
                ? [{ key: "outcome", label: "Set outcome", icon: <IChart size={14} />, onSelect: onSetOutcome }]
                : []),
              ...(canDelete
                ? [{ key: "delete", label: "Delete case", icon: <ITrash size={14} />, danger: true, onSelect: onDeleteCase }]
                : []),
            ]}
          />
        </div>
      </div>

      {/* One line, one answer. This used to be six badges in six visual styles
          scattered across three surfaces; now it either names what is owed or
          says plainly that nothing is. */}
      {top && (
        <div
          className="flex items-center gap-2 text-[12px] px-2.5 py-1.5 rounded-lg"
          style={{
            background: top.tone === "block" ? "rgba(255,107,107,0.08)" : top.tone === "wait" ? "rgba(242,176,76,0.08)" : "var(--tint)",
            border: `1px solid ${top.tone === "block" ? "rgba(255,107,107,0.3)" : "var(--line-soft)"}`,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 999, flexShrink: 0, background: toneColor }} />
          <span className="font-medium shrink-0" style={{ color: toneColor }}>{top.label}</span>
          {top.detail && <span className="truncate" style={{ color: "var(--ink-dim)" }}>— {top.detail}</span>}
          {blockers.length > 1 && (
            <span className="ml-auto shrink-0 mono text-[11px]" style={{ color: "var(--ink-faint)" }}>
              +{blockers.length - 1} more
            </span>
          )}
        </div>
      )}
    </div>
  );
}
