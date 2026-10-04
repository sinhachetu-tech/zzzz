/**
 * Phase 7 audit — the rate-product gap (work-queue item 1).
 *
 * Two questions, both answered from the live DB rather than from the schema:
 *   1. Does LoanCase already have a controlled transaction vocabulary? (transactionPurpose)
 *   2. Is bankProductId populated anywhere, and where is the BankProduct audit trail?
 *
 * Read-only. No writes.
 */
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

async function main() {
  const purpose = await db.$queryRawUnsafe(
    `select "transactionPurpose", count(*)::int n from "LoanCase" group by 1 order by 2 desc`
  );
  console.log("transactionPurpose :", JSON.stringify(purpose));

  // chr(8709) is an empty string, so the bucket label stays readable.
  const type = await db.$queryRawUnsafe(
    `select coalesce(nullif("transactionType", chr(8709)), chr(8709)) t, count(*)::int n
       from "LoanCase" group by 1 order by 2 desc`
  );
  console.log("transactionType   :", JSON.stringify(type));

  // The real question: is the free-text field redundant with the controlled one?
  const overlap = await db.$queryRawUnsafe(
    `select count(*)::int n from "LoanCase"
      where "transactionType" is distinct from "transactionPurpose"`
  );
  console.log("rows where they differ :", JSON.stringify(overlap));

  // BankProduct audit trail: where does it already live?
  const proposals = await db.$queryRawUnsafe(
    `select count(*)::int total,
            count(*) filter (where "productIds" <> '[]')::int with_products
       from "Proposal"`
  );
  console.log("Proposal (productIds trail) :", JSON.stringify(proposals));

  const hasCol = await db.$queryRawUnsafe(
    `select count(*)::int n from information_schema.columns
      where table_name = 'LoanCase' and column_name = 'bankProductId'`
  );
  console.log("LoanCase.bankProductId exists :", JSON.stringify(hasCol));

  const banks = await db.$queryRawUnsafe(
    `select count(*)::int n, count(*) filter (where banks <> '[]')::int with_banks
       from "LoanCase"`
  );
  console.log("LoanCase.banks :", JSON.stringify(banks));
}

main()
  .catch((e) => console.log("ERR", e.message))
  .finally(() => db.$disconnect());