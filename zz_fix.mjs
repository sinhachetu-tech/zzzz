import fs from "node:fs";

// 1. client-store: import CaseDocument + ensure createCase input accepts profile vectors
let p = "src/lib/client-store.ts";
let t = fs.readFileSync(p, "utf8");
if (!t.includes("  CaseDocument,")) {
  t = t.replace("  DocRule, FeeRule,", "  CaseDocument, DocRule, FeeRule,");
  if (!t.includes("  CaseDocument,")) throw new Error("import anchor for CaseDocument not found");
}
if (!t.includes("employmentProfile?: string;")) {
  const anchor = "    transactionType?: string; propertyLocation?: string | null; coApplicantName?: string | null; bankRm?: string | null; statusNote?: string;";
  if (!t.includes(anchor)) throw new Error("createCase anchor not found");
  t = t.replace(anchor, anchor + "\n    employmentProfile?: string; propertyType?: string; residency?: string;");
}
fs.writeFileSync(p, t);

// 2. ser.ts: re-add serFeeRule (dropped in the earlier splice)
p = "src/lib/ser.ts";
t = fs.readFileSync(p, "utf8");
if (!t.includes("serFeeRule")) {
  const add = `
type PrismaFeeRuleRow = {
  id: number; emirate: string; txnType: string; label: string; amountType: string;
  amount: number; paidBy: string; note: string; sortOrder: number; active: boolean;
};
export function serFeeRule(f: PrismaFeeRuleRow): FeeRule {
  return {
    id: f.id, emirate: f.emirate as FeeRule["emirate"], txnType: f.txnType as FeeRule["txnType"],
    label: f.label, amountType: f.amountType as FeeRule["amountType"], amount: f.amount,
    paidBy: f.paidBy, note: f.note, sortOrder: f.sortOrder, active: f.active,
  };
}
`;
  t = t.trimEnd() + "\n" + add;
  fs.writeFileSync(p, t);
  console.log("serFeeRule re-added");
} else {
  console.log("serFeeRule present");
}

// 3. vault.ts: DocRule vectors are now arrays — evaluate against arrays directly
p = "src/lib/vault.ts";
t = fs.readFileSync(p, "utf8");
t = t.replace(
  `function matches(vecJson: string, value: string): boolean {
  const vec = parseVec(vecJson);
  return vec.includes("all") || vec.includes("any") || vec.includes(value);
}`,
  `function matches(vec: string[], value: string): boolean {
  return vec.includes("all") || vec.includes("any") || vec.includes(value);
}`
);
fs.writeFileSync(p, t);

// 4. client dashboard: icons take className not style — wrap with span
p = "src/app/client/dashboard.tsx";
t = fs.readFileSync(p, "utf8");
t = t.replace(
  `<ICheck size={13} className="shrink-0" style={{ color: d.status === "Waived" ? "var(--ink-faint)" : "var(--mint)" }} />`,
  `<span className="shrink-0" style={{ color: d.status === "Waived" ? "var(--ink-faint)" : "var(--mint)", display: "inline-flex" }}><ICheck size={13} /></span>`
);
fs.writeFileSync(p, t);

console.log("all fixed");
