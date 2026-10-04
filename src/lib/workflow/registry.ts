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

/* ---------------------------------------------------------------------------
 * PER-SERVICE-LINE JOURNEYS (Phase 5)
 *
 * WHY THIS EXISTS. Every journey above is mortgage vocabulary. A golden visa has
 * no valuation, no FOL and no transfer; a will has neither. Before this, a case
 * of ANY service had to walk the mortgage pipeline, because StageItem was global
 * and these five stages were the only ones the code knew about.
 *
 * THE HONEST STATE OF THE BUSINESS, stated in code. Mortgage is the only line
 * whose process is actually written down, so it is the only line with code-backed
 * behaviour. The other five lines have a StageSet reserved for them but no stages
 * — and `isJourneyConfigured` returns false for them, which is what makes the UI
 * say "coming soon" instead of inventing a plausible-looking pipeline nobody has
 * agreed to. Inventing those stages would be worse than leaving them blank: staff
 * would follow a workflow the firm never approved.
 *
 * To bring a line live: add its stages to its StageSet in Admin → Workflow →
 * Stages, then flip `CODE_BACKED_LINES` below if it needs the drawer behaviour.
 * ------------------------------------------------------------------------- */

/** Lines whose journey has real code-backed behaviour (the drawer, gates, SOP). */
const CODE_BACKED_LINES = new Set(["MORTGAGE"]);

/**
 * Does this service line have a usable journey yet?
 *
 * False means "coming soon", and the UI must say so rather than falling back to
 * the mortgage rail — showing a valuation stage on a will would be a lie.
 */
export function isJourneyConfigured(
  serviceLineCode: string | null | undefined,
  stageCount: number,
): boolean {
  if (!serviceLineCode) return false;
  return CODE_BACKED_LINES.has(serviceLineCode) || stageCount > 0;
}

/**
 * The code-backed journey for a line, or null when the line has none yet.
 * Only mortgage has one today; `null` is the honest answer for the rest.
 */
export function journeyFor(serviceLineCode: string | null | undefined): StageDef[] | null {
  if (!serviceLineCode) return null;
  return CODE_BACKED_LINES.has(serviceLineCode) ? JOURNEY : null;
}

/**
 * The active stages belonging to one service line, in order.
 *
 * THE SCOPING RULE, in one place. A StageItem carries no serviceLineId of its own
 * — the StageSet does — so every caller that needs "this line's stages" has to
 * resolve through here. Duplicating that join in each component is exactly how a
 * golden-visa case ends up rendering "Valuation": one copy forgot the filter.
 *
 * A stage with no resolvable line is treated as MORTGAGE, because every stage that
 * predates StageSet is mortgage. A case with no line is also treated as MORTGAGE
 * for the same reason — and because that is what the app did before Phase 5, so
 * it keeps every existing case rendering exactly as it did.
 */
export function stagesForServiceLine<T extends { serviceLineId?: number | null; active: boolean; sortOrder: number }>(
  stages: T[],
  serviceLines: { id: number; code: string }[],
  serviceLineId: number | null | undefined,
): T[] {
  const codeOf = (id: number | null | undefined) =>
    serviceLines.find((l) => l.id === id)?.code ?? "MORTGAGE";
  const want = codeOf(serviceLineId);
  return stages
    .filter((s) => codeOf(s.serviceLineId ?? null) === want)
    .filter((s) => s.active)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}
