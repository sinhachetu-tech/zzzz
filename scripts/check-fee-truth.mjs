// Is "processing fee 0%" on those cards REAL, or an artifact of a default?
//
// This matters more than anything else found so far: if products record no
// processing fee and something reads that as 0, every proposal understates the
// client's upfront cost by the real bank fee. A "free" fee and a "missing" fee must
// never look the same.
//
//   node scripts/check-fee-truth.mjs
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

try {
  const products = await db.bankProduct.findMany({
    where: { status: "approved", active: true },
    select: { id: true, name: true, feesJson: true, bank: { select: { name: true } } },
  });

  let blankJson = 0, emptyObj = 0, hasProcessing = 0, zeroFee = 0, positiveFee = 0, malformed = 0;
  const zeroExamples = [];
  const positiveExamples = [];

  for (const p of products) {
    const raw = (p.feesJson ?? "").trim();
    if (raw === "" || raw === "{}") { blankJson += 1; continue; }
    let j;
    try { j = JSON.parse(raw); } catch { malformed += 1; continue; }
    if (!j || typeof j !== "object") { malformed += 1; continue; }
    const proc = j.processing;
    if (!proc || typeof proc !== "object") { emptyObj += 1; continue; }
    hasProcessing += 1;
    if (proc.default === 0) {
      zeroFee += 1;
      if (zeroExamples.length < 5) zeroExamples.push(`${p.bank.name} · ${p.name}  (${raw.slice(0, 70)})`);
    } else if (typeof proc.default === "number" && proc.default > 0) {
      positiveFee += 1;
      if (positiveExamples.length < 5) positiveExamples.push(`${p.bank.name} · ${p.name}  default=${proc.default}%`);
    }
  }

  console.log("--- is a 0% processing fee real, or an artifact? ---------------");
  console.log(`products examined              : ${products.length}`);
  console.log(`feesJson blank or {}          : ${blankJson}`);
  console.log(`feesJson parsed, NO processing: ${emptyObj}`);
  console.log(`has a processing block         : ${hasProcessing}`);
  console.log(`  of which default === 0      : ${zeroFee}`);
  console.log(`  of which default  > 0       : ${positiveFee}`);
  console.log(`malformed feesJson            : ${malformed}`);

  if (zeroExamples.length) {
    console.log("\nproducts recorded as 0% (raw feesJson):");
    zeroExamples.forEach((e) => console.log("  " + e));
  }
  if (positiveExamples.length) {
    console.log("\nproducts with a real fee:");
    positiveExamples.forEach((e) => console.log("  " + e));
  }

  const verdict = zeroFee > 0
    ? "\nVERDICT: some products really do record 0% = free. Those are genuine — but the "
      + `${blankJson + emptyObj} with no processing block at all must NOT be read as 0.`
    : `\nVERDICT: no product records 0% — every "0%" is an artifact of a missing block. `
      + "Treating absent as 0 would understate every proposal.";
  console.log(verdict);
  console.log("\n--- the 0% fees: are they promotional, and has the promo expired? ---");
  const promoRe = /(\d{4}|promo|promotion|Q[1-4]|valid|until|expires?)/i;
  const notes = new Map();
  for (const p of products) {
    let j;
    try { j = JSON.parse(p.feesJson || "{}"); } catch { continue; }
    if (j?.processing?.default !== 0) continue;
    const n = String(j.processing.note ?? "(no note)");
    if (!notes.has(n)) notes.set(n, []);
    notes.get(n).push(`${p.bank.name} · ${p.name}`);
  }
  for (const [note, list] of notes) {
    console.log(`  ${list.length} products share this note:`);
    console.log(`    "${note.slice(0, 160)}"`);
    console.log(`    e.g. ${list[0]}`);
    console.log(`    looks promotional: ${promoRe.test(note) ? "YES" : "no"}`);
  }
} finally {
  await db.$disconnect();
}

