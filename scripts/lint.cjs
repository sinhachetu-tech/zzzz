// ESLint runner with the same self-written-verdict approach as typecheck.cjs.
//
//   node scripts/lint.cjs <label> <path...>

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const label = process.argv[2] || "lint";
const files = process.argv.slice(3);
const targets = files.length ? files : ["src"];

const res = spawnSync("npx", ["eslint", ...targets], {
  cwd: root,
  encoding: "utf8",
  shell: true,
  maxBuffer: 32 * 1024 * 1024,
});

const body = (String(res.stdout || "") + String(res.stderr || "")).trim();
const lines = body ? body.split(/\r?\n/) : [];
const report = [
  "=== npx eslint " + targets.join(" ") + " : " + (res.status === 0 ? "PASS" : "FAIL") +
    " (exit " + res.status + ") ===",
  ...(lines.length ? lines : ["(no output)"]),
].join("\n");

const outFile = path.join(root, "tool-results", label + ".txt");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, report + "\n", "utf8");
console.log(report);