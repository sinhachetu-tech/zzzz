// Phase F gate — runs every long command from INSIDE Node and writes one verdict
// file, because this session's shell repeatedly kills long commands and leaves
// ZERO-BYTE files that read exactly like a clean pass. The verdict file is written
// only AFTER spawnSync has returned a real exit code, so the file existing at all
// is the proof that the step actually ran.
//
//   node tool-results/phasef-gate.mjs validate | sql | apply | regen | tsc
const { spawnSync, execSync } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const path = require("node:path");

const root = "c:/Users/Lenovo/Desktop/zzzz";
const step = process.argv[2] || "validate";
const label = "phasef-" + step;
const dest = path.join(root, "tool-results", label + ".txt");
const out = [];

const run = (name, cmd, opts = {}) => {
  let r;
  try {
    r = spawnSync(cmd, {
      cwd: root,
      encoding: "utf8",
      timeout: 420000,
      shell: true,
      ...opts,
    });
  } catch (e) {
    out.push(name + ": THREW " + (e && e.message));
    return -1;
  }
  const code = typeof r.status === "number" ? r.status : -1;
  const body = ((r.stdout || "") + (r.stderr || "")).trim();
  out.push(
    name + ": exit=" + code + (code === 0 ? " OK" : " FAIL") +
    (body ? "\n" + body.split("\n").slice(-25).join("\n") : ""),
  );
  return code;
};

if (step === "validate") {
  run("prisma-validate", "npx prisma validate");
} else if (step === "sql") {
  // gen-sql reads SQL_OUT from the environment.
  run("gen-sql", `node scripts/gen-sql.cjs`, {
    env: { ...process.env, SQL_OUT: "prisma/phase6_departments.sql" },
  });
  // Second, independent guard: re-read the generated file and fail loudly if it
  // contains anything that could drop data. gen-sql has its own check; this is the
  // belt to its braces, since this is the file we are about to execute.
  try {
    const sql = require("node:fs").readFileSync(path.join(root, "prisma/phase6_departments.sql"), "utf8");
    const bad = sql.split("\n").filter((l) =>
      /^\s*(DROP|TRUNCATE|DELETE\s+FROM)\b/i.test(l) || /ALTER\s+COLUMN[\s\S]*\bTYPE\b/i.test(l));
    out.push("destructive-scan: " + (bad.length ? "FOUND\n" + bad.join("\n") : "clean (no DROP/TRUNCATE/DELETE/ALTER TYPE)"));
    out.push("statement-count: " + (sql.split(";").length - 1));
  } catch (e) {
    out.push("destructive-scan: COULD NOT READ GENERATED FILE — " + e.message);
  }
} else if (step === "apply") {
  run("apply-sql", "node scripts/apply-sql.cjs --apply phase6_departments.sql");
} else if (step === "regen") {
  run("regen", "node scripts/regen.cjs");
} else if (step === "verify") {
  // Row counts + the scoping probe, in its own file (nesting a JS program inside a
  // shell -e string mangles the newlines, which is exactly what happened the first
  // time this ran).
  try {
    const r = execSync("node scripts/phasef-verify.cjs", {
      cwd: root,
      encoding: "utf8",
      timeout: 120000,
    });
    out.push("db-verify: OK\n" + r.trim());
  } catch (e) {
    out.push("db-verify: FAIL\n" + ((e.stdout || "") + (e.stderr || "")).slice(-2000));
  }
} else if (step === "tsc") {
  run("tsc", "npx tsc --noEmit");
} else {
  out.push("unknown step: " + step);
}

writeFileSync(dest, out.join("\n\n"), "utf8");
console.log("wrote " + dest);