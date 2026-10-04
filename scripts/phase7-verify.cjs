/**
 * Phase 7 verification — the rate-card columns.
 *
 * Written because apply-sql.cjs reported "columns 1/1" for a migration that adds
 * TWO columns in one ALTER TABLE. Its regex only sees the first column of a
 * multi-column ADD COLUMN, so it would have passed a half-applied migration.
 * This queries information_schema directly and checks BOTH columns plus the FKs
 * and the ON DELETE rule.
 */
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  (ok ? pass++ : fail++);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

async function main() {
  // 1. BOTH columns exist (not just the first).
  const cols = await db.$queryRawUnsafe(
    `select column_name, data_type, is_nullable
       from information_schema.columns
      where table_name = 'LoanCase'
        and column_name in ('bankProductId', 'bookedBankProductId')
      order by column_name`
  );
  check("both rate-card columns exist", cols.length === 2, `found ${cols.length}`);
  check("both are nullable", cols.every((c) => c.is_nullable === "YES"));

  // 2. FKs exist AND use ON DELETE SET NULL.
  //    SetNull is the safety property: deleting a catalogue row must not delete
  //    the case that was priced on it.
  const fks = await db.$queryRawUnsafe(
    `select tc.constraint_name, rc.delete_rule
       from information_schema.table_constraints tc
       join information_schema.referential_constraints rc
         on rc.constraint_name = tc.constraint_name
       where tc.table_name = 'LoanCase'
         and tc.constraint_name ilike '%bankproductid%'`
  );
  check("2 FKs present", fks.length === 2, `found ${fks.length}`);
  check(
    "ON DELETE SET NULL on both",
    fks.length === 2 && fks.every((f) => String(f.delete_rule).toUpperCase() === "SET NULL"),
    fks.map((f) => `${f.constraint_name}=${f.delete_rule}`).join(", ")
  );

  // 3. Baseline untouched, and nothing invented data.
  const rows = await db.$queryRawUnsafe(
    `select count(*)::int cases,
            count(*) filter (where "bankProductId" is not null)::int priced,
            count(*) filter (where "bookedBankProductId" is not null)::int booked
       from "LoanCase"`
  );
  check("41 cases intact", rows[0].cases === 41, `got ${rows[0].cases}`);
  check("no rates invented", rows[0].priced === 0 && rows[0].booked === 0);

  // 4. THE SAFETY PROPERTY, proved rather than asserted: point a case at a
  //    throwaway BankProduct, delete it, and confirm the case SURVIVES with a
  //    null id. This is the one behaviour that would lose data if it regressed.
  const bp = await db.bankProduct.create({
    data: {
      bankId: 1,
      name: "ZZ P7 cascade probe",
      sheet: "ZZ",
      residency: "ZZ",
      employment: "ZZ",
    },
  });
  const victim = await db.loanCase.findFirst({ orderBy: { id: "asc" } });
  const before = await db.loanCase.count();
  await db.loanCase.update({
    where: { id: victim.id },
    data: { bankProductId: bp.id },
  });
  await db.bankProduct.delete({ where: { id: bp.id } });
  const after = await db.loanCase.findUnique({ where: { id: victim.id } });
  const count = await db.loanCase.count();
  check(
    "deleting a rate card does NOT delete the case",
    after !== null && after.bankProductId === null && count === before,
    `case ${victim.id} exists=${after !== null} bankProductId=${after && after.bankProductId} count ${before}->${count}`
  );

  console.log(`\nPASS=${pass} FAIL=${fail}`);
}

main()
  .catch((e) => {
    console.log("ERR", e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());