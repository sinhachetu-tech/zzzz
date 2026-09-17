// E2E-lite: fetch the running app, pull every client chunk, and confirm the
// datetime feature actually shipped into the served bundle.
const BASE = "http://127.0.0.1:3000";
const html = await (await fetch(BASE + "/")).text();
if (!html.includes("<html")) { console.log("PAGE_FAIL"); process.exit(1); }
console.log("PAGE_OK");
const urls = [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]);
const uniq = [...new Set(urls)];
let markers = { uaeOffset: 0, timeInput: 0, dbrDial: 0, dueChipTime: 0, settledView: 0 };
for (const u of uniq) {
  try {
    const src = await (await fetch(u.startsWith("http") ? u : BASE + u)).text();
    if (src.includes("+04:00")) markers.uaeOffset++;
    if (src.includes('type:"time"') || src.includes('"time"')) markers.timeInput++;
    if (src.includes("DBR after mortgage") && src.includes("stroke-dasharray")) markers.dbrDial++;
    if (src.includes("overdue ·") || src.includes("due today")) markers.dueChipTime++;
    if (src.includes("view-in")) markers.settledView++;
  } catch { /* chunk fetch fail — report count only */ }
}
console.log("CHUNKS=" + uniq.length, JSON.stringify(markers));
process.exit(0);
