"use client";

import { useMemo, useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { StageItem, StageStep, CommTemplate } from "@/lib/types";
import { stagesForServiceLine } from "@/lib/workflow/registry";
import { Chip, EmptyState, Modal } from "@/components/hfmc/ui";
import { ConfirmModal } from "@/components/hfmc/bits";
import {
  ICheck, IChevronR, IClock, IFlag, IPencil, IPlus, IShield, ITasks, ITrash, ITrophy, IX
} from "@/components/icons";

function CardHeader({
  title,
  sub,
  action,
  children,
}: {
  title: string;
  sub?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-disp font-semibold text-[15px] m-0">{title}</h3>
          {sub && <p className="text-[12px] text-[var(--ink-faint)] m-0 mt-0.5">{sub}</p>}
        </div>
        {action && <div>{action}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

interface StageDraft {
  id: number;
  label: string;
  active: boolean;
  sortOrder: number;
  ownerRole: string;
  exitGateSummary: string;
  sopJson: string[];
  commsJson: string[];
}

interface StepDraft {
  id: number;
  stageId: number;
  stepNumber: string;
  label: string;
  hint: string;
  sortOrder: number;
  active: boolean;
  isGate: boolean;
  checkType: "date_field" | "boolean_field" | "doc_category" | "note_keyword" | "manual";
  checkTarget: string;
}

const COMMON_DATE_TARGETS = [
  { value: "fileSubmittedDate", label: "File Submitted Date" },
  { value: "preApprovalDate", label: "Pre-Approval Date" },
  { value: "valuationInitiatedDate", label: "Valuation Initiated Date" },
  { value: "inspectionDate", label: "Inspection Date" },
  { value: "valuationReportDate", label: "Valuation Report Received Date" },
  { value: "folConversionDate", label: "FOL Conversion Sent Date" },
  { value: "folDate", label: "FOL Verified Date" },
  { value: "folSignedDate", label: "FOL Signed Date" },
  { value: "liabilityLetterDate", label: "Liability Letter Received Date" },
  { value: "settlementDate", label: "Settlement / MC Date" },
  { value: "transferDate", label: "Transfer Appointment Date" },
  { value: "titleDeedDate", label: "Title Deed Issued Date" },
];

const COMMON_BOOLEAN_TARGETS = [
  { value: "waGroup", label: "WhatsApp Group Created (waGroup)" },
  { value: "ddaActive", label: "DDA Activated (ddaActive)" },
];

const COMMON_DOC_CATEGORIES = [
  { value: "KYC", label: "KYC Documents" },
  { value: "Income", label: "Income Documents" },
  { value: "Approval", label: "Approval Documents" },
  { value: "Property", label: "Property Documents" },
  { value: "Valuation", label: "Valuation Documents" },
  { value: "Transfer", label: "Transfer Documents" },
];

export function StagesManager() {
  const { stages, serviceLines, commTemplates, milestoneDates, hydrate, toast } = useHfmcStore();
  const [editingStage, setEditingStage] = useState<StageDraft | null>(null);
  const [creatingStage, setCreatingStage] = useState(false);
  const [deletingStage, setDeletingStage] = useState<StageItem | null>(null);

  const [expandedStageId, setExpandedStageId] = useState<number | null>(null);
  const [editingStep, setEditingStep] = useState<StepDraft | null>(null);
  const [creatingStepForStageId, setCreatingStepForStageId] = useState<number | null>(null);
  const [deletingStep, setDeletingStep] = useState<StageStep | null>(null);

  // Dynamic custom milestone dates (Method A)
  const [showNewDateModal, setShowNewDateModal] = useState(false);
  const [newDateLabel, setNewDateLabel] = useState("");
  const [newDateKey, setNewDateKey] = useState("");
  const [savingNewDate, setSavingNewDate] = useState(false);

  const customMilestones = useMemo(() => {
    return (milestoneDates ?? []).filter((m) => m.active).map((m) => {
      const parts = m.label.split("|");
      const label = parts[0].trim();
      const value = parts[1]?.trim() || (label.charAt(0).toLowerCase() + label.slice(1).replace(/[^a-zA-Z0-9]/g, "") + (label.toLowerCase().endsWith("date") ? "" : "Date"));
      return { id: m.id, label, value };
    });
  }, [milestoneDates]);

  const handleLabelChange = (val: string) => {
    setNewDateLabel(val);
    const clean = val.trim().replace(/[^a-zA-Z0-9\s]/g, "");
    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length > 0) {
      const camel = words.map((w, idx) => idx === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
      const withDate = camel.toLowerCase().endsWith("date") ? camel : `${camel}Date`;
      setNewDateKey(withDate);
    } else {
      setNewDateKey("");
    }
  };

  const saveNewMilestoneDate = async () => {
    if (!newDateLabel.trim() || !newDateKey.trim()) {
      toast("error", "Milestone label and field key are required.");
      return;
    }
    setSavingNewDate(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "master",
          masterKind: "milestoneDate",
          label: `${newDateLabel.trim()}|${newDateKey.trim()}`,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create milestone date");
      }
      await hydrate();
      if (editingStep) {
        setEditingStep({ ...editingStep, checkTarget: newDateKey.trim() });
      }
      toast("success", `Custom milestone "${newDateLabel.trim()}" created.`);
      setShowNewDateModal(false);
      setNewDateLabel("");
      setNewDateKey("");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSavingNewDate(false);
    }
  };

  const deleteCustomMilestone = async (id: number, label: string) => {
    try {
      const res = await fetch(`/api/admin?kind=master&id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete milestone");
      await hydrate();
      toast("success", `Milestone "${label}" removed.`);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Delete failed.");
    }
  };

  const [busy, setBusy] = useState(false);

  /* PHASE 5 — this editor is per service line. Before this it showed one flat
   * list, which meant "the workflow" was a single global thing: a stage added
   * for a golden visa would appear on every mortgage case, and nobody could tell
   * which journey a stage belonged to. Tabs make the scoping visible and make
   * the "coming soon" state a first-class thing an admin can fill in. */
  const activeLineList = serviceLines.filter((s) => s.active);
  const [lineTab, setLineTab] = useState<string>(() => activeLineList[0]?.code ?? "MORTGAGE");
  const currentLine = activeLineList.find((s) => s.code === lineTab) ?? activeLineList[0];

  // Phase 5: the set id for the tab being edited, so a new stage is filed under
  // the right service line. The admin editor resolves it from the stages already
  // on file rather than fetching sets separately — every set that matters has at
  // least one stage, except the reserved "coming soon" ones, which are resolved
  // by the API defaulting to the line's default set.
  const sortedStages = useMemo(
    () => stagesForServiceLine(stages, serviceLines, currentLine?.id).sort((a, b) => a.sortOrder - b.sortOrder),
    [stages, serviceLines, currentLine?.id],
  );

  const saveStage = async () => {
    if (!editingStage) return;
    if (!editingStage.label.trim()) {
      toast("error", "Stage label is required.");
      return;
    }
    setBusy(true);
    const body: Record<string, unknown> = {
      kind: "stage",
      label: editingStage.label.trim(),
      active: editingStage.active,
      sortOrder: editingStage.sortOrder,
      ownerRole: editingStage.ownerRole.trim(),
      exitGateSummary: editingStage.exitGateSummary.trim(),
      sopJson: JSON.stringify(editingStage.sopJson),
      commsJson: JSON.stringify(editingStage.commsJson),
      // Phase 5: the new stage belongs to the tab's service line. The set id is
      // resolved SERVER-side because a reserved "coming soon" line has a set but
      // no stages yet — so there is no stage on file to read a set id from, and
      // sending null there would block the very first stage of a new journey.
      serviceLineId: creatingStage ? (currentLine?.id ?? null) : undefined,
    };

    try {
      const res = await fetch("/api/admin", {
        method: creatingStage ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(creatingStage ? body : { ...body, id: editingStage.id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save stage");
      }
      await hydrate();
      toast("success", creatingStage ? `Stage "${editingStage.label}" created.` : "Stage updated.");
      setEditingStage(null);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const confirmDeleteStage = async () => {
    if (!deletingStage) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin?kind=stage&id=${deletingStage.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to delete stage");
      }
      await hydrate();
      toast("success", `"${deletingStage.label}" deleted.`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setBusy(false);
      setDeletingStage(null);
    }
  };

  const saveStep = async () => {
    if (!editingStep) return;
    if (!editingStep.label.trim()) {
      toast("error", "Step label is required.");
      return;
    }
    setBusy(true);
    const isNew = creatingStepForStageId !== null;
    const body: Record<string, unknown> = {
      kind: "stage_step",
      stageId: editingStep.stageId,
      stepNumber: editingStep.stepNumber.trim() || "1.0",
      label: editingStep.label.trim(),
      hint: editingStep.hint.trim(),
      sortOrder: editingStep.sortOrder,
      active: editingStep.active,
      isGate: editingStep.isGate,
      checkType: editingStep.checkType,
      checkTarget: editingStep.checkTarget.trim(),
    };

    try {
      const res = await fetch("/api/admin", {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isNew ? body : { ...body, id: editingStep.id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save step");
      }
      await hydrate();
      toast("success", isNew ? "Sub-step added." : "Sub-step updated.");
      setEditingStep(null);
      setCreatingStepForStageId(null);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const confirmDeleteStep = async () => {
    if (!deletingStep) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin?kind=stage_step&id=${deletingStep.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to delete sub-step");
      }
      await hydrate();
      toast("success", "Sub-step deleted.");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setBusy(false);
      setDeletingStep(null);
    }
  };

  const nextOrder = sortedStages.length ? sortedStages[sortedStages.length - 1].sortOrder + 1 : 1;

  const toggleCommTemplate = (templateId: string) => {
    if (!editingStage) return;
    const cur = editingStage.commsJson;
    const next = cur.includes(templateId)
      ? cur.filter((id) => id !== templateId)
      : [...cur, templateId];
    setEditingStage({ ...editingStage, commsJson: next });
  };

  return (
    <div className="space-y-4 anim-fade-up">
      {/* Per-service-line journey tabs (Phase 5). One flat stage list made "the
          workflow" a global thing — a stage written for a golden visa would show
          up on every mortgage case. */}
      <div className="flex gap-1.5 flex-wrap">
        {activeLineList.map((s) => {
          const n = stagesForServiceLine(stages, serviceLines, s.id).length;
          const on = currentLine?.code === s.code;
          return (
            <button key={s.id} className="chip transition-all" onClick={() => setLineTab(s.code)}
              style={on ? { background: "rgba(67,214,155,0.12)", borderColor: "var(--mint)", color: "var(--mint)" } : undefined}
              title={n === 0 ? `${s.name}: no stages yet — add the first one below` : `${s.name}: ${n} stage${n === 1 ? "" : "s"}`}>
              {s.shortName || s.name}
              {n === 0
                ? <span style={{ opacity: 0.7 }}> · coming soon</span>
                : <span style={{ opacity: 0.7 }}> · {n}</span>}
            </button>
          );
        })}
      </div>

      <div className="card p-4">
        <CardHeader
          title={`${currentLine?.name ?? "Workflow"} stages & case engine (${sortedStages.length})`}
          sub={sortedStages.length === 0
            ? "No stages written for this service yet. Add the first one to switch its journey on — until then cases are tracked by status only."
            : "Admin control of case journey: configure owners, communications, data/dates collected, procedures, and exit blockers."}
          action={
            <button
              className="btn btn-primary sm:btn-sm"
              onClick={() => {
                setEditingStage({
                  id: 0,
                  label: "",
                  active: true,
                  sortOrder: nextOrder,
                  ownerRole: "VRM / SPO",
                  exitGateSummary: "",
                  sopJson: [],
                  commsJson: [],
                });
                setCreatingStage(true);
              }}
            >
              <IPlus size={14} /> Add Stage
            </button>
          }
        />

        {sortedStages.length === 0 ? (
          <EmptyState
            icon={<ITrophy size={20} />}
            title={`${currentLine?.name ?? "This service"} — coming soon`}
            body="No workflow has been written for this service yet. Add its first stage below; cases will then run on their own journey instead of being tracked by status alone."
          />
        ) : (
          <div className="space-y-3 mt-4">
            {sortedStages.map((stage) => {
              const isExpanded = expandedStageId === stage.id;
              const steps = stage.steps ?? [];
              const gateCount = steps.filter((s) => s.isGate).length;

              return (
                <div
                  key={stage.id}
                  className="rounded-xl border transition-all"
                  style={{
                    background: stage.active ? "var(--bg2)" : "var(--bg)",
                    borderColor: isExpanded ? "var(--amber)" : "var(--line)",
                    opacity: stage.active ? 1 : 0.6,
                  }}
                >
                  <div className="p-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-7 h-7 rounded-lg bg-[var(--line)] grid place-items-center mono text-[12px] font-bold shrink-0">
                        {stage.sortOrder}
                      </span>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-disp font-semibold text-[15px] m-0">{stage.label}</h4>
                          <Chip tone={stage.active ? "mint" : "slate"}>
                            {stage.active ? "Active" : "Inactive"}
                          </Chip>
                          {stage.ownerRole && (
                            <Chip tone="sky">Owner: {stage.ownerRole}</Chip>
                          )}
                          <Chip tone={gateCount > 0 ? "coral" : "slate"}>
                            {steps.length} sub-steps · {gateCount} blocker{gateCount === 1 ? "" : "s"}
                          </Chip>
                        </div>
                        {stage.exitGateSummary && (
                          <p className="text-[12px] text-[var(--ink-dim)] m-0 mt-1 flex items-center gap-1.5">
                            <span className="text-[var(--amber)]">⚡ Blocker rule:</span>
                            <span>{stage.exitGateSummary}</span>
                          </p>
                        )}
                        {stage.commsJson && stage.commsJson.length > 0 && (
                          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                            <span className="mono text-[10.5px] text-[var(--ink-faint)]">Comms:</span>
                            {stage.commsJson.map((cid) => (
                              <span
                                key={cid}
                                className="mono text-[10.5px] px-1.5 py-0.5 rounded bg-[var(--line-soft)] text-[var(--ink-dim)]"
                              >
                                {cid}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setExpandedStageId(isExpanded ? null : stage.id)}
                      >
                        <ITasks size={13} />
                        {isExpanded ? "Hide Steps" : `Manage Steps (${steps.length})`}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setEditingStage({
                            id: stage.id,
                            label: stage.label,
                            active: stage.active,
                            sortOrder: stage.sortOrder,
                            ownerRole: stage.ownerRole || "",
                            exitGateSummary: stage.exitGateSummary || "",
                            sopJson: stage.sopJson || [],
                            commsJson: stage.commsJson || [],
                          });
                          setCreatingStage(false);
                        }}
                      >
                        <IPencil size={13} /> Edit
                      </button>
                      <button
                        className="btn btn-danger btn-sm !px-2"
                        onClick={() => setDeletingStage(stage)}
                        title="Delete stage"
                      >
                        <ITrash size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Expanded Sub-steps Section */}
                  {isExpanded && (
                    <div
                      className="p-4 pt-3 border-t bg-[var(--bg3)] rounded-b-xl space-y-3"
                      style={{ borderColor: "var(--line)" }}
                    >
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <h5 className="font-disp font-semibold text-[13px] m-0">
                            Sub-steps & Checklist for {stage.label}
                          </h5>
                          <p className="text-[11.5px] text-[var(--ink-faint)] m-0">
                            Items with ⭐ Blocker gate prevent advancing to the next stage unless satisfied or explicitly overridden.
                          </p>
                        </div>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => {
                            const lastStepOrder = steps.length
                              ? steps[steps.length - 1].sortOrder + 10
                              : 10;
                            const nextNum = `${stage.sortOrder}.${steps.length + 1}`;
                            setEditingStep({
                              id: 0,
                              stageId: stage.id,
                              stepNumber: nextNum,
                              label: "",
                              hint: "",
                              sortOrder: lastStepOrder,
                              active: true,
                              isGate: false,
                              checkType: "manual",
                              checkTarget: "",
                            });
                            setCreatingStepForStageId(stage.id);
                          }}
                        >
                          <IPlus size={13} /> Add Sub-Step
                        </button>
                      </div>

                      {steps.length === 0 ? (
                        <div className="text-center py-4 text-[12px] text-[var(--ink-faint)]">
                          No sub-steps configured yet. Click "Add Sub-Step" above to create checklist items and blockers.
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="tbl min-w-[700px]">
                            <thead>
                              <tr>
                                <th className="w-[60px]">Step</th>
                                <th>Checklist Label & Instructions</th>
                                <th>Check Type & Target</th>
                                <th className="w-[120px]">Blocker?</th>
                                <th className="text-right w-[100px]">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {steps.map((st) => (
                                <tr key={st.id}>
                                  <td className="mono text-[12px] font-semibold text-[var(--amber)]">
                                    {st.stepNumber}
                                  </td>
                                  <td>
                                    <div className="font-medium text-[13px]">{st.label}</div>
                                    {st.hint && (
                                      <div className="text-[11px] text-[var(--ink-faint)]">{st.hint}</div>
                                    )}
                                  </td>
                                  <td>
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="mono text-[10.5px] px-1.5 py-0.5 rounded bg-[var(--line)]">
                                        {st.checkType}
                                      </span>
                                      {st.checkTarget && (
                                        <span className="mono text-[10.5px] text-[var(--ink-dim)]">
                                          → {st.checkTarget}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td>
                                    {st.isGate ? (
                                      <Chip tone="coral">⭐ Exit Blocker</Chip>
                                    ) : (
                                      <Chip tone="slate">Standard</Chip>
                                    )}
                                  </td>
                                  <td className="text-right">
                                    <div className="inline-flex gap-1.5">
                                      <button
                                        className="btn btn-ghost btn-sm !px-2"
                                        onClick={() => {
                                          setEditingStep({ ...st });
                                          setCreatingStepForStageId(null);
                                        }}
                                        title="Edit sub-step"
                                      >
                                        <IPencil size={12} />
                                      </button>
                                      <button
                                        className="btn btn-danger btn-sm !px-2"
                                        onClick={() => setDeletingStep(st)}
                                        title="Delete sub-step"
                                      >
                                        <ITrash size={12} />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Stage Edit / Create Modal */}
      {editingStage && (
        <Modal
          title={creatingStage ? "Create Stage" : `Configure · ${editingStage.label}`}
          onClose={() => setEditingStage(null)}
          width={560}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setEditingStage(null)} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveStage} disabled={busy}>
                <ICheck size={15} /> Save Stage
              </button>
            </>
          }
        >
          <div className="space-y-3.5">
            <div>
              <label className="label">Stage Label</label>
              <input
                className="input"
                placeholder="e.g. Valuation, FOL + Loan Booking"
                value={editingStage.label}
                onChange={(e) => setEditingStage({ ...editingStage, label: e.target.value })}
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Sort Order</label>
                <input
                  className="input mono"
                  type="number"
                  min={0}
                  value={editingStage.sortOrder}
                  onChange={(e) =>
                    setEditingStage({ ...editingStage, sortOrder: Number(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className="label">Owner Role</label>
                <input
                  className="input"
                  placeholder="e.g. SPO + Bank RM"
                  value={editingStage.ownerRole}
                  onChange={(e) => setEditingStage({ ...editingStage, ownerRole: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="label">Exit Gate / Blocker Rule Summary</label>
              <input
                className="input"
                placeholder="e.g. preApprovalDate + preApprovalAmount present"
                value={editingStage.exitGateSummary}
                onChange={(e) =>
                  setEditingStage({ ...editingStage, exitGateSummary: e.target.value })
                }
              />
              <p className="text-[10.5px] text-[var(--ink-faint)] m-0 mt-1">
                Short one-line blocker summary displayed on the Move Stage CTA when preconditions are not met.
              </p>
            </div>

            <div>
              <label className="label">Available Communication Templates</label>
              <div className="flex flex-wrap gap-1.5 p-2 rounded-lg bg-[var(--bg3)] border border-[var(--line)] max-h-36 overflow-y-auto">
                {commTemplates.map((t) => {
                  const sel = editingStage.commsJson.includes(t.key);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleCommTemplate(t.key)}
                      className="chip text-[11px] transition-all"
                      style={
                        sel
                          ? { background: "rgba(67,214,155,0.15)", borderColor: "var(--mint)", color: "var(--mint)" }
                          : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-dim)" }
                      }
                    >
                      {sel ? "✓ " : "+ "}
                      {t.name} ({t.channel})
                    </button>
                  );
                })}
              </div>
              <p className="text-[10.5px] text-[var(--ink-faint)] m-0 mt-1">
                Picked communication templates appear as 1-click WhatsApp/Email buttons inside this stage's drawer.
              </p>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="stage-active-toggle"
                checked={editingStage.active}
                onChange={(e) => setEditingStage({ ...editingStage, active: e.target.checked })}
              />
              <label htmlFor="stage-active-toggle" className="text-[12.5px] text-[var(--ink-dim)] m-0">
                Active — visible in Case 360 journey and stage picker
              </label>
            </div>
          </div>
        </Modal>
      )}

      {/* Sub-step Edit / Create Modal */}
      {editingStep && (
        <Modal
          title={creatingStepForStageId !== null ? "Add Sub-Step" : `Edit Sub-Step · ${editingStep.stepNumber}`}
          onClose={() => {
            setEditingStep(null);
            setCreatingStepForStageId(null);
          }}
          width={520}
          footer={
            <>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setEditingStep(null);
                  setCreatingStepForStageId(null);
                }}
                disabled={busy}
              >
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveStep} disabled={busy}>
                <ICheck size={15} /> Save Sub-Step
              </button>
            </>
          }
        >
          <div className="space-y-3.5">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">Step Number</label>
                <input
                  className="input mono"
                  placeholder="e.g. 2.1"
                  value={editingStep.stepNumber}
                  onChange={(e) => setEditingStep({ ...editingStep, stepNumber: e.target.value })}
                  autoFocus
                />
              </div>
              <div className="col-span-2">
                <label className="label">Sort Order</label>
                <input
                  className="input mono"
                  type="number"
                  value={editingStep.sortOrder}
                  onChange={(e) =>
                    setEditingStep({ ...editingStep, sortOrder: Number(e.target.value) || 0 })
                  }
                />
              </div>
            </div>

            <div>
              <label className="label">Step Action Label</label>
              <input
                className="input"
                placeholder="e.g. Valuation initiated with bank valuer"
                value={editingStep.label}
                onChange={(e) => setEditingStep({ ...editingStep, label: e.target.value })}
              />
            </div>

            <div>
              <label className="label">Staff Hint / Guidance</label>
              <input
                className="input"
                placeholder="e.g. Fee confirmation received; inspection slot booked"
                value={editingStep.hint}
                onChange={(e) => setEditingStep({ ...editingStep, hint: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Check Type</label>
                <select
                  className="input"
                  value={editingStep.checkType}
                  onChange={(e) => {
                    const ct = e.target.value as StepDraft["checkType"];
                    setEditingStep({ ...editingStep, checkType: ct });
                  }}
                >
                  <option value="manual">Manual Staff Check</option>
                  <option value="date_field">Date Field on Case</option>
                  <option value="boolean_field">Boolean Field on Case</option>
                  <option value="doc_category">Document Category Verified</option>
                  <option value="note_keyword">Daily Note Keyword Sniff</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="label m-0">Check Target</label>
                  {editingStep.checkType === "date_field" && (
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-[var(--gold)] hover:underline flex items-center gap-1 cursor-pointer bg-transparent border-0 p-0"
                      onClick={() => setShowNewDateModal(true)}
                    >
                      <IPlus size={11} /> New Milestone Date
                    </button>
                  )}
                </div>
                {editingStep.checkType === "date_field" ? (
                  <select
                    className="input"
                    value={editingStep.checkTarget}
                    onChange={(e) => setEditingStep({ ...editingStep, checkTarget: e.target.value })}
                  >
                    <option value="">— Select Target Date Field —</option>
                    <optgroup label="Standard Mortgage Milestones">
                      {COMMON_DATE_TARGETS.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label} ({t.value})
                        </option>
                      ))}
                    </optgroup>
                    {customMilestones.length > 0 && (
                      <optgroup label="Custom Admin Milestones">
                        {customMilestones.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label} ({t.value})
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                ) : editingStep.checkType === "boolean_field" ? (
                  <select
                    className="input"
                    value={editingStep.checkTarget}
                    onChange={(e) => setEditingStep({ ...editingStep, checkTarget: e.target.value })}
                  >
                    <option value="">— Select Boolean Field —</option>
                    {COMMON_BOOLEAN_TARGETS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                ) : editingStep.checkType === "doc_category" ? (
                  <select
                    className="input"
                    value={editingStep.checkTarget}
                    onChange={(e) => setEditingStep({ ...editingStep, checkTarget: e.target.value })}
                  >
                    <option value="">— Select Document Category —</option>
                    {COMMON_DOC_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="input mono"
                    placeholder="Field name or keyword regex"
                    value={editingStep.checkTarget}
                    onChange={(e) => setEditingStep({ ...editingStep, checkTarget: e.target.value })}
                  />
                )}
              </div>
            </div>

            <div className="p-3 rounded-lg border border-[var(--line)] bg-[var(--bg2)] space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="step-isgate-toggle"
                  checked={editingStep.isGate}
                  onChange={(e) => setEditingStep({ ...editingStep, isGate: e.target.checked })}
                />
                <label htmlFor="step-isgate-toggle" className="text-[12.5px] font-semibold text-[var(--coral)] m-0">
                  ⭐ Is Exit Blocker (Prevents stage advance)
                </label>
              </div>
              <p className="text-[11px] text-[var(--ink-faint)] m-0">
                When enabled, the file cannot move to the next stage unless this check passes or an explicit override reason is provided.
              </p>
            </div>
          </div>
        </Modal>
      )}

      {/* Stage Delete Confirmation */}
      <ConfirmModal
        open={!!deletingStage}
        onClose={() => setDeletingStage(null)}
        onConfirm={confirmDeleteStage}
        title={`Delete "${deletingStage?.label ?? ""}"?`}
        body="Cases currently in this stage keep their label, but it will no longer appear in pipeline journeys."
        confirmLabel="Delete Stage"
      />

      {/* Step Delete Confirmation */}
      <ConfirmModal
        open={!!deletingStep}
        onClose={() => setDeletingStep(null)}
        onConfirm={confirmDeleteStep}
        title={`Delete sub-step "${deletingStep?.stepNumber ?? ""} - ${deletingStep?.label ?? ""}"?`}
        body="This sub-step and its exit blocker check will be removed."
        confirmLabel="Delete Sub-Step"
      />

      {/* Dynamic Milestone Date Creator Modal (Method A) */}
      {showNewDateModal && (
        <Modal
          onClose={() => setShowNewDateModal(false)}
          title="Define Custom Milestone Date (Method A)"
          sub="Add a new milestone date field. It becomes available across all stages and automatically displays in the Case 360 Stage Drawer."
          footer={
            <div className="flex items-center justify-between w-full">
              <span className="text-[11px] text-[var(--ink-faint)]">
                Field will be named <code>{newDateKey || "..."}</code> on cases.
              </span>
              <div className="flex items-center gap-2">
                <button
                  className="btn btn-ghost sm:btn-sm"
                  onClick={() => setShowNewDateModal(false)}
                  disabled={savingNewDate}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary sm:btn-sm"
                  onClick={saveNewMilestoneDate}
                  disabled={savingNewDate || !newDateLabel.trim() || !newDateKey.trim()}
                >
                  {savingNewDate ? "Saving..." : "Create & Select Milestone"}
                </button>
              </div>
            </div>
          }
        >
          <div className="space-y-3.5">
            <div>
              <label className="label">Milestone Display Label *</label>
              <input
                className="input"
                placeholder="e.g. Developer NOC Received"
                value={newDateLabel}
                onChange={(e) => handleLabelChange(e.target.value)}
                autoFocus
              />
              <p className="text-[11px] text-[var(--ink-faint)] m-0 mt-1">
                The human-friendly name shown to staff and on checklists.
              </p>
            </div>

            <div>
              <label className="label">Database Field Key * (camelCase)</label>
              <input
                className="input mono"
                placeholder="e.g. developerNocDate"
                value={newDateKey}
                onChange={(e) => setNewDateKey(e.target.value.trim())}
              />
              <p className="text-[11px] text-[var(--ink-faint)] m-0 mt-1">
                Unique identifier used on cases. Recommended to end with <code>Date</code>.
              </p>
            </div>

            {customMilestones.length > 0 && (
              <div className="mt-4 pt-3 border-t border-[var(--line)]">
                <h5 className="font-disp font-semibold text-[12px] m-0 mb-2 text-[var(--ink-dim)]">
                  Existing Custom Milestones ({customMilestones.length})
                </h5>
                <div className="flex flex-wrap gap-1.5">
                  {customMilestones.map((m) => (
                    <span
                      key={m.id}
                      className="chip text-[11px] flex items-center gap-1.5 bg-[var(--bg2)] border-[var(--line)]"
                    >
                      <span>{m.label} (<code>{m.value}</code>)</span>
                      <button
                        type="button"
                        className="text-[var(--coral)] hover:opacity-80 p-0 bg-transparent border-0 cursor-pointer text-[12px]"
                        title={`Delete ${m.label}`}
                        onClick={() => deleteCustomMilestone(m.id, m.label)}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
