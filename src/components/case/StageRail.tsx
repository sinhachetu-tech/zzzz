"use client";

/* StageRail — where the case is, in one line.
 *
 * REPLACED five clickable stage cards. Each card carried a step number, the stage
 * name, an owner role, a docs x/y count and a done/next hint — and then opened a
 * drawer that showed the same five stages' detail again. 5 cards × ~70px of
 * duplicated summary sat between the header and the work, and reading them
 * required the same knowledge the drawer was there to teach.
 *
 * The information that was genuinely lost is preserved as affordances rather
 * than removed:
 *   · the CURRENT stage is a button — that is the one whose drawer you want,
 *     and it is the only one that was worth a dedicated hit target
 *   · prev/next are buttons, because moving stage is the most frequent
 *     structural action on a file and used to require hunting for "Stage"
 *   · the dots encode reached / current / upcoming, so "am I early or late" is
 *     still answerable at a glance
 *
 * SLA lives here because the rail is the only always-visible statement of time,
 * and a breach next to the stage name is where it does something.
 */

import { useMemo } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { LoanCase } from "@/lib/types";
import { LABEL_TO_KEY, stagesForServiceLine } from "@/lib/workflow/registry";
import { ageDays } from "@/lib/format";
import type { StageKey } from "@/lib/workflow/types";

export function StageRail({
  c,
  onOpen,
  onMove,
  serviceLineName,
  journeyConfigured,
}: {
  c: LoanCase;
  onOpen: (key: StageKey) => void;
  onMove: () => void;
  /** Name of the case's service line, for the coming-soon message. */
  serviceLineName?: string;
  /**
   * Phase 5: false when this service line has no journey written yet. The rail
   * then says so instead of rendering the MORTGAGE stages — showing a valuation
   * stage on a will would be a lie about how the work actually runs.
   */
  journeyConfigured?: boolean;
}) {
  const { stages, stageTransitions, slaRules, serviceLines } = useHfmcStore();

  // Stages are scoped to the case's OWN service line (Phase 5), via the one
  // shared resolver — duplicating that join here is how a golden-visa case ends
  // up rendering "Valuation".
  const activeStages = useMemo(
    () => stagesForServiceLine(stages, serviceLines, c.serviceLineId),
    [stages, serviceLines, c.serviceLineId],
  );

  // No stages for this line yet → the honest empty state.
  if (journeyConfigured === false || activeStages.length === 0) {
    return (
      <div
        className="card px-3.5 py-2.5 flex items-center gap-2.5 anim-fade-up"
        style={{ borderLeft: "3px solid var(--ink-faint)" }}
      >
        <span className="mono text-[10.5px] uppercase font-bold tracking-wider shrink-0" style={{ color: "var(--ink-faint)" }}>
          Workflow
        </span>
        <span className="font-disp font-semibold text-[13.5px] truncate">
          {serviceLineName ?? "This service"} — coming soon
        </span>
        <span className="text-[11.5px] text-[var(--ink-faint)] truncate">
          No stage list has been written for this service yet, so the case is tracked by status only.
        </span>
      </div>
    );
  }

  const currentIdx = useMemo(() => {
    const idx = activeStages.findIndex((s) => s.label === c.stage);
    return idx >= 0 ? idx : 0;
  }, [activeStages, c.stage]);

  // Reached = the furthest stage this case has actually occupied. Derived from
  // the transition log, so a stage the case was moved back out of still reads
  // as "you have been here" rather than resetting to a blank dot.
  const reachedIdx = useMemo(() => {
    let max = currentIdx;
    for (const t of stageTransitions.filter((x) => x.caseId === c.id)) {
      const i = activeStages.findIndex((s) => s.label === t.toStage);
      if (i > max) max = i;
    }
    return max;
  }, [stageTransitions, c.id, currentIdx, activeStages]);

  const age = ageDays(c.createdAt);
  const rule = slaRules.find((r) => r.active && r.stage === c.stage && !r.bank);
  const slaOver = rule ? age - rule.maxDays : null;
  const over = slaOver != null && slaOver > 0;

  const current = activeStages[currentIdx];
  const prev = currentIdx > 0 ? activeStages[currentIdx - 1] : null;
  const next = currentIdx + 1 < activeStages.length ? activeStages[currentIdx + 1] : null;
  const stageKey = (LABEL_TO_KEY[current?.label ?? ""] ?? current?.label ?? "doc") as StageKey;

  return (
    <div
      className="card px-3.5 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 anim-fade-up"
      style={{ borderLeft: "3px solid var(--amber)" }}
    >
      <button
        type="button"
        className="flex items-center gap-2 min-w-0 group"
        onClick={() => onOpen(stageKey)}
        title={`Open the ${current?.label ?? "stage"} detail — what's now, to-do, procedure and actions`}
      >
        <span className="mono text-[10.5px] uppercase font-bold tracking-wider shrink-0" style={{ color: "var(--ink-faint)" }}>
          Stage {currentIdx + 1}/{activeStages.length}
        </span>
        <span className="font-disp font-semibold text-[14px] truncate">{current?.label ?? "—"}</span>
        <span className="mono text-[11px] shrink-0 hidden sm:inline" style={{ color: "var(--ink-faint)" }}>
          {current?.ownerRole || "Team"}
        </span>
        <span className="shrink-0 hidden sm:inline-flex" style={{ color: "var(--amber)" }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:translate-x-0.5">
            <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
          </svg>
        </span>
      </button>

      {/* progress dots — reached / current / upcoming. Decorative on purpose:
          the current stage is named in words above, so this never has to be
          parsed, only glanced at. */}
      <div className="flex items-center gap-1" aria-hidden>
        {activeStages.map((s, i) => (
          <span
            key={s.id}
            title={s.label}
            style={{
              width: i === currentIdx ? 16 : 6,
              height: 6,
              borderRadius: 999,
              transition: "width 0.15s ease",
              background: i === currentIdx ? "var(--amber)" : i < reachedIdx ? "var(--mint)" : "var(--line)",
              opacity: i === currentIdx ? 1 : i < reachedIdx ? 0.75 : 1,
            }}
          />
        ))}
      </div>

      <div className="flex items-center gap-1.5 ml-auto">
        <span
          className="mono text-[11px]"
          style={{ color: over ? "var(--coral)" : "var(--ink-faint)" }}
          title={rule ? `SLA for ${c.stage} is ${rule.maxDays} days` : "No SLA configured for this stage"}
        >
          {over ? `SLA +${slaOver}d` : `${age}d`}
        </span>
        {prev && (
          <button className="btn btn-ghost btn-sm !px-2 !py-1 text-[11.5px]" onClick={onMove} title={`Currently at ${c.stage} — use Move to go back to ${prev.label}`}>
            ‹ {prev.label}
          </button>
        )}
        <button className="btn btn-ghost btn-sm !px-2 !py-1 text-[11.5px]" onClick={onMove} title="Move this case to another stage">
          {next ? `${next.label} ›` : "Move stage ›"}
        </button>
      </div>
    </div>
  );
}

