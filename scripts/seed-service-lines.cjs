// Phase 1 seed — the six service lines and their products.
//
// IDEMPOTENT: every insert is ON CONFLICT DO NOTHING keyed on the stable
// `code`. Re-running is safe and never duplicates a line. Codes are the contract
// used by code and by backfills — never rename one, add a new one instead.
//
// Written as raw SQL on purpose: this runs before `prisma generate` can
// regenerate the client (the query-engine DLL is locked by a running dev
// server), so it must not depend on prisma.serviceLine existing in the client.
//
// `bankRaced` is the important column: true ONLY for mortgage, because a
// multi-bank application is a competitive race with exactly one winner. It gates
// the bank-leg/legStatus machinery in Phase 2 — a will has no legs.
//
//   node scripts/seed-service-lines.cjs           # dry run (default)
//   node scripts/seed-service-lines.cjs --apply

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const SERVICE_LINES = [
  {
    code: "MORTGAGE",
    name: "Mortgage",
    shortName: "Mortgage",
    bankRaced: true,
    sortOrder: 1,
    notes: "The original business. Per-bank legs race; exactly one wins and books the loan.",
    products: [
      ["MORT-FIRST", "First-home purchase", 1, "New buyer, no existing mortgage on the property."],
      ["MORT-BUYOUT", "Buyout / equity release", 2, "Settle the existing mortgage; optionally release equity."],
      ["MORT-CONSTR", "Construction / off-plan", 3, "Off-plan purchase paid on handover or instalments."],
      ["MORT-REFI", "Refinance", 4, "Move an existing mortgage to a different bank."],
      ["MORT-COMM", "Commercial mortgage", 5, "Office / retail / industrial financing."],
    ],
  },
  {
    code: "GOLDEN_VISA",
    name: "Golden visa assistance",
    shortName: "Golden Visa",
    bankRaced: false,
    sortOrder: 2,
    notes: "Investor-visa applications. No bank race; the timeline is government processing, not credit approval.",
    products: [
      ["GV-10", "Golden visa — 10 year", 1, "Standard investor residency, AED 2M+."],
      ["GV-5", "Golden visa — 5 year", 2, "AED 1M+ threshold."],
      ["GV-2", "Golden visa — 2 year / green", 3, "AED 500k+ threshold."],
    ],
  },
{
    code: "INSURANCE",
    name: "Insurance",
    shortName: "Insurance",
    bankRaced: false,
    sortOrder: 3,
    notes: "Personal and business protection policies.",
    products: [
      ["INS-LIFE", "Life insurance", 1, ""],
      ["INS-HEALTH", "Health / medical insurance", 2, ""],
      ["INS-MOTOR", "Motor insurance", 3, ""],
      ["INS-PROPERTY", "Property insurance", 4, "Often bound as a mortgage condition."],
      ["INS-SME", "SME / business insurance", 5, ""],
    ],
  },
  {
    code: "WILLS_LEGAL",
    name: "Wills & legal",
    shortName: "Wills",
    bankRaced: false,
    sortOrder: 4,
    notes: "Will drafting, notarisation, probate and powers of attorney. Also the natural cross-sell on every mortgage — a new borrower with no will is the easiest sale in the firm.",
    products: [
      ["WIL-DRAFT", "Will drafting", 1, ""],
      ["WIL-NOTARY", "Notarisation / attestation", 2, ""],
      ["WIL-PROBATE", "Probate", 3, ""],
      ["WIL-POA", "Power of attorney", 4, ""],
    ],
  },
  {
    code: "REAL_ESTATE",
    name: "Real estate",
    shortName: "Real Estate",
    bankRaced: false,
    sortOrder: 5,
    notes: "Agency sales and property management.",
    products: [
      ["RE-SALES", "Property sales / agency", 1, "Buyer or seller representation."],
      ["RE-MGMT", "Property management", 2, "Leasing and maintenance for owners."],
      ["RE-HANDOVER", "Snagging & handover", 3, "Developer handover inspection."],
    ],
  },
  {
    code: "BUSINESS_SETUP",
    name: "Business setup",
    shortName: "Business Setup",
    bankRaced: false,
    sortOrder: 6,
    notes: "Company formation, visas and accounting.",
    products: [
      ["BS-LICENCE", "Trade licence", 1, "Free zone or mainland."],
      ["BS-VISA", "Employment / investor visa", 2, ""],
      ["BS-PRO", "PRO / Golden visa for business", 3, ""],
      ["BS-ACCT", "Accounting & compliance", 4, ""],
    ],
  },
];

async function main() {
  const existing = await prisma.$queryRawUnsafe(`SELECT code FROM "ServiceLine"`);
  const have = new Set(existing.map((e) => e.code));
  const fresh = SERVICE_LINES.filter((s) => !have.has(s.code));

  console.log(`service lines to ensure : ${SERVICE_LINES.length}`);
  console.log(`already present         : ${SERVICE_LINES.length - fresh.length}`);
  console.log(`to insert               : ${fresh.length}`);
  const productCount = SERVICE_LINES.reduce((n, s) => n + s.products.length, 0);
  console.log(`products in catalogue   : ${productCount}\n`);

  for (const s of SERVICE_LINES) {
    console.log(`  ${s.bankRaced ? "[race]" : "     "} ${s.code.padEnd(15)} ${s.name}`);
    for (const [code, name, , notes] of s.products) {
      console.log(`         ${code.padEnd(14)} ${name}${notes ? `  — ${notes}` : ""}`);
    }
  }

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply.");
    return;
  }

  // One transaction: a half-seeded catalogue is worse than none, because the UI
  // would then offer an empty service line.
  await prisma.$transaction(async (tx) => {
    for (const s of SERVICE_LINES) {
      await tx.$executeRawUnsafe(
        `INSERT INTO "ServiceLine"
           (code, name, "shortName", active, "sortOrder", "bankRaced", notes, "createdAt", "updatedAt")
         VALUES ($1,$2,$3,true,$4,$5,$6, now(), now())
         ON CONFLICT (code) DO NOTHING`,
        s.code, s.name, s.shortName, s.sortOrder, s.bankRaced, s.notes,
      );
      // $queryRawUnsafe returns the rows array directly (not { rows }).
      const found = await tx.$queryRawUnsafe(`SELECT id FROM "ServiceLine" WHERE code = $1`, s.code);
      if (!found || !found.length) throw new Error(`ServiceLine ${s.code} missing after insert`);
      const slId = found[0].id;
      for (const [code, name, sortOrder, notes] of s.products) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "Product"
             ("serviceLineId", code, name, active, "sortOrder", notes, "createdAt", "updatedAt")
           VALUES ($1,$2,$3,true,$4,$5, now(), now())
           ON CONFLICT (code) DO NOTHING`,
          slId, code, name, sortOrder, notes || "",
        );
      }
    }
  });

  const now = await prisma.$queryRawUnsafe(`SELECT code FROM "ServiceLine" ORDER BY "sortOrder"`);
  const prods = await prisma.$queryRawUnsafe(
    `SELECT p.code FROM "Product" p JOIN "ServiceLine" s ON s.id = p."serviceLineId" ORDER BY s."sortOrder", p."sortOrder"`,
  );
  console.log(`\nAPPLIED. service lines: ${now.map((r) => r.code).join(", ")}`);
  console.log(`products: ${prods.length}`);
}

main()
  .catch((e) => { console.error("ERROR", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());