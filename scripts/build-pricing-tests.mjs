// Test harness for the pricing floor / cap trace / norms / unknown-axis logic.
//
// WHY transpile-without-a-runner: the repo's existing suite runs under `bun`, which
// is not on every machine's PATH, and bank-match.ts pulls in Prisma. The functions
// under test are PURE, so we compile just them with the TypeScript compiler that is
// already a dependency, and run them under plain node. No new dependency, no DB.
//
//   node scripts/build-pricing-tests.mjs && npm run test:pricing
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const opts = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true };
const stripImports = (src) => src.replace(/^import .*$/gm, "");

function compile(srcFile, outFile, transform = stripImports) {
  const js = ts.transpileModule(transform(readFileSync(join(root, srcFile), "utf8")), {
    compilerOptions: opts,
  }).outputText;
  writeFileSync(join(root, outFile), js);
}

// The two pure exports of bank-match.ts, lifted out by anchor so the Prisma import
// (and the whole DB layer behind it) never has to be satisfied.
const capsFrom = (src) => {
  const i = src.indexOf("export interface CapResolution");
  const j = src.indexOf("export async function runBankMatch");
  if (i < 0 || j < 0) throw new Error("bank-match.ts anchors moved — update scripts/build-pricing-tests.mjs");
  // drop the `export` keyword (these live in a standalone module) and re-export
  // explicitly so the compiled CommonJS actually exposes them
  return `${src.slice(i, j).replace(/^export /gm, "")}\nmodule.exports = { resolveCaps, resolveNorm };\n`;
};

compile("src/lib/bank-pricing.ts", ".tmp-pricing.js", (src) =>
  // bank-pricing imports setMatches/nationalityAllowed/unknownAxes from the taxonomy,
  // which is compiled as a separate sibling — strip only THAT import and re-wire it.
  src
    .replace(/^import \{[^}]*\} from "@\/lib\/bank-rules-taxonomy";$/gm, 'const { setMatches, nationalityAllowed, unknownAxes } = require("./.tmp-tax.js");')
    .replace(/^import .*$/gm, ""),
);
compile("src/lib/bank-rules-taxonomy.ts", ".tmp-tax.js");
compile("src/lib/bank-match.ts", ".tmp-caps.js", capsFrom);
// bank-fees.ts is pure too (its only import is todayISO from format.ts), so the fee
// inheritance rules can be asserted here rather than only through a live DB read.
compile("src/lib/format.ts", ".tmp-format.js");
compile("src/lib/bank-fees.ts", ".tmp-fees.js", (src) =>
  src
    .replace(/^import \{ todayISO \} from "@\/lib\/format";$/m, 'const { todayISO } = require("./.tmp-format.js");')
    .replace(/^import .*$/gm, ""),
);
// product-issues.ts only needs the RateQuote TYPE, which erases at runtime.
compile("src/lib/product-issues.ts", ".tmp-issues.js");
// The test imports the real modules via the "@/lib/*" path alias, which node cannot
// resolve. Rewrite each specifier to the compiled sibling sitting next to it.
const ALIAS = {
  "@/lib/bank-pricing": "./.tmp-pricing.js",
  "@/lib/bank-rules-taxonomy": "./.tmp-tax.js",
  "@/lib/bank-match": "./.tmp-caps.js",
  "@/lib/bank-fees": "./.tmp-fees.js",
  "@/lib/product-issues": "./.tmp-issues.js",
  "@/lib/format": "./.tmp-format.js",
};
const rewriteAliases = (src) => {
  let out = src;
  for (const [from, to] of Object.entries(ALIAS)) {
    out = out.split(`"${from}"`).join(`"${to}"`);
  }
  if (/from "@\/lib\//.test(out)) throw new Error("unmapped @/lib import in the test — add it to ALIAS");
  return out;
};

// NOTE: imports are deliberately NOT stripped — the three import statements are
// exactly what wires the test to its compiled siblings.
compile("tests/pricing-floor.test.ts", ".tmp-test.js", rewriteAliases);

const artifacts = [".tmp-pricing.js", ".tmp-tax.js", ".tmp-caps.js", ".tmp-fees.js", ".tmp-format.js", ".tmp-issues.js", ".tmp-test.js"];
let code = 0;
try {
  const { createRequire } = await import("node:module");
  createRequire(import.meta.url)(join(root, ".tmp-test.js"));
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  code = 1;
} finally {
  // never leave build artefacts in the tree, even if the run was interrupted
  for (const f of artifacts) {
    if (existsSync(join(root, f))) unlinkSync(join(root, f));
  }
}
process.exit(code);

