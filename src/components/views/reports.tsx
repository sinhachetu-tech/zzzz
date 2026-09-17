"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { BankItem, CaseSource, LoanCase, User } from "@/lib/types";
import { SOURCES } from "@/lib/types";
import { computeEscalations, activityPerDay } from "@/lib/domain";
import {
  TONE_HEX, ageDays, commissionFor, downloadCSV, fmtDate, fmtDue, fmtMoney, fmtMoneyFull, fmtRate,
  primaryBank, todayISO,
} from "@/lib/format";
import { Avatar, Chip, EmptyState, SectionLabel } from "@/components/hfmc/ui";
import { ProposalPipeline } from "@/components/views/proposals";
import { BarList, Donut, Spark, useCountUp } from "@/components/hfmc/charts";
import {
  IBank, IBriefcase, IChart, IClock, IDownload, IInbox, ITarget, ITrophy, IUsers,
} from "@/components/icons";

/* ---------- helpers ---------- */

const SOURCE_COLORS: Record<CaseSource, string> = {
  Direct: TONE_HEX.mint,
  Agent: TONE_HEX.amber,
  Broker: TONE_HEX.sky,
  Website: TONE_HEX.slate,
  Referral: TONE_HEX.coral,
};

const STAGE_PALETTE = [TONE_HEX.amber, TONE_HEX.sky, TONE_HEX.mint, TONE_HEX.coral, TONE_HEX.slate];

interface ReportCardProps {
  title: string;
  sub: string;
  icon: ReactNode;
  span?: boolean; // span two columns on lg
  extra?: ReactNode;
  children: ReactNode;
}

function ReportCard({ title, sub, icon, span, extra, children }: ReportCardProps) {
  return (
    <div className={`card p-4 anim-fade-up anim-reveal ${span ? "lg:col-span-2" : ""}`}>
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="flex items-start gap-2.5 min-w-0">
          <span
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "var(--amber-tint)", color: "var(--amber)", border: "1px solid var(--amber-line)" }}
          >
            {icon}
          </span>
          <div className="min-w-0">
            <h3 className="font-disp font-semibold text-[14px] m-0">{title}</h3>
            <p className="text-[11.5px] text-[var(--ink-faint)] mt-0.5 mb-0 leading-snug">{sub}</p>
          </div>
        </div>
        {extra}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <div className="col-span-1 lg:col-span-2 flex items-center gap-3 mt-2">
      <span
        className="font-disp font-bold text-[12px] uppercase tracking-[0.16em]"
        style={{ color: "var(--amber)" }}
      >
        {children}
      </span>
      <span className="h-px flex-1" style={{ background: "var(--line-soft)" }} />
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone: "mint" | "amber" | "coral" | "sky" | "slate" }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10.5px] uppercase tracking-[0.1em] text-[var(--ink-faint)] font-disp font-semibold">{label}</span>
      <span className="mono font-semibold text-[14px]" style={{ color: `var(--${tone})` }}>{value}</span>
    </div>
  );
}

function CountUp({ target, format }: { target: number; format?: (n: number) => string }) {
  const v = useCountUp(target);
  return <>{format ? format(v) : v}</>;
}

/* ---------- daily MIS report (team leader's register) ---------- */

/* Projected revenue — per-bank scenarios without phantom totals.
   A client filing at 3 banks creates 3 cases; each case shows ITS bank's
   expected commission individually, but consolidation counts the engagement
   once: booked cases at actual, open engagements at best-case (max). */
