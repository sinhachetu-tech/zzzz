"use client";

/* Dashboard — the floor's analytics: KPIs, escalations, task breakdowns,
   activity. The worklist itself lives in the Cases tab; leads in Leads. */

import { useEffect, useMemo, useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import { OPEN_LEAD_STATUSES, type BulletinItem } from "@/lib/types";
import { activityPerDay, computeKpis } from "@/lib/domain";
import { TONE_HEX, caseStatusOf, dueDay, fmtDue, fmtMoney, greetingFor, isOverdueDue, parseTaskDue, relTime, todayISO } from "@/lib/format";
import { Avatar, DueChip, KpiValue } from "@/components/hfmc/ui";
import { BarList, Donut, Spark } from "@/components/hfmc/charts";
import { IArrowR, ICheck, IFlag } from "@/components/icons";

function useTick(intervalMs: number) {
  const [, setT] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setT((x) => x + 1), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
}

function Kpi({ label, value, format, tone, sub }: { label: string; value: number; format?: (n: number) => string; tone?: "mint" | "amber" | "coral" | "sky"; sub?: string }) {
  // on the shared .kpi primitive (was a hand-rolled card with its own 30px/11px
  // type), so the dashboard strip matches admin/agent/calculator tiles
  const color = tone ? `var(--${tone})` : "var(--ink)";
  return (
    // `shrink-0` matters: without it the flex strip squeezes all 7 tiles to fit
    // 390px instead of honouring min-w-[150px] and scrolling.
    <div className="kpi kpi-plain min-w-[150px] shrink-0">
      <div className="kpi-label">{label}</div>
      <KpiValue value={value} format={format} style={{ color, fontSize: 26, marginTop: 2 }} />
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const { cases, leads, tasks, activities, stages, banks, bankProducts, whyPending, waitingFor, users, me, nav, userById, visibleCases, visibleTasks, escalations, bulletin, visibleCaseIds, visibleTaskIds, flags, completeTask, toast, serviceLines } = useHfmcStore();
  useTick(30000);

  // deps must include the data arrays (cases/visibleCaseIds/tasks/visibleTaskIds)
  // — NOT the store function references, which are stable and would prevent
  // the memo from recomputing when data loads after mount (the login case).
  const visCases = useMemo(() => visibleCases(), [visibleCases, cases, visibleCaseIds]);
  const visTasks = useMemo(() => visibleTasks(), [visibleTasks, tasks, visibleTaskIds]);
  const k = useMemo(
    () => computeKpis(visCases, visTasks, (c) => caseStatusOf(c, tasks), banks, escalations),
    [visCases, visTasks, banks, escalations, tasks]
  );
  const spark = useMemo(
    () => activityPerDay(activities.filter((a) => visCases.some((c) => c.id === a.caseId)), 14),
    [activities, visCases],
  );

  const openTasks = visTasks.filter((t) => t.status === "Open");

  /* Phase I — department tabs.
   *
   * THE DASHBOARD STAYS GLOBAL. The firm wants total pipeline, so the cards are never
   * scoped to a department by default; the tab is a lens ON TOP of a global view. That is
   * the opposite of the Clients list, which must NOT be filtered (one person, all
   * services) — hiding half a person's history there would break read-across.
   *
   * Persisted by service-line CODE, never by id: ids die with the database, codes are the
   * stable contract. Same reasoning as the worklist filter.
   */
  const activeLines = useMemo(() => serviceLines.filter((s) => s.active), [serviceLines]);
  const multiLine = activeLines.length > 1;

  const [deptCode, setDeptCode] = useState<string>(() => {
    try { return localStorage.getItem("hfmc.dashboardDept") ?? ""; } catch { return ""; }
  });
  useEffect(() => {
    try {
      if (deptCode) localStorage.setItem("hfmc.dashboardDept", deptCode);
      else localStorage.removeItem("hfmc.dashboardDept");
    } catch { /* private mode */ }
  }, [deptCode]);

  // A line that has since been deactivated must not silently filter everything away.
  const deptLine = deptCode ? serviceLines.find((s) => s.code === deptCode) : undefined;
  const scopedCases = useMemo(
    () => (deptLine ? visCases.filter((c) => c.serviceLineId === deptLine.id) : visCases),
    [visCases, deptLine],
  );
  const scopedCaseIds = useMemo(() => new Set(scopedCases.map((c) => c.id)), [scopedCases]);
  // Tasks are filtered by the cases they belong to, so the tab cannot show a task whose
  // case is filtered out — otherwise the counts disagree with the worklist.
  const scopedTasks = useMemo(
    () => visTasks.filter((t) => scopedCaseIds.has(t.caseId)),
    [visTasks, scopedCaseIds],
  );
  const scopedKpis = useMemo(
    () => computeKpis(scopedCases, scopedTasks, (c) => caseStatusOf(c, tasks), banks, escalations),
    [scopedCases, scopedTasks, banks, escalations, tasks],
  );
  // Leads carry their own serviceLineId, so the tab narrows the funnel too.
  const scopedLeads = useMemo(
    () => (deptLine ? leads.filter((l) => l.serviceLineId === deptLine.id) : leads),
    [leads, deptLine],
  );

  // Every KPI reads THIS, not `k`. One alias means no consumer can accidentally keep
  // using the global figures while the tab is active — which would be the worst kind
  // of bug here: the cards would disagree with the filter above them.
  const kShown = deptLine ? scopedKpis : k;

  // Bank Products card counts. `bankProducts` is already in the hydrated store, so
  // this costs no extra request on the dashboard. Only APPROVED + active products
  // count, because that is exactly what the Products page will list.
  const liveProducts = useMemo(
    () => bankProducts.filter((p) => p.status === "approved" && p.active),
    [bankProducts],
  );
  const bankProductCount = liveProducts.length;
  const bankCount = useMemo(
    () => new Set(liveProducts.map((p) => p.bankName).filter(Boolean)).size,
    [liveProducts],
  );
  // a rate line per quote, not per product — the Products list is built this way
  const rateLineCount = useMemo(
    () => liveProducts.reduce((n, p) => {
      try {
        const parsed = JSON.parse(p.pricingJson || "{}");
        return n + (Array.isArray(parsed.quotes) ? parsed.quotes.length : 0);
      } catch {
        return n; // unparseable pricing JSON counts as zero, not as a crash
      }
    }, 0),
    [liveProducts],
  );

  const whyRows = whyPending
    .map((w) => ({ label: w.label, value: openTasks.filter((t) => t.whyPending === w.label).length, color: TONE_HEX.amber }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const waitSegs = waitingFor
    .map((w, i) => ({ label: w.label, value: openTasks.filter((t) => t.waitingFor === w.label).length, color: ["#f2b04c", "#57c2ea", "#43d69b", "#f27363", "#8ca6b0"][i % 5] }))
    .filter((s) => s.value > 0);

  const ownerRows = Array.from(new Set(openTasks.map((t) => t.ownerId)))
    .map((id) => ({ id, name: userById(id)?.name ?? "Unassigned", open: openTasks.filter((t) => t.ownerId === id).length, od: openTasks.filter((t) => t.ownerId === id && isOverdueDue(t.dueDate)).length }))
    .sort((a, b) => b.open - a.open)
    .slice(0, 6);

  const recent = [...activities]
    .filter((a) => visCases.some((c) => c.id === a.caseId))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 7);

  // stage funnel — live active work per stage (leads excluded, they are the funnel mouth)
  const funnelRows = stages
    .filter((st) => st.active && st.label !== "Lead")
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((st) => ({ label: st.label, value: visCases.filter((c) => c.caseStatus === "Active" && c.stage === st.label).length }))
    .filter((r) => r.value > 0);

  // Leads waiting in the funnel (Phase 4: reads the Lead table, not case stages).
  const openLeads = leads.filter((l) => OPEN_LEAD_STATUSES.includes(l.status));
  const leadsWaiting = openLeads;

  // my tasks due today (or overdue)
  // My urgent tasks — due today or overdue. Exact instant ordering (9am above 6pm).
  const myDueToday = me
    ? openTasks.filter((t) => t.ownerId === me.id && dueDay(t.dueDate) <= todayISO()).sort((a, b) => (parseTaskDue(a.dueDate)?.getTime() ?? 0) - (parseTaskDue(b.dueDate)?.getTime() ?? 0)).slice(0, 6)
    : [];

  const liveToday = (b: BulletinItem) => !b.isTemplate && !b.dropped && b.status === "Open" && b.date === todayISO();
  const myOpenDirectives = me ? bulletin.filter((b) => liveToday(b) && b.targets.includes(me.id)) : [];
  const issuedOpenDirectives = me ? bulletin.filter((b) => liveToday(b) && b.issuedBy === me.id) : [];

  const scope =
    me?.role === "Head of Company" || me?.role === "PA to HoC" || me?.role === "Mortgage Head" || me?.role === "Super Admin"
      ? "all teams"
      : me?.role === "Team Leader SPO" || me?.role === "Team Leader VRM"
        ? `team ${me.team}`
        : "your book";

  // 1) ROLE-BASED HOME — My Day strip for frontline (SPO / VRM incl. Team Leaders).
  const roleName = (me?.role ?? "").toLowerCase();
  const isFrontline = roleName.includes("spo") || roleName.includes("vrm");
  const greeting = greetingFor(me?.name);
  const myOpenAll = me ? openTasks.filter((t) => t.ownerId === me.id) : [];
  const myOverdueAll = myOpenAll.filter((t) => isOverdueDue(t.dueDate));
  const myDueNowCount = me ? myOpenAll.filter((t) => !isOverdueDue(t.dueDate) && dueDay(t.dueDate) <= todayISO()).length : 0;
  // "My new leads" — from the Lead table (Phase 4). Sorted by arrival, not by the
  // SLA clock: this strip answers "what just landed on me", and the Leads tab
  // is where the going-quiet ones live. Phase I: scoped to the department tab, so
  // the strip agrees with the KPI cards rather than contradicting them.
  const myNewLeads = me
    ? scopedLeads.filter((l) => l.ownerId === me.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3)
    : [];
  const myDayList = [...myDueToday];
  const myDayEmpty = myOverdueAll.length === 0 && myDayList.length === 0 && myNewLeads.length === 0;

  const doneQuick = async (taskId: number, label: string) => {
    try {
      await completeTask(taskId, "");
      toast("success", `"${label}" marked done.`);
    } catch { toast("error", "Could not complete task. Try again."); }
  };

  return (
    <div className="space-y-5">
      {/* Phase I — department tabs. HIDDEN while a single line is active: a tab bar
          offering one option is noise, and this matches the worklist's rule exactly. */}
      {multiLine && (
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Department">
          <button
            role="tab"
            aria-selected={!deptLine}
            className={`chip cursor-pointer ${!deptLine ? "" : "opacity-70"}`}
            style={!deptLine ? { background: "var(--ink)", color: "var(--paper)" } : undefined}
            onClick={() => setDeptCode("")}
          >
            All departments
          </button>
          {activeLines.map((s) => {
            const on = deptLine?.id === s.id;
            const count = visCases.filter((c) => c.serviceLineId === s.id).length;
            // A line can be ACTIVE (offered) with zero work — five shipped that way with
            // empty "coming soon" journeys. A bare "0" reads like a broken filter, so it
            // says so instead. Verified: all 6 lines are active, only MORTGAGE has cases.
            return (
              <button
                key={s.id}
                role="tab"
                aria-selected={on}
                className={`chip cursor-pointer ${on ? "" : "opacity-70"}`}
                style={on ? { background: "var(--ink)", color: "var(--paper)" } : undefined}
                title={count === 0 ? `${s.name} — no cases yet` : s.name}
                onClick={() => setDeptCode(s.code)}
              >
                {s.shortName || s.name}
                {count === 0
                  ? <span className="ml-1 opacity-60">soon</span>
                  : <span className="ml-1 opacity-70">{count}</span>}
              </button>
            );
          })}
        </div>
      )}
      {/* Explains WHY the numbers below changed, rather than leaving the user to guess
          whether the tab is hiding their work. */}
      {multiLine && deptLine && (
        <p className="text-[11.5px] text-[var(--ink-faint)] m-0">
          Showing <strong>{deptLine.name}</strong> only — the firm's totals are unchanged, this is a lens.
          {" "}Clients are deliberately <em>not</em> filtered: one person holds every service.
        </p>
      )}
      {isFrontline && (
        <div className="card p-4 sm:p-5 anim-fade-up" style={{ borderLeft: "3px solid var(--amber)" }}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-disp font-bold text-[20px] tracking-tight m-0">{greeting}</h2>
              <p className="text-[12.5px] text-[var(--ink-dim)] mt-1 mb-0">
                <strong style={{ color: myOverdueAll.length ? "var(--coral)" : "var(--ink)" }}>{myOverdueAll.length} overdue</strong>
                {" · "}{myDueNowCount} due today{" · "}{myNewLeads.length} new lead{myNewLeads.length === 1 ? "" : "s"} · {myOpenAll.length} open total
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn btn-ghost btn-sm" onClick={() => nav({ name: "tasks" })}>Task queue <IArrowR size={12} /></button>
              <button className="btn btn-ghost btn-sm" onClick={() => nav({ name: "leads" })}>Leads <IArrowR size={12} /></button>
            </div>
          </div>
          {myDayEmpty ? (
            <p className="text-[13px] text-[var(--ink-faint)] m-0 mt-3">Clean slate — nothing overdue, nothing due today. Pick up a lead or check Cases.</p>
          ) : (
            <div className="space-y-2 mt-3">
              {myDayList.map((t) => {
                const c = cases.find((x) => x.id === t.caseId);
                const od = isOverdueDue(t.dueDate);
                return (
                  <div key={t.id} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2" style={{ background: "var(--tint)", border: "1px solid var(--line-soft)" }}>
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: od ? "var(--coral)" : "var(--amber)" }} />
                    <button className="min-w-0 flex-1 text-left" onClick={() => c && nav({ name: "case", id: c.id })} title={`${c?.caseNumber ?? ""} — open case`}>
                      <span className="block text-[13px] font-medium truncate">{t.description}</span>
                      <span className="block mono text-[10.5px] text-[var(--ink-faint)]">{c?.caseNumber ?? "—"} · {c?.customer ?? ""} · {fmtDue(t.dueDate)}</span>
                    </button>
                    <DueChip dueISO={t.dueDate} />
                    <button className="btn btn-ghost btn-sm !px-2 shrink-0" onClick={() => c && nav({ name: "case", id: c.id })}>Open</button>
                    <button className="btn btn-mint btn-sm !px-2 shrink-0" title="Mark done" onClick={() => doneQuick(t.id, t.description)}><ICheck size={13} /></button>
                  </div>
                );
              })}
              {myNewLeads.length > 0 && myDayList.length === 0 && myNewLeads.map((l) => (
                // A lead is NOT a case (Phase 4) — it has no case number and no
                // Case 360 to open, so this navigates to the FUNNEL instead.
                <button key={l.id} className="rowlink w-full text-left flex items-center gap-2.5 rounded-lg px-2.5 py-2" style={{ border: "1px dashed var(--amber-line)" }} onClick={() => nav({ name: "leads" })}>
                  <span className="text-[13px] flex-1 truncate"><strong>New lead:</strong> {l.fullName} <span className="mono text-[10.5px] text-[var(--ink-faint)]">{l.serviceLineName ?? ""} · {relTime(l.createdAt)}</span></span>
                  <span className="text-[11.5px] font-semibold" style={{ color: "var(--amber)" }}>Qualify →</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {/* Frontline get their greeting inside the My Day card above; managers
          (HoC, Mortgage Head, PA, Super Admin) previously got none at all, so
          they now get the same one here. Same helper, same format, everyone. */}
      {!isFrontline && (
        <h2 className="font-disp font-bold text-[20px] tracking-tight m-0 anim-fade-up">{greeting}</h2>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-disp font-bold text-[24px] tracking-tight m-0">
            Dashboard · <span style={{ color: "var(--amber)" }}>{scope}</span>
          </h1>
          <p className="text-[13px] text-[var(--ink-dim)] mt-0.5 mb-0">
            The floor at a glance — {kShown.openCases} live cases · {fmtMoney(kShown.pipelineValue)} in flight · {kShown.escalations} SLA breach{kShown.escalations === 1 ? "" : "es"}. Work happens in <button className="underline font-medium" onClick={() => nav({ name: "cases" })}>Cases</button> and <button className="underline font-medium" onClick={() => nav({ name: "leads" })}>Leads</button>.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[12px] text-[var(--ink-faint)]">
          <span className="dot-live" />
          <span className="mono">activity · last 14 days</span>
          <Spark points={spark} width={130} height={34} />
        </div>
      </div>

      {/* Bank Products entry — the pricing catalogue is a work tool, not a report,
          so it gets a card rather than a line in the header. Counts come from the
          store's already-hydrated bankProducts; no extra request on the dashboard. */}
      <button
        className="w-full text-left card p-4 anim-fade-up transition-all hover:brightness-[1.03]"
        style={{ borderLeft: "3px solid var(--mint)", cursor: "pointer" }}
        onClick={() => nav({ name: "products" })}
        title="Browse every live bank rate line — filter by employment, residency, transaction, rate and LTV"
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-disp font-semibold text-[14px] flex items-center gap-2">
              Bank products
              <IArrowR size={13} />
            </div>
            <p className="text-[11.5px] m-0" style={{ color: "var(--ink-faint)" }}>
              Every live rate line across {bankProductCount} bank product{bankProductCount === 1 ? "" : "s"} — who each one is for,
              what it costs, and what else it charges. Filter by employment, residency, transaction, rate and LTV.
            </p>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <div className="text-right">
              <div className="mono text-[20px] font-bold" style={{ color: "var(--mint)" }}>{rateLineCount}</div>
              <div className="text-[10.5px]" style={{ color: "var(--ink-faint)" }}>rate lines</div>
            </div>
            <div className="text-right">
              <div className="mono text-[20px] font-bold" style={{ color: "var(--amber)" }}>{bankCount}</div>
              <div className="text-[10.5px]" style={{ color: "var(--ink-faint)" }}>banks</div>
            </div>
          </div>
        </div>
      </button>

      {/* Mobile: a 2-up grid so every KPI is visible without sideways scrolling
          (a horizontal strip hid 5 of 7 tiles behind a swipe). From md up it
          returns to the original single-row scroll strip, which is denser and
          suits a wide desktop. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:flex md:gap-3 md:overflow-x-auto md:pb-1 stagger">
        <Kpi label={deptLine ? `${deptLine.shortName || deptLine.name} in flight` : "Cases in flight"} value={kShown.openCases} />
        <Kpi label="Overdue" value={kShown.overdue} tone="coral" />
        <Kpi label="At risk" value={kShown.atRisk} tone="amber" />
        <Kpi label="No next action" value={kShown.noAction} tone="sky" />
        <Kpi label="Open tasks" value={kShown.openTasks} />
        <Kpi label="Pipeline value" value={kShown.pipelineValue} format={fmtMoney} tone="mint" />
        {flags?.viewRevenue && <Kpi label="Est. commission" value={kShown.estCommission} format={fmtMoney} tone="amber" sub="at current bank rates" />}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4 items-start">
        <div className="space-y-4">
          <div className="card p-4 anim-fade-up">
            <h3 className="font-disp font-semibold text-[13.5px] mt-0 mb-3">Pipeline by stage</h3>
            {funnelRows.length ? <BarList items={funnelRows.map((r) => ({ ...r, color: TONE_HEX.amber }))} /> : <p className="text-[12.5px] text-[var(--ink-faint)] m-0">No live cases — open a lead to start.</p>}
          </div>
          <div className="card p-4 anim-fade-up">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="font-disp font-semibold text-[13.5px] m-0">My tasks due today</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => nav({ name: "tasks" })}>Task queue <IArrowR size={12} /></button>
            </div>
            <div className="space-y-2">
              {myDueToday.length === 0 && <p className="text-[12.5px] text-[var(--ink-faint)] m-0">Nothing due on you today — clean slate.</p>}
              {myDueToday.map((t) => {
                const c = cases.find((x) => x.id === t.caseId);
                return (
                  <button key={t.id} className="rowlink w-full text-left flex items-center gap-2.5 rounded-lg px-2 py-1.5" onClick={() => c && nav({ name: "case", id: c.id })}>
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: isOverdueDue(t.dueDate) ? "var(--coral)" : "var(--amber)" }} />
                    <span className="text-[12.5px] flex-1 truncate">{t.description}</span>
                    <span className="mono text-[10.5px] text-[var(--ink-faint)]">{c?.caseNumber}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="card p-4 anim-fade-up">
            <h3 className="font-disp font-semibold text-[13.5px] mt-0 mb-3">Latest activity</h3>
            <div className="space-y-2.5">
              {recent.length === 0 && <p className="text-[12.5px] text-[var(--ink-faint)] m-0">Quiet so far.</p>}
              {recent.map((a) => {
                const c = cases.find((x) => x.id === a.caseId);
                return (
                  <button key={a.id} className="rowlink w-full text-left flex gap-2.5 rounded-lg px-2 py-1.5" onClick={() => c && nav({ name: "case", id: c.id })}>
                    <Avatar name={userById(a.userId)?.name ?? "?"} size={24} />
                    <span className="min-w-0">
                      <span className="block text-[12px] leading-snug">
                        <strong className="font-medium">{userById(a.userId)?.name.split(" ")[0]}</strong>{" "}
                        <span className="text-[var(--ink-dim)]">{a.action.toLowerCase()}</span>
                      </span>
                      <span className="block text-[10.5px] text-[var(--ink-faint)] mono">
                        {c?.caseNumber} · {relTime(a.at)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {leadsWaiting.length > 0 && (
            <div className="card p-4 anim-fade-up" style={{ borderLeft: "3px solid var(--amber)" }}>
              <div className="flex items-baseline gap-3">
                <span className="font-disp font-bold text-[28px] leading-none" style={{ color: "var(--amber)" }}>{leadsWaiting.length}</span>
                <span className="text-[12px] text-[var(--ink-dim)]">lead{leadsWaiting.length === 1 ? "" : "s"} waiting to be qualified</span>
              </div>
              <p className="text-[11.5px] text-[var(--ink-faint)] m-0 mt-1.5 mb-0 truncate">
                {leadsWaiting[0].fullName}{leadsWaiting.length > 1 ? ` +${leadsWaiting.length - 1} more` : ""}
              </p>
              <button className="btn btn-ghost btn-sm mt-3 w-full justify-center" onClick={() => nav({ name: "leads" })}>
                Open the funnel <IArrowR size={13} />
              </button>
            </div>
          )}
          {(myOpenDirectives.length > 0 || issuedOpenDirectives.length > 0) && (
            <div className="card p-4 anim-fade-up" style={{ borderLeft: "3px solid var(--amber)" }}>
              <div className="flex items-center gap-2 mb-2">
                <IFlag size={14} className="text-[var(--amber)]" />
                <h3 className="font-disp font-semibold text-[13.5px] m-0">Today's directives</h3>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="font-disp font-bold text-[28px] leading-none" style={{ color: "var(--amber)" }}>{myOpenDirectives.length}</span>
                <span className="text-[12px] text-[var(--ink-dim)]">waiting on you</span>
                {issuedOpenDirectives.length > 0 && <span className="mono text-[11.5px] text-[var(--ink-faint)] ml-auto">+{issuedOpenDirectives.length} you issued</span>}
              </div>
              {myOpenDirectives.length > 0 && <p className="text-[12px] text-[var(--ink-dim)] mt-1.5 mb-0 leading-snug truncate">“{myOpenDirectives[0].task}”</p>}
              <button className="btn btn-ghost btn-sm mt-3 w-full justify-center" onClick={() => nav({ name: "bulletin" })}>
                Open morning bulletin <IArrowR size={13} />
              </button>
            </div>
          )}
          <div className="card p-4 anim-fade-up">
            <h3 className="font-disp font-semibold text-[13.5px] mt-0 mb-3">Why pending</h3>
            {whyRows.length ? <BarList items={whyRows} /> : <p className="text-[12.5px] text-[var(--ink-faint)] m-0">No open tasks.</p>}
          </div>
          <div className="card p-4 anim-fade-up">
            <h3 className="font-disp font-semibold text-[13.5px] mt-0 mb-3">Waiting for</h3>
            {waitSegs.length ? <Donut segments={waitSegs} size={120} centerLabel="open tasks" /> : <p className="text-[12.5px] text-[var(--ink-faint)] m-0">Nothing waiting.</p>}
          </div>
          <div className="card p-4 anim-fade-up">
            <h3 className="font-disp font-semibold text-[13.5px] mt-0 mb-3">Owner load</h3>
            <div className="space-y-2">
              {ownerRows.length === 0 && <p className="text-[12.5px] text-[var(--ink-faint)] m-0">No open tasks assigned.</p>}
              {ownerRows.map((o) => (
                <div key={o.id} className="w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5">
                  <Avatar name={o.name} size={26} />
                  <span className="text-[12.5px] flex-1 text-left truncate">{o.name}</span>
                  {o.od > 0 && <span className="mono text-[11px]" style={{ color: "var(--coral)" }}>{o.od} od</span>}
                  <span className="mono text-[12px] text-[var(--ink-dim)]">{o.open}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
