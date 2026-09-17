// Convergence check — writes ALL output to verify-out.txt (read separately).
// 1) task-due test suite via child_process (bypasses broken shell integration)
// 2) dial ship-check: does the served .next chunk graph contain the Dial arc?
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = [];
const log = (s) => out.push(s);

// 1) tests
try {
  const r = execSync("node --experimental-strip-types --test tests/task-due.test.mjs", { cwd: root, encoding: "utf8", timeout: 120000 });
  const lines = r.split("\n").filter((l) => /^(# tests|# pass|# fail|not ok)/.test(l.trim()));
  log("TESTS: " + lines.join(" | "));
} catch (e) {
  log("TESTS FAILED:\n" + (e.stdout || "") + "\n" + (e.stderr || ""));
}

// 2) dial component arc + calculator usage in built chunks
let arc = 0, label = 0;
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) { if (!f.includes("cache")) walk(f); continue; }
    if (!f.endsWith(".js")) continue;
    const s = readFileSync(f, "utf8");
    if (s.includes("M 18 112") && s.includes("stroke-dasharray")) { arc++; log("ARC_CHUNK " + path.basename(f)); }
    if (s.includes("DBR after mortgage")) { label++; log("LABEL_CHUNK " + path.basename(f)); }
  }
};
try { walk(path.join(root, ".next")); } catch (e) { log("WALK_ERR " + e.message); }
log("SUMMARY arcChunks=" + arc + " labelChunks=" + label);
writeFileSync(path.join(root, "tool-results", "verify-out.txt"), out.join("\n"), "utf8");