function ProjectedRevenue({ visCases, userById, banks }: {
  visCases: LoanCase[]; userById: (id: number) => User | undefined; banks: BankItem[];
}) {
  const active = visCases.filter((c) => c.caseStatus === "Active");
  const booked = visCases.filter((c) => c.caseStatus === "Closed" && c.wonBank);

  // group open cases into engagements (client + amount + creation day)
  const groups = useMemo(() => {
    const map = new Map<string, LoanCase[]>();
    for (const c of active) {
      const key = (c.clientId ?? "c" + c.customer) + "|" + c.loanAmount + "|" + c.createdAt.slice(0, 10);
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return [...map.values()];
  }, [active]);

  const rows = useMemo(() => groups.map((g) => {
    const perBank = g.map((c) => ({ c, ...commissionFor(c, banks) }));
    const best = perBank.reduce((a, b) => (b.net > a.net ? b : a), perBank[0]);
    return {
      key: g[0].id,
      customer: g[0].customer,
      owner: userById(g[0].ownerId)?.name.split(" ")[0] ?? "—",
      amount: g[0].loanAmount,
      banks: perBank,
      best,
      split: g.length > 1,
    };
  }).sort((a, b) => b.best.net - a.best.net), [groups, banks, userById]);

  const bookedNet = booked.reduce((s, c) => s + commissionFor(c, banks).net, 0);
  const pipelineBest = rows.reduce((s, r) => s + r.best.net, 0);
  const phantom = rows.reduce((s, r) => s + r.banks.reduce((t, b) => t + b.net, 0) - r.best.net, 0);

  return (
    <div className="card anim-fade-up">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
        <h3 className="font-disp font-semibold text-[14px] m-0">Projected revenue — per bank, consolidated once</h3>
        <span className="text-[11.5px] text-[var(--ink-faint)]">
          each bank case shows its own expected commission · totals count every engagement only once
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3 p-4 pb-0">
        <div className="rounded-lg px-3 py-2.5" style={{ background: "var(--tint)" }}>
          <div className="text-[10px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)]">Booked (actual)</div>
          <div className="font-disp font-bold text-[20px] mono" style={{ color: "var(--mint)" }}>{fmtMoney(bookedNet)}</div>
          <div className="text-[10.5px] text-[var(--ink-faint)]">{booked.length} disbursed file{booked.length === 1 ? "" : "s"}</div>
        </div>
        <div className="rounded-lg px-3 py-2.5" style={{ background: "var(--amber-tint)" }}>
          <div className="text-[10px] uppercase tracking-[0.1em] font-disp font-semibold" style={{ color: "var(--amber)" }}>Pipeline (best case)</div>
          <div className="font-disp font-bold text-[20px] mono" style={{ color: "var(--amber)" }}>{fmtMoney(pipelineBest)}</div>
          <div className="text-[10.5px] text-[var(--ink-faint)]">{rows.length} open engagement{rows.length === 1 ? "" : "s"} — max per engagement</div>
        </div>
        <div className="rounded-lg px-3 py-2.5" style={{ background: "var(--tint)" }}>
          <div className="text-[10px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)]">Avoided double-count</div>
          <div className="font-disp font-bold text-[20px] mono">{fmtMoney(phantom)}</div>
          <div className="text-[10.5px] text-[var(--ink-faint)]">phantom revenue from multi-bank duplicates, excluded</div>
        </div>
      </div>
      <div className="overflow-x-auto p-4 pt-3">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-[var(--ink-faint)] text-left">
              <th className="py-1.5">Client</th><th>Owner</th><th>Amount</th><th>Bank scenarios (net of partner/channel)</th><th>Best case (counted once)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} style={{ borderTop: "1px dashed var(--line)" }}>
                <td className="py-2 font-medium">{r.customer}</td>
                <td className="text-[var(--ink-dim)]">{r.owner}</td>
                <td className="mono">{fmtMoney(r.amount)}</td>
                <td>
                  <div className="flex flex-wrap gap-1.5">
                    {r.banks.map((b) => (
                      <span key={b.c.id} className="chip !py-0.5 text-[10.5px] mono"
                        style={b.c.id === r.best.c.id ? { borderColor: "var(--amber)", color: "var(--amber)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}
                        title={b.c.banks.join(", ") + (b.c.bankRm ? " · RM " + b.c.bankRm : "")}>
                        {b.c.banks[0] ?? "TBC"} {fmtMoney(b.net)}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="mono font-semibold" style={{ color: "var(--amber)" }}>{fmtMoney(r.best.net)}{r.split ? <span className="text-[10px] text-[var(--ink-faint)] font-normal"> (of {r.banks.length} banks)</span> : null}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="py-3 text-[var(--ink-faint)]">No open cases — projected pipeline is empty.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DailyMisReport({ visCases, userById, toast }: {
  visCases: LoanCase[];
  userById: (id: number) => User | undefined;
  toast: (kind: "success" | "error" | "info", msg: string) => void;
}) {
  const { caseUpdates, users, flags } = useHfmcStore();
  const [scope, setScope] = useState<"today" | "date" | "month">("today");
  const [dateVal, setDateVal] = useState(todayISO());
  const [monthVal, setMonthVal] = useState(todayISO().slice(0, 7));
  const [team, setTeam] = useState("all");
  const [activeOnly, setActiveOnly] = useState(true);

  const teams = useMemo(() => [...new Set(users.map((u) => u.team))], [users]);
  const teamsOf = (caseRow: LoanCase) => userById(caseRow.ownerId)?.team ?? "—";

  const inScopeDate = (date: string) =>
    scope === "today" ? date === todayISO() : scope === "date" ? date === dateVal : date.startsWith(monthVal);

  const rows = useMemo(() => {
    return visCases
      .filter((c) => (activeOnly ? c.caseStatus === "Active" : true))
      .filter((c) => team === "all" || teamsOf(c) === team)
      .map((c) => {
        const updates = caseUpdates
          .filter((u) => u.caseId === c.id && inScopeDate(u.date))
          .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
        const latest = updates[0] ?? null;
        return { c, latest, updateCount: updates.length };
      })
      .sort((a, b) => {
        // not-updated cases float to the top as the work list
        const aMissing = a.latest ? 1 : 0;
        const bMissing = b.latest ? 1 : 0;
        return aMissing - bMissing || (b.latest?.date ?? "").localeCompare(a.latest?.date ?? "");
      });
  }, [visCases, caseUpdates, team, activeOnly, scope, dateVal, monthVal]);

  const pending = rows.filter((r) => !r.latest && r.c.caseStatus === "Active").length;
  const holds = rows.filter((r) => r.latest?.onHold).length;

  const exportCsv = () => {
    downloadCSV(
      scope === "month" ? `hfmc-daily-mis-${monthVal}.csv` : `hfmc-daily-mis-${scope === "today" ? todayISO() : dateVal}.csv`,
      ["Case #", "Customer", "Team", "Stage", "Status", "Updates in scope", "Last update date", "On hold", "Update", "Author"],
      rows.map((r) => [
        r.c.caseNumber, r.c.customer, teamsOf(r.c), r.c.stage, r.c.caseStatus, r.updateCount,
        r.latest?.date ?? "", r.latest?.onHold ? "ON HOLD" : "", (r.latest?.note ?? "").replace(/\n/g, " "),
        r.latest?.authorName ?? userById(r.latest?.authorId ?? -1)?.name ?? "",
      ]),
    );
    toast("success", "Daily MIS exported.");
  };

  return (
    <ReportCard title="Daily MIS register" sub={`Dated progress entries per case — the 3 PM discipline. ${pending} active case(s) not updated yet${holds ? ` · ${holds} on hold` : ""}.`} icon={<IClock size={15} />} span>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "var(--line)" }}>
          {(["today", "date", "month"] as const).map((s) => (
            <button key={s} className="px-3 py-1.5 text-[12px] font-disp font-semibold transition-colors"
              style={scope === s ? { background: "var(--amber-tint)", color: "var(--amber)" } : { color: "var(--ink-faint)" }}
              onClick={() => setScope(s)}>
              {s === "today" ? "Today" : s === "date" ? "By date" : "By month"}
            </button>
          ))}
        </div>
        {scope === "date" && <input className="input mono !w-auto" type="date" value={dateVal} onChange={(e) => setDateVal(e.target.value)} />}
        {scope === "month" && <input className="input mono !w-auto" type="month" value={monthVal} onChange={(e) => setMonthVal(e.target.value)} />}
        {(flags?.scope === "all" || flags?.super || flags?.admin) && (
          <select className="select !w-auto" value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="all">All teams</option>
            {teams.map((tm) => <option key={tm} value={tm}>{tm}</option>)}
          </select>
        )}
        <button className="chip transition-all" style={activeOnly ? { background: "rgba(67,214,155,0.12)", borderColor: "rgba(67,214,155,0.5)", color: "var(--mint)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}
          onClick={() => setActiveOnly(!activeOnly)}>
          {activeOnly ? "active only" : "all statuses"}
        </button>
        <button className="btn btn-ghost btn-sm ml-auto" onClick={exportCsv}><IDownload size={14} /> Export CSV</button>
      </div>
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-[var(--ink-faint)] m-0">No cases in scope.</p>
      ) : (
        <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
          <table className="tbl min-w-[760px]">
            <thead>
              <tr><th>Case</th><th>Customer</th><th>Team</th><th>Stage</th><th>Updates</th><th>Last update</th><th>On hold</th></tr>
            </thead>
            <tbody>
              {rows.map(({ c, latest, updateCount }) => (
                <tr key={c.id} style={!latest && c.caseStatus === "Active" ? { background: "rgba(242,115,99,0.06)" } : undefined}>
                  <td className="mono text-[12px]" style={{ color: "var(--amber)" }}>{c.caseNumber}</td>
                  <td className="font-medium">{c.customer}</td>
                  <td className="text-[11.5px] text-[var(--ink-dim)]">{teamsOf(c)}</td>
                  <td><Chip tone="slate">{c.stage}</Chip></td>
                  <td className="mono text-center">{updateCount}</td>
                  <td className="text-[11.5px] max-w-[340px]">
                    {latest ? (
                      <>
                        <span className="mono text-[var(--ink-faint)]">{fmtDate(latest.date)}</span>
                        <span className="block truncate" style={{ color: "var(--ink-dim)" }}>{latest.note}</span>
                      </>
                    ) : (
                      <span style={{ color: "var(--coral)" }}>not updated in scope</span>
                    )}
                  </td>
                  <td>{latest?.onHold ? <Chip tone="coral">hold</Chip> : <span className="text-[var(--ink-faint)] text-[11px]">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ReportCard>
  );
}

/* ---------- view ---------- */

export default function Reports() {
  const {
    cases, tasks, activities, banks, partners, users, stages, slaRules, flags, caseUpdates,
    nav, userById, visibleCases, visibleTasks, toast,
  } = useHfmcStore();
  const canRevenue = !!flags?.viewRevenue;

  const visCases = useMemo(() => visibleCases(), [visibleCases]);
  const visTasks = useMemo(() => visibleTasks(), [visibleTasks]);

  /* ---- slice cases by lifecycle state ---- */
  const active = useMemo(() => visCases.filter((c) => c.caseStatus === "Active"), [visCases]);
  const booked = useMemo(() => visCases.filter((c) => c.caseStatus === "Closed"), [visCases]);
  const lost = useMemo(() => visCases.filter((c) => c.caseStatus === "Lost"), [visCases]);

  /* ---- 1 · pipeline by stage ---- */
  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.sortOrder - b.sortOrder),
    [stages],
  );
  const stageRows = useMemo(
    () =>
      sortedStages
        .map((s, i) => {
          const inStage = active.filter((c) => c.stage === s.label);
          const value = inStage.reduce((sum, c) => sum + c.loanAmount, 0);
          return {
            label: s.label,
            value: inStage.length,
            color: STAGE_PALETTE[i % STAGE_PALETTE.length],
            sub: inStage.length ? `· ${fmtMoney(value)}` : "",
            amount: value,
          };
        })
        .filter((r) => r.value > 0),
    [sortedStages, active],
  );

  /* ---- 2 · source mix ---- */
  const sourceSegs = useMemo(
    () =>
      SOURCES
        .map((src) => ({
          label: src,
          value: visCases.filter((c) => c.source === src).length,
          color: SOURCE_COLORS[src],
        }))
        .filter((s) => s.value > 0),
    [visCases],
  );

  /* ---- 3 · bank win rate ---- */
  const bankRows = useMemo(
    () =>
      banks
        .map((b) => {
          const submitted = visCases.filter((c) => c.banks.includes(b.name));
          const won = booked.filter((c) => c.wonBank === b.name);
          const lostCount = lost.filter((c) => c.banks.includes(b.name)).length;
          const decided = won.length + lostCount;
          const winPct = decided > 0 ? Math.round((won.length / decided) * 100) : 0;
          const grossEarned = won.reduce((s, c) => s + commissionFor(c, banks).gross, 0);
          return { b, submitted: submitted.length, won: won.length, lostCount, winPct, grossEarned };
        })
        .filter((r) => r.submitted > 0 || r.won > 0)
        .sort((a, b) => b.grossEarned - a.grossEarned),
    [banks, visCases, booked, lost],
  );

  /* ---- 4 · owner leaderboard ---- */
  const owners = useMemo(
    () =>
      users
        .filter((u) => u.role !== "Head of Company" && u.role !== "PA to HoC")
        .map((u) => {
          const mine = visCases.filter((c) => c.ownerId === u.id);
          const won = mine.filter((c) => c.caseStatus === "Closed");
          const lostMine = mine.filter((c) => c.caseStatus === "Lost").length;
          const decided = won.length + lostMine;
          const winPct = decided > 0 ? Math.round((won.length / decided) * 100) : 0;
          const bookedValue = won.reduce((s, c) => s + c.loanAmount, 0);
          const netEarn = won.reduce((s, c) => s + commissionFor(c, banks).net, 0);
          return { u, mine: mine.length, won: won.length, lostMine, winPct, bookedValue, netEarn };
        })
        .filter((r) => r.mine > 0)
        .sort((a, b) => b.bookedValue - a.bookedValue),
    [users, visCases, banks],
  );

  /* ---- 5 · conversion funnel ---- */
  const funnel = useMemo(() => {
    const total = visCases.length;
    const bookedN = booked.length;
    const lostN = lost.length;
    const activeN = active.length;
    const decided = bookedN + lostN;
    const conv = total > 0 ? Math.round((bookedN / total) * 100) : 0;
    const hitRate = decided > 0 ? Math.round((bookedN / decided) * 100) : 0;
    return { total, bookedN, lostN, activeN, conv, hitRate };
  }, [visCases, booked, lost, active]);

  /* ---- 6 · commission summary ---- */
  const commission = useMemo(() => {
    const gross = booked.reduce((s, c) => s + commissionFor(c, banks).gross, 0);
    const partnerCut = booked.reduce((s, c) => s + commissionFor(c, banks).partnerCut, 0);
    const net = gross - partnerCut;
    const pipelineGross = active.reduce((s, c) => s + commissionFor(c, banks).gross, 0);
    return { gross, partnerCut, net, pipelineGross };
  }, [booked, active, banks]);

  /* ---- 7 · SLA breaches ---- */
  const escalations = useMemo(
    () => computeEscalations(visCases, slaRules),
    [visCases, slaRules],
  );
  const slaCases = useMemo(
    () =>
      escalations
        .map((e) => ({ e, c: visCases.find((c) => c.id === e.caseId) }))
        .filter((r): r is { e: typeof escalations[number]; c: LoanCase } => !!r.c)
        .sort((a, b) => b.e.breachDays - a.e.breachDays),
    [escalations, visCases],
  );

  /* ---- 8 · activity trend (14 days) ---- */
  const trend = useMemo(() => activityPerDay(activities, 14), [activities]);
  const trendTotal = useMemo(() => trend.reduce((s, n) => s + n, 0), [trend]);

  /* ---- CSV exports ---- */
  const exportCases = () => {
    const header = ["Case #", "Customer", "Status", "Stage", "Source", "Banks", "Won bank", "Loan amount (AED)", "Owner", "Partner", ...(canRevenue ? ["Share %"] : []), "Created", "Closed"];
    const rows = visCases.map((c) => [
      c.caseNumber, c.customer, c.caseStatus, c.stage, c.source,
      c.banks.join(" / ") || "TBC", c.wonBank ?? "", Math.round(c.loanAmount),
      userById(c.ownerId)?.name ?? "", c.partner?.name ?? "",
      ...(canRevenue ? [c.partner?.sharePct ?? ""] : []),
      c.createdAt.slice(0, 10), c.closedDate ?? "",
    ]);
    downloadCSV("hfmc-cases.csv", header, rows);
    toast("success", "Cases exported.");
  };

  const exportTasks = () => {
    const header = ["Case #", "Task", "Owner", "Status", "Waiting for", "Why pending", "Due", "Created"];
    const rows = visTasks.map((t) => {
      const c = cases.find((x) => x.id === t.caseId);
      return [
        c?.caseNumber ?? "", t.description, userById(t.ownerId)?.name ?? "",
        t.status, t.waitingFor, t.whyPending, fmtDue(t.dueDate), t.createdAt.slice(0, 10),
      ];
    });
    downloadCSV("hfmc-tasks.csv", header, rows);
    toast("success", "Tasks exported.");
  };

  const exportCommission = () => {
    const header = ["Case #", "Customer", "Won bank", "Rate %", "Loan amount (AED)", "Gross (AED)", "Partner", "Share %", "Partner cut (AED)", "Net (AED)", "Closed"];
    const rows = booked.map((c) => {
      const m = commissionFor(c, banks);
      return [
        c.caseNumber, c.customer, m.bank ?? "", m.ratePct, Math.round(c.loanAmount),
        Math.round(m.gross), c.partner?.name ?? "", c.partner?.sharePct ?? "",
        Math.round(m.partnerCut), Math.round(m.net), c.closedDate ?? "",
      ];
    });
    downloadCSV("hfmc-commission.csv", header, rows);
    toast("success", "Commission exported.");
  };

  /* ---- render ---- */

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-3 anim-fade-up">
        <div>
          <h1 className="font-disp font-bold text-[24px] tracking-tight m-0 flex items-center gap-2.5">
            <IChart size={22} className="text-[var(--amber)]" /> Reports
          </h1>
          <p className="text-[13px] text-[var(--ink-dim)] mt-0.5 mb-0">
            {visCases.length} cases · {booked.length} booked · {fmtMoney(booked.reduce((s, c) => s + c.loanAmount, 0))} closed volume
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-ghost sm:btn-sm" onClick={exportCases} title="Export every visible case">
            <IDownload size={14} /> Cases
          </button>
          <button className="btn btn-ghost sm:btn-sm" onClick={exportTasks} title="Export every visible task">
            <IDownload size={14} /> Tasks
          </button>
          {canRevenue && (
            <button className="btn btn-primary sm:btn-sm" onClick={exportCommission} title="Export commission breakdown for booked cases">
              <IDownload size={14} /> Commission
            </button>
          )}
        </div>
      </div>

      {/* KPI strip */}
      <div className={`grid gap-3 stagger ${canRevenue ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2 lg:grid-cols-3"}`}>
        <KpiCard label="Active pipeline" value={<CountUp target={active.length} />} sub={fmtMoney(active.reduce((s, c) => s + c.loanAmount, 0))} tone="amber" icon={<IBriefcase size={15} />} />
        <KpiCard label="Booked" value={<CountUp target={booked.length} />} sub={fmtMoney(booked.reduce((s, c) => s + c.loanAmount, 0))} tone="mint" icon={<ITrophy size={15} />} />
        <KpiCard label="Lost" value={<CountUp target={lost.length} />} sub={`${funnel.hitRate}% hit rate`} tone="coral" icon={<ITarget size={15} />} />
        {canRevenue && (
          <KpiCard label="Net commission" value={<CountUp target={Math.round(commission.net)} format={fmtMoney} />} sub={`of ${fmtMoney(commission.gross)} gross`} tone="sky" icon={<IBank size={15} />} />
        )}
      </div>

      <DailyMisReport visCases={visCases} userById={userById} toast={toast} />

      {canRevenue && <ProjectedRevenue visCases={visCases} userById={userById} banks={banks} />}

      {/* proposal follow-up pipeline across cases (created in Case 360) */}
      <ProposalPipeline />

      {/* report grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GroupLabel>Pipeline</GroupLabel>

        {/* 1 · pipeline by stage */}
        <ReportCard
          title="Pipeline by stage"
          sub="Live cases and loan amount per stage"
          icon={<IBriefcase size={15} />}
        >
          {stageRows.length ? (
            <BarList items={stageRows} />
          ) : (
            <p className="text-[12.5px] text-[var(--ink-faint)] m-0">No active cases in any stage.</p>
          )}
        </ReportCard>

        {/* 2 · source mix */}
        <ReportCard
          title="Source mix"
          sub="Where the case introductions come from"
          icon={<IUsers size={15} />}
        >
          {sourceSegs.length ? (
            <Donut segments={sourceSegs} centerLabel="cases" />
          ) : (
            <p className="text-[12.5px] text-[var(--ink-faint)] m-0">No cases to break down.</p>
          )}
        </ReportCard>

        {/* 3 · bank win rate */}
        <ReportCard
          title="Bank win rate"
          sub={canRevenue ? "Submitted vs booked per bank, and commission earned" : "Submitted vs booked per bank"}
          icon={<IBank size={15} />}
          span
        >
          {bankRows.length === 0 ? (
            <p className="text-[12.5px] text-[var(--ink-faint)] m-0">No bank activity yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="tbl min-w-[640px]">
                <thead>
                  <tr>
                    <th>Bank</th>
                    {canRevenue && <th>Rate</th>}
                    <th>Submitted</th>
                    <th>Won</th>
                    <th>Win %</th>
                    {canRevenue && <th>Commission earned</th>}
                  </tr>
                </thead>
                <tbody>
                  {bankRows.map((r) => (
                    <tr key={r.b.id} style={{ cursor: "default" }}>
                      <td className="font-medium">{r.b.name}</td>
                      {canRevenue && <td className="mono">{fmtRate(r.b.ratePct)}</td>}
                      <td className="mono">{r.submitted}</td>
                      <td className="mono">{r.won}</td>
                      <td>
                        <WinPill pct={r.winPct} />
                      </td>
                      {canRevenue && (
                        <td className="mono" style={{ color: r.grossEarned > 0 ? "var(--mint)" : undefined }}>
                          {r.grossEarned > 0 ? fmtMoney(r.grossEarned) : "—"}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ReportCard>

        <GroupLabel>People</GroupLabel>

        {/* 4 · owner leaderboard */}
        <ReportCard
          title="Owner leaderboard"
          sub={canRevenue ? "Ranked by booked volume — with win rate and net commission" : "Ranked by booked volume — with win rate"}
          icon={<ITrophy size={15} />}
          span
        >
          {owners.length === 0 ? (
            <p className="text-[12.5px] text-[var(--ink-faint)] m-0">No cases assigned yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="tbl min-w-[640px]">
                <thead>
                  <tr>
                    <th className="w-[34px]">#</th>
                    <th>Owner</th>
                    <th>Cases</th>
                    <th>Booked</th>
                    <th>Win %</th>
                    <th>Booked volume</th>
                    {canRevenue && <th>Net commission</th>}
                  </tr>
                </thead>
                <tbody>
                  {owners.map((r, i) => (
                    <tr key={r.u.id} style={{ cursor: "default", background: i === 0 ? "rgba(242,176,76,0.06)" : undefined }}>
                      <td className="mono text-center" style={{ color: i === 0 ? "var(--amber)" : "var(--ink-faint)" }}>
                        {i + 1}
                      </td>
                      <td>
                        <span className="flex items-center gap-2">
                          <Avatar name={r.u.name} size={24} />
                          <span className="font-medium">{r.u.name}</span>
                        </span>
                      </td>
                      <td className="mono">{r.mine}</td>
                      <td className="mono">{r.won}</td>
                      <td><WinPill pct={r.winPct} /></td>
                      <td className="mono">{fmtMoney(r.bookedValue)}</td>
                      {canRevenue && <td className="mono" style={{ color: "var(--mint)" }}>{fmtMoney(r.netEarn)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ReportCard>

        <GroupLabel>Performance</GroupLabel>

        {/* 5 · conversion funnel */}
        <ReportCard
          title="Conversion funnel"
          sub="From active to booked vs lost"
          icon={<ITarget size={15} />}
        >
          <FunnelBar label="Active" value={funnel.activeN} total={funnel.total} color={TONE_HEX.amber} />
          <FunnelBar label="Booked" value={funnel.bookedN} total={funnel.total} color={TONE_HEX.mint} />
          <FunnelBar label="Lost" value={funnel.lostN} total={funnel.total} color={TONE_HEX.coral} />
          <div className="flex items-center justify-between gap-3 mt-3 pt-2.5 text-[11.5px]" style={{ borderTop: "1px dashed var(--line)" }}>
            <span className="text-[var(--ink-faint)]">Conversion <span className="mono" style={{ color: "var(--amber)" }}>{funnel.conv}%</span></span>
            <span className="text-[var(--ink-faint)]">Hit rate (decided) <span className="mono" style={{ color: "var(--mint)" }}>{funnel.hitRate}%</span></span>
          </div>
        </ReportCard>

        {/* 6 · commission summary — restricted designations never see it */}
        {canRevenue && (
        <ReportCard
          title="Commission summary"
          sub="Booked gross, partner payouts, and what the firm keeps"
          icon={<IBank size={15} />}
        >
          <div className="space-y-2.5">
            <CommissionRow label="Gross earned" value={commission.gross} tone="amber" />
            <CommissionRow label="Partner payouts" value={-commission.partnerCut} tone="coral" prefix="− " />
            <div className="flex items-center justify-between pt-2.5" style={{ borderTop: "1px dashed var(--line)" }}>
              <span className="font-disp font-semibold text-[13.5px]">We keep</span>
              <span className="mono font-bold text-[16px]" style={{ color: "var(--mint)" }}>
                <CountUp target={Math.round(commission.net)} format={fmtMoney} />
              </span>
            </div>
          </div>
          <div className="mt-3 pt-2.5 text-[11.5px] text-[var(--ink-faint)]" style={{ borderTop: "1px dashed var(--line)" }}>
            Active pipeline at current rates ·{" "}
            <span className="mono" style={{ color: "var(--ink-dim)" }}>{fmtMoney(commission.pipelineGross)}</span>{" "}projected gross
          </div>
        </ReportCard>
        )}

        <GroupLabel>Risk & rhythm</GroupLabel>

        {/* 7 · SLA breaches */}
        <ReportCard
          title="SLA breaches"
          sub="Active cases past their allowed stage age — click to drill in"
          icon={<IClock size={15} />}
          span
          extra={
            slaCases.length > 0 ? (
              <span className="chip" style={{ color: "var(--coral)", background: "rgba(217,45,32,0.08)", borderColor: "rgba(217,45,32,0.3)" }}>
                {slaCases.length} over SLA
              </span>
            ) : undefined
          }
        >
          {slaCases.length === 0 ? (
            <div className="flex items-center gap-2 text-[12.5px] py-2" style={{ color: "var(--mint)" }}>
              <IInbox size={16} /> Every active case is inside its stage SLA.
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-2 max-h-[320px] overflow-y-auto pr-1">
              {slaCases.map(({ e, c }) => (
                <button
                  key={c.id}
                  className="rowlink flex items-center gap-3 text-left px-3 py-2.5 rounded-lg transition-colors hover:bg-[rgba(242,115,99,0.08)]"
                  style={{ border: "1px solid rgba(242,115,99,0.25)" }}
                  onClick={() => nav({ name: "case", id: c.id })}
                >
                  <span className="dot-overdue shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="mono text-[11.5px] block" style={{ color: "var(--coral)" }}>{c.caseNumber}</span>
                    <span className="text-[12px] text-[var(--ink-dim)] block truncate">
                      {c.customer} · {c.stage} @ {primaryBank(c) ?? "bank TBC"}
                    </span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="mono text-[13px] font-semibold block" style={{ color: "var(--coral)" }}>{e.ageDays}d</span>
                    <span className="text-[10.5px] text-[var(--ink-faint)] block">SLA {e.maxDays}d · +{e.breachDays}d</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </ReportCard>

        {/* 8 · activity trend */}
        <ReportCard
          title="Activity trend"
          sub="Last 14 days of case updates"
          icon={<IChart size={15} />}
          extra={
            <span className="mono text-[11.5px] text-[var(--ink-faint)]">
              {trendTotal} events
            </span>
          }
        >
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col">
              <span className="text-[10.5px] uppercase tracking-[0.1em] text-[var(--ink-faint)] font-disp font-semibold">14-day total</span>
              <span className="font-disp font-bold text-[30px] leading-tight" style={{ color: "var(--amber)" }}>
                <CountUp target={trendTotal} />
              </span>
            </div>
            <div className="flex-1 min-w-[180px] flex flex-col items-end overflow-x-auto">
              <Spark points={trend} color={TONE_HEX.amber} width={260} height={56} />
              <span className="text-[10.5px] text-[var(--ink-faint)] mt-1">today →</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-3 pt-2.5" style={{ borderTop: "1px dashed var(--line)" }}>
            <MiniStat label="Peak day" value={trend.length ? `${Math.max(...trend)}` : "0"} tone="amber" />
            <MiniStat label="Today" value={trend.length ? `${trend[trend.length - 1]}` : "0"} tone="mint" />
            <MiniStat label="Avg / day" value={trend.length ? (trendTotal / trend.length).toFixed(1) : "0"} tone="sky" />
          </div>
        </ReportCard>

        {/* partners overview (uses otherwise unused `partners` import) */}
        <ReportCard
          title="Partner roster"
          sub="Active agents, brokers and referrers with default share"
          icon={<IUsers size={15} />}
        >
          {partners.filter((p) => p.active).length === 0 ? (
            <p className="text-[12.5px] text-[var(--ink-faint)] m-0">No active partners on file.</p>
          ) : (
            <div className="space-y-1.5">
              {partners
                .filter((p) => p.active)
                .map((p) => {
                  const intros = visCases.filter((c) => c.partner?.name === p.name).length;
                  return (
                    <div
                      key={p.id}
                      className="flex items-center gap-3 px-2.5 py-2 rounded-lg"
                      style={{ background: "var(--tint)" }}
                    >
                      <Chip tone={p.kind === "Agent" ? "amber" : p.kind === "Broker" ? "sky" : "coral"}>{p.kind}</Chip>
                      <span className="text-[12.5px] font-medium flex-1 truncate">{p.name}</span>
                      <span className="mono text-[11.5px] text-[var(--ink-faint)]">{p.defaultSharePct}%</span>
                      <span className="mono text-[11.5px] text-[var(--ink-dim)]">{intros} case{intros === 1 ? "" : "s"}</span>
                    </div>
                  );
                })}
            </div>
          )}
        </ReportCard>
      </div>
    </div>
  );
}

/* ---------- sub-components ---------- */

function KpiCard({
  label, value, sub, tone, icon,
}: {
  label: string; value: ReactNode; sub: string; tone: "mint" | "amber" | "coral" | "sky" | "slate"; icon: ReactNode;
}) {
  return (
    <div className="card card-hover px-4 py-3.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--ink-faint)] font-disp font-semibold">{label}</span>
        <span style={{ color: `var(--${tone})` }}>{icon}</span>
      </div>
      <div className="font-disp font-bold text-[26px] leading-tight mt-0.5" style={{ color: `var(--${tone})` }}>
        {value}
      </div>
      <div className="text-[11.5px] text-[var(--ink-faint)]">{sub}</div>
    </div>
  );
}

function WinPill({ pct }: { pct: number }) {
  const tone = pct >= 60 ? "mint" : pct >= 30 ? "amber" : "coral";
  return (
    <Chip tone={tone}>{pct}%</Chip>
  );
}

function FunnelBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className="text-[12.5px] text-[var(--ink-dim)]">{label}</span>
        <span className="mono text-[12px]">
          {value}
          <span className="text-[var(--ink-faint)] ml-1.5">{Math.round(pct)}%</span>
        </span>
      </div>
      <div className="h-[8px] rounded-full overflow-hidden" style={{ background: "var(--track)" }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${color}88, ${color})`,
            transition: "width 0.9s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
      </div>
    </div>
  );
}

function CommissionRow({ label, value, tone, prefix = "" }: { label: string; value: number; tone: "mint" | "amber" | "coral"; prefix?: string }) {
  return (
    <div className="flex items-center justify-between text-[13.5px]">
      <span className="text-[var(--ink-dim)]">{label}</span>
      <span className="mono font-semibold" style={{ color: `var(--${tone})` }}>
        {prefix}
        <CountUp target={Math.abs(Math.round(value))} format={fmtMoney} />
      </span>
    </div>
  );
}
