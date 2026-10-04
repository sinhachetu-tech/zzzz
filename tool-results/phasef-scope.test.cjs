// Compiles tool-results/phasef-scope.ts with the project's own tsconfig paths, then
// runs it — so the assertions execute against the REAL src/lib/domain.ts, never a copy.
// (Phase 5's test re-implemented the rule inline and passed while the shipped helper
// was broken. That is the failure mode this runner exists to prevent.)
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const root = "c:/Users/Lenovo/Desktop/zzzz";
const out = [];

const r = spawnSync("npx", ["tsc", "tool-results/phasef-scope.ts", "--outDir", "tool-results/_fbuild", "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck", "--strict", "false", "--baseUrl", ".", "--paths", "@/*=*"], {
  cwd: root, encoding: "utf8", timeout: 300000,
});

if (r.status !== 0) {
  out.push("COMPILE FAILED\n" + ((r.stdout || "") + (r.stderr || "")).slice(-3000));
  process.exit(2);
}

// tsc preserves the "@/..." specifiers; rewrite them to absolute paths so node resolves
// them without a bundler or a loader hook.
const jsPath = path.join(root, "tool-results/_fbuild/phasef-scope.js");
let js = fs.readFileSync(jsPath, "utf8");
js = js.replace(/from\s+["']@\/([^"']+)["']/g, (_m, p) => `from "${path.join(root, p).replace(/\\/g, "/")}"`);
fs.writeFileSync(jsPath, js, "utf8");

const run = spawnSync(process.execPath, [jsPath], { cwd: root, encoding: "utf8", timeout: 120000 });
out.push("TEST OUTPUT:\n" + ((run.stdout || "") + (run.stderr || "")).trim());
out.push("exit=" + run.status);
fs.mkdirSync(path.join(root, "tool-results"), { recursive: true });
fs.writeFileSync(path.join(root, "tool-results/phasef-scope-result.txt"), out.join("\n"), "utf8");
console.log(out.join("\n"));
process.exit(run.status ?? 3);