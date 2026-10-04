/* Scores every view for how badly it breaks on a phone, so the responsive
   migration can be ordered by actual damage instead of by file size.

   This is a HEURISTIC scorecard, not a renderer — it counts the layout patterns
   that are known to overflow or squash below 768px. Each hit is a pattern worth
   eyeballing on a real device; a non-zero score does NOT prove a screen is
   broken (a `grid-cols-2` of two big buttons is fine), which is why the rules
   below deliberately flag patterns that are USUALLY wrong.

   Usage: node scripts/mobile-score.cjs            (ranked table, worst first)
          node scripts/mobile-score.cjs --json     (machine-readable)

   NOTE on Windows: `node scripts/mobile-score.cjs > out.txt` writes UTF-16 via
   PowerShell redirection and the result looks like mojibake. Either read it in
   the terminal, or redirect explicitly:
       node scripts/mobile-score.cjs | Out-File -Encoding utf8 out.txt */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const VIEWS = path.join(ROOT, "src", "components", "views");

/* weight, label, matcher(src) -> number of hits
   Rules operate on TOKENISED class names, not raw regex over the file.

   This matters: an earlier version used /grid-cols-[2-9]/ against the raw source,
   which also matches INSIDE `sm:grid-cols-3`. That flagged dozens of grids that
   already collapsed correctly on a phone and inflated every score (admin.tsx
   "30 fixed-cols grids" was really ~10). Tokenising means a breakpoint-prefixed
   class is a different token and is correctly ignored. */
const tokenHits = (src, pred) => {
  let n = 0;
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    for (const tok of (m[1] || m[2] || "").split(/\s+/)) {
      if (pred(tok)) n++;
    }
  }
  return n;
};

// `grid-cols-N` with NO breakpoint prefix. `sm:grid-cols-3` starts with "sm:" so
// the `:` check rejects it; `grid-cols-1` is rejected on value.
const isUnprefixedCols = (tok, min = 2) => {
  const m = /^grid-cols-(\d+)$/.exec(tok);
  return !!m && Number(m[1]) >= min;
};

const RULES = [
  // A fixed N-column grid with no responsive prefix is the single most common
  // cause of the "squashed" look: N fields share the width forever.
  [3, "fixed-cols grid", (src) => tokenHits(src, (t) => isUnprefixedCols(t))],
  // Tables wider than the viewport, with no contained scroll wrapper.
  [3, "wide table", (src) => tokenHits(src, (t) => t === "tbl")],
  [2, "inline fixed width", (src) => (src.match(/style=\{\{[^}]*\bwidth:\s*\d{3,}/g) || []).length],
  [1, "min-width", (src) => tokenHits(src, (t) => /^min-w-\[\d{3,}px\]$/.test(t))],
  // A flex row that cannot wrap: the direct cause of the clipped-chip mess.
  [2, "flex-nowrap", (src) => tokenHits(src, (t) => t === "flex-nowrap")],
  // Already-correct patterns are credited, not penalised.
  [-2, "uses ResponsiveList", (src) => (src.match(/<ResponsiveList\b/g) || []).length],
  [-2, "uses rf- classes", (src) => tokenHits(src, (t) => t.startsWith("rf-"))],
];

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

const results = walk(VIEWS).map((file) => {
  const src = fs.readFileSync(file, "utf8");
  const hits = [];
  let score = 0;
  for (const [w, label, fn] of RULES) {
    const n = fn(src);
    if (n) {
      score += w * n;
      if (w > 0) hits.push(`${label} x${n}`);
    }
  }
  return {
    file: path.relative(ROOT, file).replace(/\\/g, "/"),
    lines: src.split("\n").length,
    score,
    hits,
  };
});

results.sort((a, b) => b.score - a.score || b.lines - a.lines);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log("score  lines  file");
  for (const r of results) {
    if (r.score <= 0) continue;
    console.log(
      String(r.score).padStart(5),
      String(r.lines).padStart(6),
      " ",
      r.file,
      r.hits.length ? "\n            " + r.hits.join(", ") : "",
    );
  }
  const clean = results.filter((r) => r.score <= 0).length;
  console.log(`\n${results.length - clean} screen(s) to review, ${clean} already clean.`);
}