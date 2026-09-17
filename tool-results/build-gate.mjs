// Production build gate — full output to build-out.txt.
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

try {
  const r = execSync("npx next build", {
    encoding: "utf8",
    timeout: 900000,
    cwd: "c:/Users/Lenovo/Desktop/zzzz",
    shell: "cmd.exe",
    maxBuffer: 64 * 1024 * 1024,
  });
  const tail = r.trim().split("\n").slice(-30).join("\n");
  writeFileSync("c:/Users/Lenovo/Desktop/zzzz/tool-results/build-out.txt", "BUILD_OK\n" + tail, "utf8");
} catch (e) {
  const txt = ((e.stdout || "") + "\n" + (e.stderr || "")).slice(-6000);
  writeFileSync("c:/Users/Lenovo/Desktop/zzzz/tool-results/build-out.txt", "BUILD_FAIL\n" + txt, "utf8");
}
