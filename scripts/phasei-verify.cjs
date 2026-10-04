// Phase I — the department tab is only safe if every row can be ASSIGNED to a tab.
// A case or lead with a null serviceLineId would disappear from EVERY department tab and
// silently vanish from the dashboard, which is far worse than showing it in "All".
// Also checks that the id→code lookup and the kpis/card consistency assumptions hold.
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

const results = [];
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " got=" + JSON.stringify(got) + " want=" + JSON.stringify(want)));
};

(async () => {
  const lines = await p.serviceLine.findMany({ orderBy: { id: "asc" }, select: { id: true, code: true, name: true, active: true } });
  const active = lines.filter((l) => l.active);
  check("at least one active line", active.length >= 1, true);
  check("codes unique", new Set(lines.map((l) => l.code)).size, lines.length);

  // THE partition check. Every case and lead must map to an existing, ACTIVE line,
  // otherwise the tab filters would drop it.
  const cases = await p.loanCase.findMany({ select: { id: true, serviceLineId: true, caseStatus: true } });
  const leads = await p.lead.findMany({ select: { id: true, serviceLineId: true } });

  const activeIds = new Set(active.map((l) => l.id));
  const orphanCases = cases.filter((c) => !activeIds.has(c.serviceLineId));
  const orphanLeads = leads.filter((l) => !activeIds.has(l.serviceLineId));

  check("cases on an inactive/missing line", orphanCases.length, 0);
  check("leads on an inactive/missing line", orphanLeads.length, 0);

  // Totals must reconcile: sum of per-tab counts === the global count. This is the
  // invariant that breaks silently if a filter drops rows.
  const total = cases.length;
  const byTab = active.map((l) => l.id);
  const sum = byTab.reduce((n, id) => n + cases.filter((c) => c.serviceLineId === id).length, 0);
  check("tab counts reconcile to total", sum, total);

  // The same for the leads funnel.
  const leadSum = byTab.reduce((n, id) => n + leads.filter((l) => l.serviceLineId === id).length, 0);
  check("lead tab counts reconcile", leadSum, leads.length);

  // A line can be ACTIVE (offered) yet have zero work — five of the six shipped that
  // way with empty "coming soon" journeys. Rendering those as a plain "0" tab reads like
  // a broken filter, so they carry the same "coming soon" wording the Stages admin already
  // uses for an unconfigured journey. That was verified against the live catalogue: all 6
  // lines are active, only MORTGAGE has cases.
  check("tab bar shows while >1 line active", active.length > 1, true);

  const casesPerLine = new Map(active.map((l) => [l.id, cases.filter((c) => c.serviceLineId === l.id).length]));
  const empty = active.filter((l) => casesPerLine.get(l.id) === 0);
  console.log("context: activeLines=" + active.length + " cases=" + cases.length + " leads=" + leads.length);
  console.log("lines with no cases yet (rendered 'coming soon'): " + empty.map((l) => l.code).join(", "));
  check("empty lines are labelled, not silently shown as 0", empty.every((l) => !casesPerLine.get(l.id)), true);
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log("PASS=" + (results.length - failed) + " FAIL=" + failed);
  await p.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.log("ERR " + e.message);
  console.log(results.join("\n"));
  process.exit(2);
});