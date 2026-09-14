"use client";

/* Dashboard — the floor's analytics: KPIs, escalations, task breakdowns,
   activity. The worklist itself lives in the Cases tab; leads in Leads. */

import { useEffect, useMemo, useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { BulletinItem } from "@/lib/types";
import { activityPerDay, computeKpis } from "@/lib/domain";
import { TONE_HEX, caseStatusOf, fmtMoney, relTime, todayISO } from "@/lib/format";
import { Avatar } from "@/components/hfmc/ui";
import { BarList, Donut, Spark, useCountUp } from "@/components/hfmc/charts";
import { IArrowR, IFlag } from "@/components/icons";

function useTick(intervalMs: number) {
  const [, setT] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setT((x) => x + 1), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
}

function Kpi({ label, value, format, tone, sub }: { label: string; value: number; format?: (n: number) => string; tone?: "mint" | "amber" | "coral" | "sky"; sub?: string }) {
  const v = useCountUp(value);
  const color = tone ? `var(--${tone})` : "var(--ink)";
  return (
    <div className="card card-hover px-4 py-3.5 min-w-[150px]">
      <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--ink-faint)] font-disp font-semibold">{label}</div>
      <div className="font-disp font-bold text-[30px] leading-tight mt-0.5" style={{ color }}>{format ? format(v) : v}</div>
      {sub && <div className="text-[11.5px] text-[var(--ink-faint)]">{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const { cases, tasks, activities, stages, banks, whyPending, waitingFor, users, me, nav, userById, visibleCases, visibleTasks, escalations, bulletin, visibleCaseIds, visibleTaskIds, flags } = useHfmcStore();
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

  const whyRows = whyPending
    .map((w) => ({ label: w.label, value: openTasks.filter((t) => t.whyPending === w.label).length, color: TONE_HEX.amber }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const waitSegs = waitingFor
    .map((w, i) => ({ label: w.label, value: openTasks.filter((t) => t.waitingFor === w.label).length, color: ["#f2b04c", "#57c2ea", "#43d69b", "#f27363", "#8ca6b0"][i % 5] }))
    .filter((s) => s.value > 0);

  const ownerRows = Array.from(new Set(openTasks.map((t) => t.ownerId)))
    .map((id) => ({ id, name: userById(id)?.name ?? "Unassigned", open: openTasks.filter((t) => t.ownerId === id).length, od: openTasks.filter((t) => t.ownerId === id && t.dueDate < todayISO()).length }))
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

  // leads waiting in the funnel
  const leadsWaiting = visCases.filter((c) => c.caseStatus === "Active" && c.stage === "Lead");

  // my tasks due today (or overdue)
  const myDueToday = me
    ? openTasks.filter((t) => t.ownerId === me.id && t.dueDate <= todayISO()).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 6)
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-disp font-bold text-[24px] tracking-tight m-0">
            Dashboard · <span style={{ color: "var(--amber)" }}>{scope}</span>
          </h1>
          <p className="text-[13px] text-[var(--ink-dim)] mt-0.5 mb-0">
            The floor at a glance — {k.openCases} live cases · {fmtMoney(k.pipelineValue)} in flight · {k.escalations} SLA breach{k.escalations === 1 ? "" : "es"}. Work happens in <button className="underline font-medium" onClick={() => nav({ name: "cases" })}>Cases</button> and <button className="underline font-medium" onClick={() => nav({ name: "leads" })}>Leads</button>.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[12px] text-[var(--ink-faint)]">
          <span className="dot-live" />
          <span className="mono">activity · last 14 days</span>
          <Spark points={spark} width={130} height={34} />
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1 stagger">
        <Kpi label="Cases in flight" value={k.openCases} />
        <Kpi label="Overdue" value={k.overdue} tone="coral" />
        <Kpi label="At risk" value={k.atRisk} tone="amber" />
        <Kpi label="No next action" value={k.noAction} tone="sky" />
        <Kpi label="Open tasks" value={k.openTasks} />
        <Kpi label="Pipeline value" value={k.pipelineValue} format={fmtMoney} tone="mint" />
        {flags?.viewRevenue && <Kpi label="Est. commission" value={k.estCommission} format={fmtMoney} tone="amber" sub="at current bank rates" />}
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
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: t.dueDate < todayISO() ? "var(--coral)" : "var(--amber)" }} />
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
                {leadsWaiting[0].customer}{leadsWaiting.length > 1 ? ` +${leadsWaiting.length - 1} more` : ""}
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
