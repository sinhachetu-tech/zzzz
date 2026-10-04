// Remove the BANK fees that were filed in the PLACE-fee (FeeRule) table.
//
// FeeRule is keyed by emirate × transaction, so a bank fee filed there made a
// client's processing fee change depending on which emirate their property was in —
// AND double-counted it against the real per-bank figure in BankProduct.feesJson.
// Twelve such rows existed (Bank Processing Fee / Valuation Fee under Dubai and
// Abu Dhabi). They are removed here; the API now rejects them so it cannot recur.
//
// Read-only unless --apply is passed. Deletes ONLY rows matching isBankFeeLabel,
// and prints exactly what it removed.
//
//   node scripts/clean-misfiled-bank-fees.mjs [--apply]
import { PrismaClient } from "@prisma/client";
import { isBankFeeLabel } from "../src/lib/fee-scope.ts";

const APPLY = process.argv.includes("--apply");
const db = new PrismaClient();

try {
  const rows = await db.feeRule.findMany({ orderBy: [{ emirate: "asc" }, { txnType: "asc" }] });
  const bankFees = rows.filter((r) => isBankFeeLabel(r.label));
  const placeFees = rows.filter((r) => !isBankFeeLabel(r.label));

  console.log("--- FeeRule scope check ------------------------------------");
  console.log(`total FeeRule rows      : ${rows.length}`);
  console.log(`PLACE fees (correct)    : ${placeFees.length}`);
  console.log(`BANK fees (misfiled)    : ${bankFees.length}`);

  if (bankFees.length) {
    console.log("\nrows that would be removed:");
    for (const r of bankFees) {
      console.log(`  [${r.emirate}/${r.txnType}] ${r.label}  ${r.amountType}=${r.amount}  ${r.note ?? ""}`.slice(0, 120));
    }
  }

  // sanity: after removal, does every emirate/transaction still have place fees?
  const byGroup = {};
  for (const r of placeFees) {
    const k = `${r.emirate}/${r.txnType}`;
    byGroup[k] = (byGroup[k] ?? 0) + 1;
  }
  console.log("\nplace fees remaining per emirate/transaction:");
  for (const [k, n] of Object.entries(byGroup).sort()) console.log(`  ${k.padEnd(20)} ${n}`);

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing deleted. Re-run with --apply to remove ${bankFees.length} rows.`);
  } else {
    const ids = bankFees.map((r) => r.id);
    const res = ids.length ? await db.feeRule.deleteMany({ where: { id: { in: ids } } }) : { count: 0 };
    console.log(`\ndeleted ${res.count} misfiled bank-fee row(s) from FeeRule.`);
  }
} finally {
  await db.$disconnect();
}
