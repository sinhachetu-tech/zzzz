"use client";

/* Cases — the pipeline worklist. Every case at every stage (leads excluded —
   they live in the Leads tab until converted). Search, filter, sort, click a
   row for the full Case 360. Dashboard is analytics; this is where work
   actually gets picked up. */

import { useMemo, useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { CaseStatus, LoanCase } from "@/lib/types";
import { caseStatusOf, fmtMoney, ageDays } from "@/lib/format";
import { Avatar, Chip, EmptyState, StatusChip } from "@/components/hfmc/ui";
import { BankChips, CaseStateChip, SourceChip } from "@/components/hfmc/bits";
import { IBriefcase, IInbox } from "@/components/icons";

const STATE_TABS: ("Active" | "Booked" | "Lost" | "All")[] = ["Active", "Booked", "Lost", "All"];

export default function Cases() {
  const { cases, stages, users, me, nav, userById, visibleCases, flags, tasks } = useHfmcStore();
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("All");
  const [status, setStatus] = useState("All");
  const [owner, setOwner] = useState("All");
  const [sort, setSort] = useState("urgency");
  const [stateTab, setStateTab] = useState<(typeof STATE_TABS)[number]>("Active");

  const visCases = useMemo(() => visibleCases(), [visibleCases, cases]);
  const statusOf = (c: LoanCase): CaseStatus => caseStatusOf(c, tasks);

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
            The worklist — every engagement past the lead stage. Click a row for the full 360 view.
          </p>
        </div>
      </div>

      <div className="card anim-fade-up">
        <div className="flex flex-wrap items-center gap-2 p-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
          <div className="flex rounded-lg overflow-hidden border w-full sm:w-auto" style={{ borderColor: "var(--line)" }}>
            {STATE_TABS.map((t) => (
              <button key={t} className="px-3 py-1.5 text-[12px] font-disp font-semibold transition-colors flex-1 sm:flex-initial whitespace-nowrap"
                style={stateTab === t ? { background: "rgba(242,176,76,0.15)", color: "var(--amber)" } : { color: "var(--ink-faint)", background: "transparent" }}
                onClick={() => setStateTab(t)}>
                {t} <span className="mono font-normal opacity-70">{counts[t]}</span>
              </button>
            ))}
          </div>
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
          <select className="select w-full sm:!w-[140px]" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="All">All owners</option>
            {users.filter((u) => u.role !== "Head of Company" && u.role !== "PA to HoC").map((u) => <option key={u.id} value={u.id}>{u.name.split(" ")[0]}</option>)}
          </select>
          <select className="select w-full sm:!w-[140px] sm:ml-auto" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="urgency">Most urgent</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="amount">Largest amount</option>
          </select>
        </div>

        <div className="overflow-x-auto" style={{ maxHeight: "60vh" }}>
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
                    <tr key={c.id} onClick={() => nav({ name: "case", id: c.id })}>
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
                      <td>{c.caseStatus === "Active" ? <StatusChip status={st} /> : <CaseStateChip state={c.caseStatus} />}</td>
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
        <div className="px-4 py-2.5 border-t text-[11.5px] text-[var(--ink-faint)] flex items-center gap-2" style={{ borderColor: "var(--line-soft)" }}>
          <IBriefcase size={13} />
          {filtered.length} of {nonLead.length} cases · leads are in the Leads tab until converted
        </div>
      </div>
    </div>
  );
}
