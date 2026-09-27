// Stage 3 — Valuation. Entry absorbs old "Property Identification" + "MOU"
// (MOU only — FARD is not in the SOP and the word is retired).
import type { StageDef } from "../types";

export const ValStage: StageDef = {
  key: "val",
  title: "Valuation",
  short: "Valuation",
  owner: "SPO (Valuation) + Bank RM + Valuer",
  sop: [
    "stage-2-valuation-inspection-account-opening-sop",
    "valuation-stage-document-matrix",
    "bank-specific-valuation-initiation-formats-email-templates",
    "dib-bank-valuation-format",
    "adib-bank-valuation-format",
    "cbd-bank-valuation-format",
    "rak-bank-valuation-format",
    "mashreq-bank-valuation-format",
    "enbd-bank-valuation-format",
    "general-valuation-rules-desktop-vs-physical-report-scenarios",
    "inspection-process-follow-up",
    "valuation-report-review-account-opening",
    "mandatory-update-post-valuation-report-sharing-protocol-per-meeting-dated-13-08-2026",
  ],
  subSteps: [
    { id: "3.0", label: "Entry ready: property identified + MOU signed (co-applicant names match)", check: "mouReady" },
    { id: "3.1", label: "Initiated per bank template (property docs + payment proof sent, client CC)", check: "valInitiated" },
    { id: "3.2", label: "Inspection scheduled + coordinated", check: "inspected" },
    { id: "3.3", label: "Report received + positive; shared with Real Estate per 13-Aug-2026 protocol", check: "valReport", gate: true },
    { id: "3.4", label: "FOL conversion triggered", check: "folConversionSent" },
  ],
  exitGate: {
    summary: "Valuation report verified",
    checks: ["valReport"],
  },
  comms: ["em-val-request", "wa-inspection-slot", "wa-val-report-shared"],
  docCategories: ["Property", "Valuation"],
};
