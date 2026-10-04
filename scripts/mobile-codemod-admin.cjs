/* One-off codemod for the responsive migration of src/components/views/admin.tsx.
 *
 * admin.tsx holds ~20 near-identical fixed-column grids. Editing them one at a
 * time with a text editor is error-prone (the strings repeat), so this applies
 * exact-match replacements and ASSERTS the expected hit count for each. If a
 * count doesn't match, nothing is written and the script exits non-zero — so a
 * silent partial migration can't happen.
 *
 * Every target here is either a label+input form or a short label/value stat
 * row, i.e. things that must go 1-up on a phone. Grids already reading
 * `grid-cols-1 sm:grid-cols-N` were left alone (correct at phone width), as were
 * the deliberate side-by-side choices.
 *
 * Run once:  node scripts/mobile-codemod-admin.cjs
 * Re-running is a no-op (the old strings are gone), so it is safe to re-run. */
const fs = require("fs");
const path = require("path");

const FILE = path.resolve(__dirname, "..", "src", "components", "views", "admin.tsx");

const EDITS = [
  // --- label + input forms: `grid-cols-2` forever meant two fields shared the
  // phone width (~160px each) no matter how narrow the screen got.
  ['<div className="grid grid-cols-2 gap-3">', '<div className="rf-form-grid-sm">', 6],
  ['<div className="grid grid-cols-2 gap-2">', '<div className="rf-form-grid-sm">', 3],
  ['<div className="grid grid-cols-2 gap-2 pt-1">', '<div className="rf-form-grid-sm pt-1">', 1],
  ['<div className="grid grid-cols-2 sm:grid-cols-3 gap-3">', '<div className="rf-form-grid-sm">', 1],
  ['<div className="grid grid-cols-2 sm:grid-cols-4 gap-2">', '<div className="rf-form-grid-sm">', 2],
  // --- stat / KPI strips
  ['<div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-3">', '<div className="rf-form-grid-sm p-4">', 1],
  ['<div className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-2">', '<div className="rf-form-grid-sm p-3">', 1],
  // --- short label:value text row (LTV national / expat) — 2-up is fine, and
  // auto-fit keeps 2-up while dropping to 1-up only when a value is long.
  ['<div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 mono text-[12px]">',
   '<div className="rf-form-grid-sm gap-x-4 gap-y-1.5 mono text-[12px]">', 1],
  // --- notification toggle rows
  ['<div className="grid grid-cols-2 sm:grid-cols-3 gap-2">', '<div className="rf-form-grid-sm">', 3],
  // --- Staff / Client / Agent audience columns. The wide variant because each
  // column holds a stacked group of toggles with long labels.
  ['<div className="grid grid-cols-3 gap-4">', '<div className="rf-form-grid">', 1],
];

const original = fs.readFileSync(FILE, "utf8");

// Verify every count BEFORE writing anything.
const problems = [];
const counts = [];
for (const [from, , expected] of EDITS) {
  const n = original.split(from).length - 1;
  counts.push(`${n}x  ${from.slice(0, 70)}`);
  if (n !== expected) problems.push(`expected ${expected} of ${from}, found ${n}`);
}

if (problems.length) {
  console.error("ABORTED — no changes written:\n");
  for (const p of problems) console.error("  - " + p);
  console.error("\nObserved:\n  " + counts.join("\n  "));
  process.exit(1);
}

let out = original;
for (const [from, to] of EDITS) out = out.split(from).join(to);

fs.writeFileSync(FILE, out, "utf8");
console.log(`admin.tsx: applied ${EDITS.length} replacement rules.`);
for (const c of counts) console.log("  " + c);