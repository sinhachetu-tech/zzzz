"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { BulletinItem, CaseState, CaseStatus, LoanCase } from "@/lib/types";
import { activityPerDay } from "@/lib/domain";
import { computeKpis } from "@/lib/domain";
import { TONE_HEX, ageDays, caseStatusOf, commissionFor, fmtMoney, relTime, todayISO } from "@/lib/format";
import { Avatar, Chip, EmptyState, StatusChip } from "@/components/hfmc/ui";
import { BankChips, CaseStateChip, SourceChip } from "@/components/hfmc/bits";
import { BarList, Donut, Spark, useCountUp } from "@/components/hfmc/charts";
import { IArrowR, IBriefcase, IFlag, IInbox } from "@/components/icons";

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

const STATE_TABS: ("Active" | "Booked" | "Lost" | "All")[] = ["Active", "Booked", "Lost", "All"];

export default function Dashboard() {
  const { cases, tasks, activities, stages, banks, whyPending, waitingFor, users, me, nav, userById, visibleCases, visibleTasks, escalations, bulletin, visibleCaseIds, visibleTaskIds } = useHfmcStore();
  useTick(30000);
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("All");
  const [status, setStatus] = useState("All");
  const [owner, setOwner] = useState("All");
  const [sort, setSort] = useState("urgency");
  const [stateTab, setStateTab] = useState<(typeof STATE_TABS)[number]>("Active");

  // deps must include the data arrays (cases/visibleCaseIds/tasks/visibleTaskIds)
  // — NOT the store function references, which are stable and would prevent
  // the memo from recomputing when data loads after mount (the login case).
  const visCases = useMemo(() => visibleCases(), [visibleCases, cases, visibleCaseIds]);
  const visTasks = useMemo(() => visibleTasks(), [visibleTasks, tasks, visibleTaskIds]);
  const k = useMemo(
    () => computeKpis(visCases, visTasks, (c) => caseStatusOf(c, tasks), banks, escalations),
    [visCases, visTasks, banks, escalations, tasks]
  );
  const spark = useMemo(() => activityPerDay(activities, 14), [activities]);
  const statusOf = (c: LoanCase): CaseStatus => caseStatusOf(c, tasks);

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

  const filtered = visCases
    .filter((c) => {
      if (stateTab === "Active" && c.caseStatus !== "Active") return false;
      if (stateTab === "Booked" && c.caseStatus !== "Closed") return false;
      if (stateTab === "Lost" && c.caseStatus !== "Lost") return false;
      if (stage !== "All" && c.stage !== stage) return false;
      if (owner !== "All" && c.ownerId !== parseInt(owner, 10)) return false;
      if (status !== "All" && statusOf(c) !== status) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!c.customer.toLowerCase().includes(q) && !c.caseNumber.toLowerCase().includes(q) && !c.banks.some((b) => b.toLowerCase().includes(q))) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const rank = (c: LoanCase) => ({ Overdue: 0, "At Risk": 1, "No Action": 2, "On Track": 3 } as Record<string, number>)[statusOf(c)] ?? 4;
      if (sort === "urgency") return rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt);
      if (sort === "newest") return b.createdAt.localeCompare(a.createdAt);
      if (sort === "oldest") return a.createdAt.localeCompare(b.createdAt);
      return b.loanAmount - a.loanAmount;
    });

  const counts = {
    Active: visCases.filter((c) => c.caseStatus === "Active").length,
    Booked: visCases.filter((c) => c.caseStatus === "Closed").length,
    Lost: visCases.filter((c) => c.caseStatus === "Lost").length,
    All: visCases.length,
  };

  const recent = [...activities]
    .filter((a) => visCases.some((c) => c.id === a.caseId))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 7);

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
            Pipeline · <span style={{ color: "var(--amber)" }}>{scope}</span>
          </h1>
          <p className="text-[13px] text-[var(--ink-dim)] mt-0.5 mb-0">
            {k.openCases} live cases · {fmtMoney(k.pipelineValue)} in flight · {k.escalations} SLA breach{k.escalations === 1 ? "" : "es"}
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
        <Kpi label="Est. commission" value={k.estCommission} format={fmtMoney} tone="amber" sub="at current bank rates" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4 items-start">
        <div className="card anim-fade-up">
          <div className="flex flex-wrap items-center gap-2 p-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
            <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "var(--line)" }}>
              {STATE_TABS.map((t) => (
                <button key={t} className="px-3 py-1.5 text-[12px] font-disp font-semibold transition-colors"
                  style={stateTab === t ? { background: "rgba(242,176,76,0.15)", color: "var(--amber)" } : { color: "var(--ink-faint)", background: "transparent" }}
                  onClick={() => setStateTab(t)}>
                  {t} <span className="mono font-normal opacity-70">{counts[t]}</span>
                </button>
              ))}
            </div>
            <input className="input" style={{ width: 190 }} placeholder="Search case / customer…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="select" style={{ width: 150 }} value={stage} onChange={(e) => setStage(e.target.value)}>
              <option value="All">All stages</option>
              {[...stages].sort((a, b) => a.sortOrder - b.sortOrder).map((s) => <option key={s.id} value={s.label}>{s.label}</option>)}
            </select>
            {stateTab === "Active" && (
              <select className="select" style={{ width: 130 }} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="All">All status</option>
                {["On Track", "At Risk", "Overdue", "No Action"].map((s) => <option key={s}>{s}</option>)}
              </select>
            )}
            <select className="select" style={{ width: 140 }} value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="All">All owners</option>
              {users.filter((u) => u.role !== "Head of Company" && u.role !== "PA to HoC").map((u) => <option key={u.id} value={u.id}>{u.name.split(" ")[0]}</option>)}
            </select>
            <select className="select ml-auto" style={{ width: 140 }} value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="urgency">Most urgent</option>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="amount">Largest amount</option>
            </select>
          </div>

          <div className="overflow-auto" style={{ maxHeight: "52vh" }}>
            {filtered.length === 0 ? (
              <div className="p-6">
                <EmptyState icon={<IInbox size={26} />} title={`Nothing in “${stateTab}”`} body="Adjust the filters, or use the New case button in the top bar to get things moving." />
              </div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Case</th><th>Customer</th><th>Source</th><th>Banks</th><th>Stage</th><th>Amount</th><th>Owner</th><th>Age</th>
                    {stateTab === "Active" ? <th>Status</th> : <th>Lifecycle</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => {
                    const st = statusOf(c);
                    return (
                      <tr key={c.id} onClick={() => nav({ name: "case", id: c.id })}>
                        <td className="mono text-[12.5px]" style={{ color: "var(--amber)" }}>{c.caseNumber}</td>
                        <td className="font-medium">
                          {c.customer}
                          {c.partner && <span className="block text-[10.5px] text-[var(--ink-faint)]">{c.partner.name} · {c.partner.sharePct}%</span>}
                        </td>
                        <td><SourceChip source={c.source} /></td>
                        <td><BankChips c={c} /></td>
                        <td><Chip tone="slate">{c.stage}</Chip></td>
                        <td className="mono">{fmtMoney(c.loanAmount)}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <Avatar name={userById(c.ownerId)?.name ?? "?"} size={24} />
                            <span className="text-[12.5px] text-[var(--ink-dim)]">{userById(c.ownerId)?.name.split(" ")[0]}</span>
                          </div>
                        </td>
                        <td className="mono text-[12.5px] text-[var(--ink-dim)]">{ageDays(c.createdAt)}d</td>
                        <td>{c.caseStatus === "Active" ? <StatusChip status={st} /> : <CaseStateChip state={c.caseStatus} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="px-4 py-2.5 border-t text-[11.5px] text-[var(--ink-faint)] flex items-center gap-2" style={{ borderColor: "var(--line-soft)" }}>
            <IBriefcase size={13} />
            {filtered.length} of {visCases.length} cases · click a row for the full 360 view
          </div>
        </div>

        <div className="space-y-4">
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
                <button key={o.id} className="rowlink w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5" onClick={() => { setOwner(String(o.id)); setStateTab("Active"); }}>
                  <Avatar name={o.name} size={26} />
                  <span className="text-[12.5px] flex-1 text-left truncate">{o.name}</span>
                  {o.od > 0 && <span className="mono text-[11px]" style={{ color: "var(--coral)" }}>{o.od} od</span>}
                  <span className="mono text-[12px] text-[var(--ink-dim)]">{o.open}</span>
                </button>
              ))}
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
      </div>
    </div>
  );
}
