"use client";

/* Stage field capture — the date/DDA fields the drawer's checks read first
   (valuation → FOL conversion → signing → DDA → settlement → title deed).
   The FOL rule lives here AND in the API: signing before conversion is blocked.
   Persists straight through case PATCH, so no second save path exists. */
import { useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { LoanCase } from "@/lib/types";
import type { StageKey } from "@/lib/workflow/types";
import { ICheck } from "@/components/icons";

type DateField =
  | "valuationInitiatedDate" | "inspectionDate" | "valuationReportDate"
  | "folConversionDate" | "folSignedDate"
  | "liabilityLetterDate" | "settlementDate" | "transferDate" | "titleDeedDate";

const FIELDS: Record<StageKey, { field: DateField; label: string }[]> = {
  doc: [],
  pre: [],
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

export function StageFields({ c, stageKey, conversionMissing }: {
  c: LoanCase;
  stageKey: StageKey;
  conversionMissing: boolean;
}) {
  const { updateCase, toast } = useHfmcStore();
  const [busy, setBusy] = useState(false);
  const fields = FIELDS[stageKey];
  if (stageKey === "fol" || stageKey === "val" || stageKey === "transfer") {
    // handled below
  }

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
      <h4 className="font-disp font-semibold text-[13px] m-0">Stage dates (drive the ticks)</h4>
      {fields.length === 0 && (
        <p className="text-[12px] text-[var(--ink-faint)] m-0">
          This stage has no date capture — document and task state drive it.
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {fields.map((f) => {
          const disabled = f.field === "folSignedDate" && conversionMissing;
          return (
            <div key={f.field}>
              <label className="label">{f.label}</label>
              <input
                type="date"
                className="input mono !py-[6px]"
                disabled={disabled || busy}
                value={(c[f.field] as string | null) ?? ""}
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
      {stageKey === "fol" && (
        <button
          className="chip transition-all"
          disabled={busy}
          onClick={() => save({ ddaActive: !c.ddaActive }, c.ddaActive ? "DDA cleared" : "DDA activated")}
          style={c.ddaActive
            ? { background: "rgba(67,214,155,0.12)", borderColor: "var(--mint)", color: "var(--mint)" }
            : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-dim)" }}
        >
          {c.ddaActive ? <><ICheck size={12} /> DDA activated (4.5)</> : "Mark DDA activated (4.5)"}
        </button>
      )}
    </div>
  );
}

export { FIELDS as STAGE_DATE_FIELDS };
export type { DateField as StageDateField };
