// Stage 5 — Transfer + Disbursal. Bifurcates by transactionType.
// Branch resolution lives in transferBranch(); the drawer renders ONLY the
// matching sub-steps plus the common tail.
import type { StageDef, TransferBranch } from "../types";

export const TransferStage: StageDef = {
  key: "transfer",
  title: "Transfer + Disbursal",
  short: "Transfer",
  owner: "SPO (Transfer) + Bank PRO",
  sop: [
    "preparation-coordination",
    "final-transfer-document-checklist-matrix",
    "operational-scenarios-fund-flow-logic-all-transaction-types",
    "manager-s-cheque-mc-preparation-rules",
    "standard-payment-rules-extra-finance-protocols",
    "dubai-dld-fee-structure-matrix-primary-purchase",
    "dubai-dld-fee-structure-matrix-resale-secondary-market",
    "abu-dhabi-adm-fee-structure-matrix-primary-resale",
    "adgm-al-reem-al-maryah-fee-structure-matrix",
    "buyout-equity-release-fee-structure-matrix-dubai-abu-dhabi",
    "post-completion-end-to-end-process",
  ],
  subSteps: [
    // Branch B — resale where the seller still has a mortgage (release path)
    { id: "5B.1", label: "Liability letter obtained (5–10d validity, name = MOU)", check: "liabilityLetter" },
    { id: "5B.2", label: "Settlement MC prepared to seller's bank (+ buyer top-up MC if unfunded)", check: "settlementMc" },
    { id: "5B.3", label: "Transfer-day settlement done with both PROs; balance MC to seller; release secured", check: "settled", gate: true },
    // Branch A — resale, cash seller (no release)
    { id: "5A.1", label: "Manager's cheques issued (bank MC + buyer top-up MC if unfunded)", check: "settlementMc" },
    // Branch C — buyout / equity (no trustee day)
    { id: "5C.1", label: "Old liability settled at previous bank; release + updated Title Deed; equity credited", check: "settled", gate: true },
    // Branch D — primary from developer
    { id: "5D.1", label: "SOA balance paid via bank MC to developer; Title Deed + handover", check: "settled", gate: true },
    // Common tail
    { id: "5.1", label: "Expiries rechecked (NOC Emaar 15d / Nakheel 5d / Manazel-Aldar 30d, SOA, FOL 30/60/90d, AUH search 15d)", check: "expiryOk" },
    { id: "5.2", label: "Transfer email sent (date/time/location/attendees + calculations)", check: "transferEmail" },
    { id: "5.3", label: "Transfer executed → new Title Deed QC → post-completion", check: "titleDeed", gate: true },
  ],
  exitGate: {
    summary: "Title Deed QC done (branch settlement first)",
    checks: ["settled", "titleDeed"],
  },
  comms: ["em-transfer-day", "em-settlement-pro", "wa-mc-request", "wa-transfer-slot"],
  docCategories: ["Transfer", "Bank & Liabilities"],
};

/** transactionType → branch. Keeps the 7 canonical values in types.ts. */
export function transferBranch(transactionType: string | null | undefined): TransferBranch {
  const t = (transactionType ?? "").toLowerCase();
  if (!t) return "undecided";
  if (t.includes("primary") || t.includes("handover")) return "primary";
  if (t.includes("buyout") || t.includes("equity") || t.includes("refinance")) return "buyout";
  if (t.includes("resale")) return t.includes("mortgage") ? "resale-mortgage" : "resale-cash";
  return "undecided";
}

/** Sub-step ids visible for a branch (branch steps + common tail). */
export function transferStepsFor(branch: TransferBranch): string[] {
  switch (branch) {
    case "resale-mortgage":
      return ["5B.1", "5B.2", "5B.3", "5.1", "5.2", "5.3"];
    case "resale-cash":
      return ["5A.1", "5.1", "5.2", "5.3"];
    case "buyout":
      return ["5C.1", "5.1", "5.3"];
    case "primary":
      return ["5D.1", "5.1", "5.3"];
    default:
      return ["5.1", "5.2", "5.3"];
  }
}
