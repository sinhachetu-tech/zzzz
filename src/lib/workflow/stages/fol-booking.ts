// Stage 4 — FOL + Loan Booking.
// HARD RULE: 4.1 FOL conversion happens BEFORE 4.4 signing. The drawer gates
// the signing checkbox on conversion + verification; override needs a reason
// logged to StageTransition/Activity.
import type { StageDef } from "../types";

export const FolStage: StageDef = {
  key: "fol",
  title: "FOL + Loan Booking",
  short: "FOL + Booking",
  owner: "SPO (FOL) + Bank RM",
  sop: [
    "general-fol-conversion-verification-procedure",
    "comprehensive-fol-loan-booking-document-matrix",
    "specific-document-checklists-cbd-dib",
    "liabilities-settlement-clearances-soa-updates",
    "power-of-attorney-poa-developer-noc",
    "dib-salary-transfer-letter-stl-format",
  ],
  subSteps: [
    { id: "4.1", label: "FOL conversion filled + sent (amount / tenor / ROI / EMI / insurance confirmed via VRM)", hint: "Must precede signing", check: "folConversion", gate: true },
    { id: "4.2", label: "FOL received + strictly re-verified (address: unit/door/floor/bldg/plot/municipality; financials: MOU price, finance, down, valuation, LTV, tenor, rate, EMI, fees)", check: "folVerified", gate: true },
    { id: "4.3", label: "Client explanation call done (congratulate → loan/rate/EMI → total contribution → funds + signing date)", check: "clientCall" },
    { id: "4.4", label: "FOL signed (gated: conversion + verification first)", check: "folSigned", gate: true },
    { id: "4.5", label: "DDA activated + loan booked", check: "booked", gate: true },
    { id: "4.6", label: "Liability clearance / SOA / POA / NOC where applicable", check: "clearances" },
  ],
  exitGate: {
    summary: "Loan booked (signing + DDA)",
    checks: ["folConversion", "folVerified", "folSigned", "booked"],
  },
  comms: ["em-fol-conversion", "call-fol-client-script", "wa-signing-slot", "wa-dda-activation"],
  docCategories: ["Bank & Liabilities", "Valuation", "Transfer"],
};
