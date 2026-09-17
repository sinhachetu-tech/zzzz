// True end-to-end: login as super admin → add a task with due time → read it
// back from /api/state → assert the exact datetime persisted. Also proves the
// API rejects invalid dueDate formats. Writes verify-e2e.txt.
import { writeFileSync } from "node:fs";

const BASE = "http://127.0.0.1:3000";
const out = [];
const log = (s) => out.push(typeof s === "string" ? s : JSON.stringify(s));

// 1) login (cookie auto-managed by fetch in Node 22)
const loginRes = await fetch(BASE + "/api/auth/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "super@meridian.ae", password: "super123" }),
});
log("LOGIN=" + loginRes.status);
const cookie = (loginRes.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
const authHeaders = { "Content-Type": "application/json", cookie };

// 2) pick an active case to attach the task to
const state0 = await (await fetch(BASE + "/api/state", { headers: { cookie } })).json();
const activeCase = state0.cases.find((c) => c.caseStatus === "Active");
log("CASE=" + (activeCase ? activeCase.caseNumber : "NONE"));
if (!activeCase) { log("NO_ACTIVE_CASE — abort"); }
else {
  // 3) create the task with a UAE due datetime
  const DUE = "2026-12-24T15:30";
  const addRes = await fetch(`${BASE}/api/cases/${activeCase.id}/tasks`, {
    method: "POST", headers: authHeaders,
    body: JSON.stringify({ description: "E2E datetime persistence check", ownerId: state0.me.id, waitingFor: "Internal", whyPending: "Internal review", dueDate: DUE }),
  });
  log("ADD=" + addRes.status);
  const added = await addRes.json().catch(() => ({}));
  const taskId = added.task?.id;
  log("DUE_SAVED=" + (added.task?.dueDate ?? "?"));

  // 4) read it back from the full-state endpoint (what the UI renders from)
  const state1 = await (await fetch(BASE + "/api/state", { headers: { cookie } })).json();
  const persisted = state1.tasks.find((t) => t.id === taskId);
  log("PERSISTED_DUE=" + (persisted?.dueDate ?? "NOT_FOUND"));
  log("PERSIST_EXACT=" + (persisted?.dueDate === DUE));

  // 5) the API must reject invalid due formats (validation guard)
  const bad = await fetch(`${BASE}/api/cases/${activeCase.id}/tasks`, {
    method: "POST", headers: authHeaders,
    body: JSON.stringify({ description: "bad", ownerId: state0.me.id, waitingFor: "Internal", whyPending: "Internal review", dueDate: "2026-09-31" }),
  });
  log("BAD_REJECTED=" + (bad.status === 400));

  // 6) clean up the check task
  if (taskId) await fetch(`${BASE}/api/tasks/${taskId}`, { method: "DELETE", headers: { cookie } });
  const state2 = await (await fetch(BASE + "/api/state", { headers: { cookie } })).json();
  log("CLEANED=" + !state2.tasks.some((t) => t.id === taskId));
}
writeFileSync("tool-results/verify-e2e.txt", out.join("\n"), "utf8");
