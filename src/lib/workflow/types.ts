// Case-360 journey workflow — shared vocabulary for the 5 working stages.
// DB (StageItem) owns labels/order/active; code owns stable keys + behaviour.
// Retired labels from the old 10-stage list resolve via LEGACY_MAP so
// history rows (StageTransition) and old case.stage values keep working.
export type StageKey = "doc" | "pre" | "val" | "fol" | "transfer";

export type TransferBranch =
  | "resale-cash" // seller owns outright — MC to seller, no release
  | "resale-mortgage" // seller has a mortgage — liability letter + settlement + release
  | "buyout" // pure buyout / buyout+equity / equity release — settle old loan, no trustee day
  | "primary" // direct from developer — SOA balance MC to developer
  | "undecided"; // transactionType not set yet — drawer offers the picker

export interface SubStep {
  id: string; // e.g. "4.1"
  label: string;
  hint?: string;
  // name of the live predicate evaluated by the drawer (see stages/*.ts)
  check: string;
  gate?: boolean; // must pass before signing / stage exit where noted
}

export interface ExitGate {
  summary: string; // one line shown on the Move-stage button
  checks: string[]; // predicate names, all must pass (or override + reason)
}

export interface StageDef {
  key: StageKey;
  title: string;
  short: string; // card label
  owner: string; // VRM | SPO | SPO + Bank RM
  sop: string[]; // keys into zz_sop.json — reference only, never duplicated
  subSteps: SubStep[];
  exitGate: ExitGate;
  comms: string[]; // CommTemplate ids
  docCategories: string[]; // DocVault filter for this stage
}
