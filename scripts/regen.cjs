// Regenerate the Prisma client, properly.
//
// WHY THIS SCRIPT EXISTS: `prisma generate` fails with EPERM while `next dev` is
// running, because the dev server holds query_engine-windows.dll.node. Phase A
// papered over that with $queryRaw — the wrong call, driven by the tool being
// unavailable rather than by the data being demo-only. It IS demo-only, so the
// correct move is to stop the dev server and use the typed client throughout.
//
// Kills the other node processes, runs generate, then VERIFIES the models actually
// landed — "generate exited 0" is not evidence of that, the client can still be
// stale in ways the command does not report.
//
//   node scripts/regen.cjs        → writes tool-results/regen-prisma.txt

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const outFile = path.join(root, "tool-results", "regen-prisma.txt");
const lines = [];
const say = (s = "") => lines.push(s);

function nodePids() {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq node.exe" /FO CSV /NH', {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const ids = [];
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^"node\.exe","(\d+)"/);
      if (m) ids.push(m[1]);
    }
    return ids;
  } catch {
    return [];
  }
}

function flush(verdict) {
  const body = verdict + "\n" + lines.join("\n") + "\n";
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, body, "utf8");
  console.log(body);
}

// 1. stop everything holding the engine DLL
const found = nodePids();
say("node processes found: " + (found.length ? found.join(", ") : "(none)"));
const killed = [];
for (const id of found) {
  if (Number(id) === process.pid) continue;
  try {
    execSync("taskkill /PID " + id + " /F", { stdio: "ignore" });
    killed.push(id);
  } catch {
    say("  could not kill " + id);
  }
}
say("killed: " + (killed.length ? killed.join(", ") : "(none)"));

// 2. generate
let genOut = "";
let genCode = -1;
try {
  genOut = execSync("npx prisma generate", {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
  genCode = 0;
} catch (e) {
  genOut = String(e.stdout || "") + String(e.stderr || "");
  genCode = typeof e.status === "number" ? e.status : -1;
}
say("\n--- prisma generate (exit " + genCode + ") ---");
say(genOut.trim() || "(no output)");

// 3. verify the models actually landed.
// Every route imports the typed client; if db.caseParty is still missing, generate
// did not do its job and the code will not compile.
const probeScript = [
  "const { PrismaClient } = require('@prisma/client');",
  "const p = new PrismaClient();",
  "const ks = ['caseParty','serviceLine','lead','stageSet'];",
  "console.log(ks.map(k => k + '=' + (p[k] ? 'yes' : 'NO')).join(' '));",
  "p.$disconnect();",
].join(" ");
let probe = "";
let ok = false;
try {
  probe = execSync("node -e " + JSON.stringify(probeScript), {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  ok = probe.indexOf("NO") === -1;
} catch (e) {
  probe = String(e.stdout || "") + String(e.stderr || "");
}
say("\n--- client probe ---");
say(probe.trim() || "(no output)");

flush(
  ok
    ? "=== regen: PASS ==="
    : "=== regen: FAIL - client still missing a model, or generate errored ===",
);