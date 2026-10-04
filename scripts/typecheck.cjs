// Typecheck runner that writes its OWN verdict file.
//
// This session's shell cannot be trusted to capture long command output: a killed
// command leaves a ZERO-BYTE file that reads exactly like a clean pass, and that
// nearly caused a false "typecheck green" report earlier. Writing the verdict from
// inside Node — only AFTER spawnSync has actually returned with an exit code —
// means the file existing at all is the proof that it ran.
//
//   node scripts/typecheck.cjs [label]

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const label = process.argv[2] || "tsc";
const outFile = path.join(root, "tool-results", `${label}.txt`);

const res = spawnSync("npx", ["tsc", "--noEmit"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
  maxBuffer: 32 * 1024 * 1024,
});

const body = `${res.stdout || ""}${res.stderr || ""}`.trim();
const lines = body ? body.split(/\r?\n/) : [];
const report = [
  `=== npx tsc --noEmit : ${res.status === 0 ? "PASS" : "FAIL"} (exit ${res.status}) ===`,
  ...(lines.length ? lines : ["(no diagnostics)"]),
].join("\n");

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, report + "\n", "utf8");
console.log(report);
console.log(`wrote ${outFile}`);