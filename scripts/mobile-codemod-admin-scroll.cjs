/* Second admin.tsx codemod: the horizontal-scroll containers.

 * Every `overflow-x-auto` in this file is a genuinely tabular region — banks,
 * stages, channels, products, fee rules, rates, doc rules — plus the two Seg
 * nav strips. They keep their columns and pan sideways on a phone; a card would
 * destroy the column alignment that makes config rows comparable. The swap is
 * prefix-only (`className="overflow-x-auto…` → `className="rf-scroll
 * rf-scroll-x…`) so any padding utilities on the same class survive.

 * `.rf-scroll` adds `overscroll-behavior: contain` (a pan can't drag the page)
 * and iOS momentum; `.rf-scroll-x` adds the pure-CSS edge fade that makes the
 * pan discoverable.

 * Run once:  node scripts/mobile-codemod-admin-scroll.cjs */
const fs = require("fs");
const path = require("path");

const FILE = path.resolve(__dirname, "..", "src", "components", "views", "admin.tsx");

// prefix match: keeps whatever padding/margin classes followed it
const RE = /className="overflow-x-auto/g;
const EXPECTED = 12;

const src = fs.readFileSync(FILE, "utf8");
const found = (src.match(RE) || []).length;

if (found !== EXPECTED) {
  console.error(`ABORTED — no changes written. Expected ${EXPECTED} "overflow-x-auto" containers, found ${found}.`);
  process.exit(1);
}

const out = src.replace(RE, 'className="rf-scroll rf-scroll-x');
fs.writeFileSync(FILE, out, "utf8");
console.log(`admin.tsx: converted ${found} horizontal-scroll containers to .rf-scroll .rf-scroll-x.`);