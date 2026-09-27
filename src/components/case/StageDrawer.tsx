"use client";
import { useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { LoanCase } from "@/lib/types";
import { ageDays, inDaysISO, todayISO } from "@/lib/format";
import { STAGE_BY_KEY, journeyIndexOf } from "@/lib/workflow/registry";
import type { StageKey } from "@/lib/workflow/types";
import { transferBranch, transferStepsFor } from "@/lib/workflow/stages/transfer";
import { CommButton } from "./CommButton";
import { StageFields } from "./StageFields";
import { useStageLive } from "./useStageLive";
import { StageHead, StageNow, StageSteps, StageSop, StageShell } from "./stage-parts";
import type { CaseTab } from "./stage-parts";

export function StageDrawer({ c, stageKey, onClose, onTab }: {
  c: LoanCase; stageKey: StageKey | null; onClose: () => void; onTab: (t: CaseTab) => void;
}) {
  return stageKey ? (
    <DrawerContent c={c} stageKey={stageKey} onClose={onClose} onTab={onTab} />
  ) : null;
}

function DrawerContent({ c, stageKey, onClose, onTab }: {
  c: LoanCase; stageKey: StageKey; onClose: () => void; onTab: (t: CaseTab) => void;
}) {
  const store = useHfmcStore();
  const live = useStageLive(c);
  const [confirmMove, setConfirmMove] = useState(false);
  const [reason, setReason] = useState("");
  const def = STAGE_BY_KEY[stageKey];
  const branch = stageKey === "transfer" ? transferBranch(c.transactionType) : null;
  const vis = stageKey === "transfer" && branch
    ? def.subSteps.filter((s) => transferStepsFor(branch).includes(s.id))
    : def.subSteps;
  const nextLabel = store.stages.filter((s) => s.active)[journeyIndexOf(c.stage) + 1]?.label ?? null;
  const gateFails = def.exitGate.checks.filter((k) => !live.checks[k]);
  const folLock = stageKey === "fol" && (!live.checks.folConversion || !live.checks.folVerified);
  const steps = vis.map((s) => ({ key: s.check, id: s.id, label: s.label, hint: s.hint }));

  // [Now] context — SLA age, last moves, expiring docs, Next-Best-Action
  const age = ageDays(c.createdAt);
  const rule = store.slaRules.find((r) => r.active && r.stage === c.stage && !r.bank);
  const sla = { age, max: rule?.maxDays ?? null, over: rule ? age - rule.maxDays : null };
  const moves = live.transitions.slice(0, 3).map((t) => ({
    toStage: t.toStage, at: t.at, comment: t.comment,
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
      <StageHead title={def.title} owner={def.owner} branch={branch} />
      <StageNow c={c} latest={live.latest} openN={live.openTasks.length} bankN={live.bankTasks.length}
        mandDone={live.mandatory.length - live.blocked.length} mandTotal={live.mandatory.length}
        oldest={live.oldestTask} moves={moves} sla={sla} expiring={expiring} />
      <StageSteps steps={steps} checks={live.checks} folLock={folLock} heuristic={live.heuristic} />
      <StageFields c={c} stageKey={stageKey} conversionMissing={!live.checks.folConversion} />
      <StageSop sop={def.sop} gate={def.exitGate.summary} />
      <div className="card p-4 space-y-2.5">
        <h4 className="font-disp font-semibold text-[13px] m-0">Actions</h4>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-ghost btn-sm" onClick={() => onTab("daily")}>Log update</button>
          <button className="btn btn-ghost btn-sm" onClick={() => onTab("tasks")}>Tasks</button>
          <button className="btn btn-ghost btn-sm" onClick={() => onTab("documents")}>Docs</button>
          {def.comms.map((id) => (<CommButton key={id} c={c} templateId={id} />))}
        </div>
        {nextLabel && !confirmMove && (
          <button className="btn btn-primary btn-sm" onClick={() => setConfirmMove(true)}>Move to {nextLabel} →</button>
        )}
        {nextLabel && confirmMove && (
          <div className="space-y-2">
            {gateFails.length > 0 && (
              <p className="text-[11.5px] m-0" style={{ color: "var(--coral)" }}>Exit gate: {gateFails.join(", ")} pending — reason required.</p>
            )}
            <input className="input" placeholder="Handover / override note…" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex gap-2">
              <button className="btn btn-primary btn-sm" onClick={doMove}>Confirm → {nextLabel}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setConfirmMove(false); setReason(""); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </StageShell>
  );
}
