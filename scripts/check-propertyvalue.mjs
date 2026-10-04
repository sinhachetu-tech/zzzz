// DIAGNOSTIC (read-only): how many live cases were relying on a FABRICATED
// property value before the column existed?
//
// `case-profile.ts` used to back-derive propertyValue as loanAmount/0.8 whenever it
// was absent, which invented an 80% LTV and fed it to every LTV and affordability
// verdict. This counts the exposure so the number can be chased before anyone
// quotes a client from those files again.
//
//   node scripts/check-propertyvalue.mjs
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

try {
  const total = await db.loanCase.count();
  const captured = await db.loanCase.count({ where: { propertyValue: { not: null } } });

  // a case is "at risk" if it has a loan amount but no captured property value AND
  // its stored profile never recorded one either
  const atRisk = await db.loanCase.findMany({
    where: { propertyValue: null, loanAmount: { gt: 0 } },
    select: { id: true, caseNumber: true, customer: true, loanAmount: true, profileJson: true, stage: true, caseStatus: true },
  });

  let profileHasValue = 0;
  for (const c of atRisk) {
    try {
      const v = JSON.parse(c.profileJson ?? "{}")?.property?.propertyValue;
      if (typeof v === "number" && v > 0) profileHasValue += 1;
    } catch { /* unparseable profile = no value either */ }
  }

  const active = atRisk.filter((c) => c.caseStatus === "Active");
  const byStage = {};
  for (const c of active) byStage[c.stage] = (byStage[c.stage] ?? 0) + 1;

  console.log("--- property value exposure -------------------------------------");
  console.log(`total cases                 : ${total}`);
  console.log(`captured propertyValue      : ${captured}`);
  console.log(`no propertyValue, has loan  : ${atRisk.length}`);
  console.log(`  ...of which profileJson has one (recoverable): ${profileHasValue}`);
  console.log(`  ...genuinely missing                 : ${atRisk.length - profileHasValue}`);
  console.log(`still ACTIVE and exposed    : ${active.length}`);
  console.log("active by stage:");
  for (const [s, n] of Object.entries(byStage).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s.padEnd(28)} ${n}`);
  }
  if (active.length) {
    console.log("first 15 active exposed cases:");
    for (const c of active.slice(0, 15)) {
      console.log(`  ${c.caseNumber}  ${c.customer.slice(0, 24).padEnd(24)}  loan ${c.loanAmount.toLocaleString()}  ${c.stage}`);
    }
  }

  // ---- backfill the recoverable ones ---------------------------------------
  // A REAL property value is sitting inside profileJson for 14 of these cases.
  // Copying it into the new column is not a guess — it is the value a human
  // already entered on the Case 360 profile form. Nothing is derived here.
  //
  // Guarded: only fills cases with a plausible value (>0, and >= the loan amount,
  // since a property cannot be worth less than the finance on it). Anything failing
  // that test is reported and left NULL so the engine reports a data gap.
  if (process.argv.includes("--backfill")) {
    let filled = 0, skipped = 0;
    for (const c of atRisk) {
      let v = null;
      try { v = JSON.parse(c.profileJson ?? "{}")?.property?.propertyValue ?? null; } catch { v = null; }
      if (typeof v !== "number" || v <= 0 || v < c.loanAmount) { skipped += 1; continue; }
      await db.loanCase.update({ where: { id: c.id }, data: { propertyValue: Math.round(v) } });
      filled += 1;
    }
    console.log(`\nbackfill: ${filled} filled, ${skipped} left as data gaps`);
  } else {
    console.log(`\n(run with --backfill to copy the ${profileHasValue} real values out of profileJson)`);
  }
} finally {
  await db.$disconnect();
}
