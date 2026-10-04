// Migrate the DIB promotional 0% processing fees into the promo structure.
//
// Measured 2026-09-30: 11 DIB products carry `processing.default: 0` with the note
// "Q1-Q3 2026 promo: zero processing (first-time buyer promo)". That promo expired
// 2026-09-30, but because the 0 was written into the permanent slot nothing reverted
// it — every one of those products was still quoting clients Free.
//
// This moves the 0 into `promo` (with its real window) and sets `defaultPct` to the
// standard fee recorded in the same note ("Standard fees for SE 1.25%" — for the
// self-employed products; the note gives no standard fee for the others, which stay
// a reported data gap rather than a guessed 0).
//
// Idempotent: a product whose processing block already has a `promo` object is
// skipped. --apply writes; otherwise it reports what would change.
//
//   node scripts/migrate-promo-fees.mjs [--apply]
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const db = new PrismaClient();

const SE_STANDARD = 1.25;

try {
  const products = await db.bankProduct.findMany({ select: { id: true, name: true, employment: true, feesJson: true, bank: { select: { name: true } } } });
  const candidates = [];
  for (const p of products) {
    let j;
    try { j = JSON.parse(p.feesJson || "{}"); } catch { continue; }
    const proc = j?.processing;
    if (!proc || proc.promo) continue;              // nothing to migrate or already migrated
    if (proc.default !== 0) continue;
    if (!/promo/i.test(String(proc.note ?? ""))) continue;
    candidates.push({ p, proc, note: String(proc.note) });
  }

  console.log("--- DIB-style promotional 0% processing fees -----------------");
  console.log(`products with a promo-0 in the permanent slot: ${candidates.length}`);

  let touched = 0, gaps = 0;
  for (const { p, proc, note } of candidates) {
    const isSE = /self.?employed/i.test(p.employment ?? "");
    // the note's own window; fall back to the Q1-Q3 2026 one when unparseable
    const to = /Q1[-–]Q3\s*(\d{4})/i.test(note)
      ? `${note.match(/Q1[-–]Q3\s*(\d{4})/i)[1]}-09-30`
      : "2026-09-30";
    const standard = isSE ? SE_STANDARD : null;
    if (standard == null) gaps += 1;

    const next = {
      ...proc,
      defaultPct: standard,                         // the real fee — or null if unknown
      promo: { default: 0, validFrom: null, validTo: to, note },
    };

    if (APPLY) {
      await db.bankProduct.update({
        where: { id: p.id },
        data: { feesJson: JSON.stringify({ ...JSON.parse(p.feesJson || "{}"), processing: next }) },
      });
      touched += 1;
    }
    if (candidates.indexOf({ p, proc, note }) < 5 || APPLY) void 0;
    console.log(`  ${p.bank.name} · ${p.name}`);
    console.log(`     ${isSE ? `standard ${SE_STANDARD}%` : "no standard fee recorded — becomes a data gap"}`);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. ${gaps} product(s) would become honest data gaps. Re-run with --apply.`);
  } else {
    console.log(`\nmigrated ${touched} product(s). ${gaps} now correctly report "not recorded" instead of Free.`);
  }
} finally {
  await db.$disconnect();
}
