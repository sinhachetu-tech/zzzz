// Stage 2 — Pre-Approval. Absorbs old "Bank Submission" as sub-step 2.1.
import type { StageDef } from "../types";

export const PreStage: StageDef = {
  key: "pre",
  title: "Pre-Approval",
  short: "Pre-Approval",
  owner: "SPO + Bank RM",
  sop: [
    "comprehensive-cross-bank-pre-approval-submission-matrix",
    "submission-procedures-routing-email-templates",
    "huspy-portal-submission-salaried-cases",
    "huspy-portal-submission-process-salaried-cases",
    "adib-submission-format-email-to-rami-jrab",
    "nbf-submission-format-email-to-harendra",
    "other-bank-routing",
    "follow-up-protocol-post-approval-actions",
    "bank-specific-pre-approval-rules-fee-breakdown-matrix",
  ],
  subSteps: [
    { id: "2.1", label: "File submitted (Direct routing or Huspy per bank matrix)", check: "submitted" },
    { id: "2.2", label: "Follow-up TAT: Day 1 received → Day 2 reviewed → Day 3 credit → Day 5 queries/date (Friday rule)", check: "followedUp" },
    { id: "2.3", label: "Pre-approval captured: date + amount + tenor + ROI", check: "preCaptured", gate: true },
    { id: "2.4", label: "Next executive notified to initiate Valuation", check: "handedToValuation" },
  ],
  exitGate: {
    summary: "preApprovalDate + preApprovalAmount present",
    checks: ["preCaptured"],
  },
  comms: ["em-bank-submit-routing", "wa-bank-query-chase", "wa-pre-approved-client"],
  docCategories: ["KYC", "Income", "Bank & Liabilities"],
};
