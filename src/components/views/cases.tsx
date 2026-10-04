"use client";

/* Cases — the pipeline worklist. Every case at every stage (leads excluded —
   they live in the Leads tab until converted). Search, filter, sort, click a
   row for the full Case 360. Dashboard is analytics; this is where work
   actually gets picked up. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { CaseStatus, LoanCase } from "@/lib/types";
import { ageDays, caseStatusOf, fmtDate, fmtMoney } from "@/lib/format";
import { Avatar, Chip, EmptyState, StatusChip, Tabs } from "@/components/hfmc/ui";
import { isBeatenLeg } from "@/lib/domain";
import { BankChips, CaseStateChip, LegStatusChip, ServiceLineChip, SourceChip } from "@/components/hfmc/bits";
import { BankLogo } from "@/components/case/ContactBits";
import { useChangedIds } from "@/hooks/use-changed-ids";
import { IBriefcase, IInbox } from "@/components/icons";

const STATE_TABS: ("Active" | "Booked" | "Lost" | "All")[] = ["Active", "Booked", "Lost", "All"];

/* Row-highlight fingerprint. Module scope, not inline, so the identity is
   stable across renders — an inline arrow would be a new reference every
   render, and `useChangedIds` would re-run its effect (and re-flash rows) on
   every store tick. */
const rowKey = (c: LoanCase) => c.id;
/* Only the things a broker would actually notice moving: the derived status
   (On Track → At Risk → Overdue), the stage, and ownership. Amount/age churn
   on their own are NOT included — a row that only ticks a counter must not
   flash, or the table strobes. */
const rowFingerprint = (c: LoanCase) => `${c.stage}|${c.ownerId ?? ""}|${c.caseStatus}`;

const SAVED_VIEWS: { label: string; apply: (patch: { stateTab: (typeof STATE_TABS)[number]; stage: string; status: string; owner: string; sort: string }) => { stateTab: (typeof STATE_TABS)[number]; stage: string; status: string; owner: string; sort: string } }[] = [
  { label: "My overdue", apply: () => ({ stateTab: "Active", stage: "All", status: "Overdue", owner: "mine", sort: "urgency" }) },
  { label: "High value >1M", apply: () => ({ stateTab: "Active", stage: "All", status: "All", owner: "All", sort: "amount" }) },
  { label: "No action 3d+", apply: () => ({ stateTab: "Active", stage: "All", status: "No Action", owner: "All", sort: "urgency" }) },
  { label: "Unassigned", apply: () => ({ stateTab: "Active", stage: "All", status: "All", owner: "unassigned", sort: "newest" }) },
  // The conversion stamp makes this view possible: it separates files that
  // arrived as a website/agent lead from ones created straight into the
  // pipeline, which is the question the funnel report cannot answer on its own.
  { label: "From lead", apply: () => ({ stateTab: "Active", stage: "All", status: "All", owner: "All", sort: "newest" }) },
];

