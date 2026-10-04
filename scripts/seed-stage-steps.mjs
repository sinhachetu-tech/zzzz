// scripts/seed-stage-steps.mjs
// One-off: seeds Stage sub-steps from the hardcoded stages/*.ts definitions into DB.
// Uses postgres.js directly (Prisma engine DLL locked by dev server).
// Idempotent — updates stage fields always, skips step creation if already seeded.
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();


const STAGE_DEFS = [
  {
    label: "Document Collection",
    ownerRole: "VRM \u2192 SPO checker",
    exitGateSummary: "No blocked mandatory docs + profile complete",
    sopJson: [
      "stage-1-pre-approval-sop",
      "exhaustive-document-verification-matrix",
      "pre-approval-team-checklist-red-flags",
      "kyc-document-requirements-by-nationality-residency",
      "income-document-requirements-by-employment-type",
      "property-document-requirements-pre-approval-valuation",
    ],
    commsJson: ["wa-group-invite", "wa-doc-list", "wa-nudge-missing-docs"],
    steps: [
      { stepNumber: "1.0", label: "WhatsApp group created + link saved", hint: "waGroup present; client greeted; transaction type asked", isGate: false, checkType: "boolean_field", checkTarget: "waGroup", sortOrder: 10 },
      { stepNumber: "1.1", label: "KYC verified (EID / Passport / Visa per residency)", hint: "", isGate: false, checkType: "doc_category", checkTarget: "KYC", sortOrder: 20 },
      { stepNumber: "1.2", label: "Income verified (Salaried: salary cert 30d + 6-mo statements + payslip + AECB; Self-Employed matrix)", hint: "", isGate: false, checkType: "doc_category", checkTarget: "Income", sortOrder: 30 },
      { stepNumber: "1.3", label: "Transaction docs identified (Primary / Resale / Buyout per transactionType)", hint: "", isGate: false, checkType: "date_field", checkTarget: "transactionType", sortOrder: 40 },
      { stepNumber: "1.4", label: "Submission-ready: DBR < 50%, red-flags cleared", hint: "", isGate: true, checkType: "manual", checkTarget: "", sortOrder: 50 },
    ],
  },
  {
    label: "Pre-Approval",
    ownerRole: "SPO + Bank RM",
    exitGateSummary: "preApprovalDate + preApprovalAmount present",
    sopJson: [
      "comprehensive-cross-bank-pre-approval-submission-matrix",
      "submission-procedures-routing-email-templates",
      "huspy-portal-submission-salaried-cases",
      "adib-submission-format-email-to-rami-jrab",
      "nbf-submission-format-email-to-harendra",
      "other-bank-routing",
      "follow-up-protocol-post-approval-actions",
      "bank-specific-pre-approval-rules-fee-breakdown-matrix",
    ],
    commsJson: ["em-bank-submit-routing", "wa-bank-query-chase", "wa-pre-approved-client"],
    steps: [
      { stepNumber: "2.1", label: "File submitted (Direct routing or Huspy per bank matrix)", hint: "", isGate: false, checkType: "date_field", checkTarget: "fileSubmittedDate", sortOrder: 10 },
      { stepNumber: "2.2", label: "Follow-up TAT: Day 1 received Day 2 reviewed Day 3 credit Day 5 queries/date (Friday rule)", hint: "", isGate: false, checkType: "manual", checkTarget: "", sortOrder: 20 },
      { stepNumber: "2.3", label: "Pre-approval captured: date + amount + tenor + ROI", hint: "", isGate: true, checkType: "date_field", checkTarget: "preApprovalDate", sortOrder: 30 },
      { stepNumber: "2.4", label: "Next executive notified to initiate Valuation", hint: "", isGate: false, checkType: "manual", checkTarget: "", sortOrder: 40 },
    ],
  },
  {
    label: "Valuation",
    ownerRole: "SPO (Valuation) + Bank RM + Valuer",
    exitGateSummary: "Valuation report verified",
    sopJson: [
      "stage-2-valuation-inspection-account-opening-sop",
      "valuation-stage-document-matrix",
      "bank-specific-valuation-initiation-formats-email-templates",
      "general-valuation-rules-desktop-vs-physical-report-scenarios",
      "inspection-process-follow-up",
      "valuation-report-review-account-opening",
      "mandatory-update-post-valuation-report-sharing-protocol-per-meeting-dated-13-08-2026",
    ],
    commsJson: ["em-val-request", "wa-inspection-slot", "wa-val-report-shared"],
    steps: [
      { stepNumber: "3.0", label: "Entry ready: property identified + MOU signed (co-applicant names match)", hint: "", isGate: false, checkType: "manual", checkTarget: "", sortOrder: 10 },
      { stepNumber: "3.1", label: "Initiated per bank template (property docs + payment proof sent, client CC)", hint: "", isGate: false, checkType: "date_field", checkTarget: "valuationInitiatedDate", sortOrder: 20 },
      { stepNumber: "3.2", label: "Inspection scheduled + coordinated", hint: "", isGate: false, checkType: "date_field", checkTarget: "inspectionDate", sortOrder: 30 },
      { stepNumber: "3.3", label: "Report received + positive; shared with Real Estate per 13-Aug-2026 protocol", hint: "", isGate: true, checkType: "date_field", checkTarget: "valuationReportDate", sortOrder: 40 },
      { stepNumber: "3.4", label: "FOL conversion triggered", hint: "", isGate: false, checkType: "date_field", checkTarget: "folConversionDate", sortOrder: 50 },
    ],
  },
  {
    label: "FOL + Loan Booking",
    ownerRole: "SPO (FOL) + Bank RM",
    exitGateSummary: "Loan booked (signing + DDA)",
    sopJson: [
      "general-fol-conversion-verification-procedure",
      "comprehensive-fol-loan-booking-document-matrix",
      "specific-document-checklists-cbd-dib",
      "liabilities-settlement-clearances-soa-updates",
      "power-of-attorney-poa-developer-noc",
      "dib-salary-transfer-letter-stl-format",
    ],
    commsJson: ["em-fol-conversion", "call-fol-client-script", "wa-signing-slot", "wa-dda-activation"],
    steps: [
      { stepNumber: "4.1", label: "FOL conversion filled + sent (amount / tenor / ROI / EMI / insurance confirmed via VRM)", hint: "Must precede signing", isGate: true, checkType: "date_field", checkTarget: "folConversionDate", sortOrder: 10 },
      { stepNumber: "4.2", label: "FOL received + strictly re-verified (address, financials: MOU price, finance, LTV, tenor, rate, EMI, fees)", hint: "", isGate: true, checkType: "date_field", checkTarget: "folDate", sortOrder: 20 },
      { stepNumber: "4.3", label: "Client explanation call done (congratulate > loan/rate/EMI > total contribution > funds + signing date)", hint: "", isGate: false, checkType: "note_keyword", checkTarget: "client call|explained fol|fol explained|signing date", sortOrder: 30 },
      { stepNumber: "4.4", label: "FOL signed (gated: conversion + verification first)", hint: "", isGate: true, checkType: "date_field", checkTarget: "folSignedDate", sortOrder: 40 },
      { stepNumber: "4.5", label: "DDA activated + loan booked", hint: "", isGate: true, checkType: "boolean_field", checkTarget: "ddaActive", sortOrder: 50 },
      { stepNumber: "4.6", label: "Liability clearance / SOA / POA / NOC where applicable", hint: "", isGate: false, checkType: "manual", checkTarget: "", sortOrder: 60 },
    ],
  },
  {
    label: "Transfer + Disbursal",
    ownerRole: "SPO (Transfer) + Bank PRO",
    exitGateSummary: "Title Deed QC done (branch settlement first)",
    sopJson: [
      "preparation-coordination",
      "final-transfer-document-checklist-matrix",
      "operational-scenarios-fund-flow-logic-all-transaction-types",
      "manager-s-cheque-mc-preparation-rules",
      "standard-payment-rules-extra-finance-protocols",
      "dubai-dld-fee-structure-matrix-primary-purchase",
      "dubai-dld-fee-structure-matrix-resale-secondary-market",
      "abu-dhabi-adm-fee-structure-matrix-primary-resale",
      "buyout-equity-release-fee-structure-matrix-dubai-abu-dhabi",
      "post-completion-end-to-end-process",
    ],
    commsJson: ["em-transfer-day", "em-settlement-pro", "wa-mc-request", "wa-transfer-slot"],
    steps: [
      { stepNumber: "5.1", label: "Expiries rechecked (NOC Emaar 15d / Nakheel 5d / Manazel-Aldar 30d, SOA, FOL 30/60/90d, AUH search 15d)", hint: "", isGate: false, checkType: "manual", checkTarget: "", sortOrder: 10 },
      { stepNumber: "5.2", label: "Transfer email sent (date/time/location/attendees + calculations)", hint: "", isGate: false, checkType: "date_field", checkTarget: "transferDate", sortOrder: 20 },
      { stepNumber: "5.3", label: "Transfer executed new Title Deed QC post-completion", hint: "", isGate: true, checkType: "date_field", checkTarget: "titleDeedDate", sortOrder: 30 },
      { stepNumber: "5B.1", label: "Liability letter obtained (5-10d validity, name = MOU) [Branch: resale + seller mortgage]", hint: "", isGate: false, checkType: "date_field", checkTarget: "liabilityLetterDate", sortOrder: 40 },
      { stepNumber: "5B.2", label: "Settlement MC prepared to seller bank + buyer top-up MC if unfunded [Branch: resale + seller mortgage]", hint: "", isGate: false, checkType: "date_field", checkTarget: "settlementDate", sortOrder: 50 },
      { stepNumber: "5B.3", label: "Transfer-day settlement done; balance MC to seller; release secured [Branch: resale + seller mortgage]", hint: "", isGate: true, checkType: "date_field", checkTarget: "settlementDate", sortOrder: 60 },
      { stepNumber: "5A.1", label: "Manager cheques issued (bank MC + buyer top-up MC if unfunded) [Branch: resale cash seller]", hint: "", isGate: false, checkType: "manual", checkTarget: "", sortOrder: 70 },
      { stepNumber: "5C.1", label: "Old liability settled; release + updated Title Deed; equity credited [Branch: buyout/equity]", hint: "", isGate: true, checkType: "date_field", checkTarget: "settlementDate", sortOrder: 80 },
      { stepNumber: "5D.1", label: "SOA balance paid via bank MC to developer; Title Deed + handover [Branch: primary from developer]", hint: "", isGate: true, checkType: "date_field", checkTarget: "settlementDate", sortOrder: 90 },
    ],
  },
];

