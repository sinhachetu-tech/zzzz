"use client";

/* Stage field capture — the date/DDA/boolean fields the drawer's checks read.
   Supports both admin-defined dynamic steps and legacy hardcoded dates.
   Persists straight through case PATCH, so no second save path exists. */
import { useMemo, useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { LoanCase, StageItem } from "@/lib/types";
import type { StageKey } from "@/lib/workflow/types";
import { ICheck } from "@/components/icons";

type DateField =
  | "valuationInitiatedDate" | "inspectionDate" | "valuationReportDate"
  | "folConversionDate" | "folSignedDate"
  | "liabilityLetterDate" | "settlementDate" | "transferDate" | "titleDeedDate"
  | "fileSubmittedDate" | "preApprovalDate";

const LEGACY_FIELDS: Record<string, { field: string; label: string }[]> = {
  doc: [],
  pre: [
    { field: "fileSubmittedDate", label: "2.1 File submitted date" },
    { field: "preApprovalDate", label: "2.3 Pre-approval date" },
  ],
  val: [
    { field: "valuationInitiatedDate", label: "3.1 Valuation initiated" },
    { field: "inspectionDate", label: "3.2 Inspection date" },
    { field: "valuationReportDate", label: "3.3 Report received" },
  ],
  fol: [
    { field: "folConversionDate", label: "4.1 FOL conversion sent (before signing)" },
    { field: "folSignedDate", label: "4.4 FOL signed" },
  ],
  transfer: [
    { field: "liabilityLetterDate", label: "Liability letter received" },
    { field: "settlementDate", label: "Settlement / MC executed" },
    { field: "transferDate", label: "Transfer appointment" },
    { field: "titleDeedDate", label: "Title Deed issued / QC" },
  ],
};

export function StageFields({
  c,
  stageKey,
  stageItem,
  conversionMissing,
}: {
  c: LoanCase;
  stageKey: StageKey | string;
  stageItem?: StageItem | null;
  conversionMissing: boolean;
}) {
  const { updateCase, toast } = useHfmcStore();
  const [busy, setBusy] = useState(false);

  // Extract dynamic date and boolean fields from stageItem steps if available.
  // Two steps can target the same LoanCase column (e.g. both "settlementDate"), so
  // dedupe by field — one input per column — and key on the step id, not the field.
  const dateFields = useMemo(() => {
    if (stageItem?.steps && stageItem.steps.length > 0) {
      const seen = new Set<string>();
      const dynamic = stageItem.steps
        .filter((s) => s.checkType === "date_field" && s.checkTarget)
        .filter((s) => {
          if (seen.has(s.checkTarget)) return false;
          seen.add(s.checkTarget);
          return true;
        })
        .map((s) => ({
          key: `step-${s.id}`,
          field: s.checkTarget,
          label: `${s.stepNumber} ${s.label}`,
        }));
      if (dynamic.length > 0) return dynamic;
    }
    return (LEGACY_FIELDS[stageKey] ?? []).map((f) => ({
      key: `legacy-${f.field}`,
      field: f.field,
      label: f.label,
    }));
  }, [stageItem, stageKey]);

  const hasDda = stageKey === "fol" || stageItem?.steps?.some((s) => s.checkTarget === "ddaActive");

  const save = async (patch: Record<string, unknown>, label: string) => {
    setBusy(true);
    try {
      await updateCase(c.id, patch);
      toast("success", `${label} saved.`);
    } catch {
      /* store already toasts API errors */
    }
    setBusy(false);
  };

  return (
    <div className="card p-4 space-y-3">
      <h4 className="font-disp font-semibold text-[13px] m-0">Stage data & dates (drive the ticks)</h4>
      {dateFields.length === 0 && !hasDda && (
        <p className="text-[12px] text-[var(--ink-faint)] m-0">
          This stage has no date capture — document and task state drive it.
        </p>
      )}
      {dateFields.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {dateFields.map((f) => {
            const disabled = f.field === "folSignedDate" && conversionMissing;
            const stageData = ((c as unknown as { stageDataJson?: Record<string, unknown> }).stageDataJson ?? {}) as Record<string, unknown>;
            const currentVal = (((c as unknown as Record<string, unknown>)[f.field] as string | null) ?? (stageData[f.field] as string | null)) ?? "";
            return (
              <div key={f.key}>
                <label className="label">{f.label}</label>
                <input
                  type="date"
                  className="input mono !py-[6px]"
                  disabled={disabled || busy}
                  value={currentVal}
                  onChange={(e) => save({ [f.field]: e.target.value }, f.label)}
                />
                {disabled && (
                  <p className="text-[10.5px] m-0 mt-1" style={{ color: "var(--coral)" }}>
                    Locked — record 4.1 conversion first.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
      {hasDda && (
        <button
          type="button"
          className="chip transition-all"
          disabled={busy}
          onClick={() => save({ ddaActive: !c.ddaActive }, c.ddaActive ? "DDA cleared" : "DDA activated")}
          style={
            c.ddaActive
              ? { background: "rgba(67,214,155,0.12)", borderColor: "var(--mint)", color: "var(--mint)" }
              : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-dim)" }
          }
        >
          {c.ddaActive ? <><ICheck size={12} /> DDA activated</> : "Mark DDA activated"}
        </button>
      )}
    </div>
  );
}

export { LEGACY_FIELDS as STAGE_DATE_FIELDS };
export type { DateField as StageDateField };
