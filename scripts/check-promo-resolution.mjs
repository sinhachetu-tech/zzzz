// Does the engine now quote the RIGHT processing fee on the migrated DIB promos?
//
// The migration moved the 0 into `promo` and set `defaultPct`. Raw `default` is still 0
// (that IS the promo value), so a naive read of `default` looks unchanged — which is
// exactly the mistake that let this bug live. What matters is what processingFeePct()
// resolves for a given date, so this mirrors that logic and prints both today and after
// the promo window closes.
//
//   node scripts/check-promo-resolution.mjs
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const TODAY = "2026-09-30";      // the promo's own validTo — still live on the day
const TOMORROW = "2026-10-01";   // the day it must revert

const live = (promo, on) => {
  if (!promo) return true;
  if (promo.validFrom && promo.validFrom > on) return false;
  if (promo.validTo && promo.validTo < on) return false;
  return true;
};
const resolveFee = (fees, on) => {
  const p = fees?.processing;
  if (!p) return { value: null, why: "no processing block" };
  if (p.promo == null) return { value: p.default ?? null, why: "no promo — standard default" };
  if (live(p.promo, on)) return { value: p.promo.default ?? p.default ?? null, why: `promo live (ends ${p.promo.validTo})` };
  if (p.defaultPct != null) return { value: p.defaultPct, why: "promo expired — standard fee" };
  return { value: null, why: "promo expired and NO standard fee — data gap" };
};

try {
  const products = await db.bankProduct.findMany({
    where: { status: "approved", active: true },
    select: { name: true, feesJson: true, bank: { select: { name: true } } },
  });

  let migrated = 0, stillZeroToday = 0, reverts = 0, gaps = 0;
  const rows = [];
  for (const p of products) {
    let fees;
    try { fees = JSON.parse(p.feesJson || "{}"); } catch { continue; }
    if (!fees?.processing?.promo) continue;
    migrated += 1;
    const now = resolveFee(fees, TODAY);
    const later = resolveFee(fees, TOMORROW);
    if (now.value === 0) stillZeroToday += 1;
    if (later.value != null && later.value !== now.value) reverts += 1;
    if (later.value == null) gaps += 1;
    rows.push({ bank: p.bank.name, name: p.name, now, later });
  }

  console.log("--- do the migrated promo fees resolve correctly? ---------------");
  console.log(`products with a promo block : ${migrated}`);
  console.log(`quoted 0% today (promo live): ${stillZeroToday}   <- correct, the window is still open`);
  console.log(`revert to a standard fee    : ${reverts}`);
  console.log(`become an honest data gap   : ${gaps}   <- better than a wrong 0%`);
  console.log("\nsamples:");
  for (const r of rows.slice(0, 6)) {
    console.log(`  ${r.bank} · ${r.name}`);
    console.log(`    today (${TODAY})   : ${r.now.value ?? "unknown"}%   ${r.now.why}`);
    console.log(`    tomorrow (${TOMORROW}): ${r.later.value ?? "unknown"}%   ${r.later.why}`);
  }
} finally {
  await db.$disconnect();
}