async function main() {
  for (const def of STAGE_DEFS) {
    const stage = await db.stageItem.findFirst({ where: { label: def.label } });
    if (!stage) {
      console.log(`  SKIP - stage "${def.label}" not found in DB (run seed first)`);
      continue;
    }
    await db.stageItem.update({
      where: { id: stage.id },
      data: {
        ownerRole: def.ownerRole,
        exitGateSummary: def.exitGateSummary,
        sopJson: JSON.stringify(def.sopJson),
        commsJson: JSON.stringify(def.commsJson),
      },
    });
    console.log(`  Updated stage "${def.label}" admin fields`);
    const existingCount = await db.stageStep.count({ where: { stageId: stage.id } });
    if (existingCount > 0) {
      console.log(`  SKIP steps for "${def.label}" - already has ${existingCount} rows`);
      continue;
    }
    for (const step of def.steps) {
      await db.stageStep.create({
        data: {
          stageId: stage.id,
          stepNumber: step.stepNumber,
          label: step.label,
          hint: step.hint,
          isGate: step.isGate,
          checkType: step.checkType,
          checkTarget: step.checkTarget,
          sortOrder: step.sortOrder,
          active: true,
        },
      });
    }
    console.log(`  Seeded ${def.steps.length} steps for "${def.label}"`);
  }
  console.log("Done.");
}

main().catch(console.error).finally(() => db.$disconnect());
