// Find lines matching a pattern in a source file and write them to a result file.
// This session's PowerShell console corrupts under long commands (PSReadLine
// ArgumentOutOfRangeException) and loses piped output entirely, so greps go
// through Node and land in tool-results/ where they can be read reliably.
//
//   node scripts/find.cjs <file> <pattern> [outLabel]

const fs = require("fs");
const path = require("path");

const [file, pattern, label] = process.argv.slice(2);
if (!file || !pattern) {
  console.error("usage: node scripts/find.cjs <file> <pattern> [outLabel]");
  process.exit(1);
}

const abs = path.resolve(process.cwd(), file);
const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);

let re;
try {
  re = new RegExp(pattern, "i");
} catch {
  re = { test: (s) => s.toLowerCase().includes(pattern.toLowerCase()) };
}

const hits = [];
lines.forEach((text, i) => {
  if (re.test(text)) hits.push(String(i + 1).padStart(5) + ": " + text.trim());
});

const body = hits.length
  ? hits.join("\n")
  : "(no matches in " + path.basename(abs) + ")";

const outFile = path.resolve(
  __dirname,
  "..",
  "tool-results",
  (label || "find") + ".txt",
);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, body + "\n", "utf8");
console.log(body);
console.log("\n" + hits.length + " hit(s) -> " + outFile);