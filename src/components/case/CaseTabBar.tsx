"use client";

/* CaseTabBar — the workspace switcher: FOUR tabs, not eight.
 *
 * WHAT CHANGED AND WHY IT IS BETTER:
 *   · Profile and Data Sheet became "Client". They are the same person, and the
 *     only reason they were separate is that the sheet first shipped inside a
 *     collapsed rail. Two tabs said "who is this" and split the work.
 *   · Daily Update and Tasks became "Now". "What am I doing today" is one
 *     question; it was two tabs plus a stage card plus a next-best-action line.
 *   · Banks & Proposal kept its slot and gained the money panels that used to
 *     hide in the inspector rail.
 *   · Chat and Activity moved behind "⋯". They are read-mostly; giving them a
 *     permanent slot alongside four working tabs is how you get a wall.
 *
 * THE BADGE RULE — one visual language. Previously six badges competed in six
 * styles (✓ today / pending / x/y / n open / n in play / n needed) across four
 * colours, which carries the same signal as no badge at all. Now: coral =
 * blocking us, amber = waiting on someone, mint = clear.
 *
 * The counts are the same maths the tab bodies use (the vault's own doc rule,
 * sheetCompletion from lib/person-sheet) — read here, never stored here.
 */

import { useMemo, type ReactNode } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { LoanCase } from "@/lib/types";
import { todayISO } from "@/lib/format";
import { sheetCompletion } from "@/lib/person-sheet";
import { Tabs } from "@/components/hfmc/ui";
import { OverflowMenu } from "@/components/case/OverflowMenu";
import { IZap, IUsers, IShield, IBank, IRobot, IHistory } from "@/components/icons";
import type { CaseTab } from "./stage-parts";

/** One badge. One colour scale. */
function Badge({ tone, children, title }: { tone: "coral" | "amber" | "mint"; children: ReactNode; title?: string }) {
  const color = tone === "coral" ? "var(--coral)" : tone === "amber" ? "var(--amber)" : "var(--mint)";
  const bg = tone === "coral" ? "rgba(255,107,107,0.14)" : tone === "amber" ? "rgba(242,176,76,0.16)" : "rgba(67,214,155,0.14)";
  return (
    <span className="mono inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-semibold"
      style={{ background: bg, color }} title={title}>
      {children}
    </span>
  );
}

export function CaseTabBar({
  c,
  active,
  onTab,
}: {
  c: LoanCase;
  active: CaseTab;
  onTab: (t: CaseTab) => void;
}) {
  const { caseDocuments, caseUpdates, tasks, clients, instructions } = useHfmcStore();

const counts = useMemo(() => {
    const docs = caseDocuments.filter((d) => d.caseId === c.id);
    const mand = docs.filter((d) => d.mandatory && d.status !== "Waived");
    const blocked = mand.filter((d) => d.status !== "Verified");
    const open = tasks.filter((t) => t.caseId === c.id && t.status === "Open");
    const instr = instructions.filter((i) => i.caseId === c.id && i.status === "Open");

    let sheetTotal = 0;
    let sheetDone = 0;
    for (const id of [c.clientId, c.secondPartyClientId]) {
      if (!id) continue;
      const cl = clients.find((x) => x.id === id);
      if (!cl) continue;
      const comp = sheetCompletion(cl.personData ?? {}, {
        selfEmployed: cl.employmentProfile === "Self-Employed",
      });
      sheetTotal += comp.total;
      sheetDone += comp.done;
    }

    return {
      blockedDocs: blocked.length,
      openTasks: open.length,
      openInstr: instr.length,
      sheetMissing: sheetTotal - sheetDone,
      loggedToday: caseUpdates.some((u) => u.caseId === c.id && u.date === todayISO()),
    };
  }, [caseDocuments, caseUpdates, tasks, clients, instructions, c.id, c.clientId, c.secondPartyClientId]);

  const nowBlocking = counts.openTasks + counts.openInstr + (counts.loggedToday ? 0 : 1);

  const icon = (node: ReactNode, tab: CaseTab) => (
    <span style={{ color: active === tab ? "var(--amber)" : "var(--ink-faint)", display: "inline-flex" }}>{node}</span>
  );

  const items = [
    {
      value: "now" as CaseTab,
      label: "Now",
      icon: icon(<IZap size={15} />, "now"),
      badge: nowBlocking > 0
        ? <Badge tone="amber" title="Open tasks, open instructions, or today's update is missing">{nowBlocking}</Badge>
        : <Badge tone="mint" title="Nothing outstanding today">clear</Badge>,
    },
    {
      value: "client" as CaseTab,
      label: "Client",
      icon: icon(<IUsers size={15} />, "client"),
      badge: counts.sheetMissing > 0
        ? <Badge tone="amber" title={`${counts.sheetMissing} data-sheet fields outstanding`}>{counts.sheetMissing}</Badge>
        : <Badge tone="mint" title="Data sheet complete">complete</Badge>,
    },
    {
      value: "documents" as CaseTab,
      label: "Documents",
      icon: icon(<IShield size={15} />, "documents"),
      badge: counts.blockedDocs > 0
        ? <Badge tone="coral" title="Mandatory documents with no file attached">{counts.blockedDocs}</Badge>
        : <Badge tone="mint" title="Every mandatory document is on file">complete</Badge>,
    },
    {
      value: "money" as CaseTab,
      label: "Money",
      icon: icon(<IBank size={15} />, "money"),
      badge: c.banks.length > 0 ? <Badge tone="mint" title="Banks in play">{c.banks.length}</Badge> : null,
    },
  ];

  return (
    <div className="card p-1.5 flex items-center gap-1.5 overflow-hidden select-none"
      style={{ background: "var(--bg2)", border: "1px solid var(--line)" }}>
      <div className="hidden sm:flex items-center px-2.5 shrink-0 border-r" style={{ borderColor: "var(--line)" }}>
        <span className="mono text-[10.5px] uppercase font-bold tracking-wider" style={{ color: "var(--amber)" }}>
          Workspace
        </span>
      </div>

      <Tabs flush scroll className="flex-1 min-w-0" value={active} onChange={onTab} options={items} />

      {/* More is its own control rather than a fifth tab, so "chat" never looks
          like a peer of "what I am doing right now". */}
      <div className="ml-auto shrink-0 border-l pl-1.5" style={{ borderColor: "var(--line)" }}>
        <OverflowMenu
          label="More case sections"
          items={[
            { key: "chat", label: active === "chat" ? "Chat (open)" : "Chat", icon: <IRobot size={14} />, onSelect: () => onTab("chat") },
            { key: "activity", label: active === "activity" ? "Activity log (open)" : "Activity log", icon: <IHistory size={14} />, onSelect: () => onTab("activity") },
          ]}
        />
      </div>
    </div>
  );
}