export default function Cases() {
  const { cases, stages, users, me, nav, userById, visibleCases, flags, tasks, banks, serviceLines } = useHfmcStore();
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("All");
  const [status, setStatus] = useState("All");
  const [owner, setOwner] = useState("All");
  // Service-line filter (Phase 1). Stored as the service line CODE, not the id:
  // ids are database-assigned and would break the persisted filter if the DB were
  // ever rebuilt, while MORTGAGE is a stable contract.
  const [service, setService] = useState("All");
  const [sort, setSort] = useState("urgency");
  const [stateTab, setStateTab] = useState<(typeof STATE_TABS)[number]>("Active");
  const [activeView, setActiveView] = useState<string | null>(null);

  // Persist filters — the worklist survives refresh / share-the-habit.
  /* eslint-disable react-hooks/set-state-in-effect -- the saved filter set is
     only knowable on the client; one pass seeds it, the write-back effect keeps it */
  useEffect(() => {
    try {
      const raw = localStorage.getItem("hfmc.casesFilters");
      if (!raw) return;
      const f = JSON.parse(raw);
      if (f.search !== undefined) setSearch(f.search);
      if (f.stage) setStage(f.stage);
      if (f.status) setStatus(f.status);
      if (f.owner) setOwner(f.owner);
      if (f.service) setService(f.service);
      if (f.sort) setSort(f.sort);
      if (f.stateTab && (STATE_TABS as string[]).includes(f.stateTab)) setStateTab(f.stateTab);
    } catch { /* private mode */ }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    try { localStorage.setItem("hfmc.casesFilters", JSON.stringify({ search, stage, status, owner, service, sort, stateTab })); } catch { /* private mode */ }
  }, [search, stage, status, owner, service, sort, stateTab]);

  const visCases = useMemo(() => visibleCases(), [visibleCases, cases]);
  const statusOf = (c: LoanCase): CaseStatus => caseStatusOf(c, tasks);

  // code → id, so the persisted filter survives a DB rebuild (ids are not stable,
  // codes are). Rebuilt only when the catalogue changes.
  const serviceIdByCode = useMemo(
    () => new Map(serviceLines.map((s) => [s.code, s.id])),
    [serviceLines],
  );

  /* Flash the row when its status/stage/owner actually changes, so a row that
     moved under you is findable instead of silently re-sorted. Uses `statusOf`
     too — status is DERIVED from tasks (never stored), so a task completing
     elsewhere flips On Track → No Action with no write to the case at all.
     That invisible transition is exactly the one worth seeing. */
  const statusById = useMemo(
    () => new Map(visCases.map((c) => [c.id, caseStatusOf(c, tasks)])),
    [visCases, tasks],
  );
  const changedIds = useChangedIds(
    visCases,
    rowKey,
    useCallback((c: LoanCase) => `${rowFingerprint(c)}|${statusById.get(c.id) ?? ""}`, [statusById]),
  );

  const scope =
    me?.role === "Head of Company" || me?.role === "PA to HoC" || me?.role === "Mortgage Head" || me?.role === "Super Admin"
      ? "all teams"
      : me?.role === "Team Leader SPO" || me?.role === "Team Leader VRM"
      ? `team ${me.team}`
      : "your book";

  const filtered = visCases
    .filter((c) => {
      if (c.stage === "Lead") return false; // leads live in the Leads tab
      if (stateTab === "Active" && c.caseStatus !== "Active") return false;
      if (stateTab === "Booked" && c.caseStatus !== "Closed") return false;
      if (stateTab === "Lost" && c.caseStatus !== "Lost") return false;
      if (stage !== "All" && c.stage !== stage) return false;
      // Service-line filter. Matched on CODE via the catalogue, so a case whose
      // serviceLineId is null (legacy row before the backfill) still shows under
      // "All" rather than vanishing from every view.
      if (service !== "All" && c.serviceLineId !== serviceIdByCode.get(service)) return false;
      if (owner === "mine" && c.ownerId !== me?.id) return false;
      else if (owner === "unassigned" && c.ownerId !== 1) return false;
      else if (owner !== "All" && owner !== "mine" && owner !== "unassigned" && c.ownerId !== parseInt(owner, 10)) return false;
      if (status !== "All" && statusOf(c) !== status) return false;
      // High value view reuses amount sort + 1M floor
      if (activeView === "High value >1M" && c.loanAmount < 1_000_000) return false;
      // "From lead" = carries a conversion stamp. Cases created directly into
      // the pipeline (never a Lead) have convertedAt === null.
      if (activeView === "From lead" && !c.convertedAt) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !c.customer.toLowerCase().includes(q) &&
          !c.caseNumber.toLowerCase().includes(q) &&
          !c.banks.some((b) => b.toLowerCase().includes(q)) &&
          !c.whatsapp.toLowerCase().includes(q)
        ) return false;
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

  const nonLead = visCases.filter((c) => c.stage !== "Lead");
  const counts = {
    Active: nonLead.filter((c) => c.caseStatus === "Active").length,
    Booked: nonLead.filter((c) => c.caseStatus === "Closed").length,
    Lost: nonLead.filter((c) => c.caseStatus === "Lost").length,
    All: nonLead.length,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-disp font-bold text-[24px] tracking-tight m-0">
            Cases · <span style={{ color: "var(--amber)" }}>{scope}</span>
          </h1>
          <p className="text-[13px] text-[var(--ink-dim)] mt-0.5 mb-0">
            The worklist — every engagement past the lead stage. Click a row for the full 360 view.{" "}
            <span style={{ color: "var(--ink-faint)" }}>
              Read-only here: re-owning a file or shopping it to another bank is done in the Leads tab, so there is one
              place that decides where a deal sits.
            </span>
          </p>
        </div>
      </div>

      <div className="card anim-fade-up">
        {/* Saved views — one-tap filters managers actually use */}
        <div className="flex flex-wrap items-center gap-1.5 px-3 pt-3">
          {SAVED_VIEWS.map((v) => {
            const on = activeView === v.label;
            return (
              <button key={v.label} className="chip transition-all"
                style={on ? { background: "var(--amber-tint)", borderColor: "var(--amber)", color: "var(--amber)" } : undefined}
                onClick={() => {
                  if (on) { setActiveView(null); return; }
                  const p = v.apply({ stateTab, stage, status, owner, sort });
                  setStateTab(p.stateTab); setStage(p.stage); setStatus(p.status); setOwner(p.owner); setService("All"); setSort(p.sort);
                  setActiveView(v.label);
                }}>
                {v.label}
              </button>
            );
          })}
          {(search || stage !== "All" || status !== "All" || owner !== "All" || activeView) && (
            <button className="text-[11.5px] ml-1 text-[var(--ink-faint)] hover:text-[var(--coral)] transition-colors"
              onClick={() => { setSearch(""); setStage("All"); setStatus("All"); setOwner("All"); setService("All"); setSort("urgency"); setStateTab("Active"); setActiveView(null); }}>
              Clear ×
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 p-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
          <Tabs
            scroll
            className="w-full sm:w-auto"
            value={stateTab}
            onChange={setStateTab}
            options={STATE_TABS.map((t) => ({ value: t, label: t, count: counts[t] }))}
          />
          <input className="input w-full sm:!w-[190px]" placeholder="Search case / customer…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="select w-full sm:!w-[150px]" value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="All">All stages</option>
            {[...stages].sort((a, b) => a.sortOrder - b.sortOrder).filter((s) => s.label !== "Lead").map((s) => <option key={s.id} value={s.label}>{s.label}</option>)}
          </select>
          {stateTab === "Active" && (
            <select className="select w-full sm:!w-[130px]" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="All">All status</option>
              {["On Track", "At Risk", "Overdue", "No Action"].map((s) => <option key={s}>{s}</option>)}
            </select>
          )}
          <select className="select w-full sm:!w-[140px]" value={owner} onChange={(e) => { setOwner(e.target.value); setActiveView(null); }}>
            <option value="All">All owners</option>
            <option value="mine">Mine</option>
            <option value="unassigned">Unassigned</option>
            {users.filter((u) => u.role !== "Head of Company" && u.role !== "PA to HoC").map((u) => <option key={u.id} value={u.id}>{u.name.split(" ")[0]}</option>)}
          </select>
          {/* Service-line filter — only rendered once the firm actually sells more than one
              thing. A "Service: All" dropdown next to a single service is noise. */}
          {serviceLines.filter((s) => s.active).length > 1 && (
            <select className="select w-full sm:!w-[150px]" value={service}
              onChange={(e) => { setService(e.target.value); setActiveView(null); }}>
              <option value="All">All services</option>
              {serviceLines.filter((s) => s.active).map((s) => <option key={s.id} value={s.code}>{s.shortName || s.name}</option>)}
            </select>
          )}
          <select className="select w-full sm:!w-[140px] sm:ml-auto" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="urgency">Most urgent</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="amount">Largest amount</option>
          </select>
        </div>

        <div className="overflow-x-auto hidden sm:block" style={{ maxHeight: "60vh" }}>
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState icon={<IInbox size={26} />} title={`Nothing in “${stateTab}”`} body="Adjust the filters, or use the Add lead button in the top bar to get things moving." />
            </div>
          ) : (
            <table className="tbl min-w-[1200px]">
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Customer</th>
                  <th>Status note</th>
                  <th>Source</th>
                  <th>Banks</th>
                  <th>Stage</th>
                  <th>Amount</th>
                  <th>Owner</th>
                  <th>Age</th>
                  {stateTab === "Active" ? <th>Status</th> : <th>Lifecycle</th>}
                  <th className="hidden md:table-cell">Transaction</th>
                  <th className="hidden md:table-cell">Location</th>
                  <th className="hidden md:table-cell">Bank RM</th>
                  <th className="hidden md:table-cell">VRM</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const st = statusOf(c);
                  const vrm = c.vrmId ? userById(c.vrmId) : null;
                  const note = c.statusNote?.trim() ?? "";
                  const noteShort = note.length > 40 ? `${note.slice(0, 39)}…` : note;
                  return (
                    <tr
                      key={c.id}
                      className={changedIds.has(c.id) ? "row-changed" : undefined}
                      // A leg beaten by another bank stays in the list — the bank
                      // still has its valuation history, which matters for the
                      // buyout in two years — but dimmed so it never reads as live
                      // work. `Lost race` is not the coral "Lost" state.
                      style={isBeatenLeg(c) ? { opacity: 0.55 } : undefined}
                      onClick={() => nav({ name: "case", id: c.id })}
                    >
                      <td className="mono text-[12.5px]" style={{ color: "var(--amber)" }}>{c.caseNumber}</td>
                      <td className="font-medium">
                        <div className="flex items-center gap-1.5">
                          {c.onHold && (
                            <span
                              className="chip shrink-0"
                              title={c.holdReason ? `On hold — ${c.holdReason}${c.holdUntil ? ` (until ${c.holdUntil})` : ""}` : "On hold"}
                              style={{ color: "var(--amber)", background: "rgba(242,176,76,0.12)", borderColor: "rgba(242,176,76,0.4)", padding: "1px 6px", fontSize: "9.5px" }}
                            >
                              ON HOLD
                            </span>
                          )}
                          <span className="truncate" style={{ maxWidth: 200 }}>{c.customer}</span>
                        </div>
                        {/* Contact + conversion status — the row a broker scans
                            before dialling. Phone doubles as the search target. */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                          {c.whatsapp && (
                            <span className="mono text-[10.5px]" style={{ color: "var(--ink-faint)" }}>{c.whatsapp}</span>
                          )}
                          {c.convertedAt && (
                            <span
                              className="chip"
                              title={`Converted from a lead on ${fmtDate(c.convertedAt.slice(0, 10))}${c.convertedById ? ` by ${userById(c.convertedById)?.name ?? "staff"}` : ""}`}
                              style={{ color: "var(--mint)", background: "rgba(16,185,129,0.12)", borderColor: "rgba(16,185,129,0.35)", padding: "1px 6px", fontSize: "9.5px" }}
                            >
                              Converted {(() => {
                                const d = ageDays(c.convertedAt);
                                return d <= 0 ? "today" : `${d}d ago`;
                              })()}
                            </span>
                          )}
                        </div>
                        {c.partner && (<span className="block text-[10.5px] text-[var(--ink-faint)]">{c.partner.name}{flags?.viewRevenue ? ` · ${c.partner.sharePct}%` : ""}</span>)}
                      </td>
                      <td className="text-[12px] text-[var(--ink-dim)]" style={{ maxWidth: 220 }}>
                        {noteShort ? (
                          <span title={note}>{noteShort}</span>
                        ) : (
                          <span className="text-[var(--ink-faint)]">—</span>
                        )}
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
                      <td>
                        <span className="flex items-center gap-1.5">
                          <ServiceLineChip serviceLineId={c.serviceLineId} serviceLines={serviceLines} compact />
                          <LegStatusChip status={c.legStatus} />
                          {c.caseStatus === "Active" ? <StatusChip status={st} /> : <CaseStateChip state={c.caseStatus} />}
                        </span>
                      </td>
                      <td className="hidden md:table-cell text-[12px] text-[var(--ink-dim)]">{c.transactionType || <span className="text-[var(--ink-faint)]">—</span>}</td>
                      <td className="hidden md:table-cell text-[12px] text-[var(--ink-dim)]">{c.propertyLocation || <span className="text-[var(--ink-faint)]">—</span>}</td>
                      <td className="hidden md:table-cell text-[12px] text-[var(--ink-dim)]">{c.bankRm || <span className="text-[var(--ink-faint)]">—</span>}</td>
                      <td className="hidden md:table-cell">
                        {vrm ? (
                          <div className="flex items-center gap-2">
                            <Avatar name={vrm.name} size={22} />
                            <span className="text-[12px] text-[var(--ink-dim)]">{vrm.name.split(" ")[0]}</span>
                          </div>
                        ) : <span className="text-[var(--ink-faint)]">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {/* Mobile card list — no horizontal scroll, thumb-sized tap targets */}
        <div className="sm:hidden divide-y" style={{ borderColor: "var(--line-soft)" }}>
          {filtered.slice(0, 60).map((c) => {
            const st = statusOf(c);
            return (
              <button key={c.id} className="w-full text-left px-3.5 py-3 flex items-center gap-3 active:bg-[var(--tint)]" style={isBeatenLeg(c) ? { opacity: 0.55 } : undefined} onClick={() => nav({ name: "case", id: c.id })}>
                <div className="flex items-start gap-3">
                  {(() => {
                    // Bank mark leads on mobile: "which bank is this with" is the
                    // first question on a phone; the customer name is right there.
                    const b = banks.find((x) => x.name === (c.wonBank ?? c.banks[0]));
                    return b ? <BankLogo bank={b} size={30} /> : <Avatar name={c.customer} size={30} />;
                  })()}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[13px] font-semibold truncate">{c.customer}</span>
                      {c.onHold && <span className="chip shrink-0" style={{ color: "var(--amber)", background: "rgba(242,176,76,0.12)", borderColor: "rgba(242,176,76,0.4)", padding: "1px 6px", fontSize: "9px" }}>HOLD</span>}
                      {c.convertedAt && (
                        <span
                          className="chip shrink-0"
                          title={`Converted from a lead on ${fmtDate(c.convertedAt.slice(0, 10))}`}
                          style={{ color: "var(--mint)", background: "rgba(16,185,129,0.12)", borderColor: "rgba(16,185,129,0.35)", padding: "1px 6px", fontSize: "9px" }}
                        >
                          CONVERTED
                        </span>
                      )}
                    </span>
                    {/* Phone is the number a broker dials from the worklist on a
                        phone — it belongs on the card, not behind a tap. */}
                    {c.whatsapp && (
                      <span className="block mono text-[11px] mt-0.5 truncate" style={{ color: "var(--ink-dim)" }}>{c.whatsapp}</span>
                    )}
                    <span className="block mono text-[10.5px] text-[var(--ink-faint)] mt-0.5 truncate">{c.caseNumber} · {fmtMoney(c.loanAmount)} · {c.stage} · {ageDays(c.createdAt)}d</span>
                  </span>
                </div>
                <span className="flex items-center gap-1.5">
                  <LegStatusChip status={c.legStatus} />
                  {c.caseStatus === "Active" ? <StatusChip status={st} /> : <CaseStateChip state={c.caseStatus} />}
                </span>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="p-6">
              <EmptyState icon={<IInbox size={26} />} title={`Nothing in “${stateTab}”`} body="Adjust the filters, or use the Add lead button in the top bar to get things moving." />
            </div>
          )}
        </div>
        <div className="px-4 py-2.5 border-t text-[11.5px] text-[var(--ink-faint)] flex items-center gap-2" style={{ borderColor: "var(--line-soft)" }}>
          <IBriefcase size={13} />
          {filtered.length} of {nonLead.length} cases · leads are in the Leads tab until converted
        </div>
      </div>
    </div>
  );
}
