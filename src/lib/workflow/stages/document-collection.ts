// Stage 1 — Document Collection.
// Sub-step 1.0 absorbs the old "WhatsApp Group Creation" stage.
import type { StageDef } from "../types";

export const DocStage: StageDef = {
  key: "doc",
  title: "Document Collection",
  short: "Docs",
  owner: "VRM → SPO checker",
  sop: [
    "stage-1-pre-approval-sop",
    "exhaustive-document-verification-matrix",
    "pre-approval-team-checklist-red-flags",
    "kyc-document-requirements-by-nationality-residency",
    "income-document-requirements-by-employment-type",
    "property-document-requirements-pre-approval-valuation",
  ],
  subSteps: [
    { id: "1.0", label: "WhatsApp group created + link saved", hint: "waGroup present; client greeted; transaction type asked", check: "waGroup" },
    { id: "1.1", label: "KYC verified (EID / Passport / Visa per residency)", check: "kycDocs" },
    { id: "1.2", label: "Income verified (Salaried: salary cert ≤30d + 6-mo statements + payslip + AECB; Self-Employed matrix)", check: "incomeDocs" },
    { id: "1.3", label: "Transaction docs identified (Primary / Resale / Buyout per transactionType)", check: "txnDocs" },
    { id: "1.4", label: "Submission-ready: DBR < 50%, red-flags cleared", check: "readyToSubmit", gate: true },
  ],
  exitGate: {
    summary: "No blocked mandatory docs + profile complete",
    checks: ["noBlockedMandatory", "profileComplete"],
  },
  comms: ["wa-group-invite", "wa-doc-list", "wa-nudge-missing-docs"],
  docCategories: ["KYC", "Income", "Property"],
};
