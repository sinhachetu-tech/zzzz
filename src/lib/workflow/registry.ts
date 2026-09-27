// Journey registry — the single place that knows "5 stages in this order".
import type { StageDef, StageKey } from "./types";
import { DocStage } from "./stages/document-collection";
import { PreStage } from "./stages/pre-approval";
import { ValStage } from "./stages/valuation";
import { FolStage } from "./stages/fol-booking";
import { TransferStage } from "./stages/transfer";

export const JOURNEY: StageDef[] = [DocStage, PreStage, ValStage, FolStage, TransferStage];

export const STAGE_BY_KEY: Record<StageKey, StageDef> = {
  doc: DocStage,
  pre: PreStage,
  val: ValStage,
  fol: FolStage,
  transfer: TransferStage,
};

/** DB label (current 5) → stable key. Keep in sync with stages.json. */
export const LABEL_TO_KEY: Record<string, StageKey> = {
  "Document Collection": "doc",
  "Pre-Approval": "pre",
  Valuation: "val",
  "FOL + Loan Booking": "fol",
  "Transfer + Disbursal": "transfer",
};

/**
 * Old 10-stage labels → where the case now lives.
 * Read-only mapping: history is preserved, the drawer shows the new home.
 * NOTE: "MOU / FARD" reads as MOU only — FARD is not in the SOP.
 */
export const LEGACY_MAP: Record<string, StageKey> = {
  Lead: "doc",
  "WhatsApp Group Creation": "doc",
  "Document Collection": "doc",
  "Pre-Approval": "pre",
  "Bank Submission": "pre",
  "Property Identification": "val",
  "MOU / FARD": "val",
  MOU: "val",
  Valuation: "val",
  "Final Approval": "fol",
  Disbursement: "transfer",
};

/** Any stored label (current, legacy, or bare "MOU") → stable key. */
export function stageKeyOf(label: string | null | undefined): StageKey {
  if (!label) return "doc";
  return LABEL_TO_KEY[label] ?? LEGACY_MAP[label] ?? "doc";
}

/** Index of a case's stage on the 5-card journey (for ✓ / current / upcoming). */
export function journeyIndexOf(label: string | null | undefined): number {
  const order: StageKey[] = ["doc", "pre", "val", "fol", "transfer"];
  return order.indexOf(stageKeyOf(label));
}
