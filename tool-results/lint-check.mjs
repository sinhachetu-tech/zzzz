// Lint gate — eslint every file touched by the datetime + dial work.
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const files = [
  "src/lib/format.ts",
  "src/components/hfmc/ui.tsx",
  "src/components/hfmc/charts.tsx",
  "src/components/views/tasks.tsx",
  "src/components/views/dashboard.tsx",
  "src/components/views/case-detail.tsx",
  "src/components/views/shell.tsx",
  "src/components/views/calculator.tsx",
  "src/components/views/reports.tsx",
  "src/app/api/cases/[id]/tasks/route.ts",
  "src/app/api/ai/insights/route.ts",
].map((f) => `"${f}"`).join(" ");
try {
  const r = execSync(`npx eslint ${files}`, { encoding: "utf8", timeout: 180000 });
  writeFileSync("tool-results/eslint-out.txt", "ESLINT_OK (no findings)\n" + r, "utf8");
} catch (e) {
  writeFileSync("tool-results/eslint-out.txt", "ESLINT_FINDINGS:\n" + (e.stdout || "") + (e.stderr || ""), "utf8");
}
