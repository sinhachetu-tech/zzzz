"use client";

/* Stage journey — 5 working cards with ✓ state + live signals
   (docs x/y · age · SLA) so the board reads without clicking.
   Click a card → StageDrawer (Now / To-do / Procedure / Actions).
   Legacy DB labels resolve via stageKeyOf() so old history keeps working. */
import { useMemo } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { LoanCase } from "@/lib/types";
import { JOURNEY, journeyIndexOf } from "@/lib/workflow/registry";
import { ageDays } from "@/lib/format";
import { ICheck } from "@/components/icons";
import type { StageKey } from "@/lib/workflow/types";

export function StageJourney({
  c,
  onOpen,
}: {
  c: LoanCase;
  onOpen: (key: StageKey) => void;
}) {
  const { stageTransitions, caseDocuments, slaRules } = useHfmcStore();
  const current = journeyIndexOf(c.stage);
  const reached = useMemo(() => {
    // highest journey index ever reached by this case (honest ticks on rework)
    let max = current;
    for (const t of stageTransitions.filter((x) => x.caseId === c.id)) {
      const i = journeyIndexOf(t.toStage);
      if (i > max) max = i;
    }
    return max;
  }, [stageTransitions, c.id, current]);
  const docs = useMemo(() => caseDocuments.filter((d) => d.caseId === c.id), [caseDocuments, c.id]);
  const mand = docs.filter((d) => d.mandatory && d.status !== "Waived");
  const blocked = mand.filter((d) => d.status !== "Verified");
  const age = ageDays(c.createdAt);
  const rule = slaRules.find((r) => r.active && r.stage === c.stage && !r.bank);
  const slaOver = rule ? age - rule.maxDays : null;

  return (
    <div className="card anim-fade-up anim-reveal p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-disp font-semibold text-[14px] m-0">Stage Journey</h3>
          <span className="chip text-[11px]" style={{ background: "rgba(242,176,76,0.12)", color: "var(--amber)", borderColor: "rgba(242,176,76,0.3)" }}>
            Step {current + 1} of 5: {JOURNEY[current]?.title ?? "—"}
          </span>
        </div>
        {slaOver != null && slaOver > 0 ? (
          <span className="chip" style={{ color: "var(--coral)", background: "rgba(255,107,107,0.1)", borderColor: "rgba(255,107,107,0.3)" }}>
            SLA +{slaOver}d
          </span>
        ) : (
          <span className="mono text-[11px] text-[var(--ink-faint)]">{age}d active</span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
        {JOURNEY.map((s, i) => {
          const done = i < current || (i <= reached && i !== current);
          const isCurrent = i === current;
          return (
            <button
              key={s.key}
              onClick={() => onOpen(s.key)}
              className="rounded-xl px-3 py-2.5 text-left transition-all border"
              style={
                isCurrent
                  ? { background: "rgba(242,176,76,0.12)", borderColor: "var(--amber)" }
                  : done
                    ? { background: "rgba(67,214,155,0.08)", borderColor: "var(--mint)" }
                    : { background: "var(--bg2)", borderColor: "var(--line)" }
              }
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="w-5 h-5 rounded-full grid place-items-center text-[11px] font-bold shrink-0"
                  style={
                    done
                      ? { background: "var(--mint)", color: "#fff" }
                      : isCurrent
                        ? { background: "var(--amber)", color: "#fff" }
                        : { background: "var(--line)", color: "var(--ink-faint)" }
                  }
                >
                  {done ? <ICheck size={11} /> : i + 1}
                </span>
                <span className="font-disp font-semibold text-[12.5px]">{s.short}</span>
              </div>
              <p className="text-[10.5px] text-[var(--ink-faint)] m-0 mt-1">
                {isCurrent
                  ? `You are here · docs ${mand.length - blocked.length}/${mand.length} — open`
                  : done
                    ? "Done — review"
                    : (i === current + 1 ? `Next · ${s.owner}` : s.owner)}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
