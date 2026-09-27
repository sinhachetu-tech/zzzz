"use client";

/* Workspace navigation bar — Profile / Daily Update / Vault / Tasks / Banks &
   Proposal / Activity. Prominent, icon-driven workspace switcher with live status badges. */
import { useMemo } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { LoanCase } from "@/lib/types";
import { todayISO } from "@/lib/format";
import { IUsers, ICalendar, IShield, ITasks, IBank, IHistory, IEye } from "@/components/icons";
import { Tabs } from "@/components/hfmc/ui";
import type { CaseTab } from "./stage-parts";

export function DocActionRow({
  c,
  active,
  onTab,
  showInspector,
  onToggleInspector,
}: {
  c: LoanCase;
  active: CaseTab;
  onTab: (t: CaseTab) => void;
  showInspector?: boolean;
  onToggleInspector?: () => void;
}) {
  const { caseDocuments, caseUpdates, tasks } = useHfmcStore();
  const info = useMemo(() => {
    const docs = caseDocuments.filter((d) => d.caseId === c.id);
    const mand = docs.filter((d) => d.mandatory && d.status !== "Waived");
    const blocked = mand.filter((d) => d.status !== "Verified");
    const open = tasks.filter((t) => t.caseId === c.id && t.status === "Open");
    const todayDone = caseUpdates.some((u) => u.caseId === c.id && u.date === todayISO());
    return { docs, mand, blocked, open, todayDone };
  }, [caseDocuments, caseUpdates, tasks, c.id]);

  const items = [
    {
      tab: "profile" as CaseTab,
      label: "Profile",
      icon: <IUsers size={16} />,
      badge: null,
    },
    {
      tab: "daily" as CaseTab,
      label: "Daily Update",
      icon: <ICalendar size={16} />,
      badge: info.todayDone ? (
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-mono font-semibold"
          style={{ background: "rgba(67,214,155,0.15)", color: "var(--mint)" }}
        >
          ✓ today
        </span>
      ) : (
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-mono font-semibold"
          style={{ background: "rgba(242,176,76,0.18)", color: "var(--amber)" }}
        >
          pending
        </span>
      ),
    },
    {
      tab: "documents" as CaseTab,
      label: "Vault",
      icon: <IShield size={16} />,
      badge: (
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-mono font-semibold"
          style={
            info.blocked.length > 0
              ? { background: "rgba(255,107,107,0.14)", color: "var(--coral)" }
              : { background: "rgba(67,214,155,0.15)", color: "var(--mint)" }
          }
        >
          {info.mand.length - info.blocked.length}/{info.mand.length}
        </span>
      ),
    },
    {
      tab: "tasks" as CaseTab,
      label: "Tasks",
      icon: <ITasks size={16} />,
      badge: (
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-mono font-semibold"
          style={
            info.open.length > 0
              ? { background: "rgba(242,176,76,0.18)", color: "var(--amber)" }
              : { background: "rgba(67,214,155,0.15)", color: "var(--mint)" }
          }
        >
          {info.open.length} open
        </span>
      ),
    },
    {
      tab: "banks" as CaseTab,
      label: "Banks & Proposal",
      icon: <IBank size={16} />,
      badge:
        c.banks.length > 0 ? (
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-mono font-semibold"
            style={{ background: "var(--tint)", color: "var(--ink-dim)" }}
          >
            {c.banks.length} in play
          </span>
        ) : null,
    },
    {
      tab: "chat" as CaseTab,
      label: "Chat",
      icon: (
        <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
        </svg>
      ),
      badge: null,
    },
    {
      tab: "activity" as CaseTab,
      label: "Activity",
      icon: <IHistory size={16} />,
      badge: null,
    },
  ];

  return (
    <div
      className="card tabs-flush p-1.5 flex flex-wrap gap-1.5 overflow-x-auto items-center shadow-sm select-none"
      style={{
        background: "var(--bg2)",
        border: "1px solid var(--line)",
      }}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1 shrink-0 border-r" style={{ borderColor: "var(--line)" }}>
        <span className="mono text-[10.5px] uppercase font-bold tracking-wider" style={{ color: "var(--amber)" }}>
          WORKSPACE
        </span>
      </div>
      <Tabs
        flush
        className="flex-1 min-w-0"
        value={active}
        onChange={onTab}
        options={items.map((item) => ({
          value: item.tab,
          label: item.label,
          icon: <span style={{ color: active === item.tab ? "var(--amber)" : "var(--ink-faint)" }} className="transition-colors">{item.icon}</span>,
          badge: item.badge,
        }))}
      />
      {onToggleInspector && (
        <button
          type="button"
          onClick={onToggleInspector}
          className="btn btn-ghost btn-sm !py-1.5 !px-2.5 ml-auto shrink-0 flex items-center gap-1.5 text-[12px] rounded-lg transition-all"
          style={
            showInspector
              ? { color: "var(--amber)", background: "rgba(242,176,76,0.12)", borderColor: "rgba(242,176,76,0.3)" }
              : { color: "var(--ink-dim)" }
          }
          title={showInspector ? "Hide side inspector" : "Show side inspector"}
        >
          <IEye size={14} />
          <span className="hidden sm:inline">{showInspector ? "Hide Details" : "Case Details"}</span>
        </button>
      )}
    </div>
  );
}
