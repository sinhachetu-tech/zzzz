"use client";

import { useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { LoanCase } from "@/lib/types";
import { ageDays, inDaysISO, todayISO } from "@/lib/format";
import { STAGE_BY_KEY, LABEL_TO_KEY } from "@/lib/workflow/registry";
import type { StageKey } from "@/lib/workflow/types";
import { transferBranch, transferStepsFor } from "@/lib/workflow/stages/transfer";
import { CommButton } from "./CommButton";
import { StageFields } from "./StageFields";
import { useStageLive } from "./useStageLive";
import { StageHead, StageNow, StageSteps, StageSop, StageShell } from "./stage-parts";
import type { CaseTab } from "./stage-parts";

export function StageDrawer({
  c,
  stageKey,
  onClose,
  onTab,
}: {
  c: LoanCase;
  stageKey: StageKey | string | null;
  onClose: () => void;
  onTab: (t: CaseTab) => void;
}) {
  return stageKey ? (
    <DrawerContent c={c} stageKey={stageKey} onClose={onClose} onTab={onTab} />
  ) : null;
}

function DrawerContent({
  c,
  stageKey,
  onClose,
  onTab,
}: {
  c: LoanCase;
  stageKey: StageKey | string;
  onClose: () => void;
  onTab: (t: CaseTab) => void;
}) {
  const store = useHfmcStore();
  const live = useStageLive(c);
  const [confirmMove, setConfirmMove] = useState(false);
  const [reason, setReason] = useState("");

  // Resolve dynamic stageItem from store.stages
  const stageItem =
    store.stages.find(
      (s) =>
        s.label === stageKey ||
        String(s.id) === String(stageKey) ||
        LABEL_TO_KEY[s.label] === stageKey
    ) ?? null;

  const defKey: StageKey = (
    LABEL_TO_KEY[stageItem?.label ?? ""] ??
    LABEL_TO_KEY[stageKey] ??
    stageKey ??
    "doc"
  ) as StageKey;

  const fallbackDef = STAGE_BY_KEY[defKey] ?? STAGE_BY_KEY["doc"];

  const title = stageItem?.label ?? fallbackDef.title;
  const owner = stageItem?.ownerRole || fallbackDef.owner || "Team";
  const branch = defKey === "transfer" ? transferBranch(c.transactionType) : null;

  const dbSteps = stageItem?.steps && stageItem.steps.length > 0 ? stageItem.steps : null;

  const vis =
    defKey === "transfer" && branch
      ? fallbackDef.subSteps.filter((s) => transferStepsFor(branch).includes(s.id))
      : fallbackDef.subSteps;

  const steps = dbSteps
    ? (defKey === "transfer" && branch
        ? dbSteps.filter(
            (s) =>
              transferStepsFor(branch).includes(s.stepNumber) ||
              !s.stepNumber.startsWith("5")
          )
        : dbSteps
      ).map((s) => ({
        key: s.checkTarget || s.stepNumber,
        id: s.stepNumber,
        label: s.label,
        hint: s.hint,
      }))
    : vis.map((s) => ({ key: s.check, id: s.id, label: s.label, hint: s.hint }));

  // Pipeline order for next stage
  const activeStages = store.stages
    .filter((s) => s.active)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const currentIdx = activeStages.findIndex((s) => s.label === c.stage);
  const nextLabel =
    currentIdx >= 0 && currentIdx + 1 < activeStages.length
      ? activeStages[currentIdx + 1].label
      : null;

  const isStepDone = (k: string, id: string) => !!live.checks[k] || !!live.checks[id];

  const gateFails = dbSteps
    ? dbSteps
        .filter((s) => s.isGate && !isStepDone(s.checkTarget, s.stepNumber))
        .map((s) => s.label)
    : fallbackDef.exitGate.checks.filter((k) => !live.checks[k]);

  const folLock =
    defKey === "fol" && (!live.checks.folConversion || !live.checks.folVerified);

  const sop =
    stageItem?.sopJson && stageItem.sopJson.length > 0
      ? stageItem.sopJson
      : fallbackDef.sop;

  const comms =
    stageItem?.commsJson && stageItem.commsJson.length > 0
      ? stageItem.commsJson
      : fallbackDef.comms;

  const gateSummary = stageItem?.exitGateSummary || fallbackDef.exitGate.summary;

  // [Now] context — SLA age, last moves, expiring docs, Next-Best-Action
  const age = ageDays(c.createdAt);
  const rule = store.slaRules.find((r) => r.active && r.stage === c.stage && !r.bank);
  const sla = { age, max: rule?.maxDays ?? null, over: rule ? age - rule.maxDays : null };
  const moves = live.transitions.slice(0, 3).map((t) => ({
    toStage: t.toStage,
    at: t.at,
    comment: t.comment,
    userName: store.userById(t.userId)?.name ?? "—",
  }));
  const today = todayISO();
  const expiring = live.mandatory
    .filter((d) => d.expiryDate && d.expiryDate >= today && d.expiryDate <= inDaysISO(30))
    .map((d) => ({ title: d.title, date: d.expiryDate as string }));

  const doMove = async () => {
    if (!nextLabel) return;
    if (gateFails.length && !reason.trim()) {
      store.toast("error", "Exit gate blocked — add an override reason.");
      return;
    }
    await store.updateCase(c.id, { stage: nextLabel, stageComment: reason.trim() });
    setConfirmMove(false);
    setReason("");
    onClose();
  };

  return (
    <StageShell onClose={onClose}>
      <StageHead title={title} owner={owner} branch={branch} />
      <StageNow
        c={c}
        latest={live.latest}
        openN={live.openTasks.length}
        bankN={live.bankTasks.length}
        mandDone={live.mandatory.length - live.blocked.length}
        mandTotal={live.mandatory.length}
        oldest={live.oldestTask}
        moves={moves}
        sla={sla}
        expiring={expiring}
      />
      <StageSteps steps={steps} checks={live.checks} folLock={folLock} heuristic={live.heuristic} />
      <StageFields
        c={c}
        stageKey={defKey}
        stageItem={stageItem}
        conversionMissing={!live.checks.folConversion}
      />
      <StageSop sop={sop} gate={gateSummary} />
      <div className="card p-4 space-y-2.5">
        <h4 className="font-disp font-semibold text-[13px] m-0">Actions</h4>
        <div className="flex flex-wrap gap-2">
          {/* "Log update" and "Tasks" both pointed at separate tabs; those tabs are
              now one "Now" workspace, so offering both buttons would be offering
              the same destination twice under different names. */}
          <button className="btn btn-ghost btn-sm" onClick={() => onTab("now")}>
            Work on this stage
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => onTab("documents")}>
            Documents
          </button>
          {comms.map((id) => (
            <CommButton key={id} c={c} templateId={id} />
          ))}
        </div>
        {nextLabel && !confirmMove && (
          <button className="btn btn-primary btn-sm" onClick={() => setConfirmMove(true)}>
            Move to {nextLabel} →
          </button>
        )}
        {nextLabel && confirmMove && (
          <div className="space-y-2">
            {gateFails.length > 0 && (
              <p className="text-[11.5px] m-0" style={{ color: "var(--coral)" }}>
                Exit gate: {gateSummary ? `${gateSummary} — ` : ""}{gateFails.join(", ")} pending — reason required.
              </p>
            )}
            <input
              className="input"
              placeholder="Handover / override note…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex gap-2">
              <button className="btn btn-primary btn-sm" onClick={doMove}>
                Confirm → {nextLabel}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setConfirmMove(false);
                  setReason("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </StageShell>
  );
}
