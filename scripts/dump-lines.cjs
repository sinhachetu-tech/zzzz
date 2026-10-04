// Prints exact bytes of chosen lines — used to diagnose file corruption that
// the normal reader can't distinguish from stale output.
const fs = require("fs");
const file = process.argv[2];
const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
console.log("LINES=" + lines.length);
for (const a of process.argv.slice(3)) {
  const i = Number(a);
  console.log(`${i}: ${JSON.stringify(lines[i - 1])}`);
}

// Reports whether a tool-results file is COMPLETE. An empty tsc output is
// ambiguous (clean run vs killed mid-write), so the runner appends an explicit
// EXITn marker and this checks for it.
if (process.argv[3] === "--verify") {
  const f = process.argv[2];
  const st = fs.statSync(f);
  console.log(`BYTES=${st.size}`);
  const txt = fs.readFileSync(f, "utf8");
  const m = txt.match(/EXIT(\d+)/);
  console.log(m ? `COMPLETE exit=${m[1]}` : "INCOMPLETE (no exit marker)");
  if (txt.trim()) console.log("---BODY---\n" + txt);
}