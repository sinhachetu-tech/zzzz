/* Verifies the responsive width layer in src/app/globals.css actually compiles.
   A full `next build` takes several minutes on this repo, but the only genuinely
   risky part of the layer is the CSS itself (an @container block, a nested
   media query, custom properties). This runs the real PostCSS + Tailwind v4
   pipeline over globals.css and fails on any parse error, so a broken rule is
   caught in seconds instead of at the end of a build.

   Usage: node scripts/verify-responsive-css.cjs            (pass/fail, non-zero exit)
          node scripts/verify-responsive-css.cjs --print    (also dump the output) */
const fs = require("fs");
const path = require("path");
const postcss = require("postcss");
const tailwindcss = require("@tailwindcss/postcss");

const ROOT = path.resolve(__dirname, "..");
const CSS = path.join(ROOT, "src", "app", "globals.css");

async function main() {
  const from = fs.readFileSync(CSS, "utf8");

  let css;
  try {
    css = await postcss([tailwindcss()]).process(from, { from: CSS });
  } catch (err) {
    console.error("FAIL: globals.css did not compile\n");
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  }

  const out = css.css;
  const problems = [];

  // The layer is only useful if these actually made it through the build.
  const required = [
    ".rf-page",
    ".rf-toolbar",
    ".rf-form-grid",
    ".rf-scroll",
    ".rf-card-list",
    ".rf-card",
    ".rf-card-tap",
    ".rf-desktop-only",
    ".rf-tap",
    ".rf-container",
    "@container",
  ];
  for (const sel of required) {
    if (!out.includes(sel)) problems.push(`missing expected rule: ${sel}`);
  }

  // An unclosed @media/@container block silently swallows the rest of the file.
  // PostCSS usually catches that on its own, but count the open/close pairs
  // explicitly so a regression here fails loudly rather than quietly dropping
  // every rule after the break.
  const countPair = (name) => {
    const open = (out.match(new RegExp(`@${name}\\b`, "g")) || []).length;
    const close = (out.match(new RegExp(`@${name}[^{]*\{`, "g")) || []).length;
    return { open, close };
  };
  for (const name of ["media", "container"]) {
    const { open, close } = countPair(name);
    if (open !== close) problems.push(`@${name} open/close mismatch: ${open}/${close}`);
  }

  if (problems.length) {
    console.error("FAIL: responsive layer did not survive the build\n");
    for (const p of problems) console.error("  - " + p);
    process.exit(1);
  }

  console.log(`OK: globals.css compiled (${out.length} bytes) and the responsive layer is present.`);
  if (process.argv.includes("--print")) console.log(out);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});