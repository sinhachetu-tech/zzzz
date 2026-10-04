// Remove duplicate DBR 3 (stress) blocks from bank-pricing.ts, keeping only the
// first. The block (StressKind/StressRule/StressOutcome/resolveStress) was added
// three times across interrupted edits; each copy is near-identical, so exact-text
// matching kept failing and one removal re-added the next.
//
//   node scripts/dedupe-stress-block.mjs
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "src/lib/bank-pricing.ts";
let src = readFileSync(FILE, "utf8");

const KEEP = 1;
const TYPE_MARK = "export type StressKind =";
const FN_MARK = "export function resolveStress(";

// find every block: from the nearest preceding comment opener to the end of the
// resolveStress function (first line that is exactly "}" after FN_MARK).
// The repo uses CRLF, so every newline probe must accept \r\n — that single miss
// made the first version report "0 blocks".
function findBlocks(text) {
  const out = [];
  let idx = 0;
  while ((idx = text.indexOf(TYPE_MARK, idx)) !== -1) {
    const fn = text.indexOf(FN_MARK, idx);
    if (fn === -1) break;
    const m = /\r?\n\}\r?\n/.exec(text.slice(fn));
    if (!m) break;
    const end = fn + m.index + m[0].length;
    // walk back to the nearest comment start before the type declaration
    const before = text.lastIndexOf("/**", idx);
    const beforeBlock = text.lastIndexOf("/* ---", idx);
    const start = Math.max(before, beforeBlock);
    out.push({ start, end, typeIdx: idx });
    idx = end;
  }
  return out;
}

const blocks = findBlocks(src);
console.log(`found ${blocks.length} stress block(s)`);
if (blocks.length <= KEEP) {
  console.log("nothing to do — already deduplicated");
  process.exit(0);
}

// remove from the end so earlier indices stay valid
for (let i = blocks.length - 1; i >= KEEP; i--) {
  const b = blocks[i];
  src = src.slice(0, b.start) + src.slice(b.end);
  console.log(`  removed block starting at offset ${b.start}`);
}

// tidy up any run of >2 blank lines left behind
src = src.replace(/\n{4,}/g, "\n\n\n");
writeFileSync(FILE, src);

const after = findBlocks(src).length;
console.log(`now ${after} block(s) remain (expected ${KEEP})`);
if (after !== KEEP) {
  console.error("DEDUPE FAILED — not writing a bad file, re-run after inspecting");
  process.exit(1);
}
console.log("ok");
