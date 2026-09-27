// Backfill FINAL PROPERTY CLASSIFICATION canonical dims on existing LoanCase rows.
// ADDITIVE + IDEMPOTENT: never overwrites a value that is already set to
// something other than the defaults, never guesses, and re-running is a no-op.
//
// Mapping rules (conservative — matches src/lib/case-profile.ts):
//   propertyTypeCanonical : legacy propertyType has NO residential/commercial
//                           signal → UNKNOWN (a human must classify it).
//   commercialSubtype     : NULL unless the row is explicitly COMMERCIAL.
//   propertyStage         : "Off-Plan" → OFF_PLAN, "Ready" → COMPLETED, else UNKNOWN.
//   constructionStatus    : ALWAYS UNKNOWN — never inferred from stage
//                           (Off-plan ≠ Under-construction, Handover ≠ Completed).
//   partyRelationship     : transactionType mentions developer/primary/handover →
//                           DEVELOPER; buyout/resale → EXISTING_OWNER; else UNKNOWN.
//   existingFinance       : buyout → MORTGAGE; else UNKNOWN.
//   transactionPurpose    : buyout+equity → REFINANCE_AND_EQUITY, buyout →
//                           REFINANCE, equity/cashout → EQUITY_RELEASE, else PURCHASE.
//
// If profileJson already carries canonical dims (saved by the profile editor),
// those WIN over the legacy-derivation above.
//
// Usage:
//   node scripts/backfill-property-canonical.mjs --dry-run   # report only
//   node scripts/backfill-property-canonical.mjs             # write
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

function deriveFromLegacy(row) {
  const pt = (row.propertyType || "").toLowerCase();
  const txn = (row.transactionType || "").toLowerCase();
  const isOffPlan = pt.includes("off");
  const isBuyout = txn.includes("buyout");
  const isEquity = txn.includes("equity") || txn.includes("cashout") || txn.includes("top up");
  return {
    propertyTypeCanonical: "UNKNOWN", // no residential/commercial signal in legacy fields
    commercialSubtype: null,
    propertyStage: isOffPlan ? "OFF_PLAN" : (pt.includes("ready") || txn.includes("resale")) ? "COMPLETED" : "UNKNOWN",
    constructionStatus: "UNKNOWN", // NEVER inferred from stage
    partyRelationship: (txn.includes("developer") || txn.includes("primary") || txn.includes("handover")) ? "DEVELOPER"
      : (isBuyout || txn.includes("resale")) ? "EXISTING_OWNER" : "UNKNOWN",
    existingFinance: isBuyout ? "MORTGAGE" : "UNKNOWN",
    transactionPurpose: (isBuyout && isEquity) ? "REFINANCE_AND_EQUITY"
      : isBuyout ? "REFINANCE"
      : isEquity ? "EQUITY_RELEASE"
      : "PURCHASE",
  };
}

function fromProfileJson(row) {
  if (!row.profileJson) return null;
  try {
    const p = JSON.parse(row.profileJson);
    const prop = p?.property;
    if (!prop) return null;
    const canon = {
      propertyTypeCanonical: prop.canonicalPropertyType ?? null,
      commercialSubtype: prop.canonicalCommercialSubtype ?? null,
      propertyStage: prop.canonicalPropertyStage ?? null,
      constructionStatus: prop.canonicalConstructionStatus ?? null,
      partyRelationship: prop.canonicalPartyRelationship ?? null,
      existingFinance: prop.canonicalExistingFinance ?? null,
      transactionPurpose: prop.canonicalTransactionPurpose ?? null,
    };
    // only trust profileJson when at least one canonical dim was explicitly saved
    const anySet = Object.values(canon).some((v) => v != null && v !== "");
    return anySet ? canon : null;
  } catch {
    return null;
  }
}

const DEFAULTS = { propertyTypeCanonical: "UNKNOWN", propertyStage: "UNKNOWN", constructionStatus: "UNKNOWN", partyRelationship: "UNKNOWN", existingFinance: "UNKNOWN", transactionPurpose: "UNKNOWN", commercialSubtype: null };

async function main() {
  const rows = await db.loanCase.findMany({
    select: {
      id: true, caseNumber: true, propertyType: true, transactionType: true, profileJson: true,
      propertyTypeCanonical: true, commercialSubtype: true, propertyStage: true,
      constructionStatus: true, partyRelationship: true, existingFinance: true, transactionPurpose: true,
    },
  });
  let wouldUpdate = 0, skipped = 0, updated = 0;
  for (const row of rows) {
    // PRECEDENCE 1: canonical dims already saved by the profile editor → sync only if column lags
    const fromProfile = fromProfileJson(row);
    // PRECEDENCE 2: conservative legacy derivation
    const derived = fromProfile ?? deriveFromLegacy(row);

    const data = {};
    for (const f of Object.keys(DEFAULTS)) {
      const isDefault = row[f] === DEFAULTS[f];
      const next = derived[f] !== undefined && derived[f] !== null ? derived[f] : DEFAULTS[f];
      // only fill columns still at their default — never overwrite a human answer
      if (isDefault && next !== DEFAULTS[f]) data[f] = next;
      // commercial subtype: enforce NULL iff not COMMERCIAL (repair only)
    }
    const effType = data.propertyTypeCanonical ?? row.propertyTypeCanonical;
    if (effType !== "COMMERCIAL" && row.commercialSubtype != null) data.commercialSubtype = null;
    if (effType === "COMMERCIAL" && row.commercialSubtype == null && !("commercialSubtype" in data)) {
      data.commercialSubtype = "UNKNOWN"; // commercial but subtype unknown → TO_VERIFY, not invented
    }

    if (Object.keys(data).length === 0) { skipped++; continue; }
    wouldUpdate++;
    if (dryRun) {
      console.log(`[dry-run] ${row.caseNumber}: ${JSON.stringify(data)}`);
    } else {
      await db.loanCase.update({ where: { id: row.id }, data });
      updated++;
      console.log(`${row.caseNumber}: ${JSON.stringify(data)}`);
    }
  }
  console.log(`\n${rows.length} rows scanned — ${skipped} already classified, ${wouldUpdate} ${dryRun ? "would update" : "updated"}.`);
  if (dryRun) console.log("Dry run: no writes performed.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());