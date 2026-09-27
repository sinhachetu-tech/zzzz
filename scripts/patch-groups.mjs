import { readFileSync, writeFileSync } from "fs";
const file = "src/components/views/admin.tsx";
let content = readFileSync(file, "utf-8");
const old = `  { key: "docs", label: "Docs & Fees", tabs: TAB_OPTIONS.filter((t) => ["docrules", "feerules", "templates", "storage"].includes(t.value)) },\n];`;
const replacement = `  { key: "docs", label: "Docs & Fees", tabs: TAB_OPTIONS.filter((t) => ["docrules", "feerules", "templates", "storage"].includes(t.value)) },\n  { key: "settings", label: "Settings", tabs: TAB_OPTIONS.filter((t) => ["notifications", "devices"].includes(t.value)) },\n];`;
if (!content.includes(old)) {
  console.error("NOT FOUND – searching for 'key: \"docs\"'…");
  const idx = content.indexOf('key: "docs"');
  console.log(JSON.stringify(content.slice(Math.max(0, idx - 2), idx + 200)));
  process.exit(1);
}
writeFileSync(file, content.replace(old, replacement), "utf-8");
console.log("Done ✓");
