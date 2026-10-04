// Step 2 verification — the three scale indexes actually EXIST.
// Needed because scripts/apply-sql.cjs only understands CREATE TABLE / ADD COLUMN /
// ADD CONSTRAINT, so it reported "0/0 columns, 0/0 constraints, verified!" on a
// migration that only created INDEXES — i.e. it passed while checking nothing.
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

const WANT = [
  "Client_fullName_idx",
  "LoanCase_customer_idx",
  "LoanCase_serviceLineId_updatedAt_idx",
];

(async () => {
  // Literals, not placeholders: $queryRawUnsafe does NOT bind parameters the way the
  // typed query engine does, so "?" arrives verbatim and Postgres sees a syntax error.
  // WANT is a fixed compile-time list, so inlining it is safe.
  const rows = await p.$queryRawUnsafe(
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (" +
      WANT.map((w) => `'${w}'`).join(",") + ") ORDER BY indexname",
  );
  const found = rows.map((r) => r.indexname);
  let bad = 0;
  for (const w of WANT) {
    const ok = found.includes(w);
    if (!ok) bad++;
    console.log(`${ok ? "PASS" : "FAIL"} ${w}`);
  }
  console.log(`indexes present: ${found.length}/${WANT.length}`);

  // The indexes must be USABLE, not merely present: Postgres ignores an index for a
  // pattern it can't serve, and a `contains` search ("%ahmed%") will still seq-scan.
  // Explain proves the planner picks the index for a prefix match.
  const plan = await p.$queryRawUnsafe(
    "EXPLAIN SELECT * FROM \"LoanCase\" WHERE \"customer\" LIKE 'Ahm%'",
  );
  const used = plan.map((r) => Object.values(r).join(" ")).join(" ");
  console.log("LoanCase customer prefix search uses index: " + /LoanCase_customer_idx/.test(used));

  console.log(`data intact: cases=${await p.loanCase.count()} clients=${await p.client.count()}`);
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => { console.log("ERR " + e.message); process.exit(2); });