const { execSync } = require("child_process");
const fs = require("fs");
const d = execSync("git diff HEAD -- src/components/views/calculator.tsx", {
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
});
fs.writeFileSync("tool-results/calc.diff", d);
console.log("bytes", d.length);