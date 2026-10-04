"use client";
import { CaseProfileEditor } from "@/components/views/case-profile-editor";
import { parseCaseProfile, computeJointAffordability } from "@/lib/case-profile";
import { ContactLine, BankLogo, KycChip, resolveContact } from "@/components/case/ContactBits";
import { ConvertLeadModal } from "@/components/case/ConvertLeadModal";
import { computeReadiness } from "@/lib/lead-readiness";
import { AddBankModal } from "@/components/views/add-bank-modal";

/* Leads view — the top of the funnel. Lead-stage cases (including portal
   self-registrations) with qualify / assign / convert actions.

   A "Lead" is not a table — it is a LoanCase row while stage === "Lead".
   Converting moves the stage and stamps convertedAt/convertedById (see
   api/cases/[id]/route.ts). The cards therefore print the person's CONTACT
   details up front, because a lead you cannot call is not a lead. */

import { useMemo, useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import { fmtDate, relTime, inDaysISO } from "@/lib/format";
import { Avatar, Chip, EmptyState, Modal } from "@/components/hfmc/ui";
import { ConfirmModal } from "@/components/hfmc/bits";
import { IArrowR, ITrash, IWhatsapp, IPencil, IPlus, IGrid, IBank, IShield, IUsers } from "@/components/icons";

/** Lead age → SLA tone. Fresh leads convert; stale leads die. */
function leadAge(createdAt: string): { hours: number; label: string; tone: "mint" | "amber" | "coral" } {
  const h = Math.max(0, (Date.now() - new Date(createdAt).getTime()) / 3_600_000);
  if (h < 24) return { hours: h, label: h < 1 ? "new" : `${Math.floor(h)}h old`, tone: "mint" };
  if (h < 72) return { hours: h, label: `${Math.floor(h / 24)}d old`, tone: "amber" };
  return { hours: h, label: `${Math.floor(h / 24)}d old`, tone: "coral" };
}

/** Leads per page. 10 is the triage sweet spot: enough to scan a morning's
 *  intake in one screen, few enough that nobody scrolls a wall of cards. */
const PAGE_SIZE = 10;

/** Days since an ISO timestamp, for the "Converted 3d ago" chips. */
function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

export default function Leads() {
  const { cases, users, userById, updateCase, deleteCase, toast, nav, me, flags, banks, channels, stages, openNewCase, clients } = useHfmcStore();
  const [filter, setFilter] = useState<"all" | "mine" | "unassigned" | "ready">("all");
  // Default is NEWEST first: a broker opening the Leads tab is asking "what just
  // came in?". "Oldest first" (stale needs a nudge) stays one dropdown click
  // away because that is still the right view when you are working the backlog.
  const [sort, setSort] = useState<"newest" | "oldest" | "ready">("newest");
  // 10 per page. The funnel is a triage list, not a report — a broker should
  // never scroll past more than 10 cards to reach the bottom.
  const [page, setPage] = useState(1);
  const [qualifyingCase, setQualifyingCase] = useState<any>(null);
  const [convertingCase, setConvertingCase] = useState<any>(null);
  const [addingBankTo, setAddingBankTo] = useState<any>(null);
  // The converted-leads archive: its own search box + "show all" expander, so it
  // never crowds the live funnel above it.
  const [archiveSearch, setArchiveSearch] = useState("");
  const [archivePage, setArchivePage] = useState(1);
  const [losingCase, setLosingCase] = useState<{ id: number; caseNumber: string; customer: string } | null>(null);
  const [loseReason, setLoseReason] = useState("");
  const [delCase, setDelCase] = useState<{ id: number; caseNumber: string; customer: string } | null>(null);
  const [editingCase, setEditingCase] = useState<any>(null);

  const canAssign = !!(flags?.issueTasks || flags?.admin || flags?.super);
  const canDelete = !!(flags?.admin || flags?.super);
  const canEditDetails = !!(flags?.admin || flags?.super || flags?.issueTasks); // allow editing for staff who can assign

  const markLost = async () => {
    if (!losingCase) return;
    await updateCase(losingCase.id, { caseStatus: "Lost", lostReason: loseReason.trim() || "No reason given" });
    toast("info", `${losingCase.caseNumber} marked lost — kept on record with the reason.`);
    setLosingCase(null); setLoseReason("");
  };
  // Readiness per lead, from the SAME rules the Convert pre-flight uses
  // (src/lib/lead-readiness.ts) — so the badge, this sort and the modal can
  // never disagree about what "qualified" means.
  const readinessFor = useMemo(() => {
    const map = new Map<number, ReturnType<typeof computeReadiness>>();
    for (const c of cases) {
      if (c.stage !== "Lead") continue;
      const contact = resolveContact(c, clients.find((cl) => cl.id === c.clientId));
      const ownerName = c.ownerId > 1 ? userById(c.ownerId)?.name ?? null : null;
      map.set(c.id, computeReadiness({
        phone: contact.phone || c.whatsapp,
        email: contact.email,
        eidNo: contact.eidNo,
        passportNo: contact.passportNo,
        ownerName,
        loanAmount: c.loanAmount,
        customer: c.customer,
      }));
    }
    return map;
  }, [cases, clients, userById]);

  const leads = useMemo(
    () =>
      cases.filter((c) => c.stage === "Lead" && c.caseStatus === "Active")
        .filter((c) =>
          filter === "all" ? true
            : filter === "unassigned" ? !c.ownerId || c.ownerId === 1
              : filter === "ready" ? readinessFor.get(c.id)?.ready === true
                : c.ownerId === me?.id,
        )
        .sort((a, b) => {
          if (sort === "ready") {
            // Most complete first; readiness score already weights the hard
            // gaps, so a lead missing only an email outranks one with no owner.
            const d = (readinessFor.get(b.id)?.score ?? 0) - (readinessFor.get(a.id)?.score ?? 0);
            if (d) return d;
          }
          if (sort === "newest") return b.createdAt.localeCompare(a.createdAt);
          return a.createdAt.localeCompare(b.createdAt); // stale first
        }),
    [cases, filter, sort, me?.id, readinessFor],
  );

  // Page slice. Sort/filter first, paginate LAST, so page 1 always means "the top
  // N of the current view".
  //
  // NOTE: page resets happen in the control handlers, NOT in an effect. Two
  // reasons — this repo's react-hooks/set-state-in-effect rule (correctly) flags
  // effect-driven setState as a cascading render, and an effect fires *after*
  // the first paint, so the user would see page 4 of a now-3-row list flash
  // empty before it corrected itself. Resetting in the handler is both cheaper
  // and one frame sooner.
  const pageCount = Math.max(1, Math.ceil(leads.length / PAGE_SIZE));
  // Derived clamp: if rows are deleted underneath us, page 9 of 5 renders the
  // last page rather than an empty screen.
  const safePage = Math.min(page, pageCount);
  const leadsPage = useMemo(
    () => leads.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [leads, safePage],
  );

  const readyCount = useMemo(
    () => cases.filter((c) => c.stage === "Lead" && c.caseStatus === "Active" && readinessFor.get(c.id)?.ready).length,
    [cases, readinessFor],
  );

  // Converted leads — the whole history, searchable. This is the Leads tab's
  // answer to "I need to change something on a deal that is already qualified":
  // the Cases tab is deliberately read-only, so this archive is the only place
  // a converted file can still be re-owned, re-shopped or corrected.
  //
  // It is NOT capped at 7 days. An earlier version showed only the last week,
  // which left anything older with no edit surface at all once the Cases-tab
  // editing was removed. Default view is the newest few so the top of the page
  // stays uncluttered; the search + "show all" reveal the rest.
  const convertedLeads = useMemo(
    () =>
      cases
        .filter((c) => c.convertedAt && c.stage !== "Lead")
        .sort((a, b) => (b.convertedAt ?? "").localeCompare(a.convertedAt ?? "")),
    [cases],
  );

  const archiveMatches = useMemo(() => {
    const q = archiveSearch.trim().toLowerCase();
    if (!q) return convertedLeads;
    const digits = q.replace(/\D/g, "");
    return convertedLeads.filter(
      (c) =>
        c.customer.toLowerCase().includes(q) ||
        c.caseNumber.toLowerCase().includes(q) ||
        (c.bankRef ?? "").toLowerCase().includes(q) ||
        c.banks.some((b) => b.toLowerCase().includes(q)) ||
        (digits.length > 0 && c.whatsapp.includes(digits)),
    );
  }, [convertedLeads, archiveSearch]);

  // Paginated at the same 10/page as the funnel. It used to be "6 then show
  // everything", which was fine when it held a handful of rows and is unusable
  // now that every historical case is stamped.
  // `safePage` is the requested page clamped to the real range, so deleting rows
  // out from under the view lands on the last page instead of an empty one.
  const archivePageCount = Math.max(1, Math.ceil(archiveMatches.length / PAGE_SIZE));
  const safeArchivePage = Math.min(archivePage, archivePageCount);
  const archiveShown = archiveMatches.slice((safeArchivePage - 1) * PAGE_SIZE, safeArchivePage * PAGE_SIZE);
  const convertedCount = archiveMatches.length;

  const undoConversion = async (c: { id: number; caseNumber: string }) => {
    await updateCase(c.id, { stage: "Lead" });
    toast("info", `${c.caseNumber} sent back to the Leads funnel. The original conversion date is kept on record.`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-disp font-bold text-[24px] tracking-tight m-0 flex items-center gap-2.5">
            Leads
          </h1>
          <p className="text-[13px] text-[var(--ink-dim)] mt-0.5 mb-0">
            Portal registrations and fresh inquiries — qualify them, then convert into the pipeline.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "var(--line)" }}>
            {(["all", "ready", "mine", "unassigned"] as const).map((f) => (
              <button key={f} className="px-3 py-1.5 text-[12px] font-disp font-semibold transition-colors"
                style={filter === f ? { background: "var(--amber-tint)", color: "var(--amber)" } : { color: "var(--ink-faint)" }}
                onClick={() => {
                  setFilter(f);
                  setPage(1);
                  // "Ready" only makes sense ranked by readiness — switching to
                  // the pill implies the sort, so don't make it a second click.
                  if (f === "ready") setSort("ready");
                }}>
                {f === "all" ? "All" : f === "ready" ? `Ready${readyCount ? ` · ${readyCount}` : ""}` : f === "mine" ? "Mine" : "Unassigned"}
              </button>
            ))}
          </div>
          <select className="select !w-auto !py-1 text-[11.5px]" value={sort}
            onChange={(e) => { setSort(e.target.value as typeof sort); setPage(1); }}
            title="How to order the funnel">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first (stale needs a nudge)</option>
            <option value="ready">Most qualified first</option>
          </select>
        </div>
        {/* Add Lead button in Leads view */}
        <button className="btn btn-primary btn-sm ml-2" onClick={() => openNewCase()}>
          Add lead
        </button>
      </div>

      {/* CONVERTED LEADS — the modification surface for already-qualified deals.
          The Cases tab is deliberately read-only, so this archive (searchable,
          full history, not just the last week) is the only place a converted file
          can still be re-owned, re-shopped or corrected. */}
      {convertedLeads.length > 0 && (
        <div className="card p-3.5 anim-fade-up" style={{ borderLeft: "3px solid var(--mint)" }}>
          <div className="flex flex-wrap items-center gap-2 mb-2.5">
            <span style={{ color: "var(--mint)" }}><IArrowR size={13} /></span>
            <span className="font-disp font-semibold text-[12.5px]">Converted leads</span>
            <span className="mono text-[10.5px] text-[var(--ink-faint)]">
              {convertedCount} qualified{archiveSearch ? ` matching “${archiveSearch}”` : ""}
            </span>
            <input
              className="input !w-auto !py-1 text-[11.5px] ml-auto"
              style={{ width: 220 }}
              placeholder="Name / case no / phone / bank ref…"
              value={archiveSearch}
              onChange={(e) => { setArchiveSearch(e.target.value); setArchivePage(1); }}
            />
          </div>

          {archiveShown.length === 0 ? (
            <p className="text-[12px] text-[var(--ink-faint)] m-0 py-3">No converted lead matches that search.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                {archiveShown.map((c) => {
                  const by = c.convertedById ? userById(c.convertedById)?.name : null;
                  const bank = banks.find((b: any) => b.name === c.banks[0]);
                  return (
                    <div key={c.id} className="flex items-center gap-2 rounded-lg px-2.5 py-2" style={{ background: "var(--tint)", border: "1px solid var(--line-soft)" }}>
                      {bank ? <BankLogo bank={bank} size={24} /> : (
                        <span className="w-6 text-center text-[8px] text-[var(--ink-faint)] leading-tight shrink-0" title="No bank on this case yet">no bank</span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-medium truncate">{c.customer}</div>
                        <div className="mono text-[10.5px] text-[var(--ink-faint)] truncate">
                          {c.caseNumber} · {c.banks[0] ?? "no bank"} · {c.stage} ·{" "}
                          {c.convertedAt ? `${daysSince(c.convertedAt)}d ago` : ""}{by ? ` · ${by.split(" ")[0]}` : ""}
                        </div>
                        {c.bankRef && (
                          <div className="mono text-[10px]" style={{ color: "var(--mint)" }}>bank ref {c.bankRef}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {/* Re-own without leaving this tab — the reason editing
                            lives here and not in the Cases worklist. */}
                        {canAssign ? (
                          <select
                            className="select !w-auto !py-0.5 text-[10.5px]"
                            value={c.ownerId}
                            title="Re-assign this file"
                            onChange={async (e) => {
                              const id = Number(e.target.value);
                              await updateCase(c.id, { ownerId: id });
                              toast("success", `${c.caseNumber} → ${userById(id)?.name ?? "owner"}.`);
                            }}
                          >
                            <option value={1}>— unassigned —</option>
                            {users.filter((u) => u.active && u.role !== "Head of Company").map((u) => (
                              <option key={u.id} value={u.id}>{u.name.split(" ")[0]}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-[10.5px] text-[var(--ink-faint)]">{userById(c.ownerId)?.name.split(" ")[0] ?? "—"}</span>
                        )}
                        <button className="btn btn-ghost btn-sm !px-1.5" title="Correct any other detail on this lead" onClick={() => setEditingCase(c)}>
                          <IPencil size={12} />
                        </button>
                        <button className="btn btn-ghost btn-sm !px-1.5" title="Open a separate case with another bank" onClick={() => setAddingBankTo(c)}>
                          <IBank size={12} />
                        </button>
                        <button className="btn btn-ghost btn-sm !px-1.5" title="Open Case 360" onClick={() => nav({ name: "case", id: c.id })}>
                          <IArrowR size={12} />
                        </button>
                        <button className="btn btn-ghost btn-sm !px-1.5" title="Send back to the Leads funnel" onClick={() => undoConversion(c)}>
                          Undo
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {archivePageCount > 1 && (
                <div className="flex items-center gap-1 mt-2.5">
                  <button className="btn btn-ghost btn-sm" disabled={archivePage === 1} onClick={() => setArchivePage((p) => Math.max(1, p - 1))}>
                    ← Newer
                  </button>
                  <span className="mono text-[11px] px-1.5" style={{ color: "var(--ink-dim)" }}>{safeArchivePage} / {archivePageCount}</span>
                  <button className="btn btn-ghost btn-sm" disabled={safeArchivePage === archivePageCount} onClick={() => setArchivePage((p) => Math.min(archivePageCount, p + 1))}>
                    Older →
                  </button>
                  <span className="mono text-[11px] ml-1.5">
                    {(safeArchivePage - 1) * PAGE_SIZE + 1}–{Math.min(safeArchivePage * PAGE_SIZE, archiveMatches.length)} of {archiveMatches.length}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {leads.length === 0 ? (
        <div className="card p-10">
          <EmptyState
            icon={<IArrowR size={24} />}
            title={filter === "all" ? "No leads in the funnel" : "Nothing matches this filter"}
            body={filter === "all"
              ? "Every enquiry has already been converted into a live case — you can still re-own or re-shop any of them in the Converted leads list below. New portal registrations and manually added Lead-stage cases will appear here."
              : "Try a different filter, or switch back to All to see the whole funnel."}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {leadsPage.map((c) => {
            const age = leadAge(c.createdAt);
            const owner = userById(c.ownerId);
            const unassigned = c.ownerId === 1 || !owner;
            const contact = resolveContact(c, clients.find((cl) => cl.id === c.clientId));
            const ready = readinessFor.get(c.id);
            return (
              <div key={c.id} className="card p-4 anim-fade-up" style={{ borderLeft: `3px solid ${ready?.ready ? "var(--mint)" : "var(--amber)"}` }}>
                <div className="flex items-start gap-3">
                  <div className="flex flex-col items-center gap-1.5 shrink-0">
                    <Avatar name={contact.name || c.customer} size={40} />
                    {/* Which bank this lead is aimed at, with its real logo when
                        one has been uploaded (Admin → Banks). A lettered tile is
                        the fallback, so the column never collapses. */}
                    {(() => {
                      const b = banks.find((x: any) => x.name === c.banks[0]);
                      if (b) return <BankLogo bank={b} size={22} />;
                      // No bank yet — say so rather than leaving a silent gap that
                      // reads as a broken image.
                      return c.banks.length ? null : (
                        <span className="text-[8.5px] text-[var(--ink-faint)] text-center leading-tight" title="No bank chosen yet — pick one in Details, or use Add bank">
                          no bank
                        </span>
                      );
                    })()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="mono text-[12px]" style={{ color: "var(--amber)" }}>{c.caseNumber}</span>
                      {/* Readiness: the same score the Convert pre-flight shows,
                          so a broker can see who is one click from the pipeline. */}
                      {ready?.ready
                        ? <Chip tone="mint">ready to convert</Chip>
                        : <Chip tone="coral">{ready?.gaps} to sort</Chip>}
                      <Chip tone="slate">{c.source}</Chip>
                      {unassigned && <Chip tone="coral">unassigned</Chip>}
                      <Chip tone={age.tone}>⏱ {age.label}</Chip>
                      {c.clientId && <Chip tone="amber">known client</Chip>}
                    </div>
                    {/* Completeness meter — hover for the exact gap, so the list
                        never says "not ready" without saying why. */}
                    {ready && (
                      <div className="flex items-center gap-2 mt-1.5" title={ready.items.filter((i) => !i.ok).map((i) => i.hint).join(" · ") || "Nothing outstanding"}>
                        <div className="h-1 flex-1 rounded-full max-w-[150px]" style={{ background: "var(--line-soft)" }}>
                          <div className="h-1 rounded-full" style={{ width: `${ready.score}%`, background: ready.ready ? "var(--mint)" : "var(--amber)" }} />
                        </div>
                        <span className="mono text-[10px]" style={{ color: ready.ready ? "var(--mint)" : "var(--ink-faint)" }}>{ready.score}%</span>
                      </div>
                    )}
                    <div className="font-disp font-semibold text-[15px] mt-1">{contact.name || c.customer}</div>

                    {/* Contact block — the reason this tab was barren. Phone and
                        email are tappable, and a gap is stated in amber rather
                        than left as an empty cell. */}
                    <div className="mt-1.5">
                      <ContactLine contact={contact} size={12.5} />
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      <KycChip contact={contact} />
                      {(() => {
                        const prof = parseCaseProfile(c.profileJson, { customer: c.customer, loanAmount: c.loanAmount, coApplicantName: c.coApplicantName });
                        const joint = computeJointAffordability(prof);
                        return <Chip tone={joint.badgeTone}>{joint.badgeLabel}</Chip>;
                      })()}
                      {c.loanAmount > 0 && <Chip tone="sky">{fmtMoneyShort(c.loanAmount)} target</Chip>}
                    </div>

                    <p className="text-[11.5px] text-[var(--ink-dim)] m-0 mt-1.5 leading-snug">
                      {c.statusNote || "No inquiry note."}
                    </p>
                    <p className="text-[10.5px] text-[var(--ink-faint)] m-0 mt-1">
                      {fmtDate(c.createdAt)} · {relTime(c.createdAt)}
                    </p>
                  </div>
                  {contact.phone && (
                    <a className="btn btn-mint btn-sm !px-2 shrink-0" title={`WhatsApp ${contact.phone}`} target="_blank" rel="noreferrer"
                      href={`https://wa.me/${contact.phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Hello, this is HFMC regarding your home finance inquiry (${c.caseNumber}).`)}`}>
                      <IWhatsapp size={14} />
                    </a>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-3 pt-2.5" style={{ borderTop: "1px dashed var(--line)" }}>
                  {canAssign && (
                    <select className="select !w-auto !py-1 text-[11.5px]" value={c.ownerId}
                      onChange={(e) => updateCase(c.id, { ownerId: Number(e.target.value) })}>
                      <option value={1}>— assign owner —</option>
                      {users.filter((u) => u.active && u.role !== "Head of Company").map((u) => (
                        <option key={u.id} value={u.id}>{u.name} · {u.role}</option>
                      ))}
                    </select>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => setQualifyingCase(c)}>
                    Qualify profile
                  </button>
                  {/* Shop to another bank — the decision is made while qualifying,
                      so it lives here and not behind Case 360. */}
                  <button className="btn btn-ghost btn-sm" title="Open this deal with another bank — each bank gets its own case number, documents and stage"
                    onClick={() => setAddingBankTo(c)}>
                    <IBank size={13} /> Add bank
                  </button>
                  {canEditDetails && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditingCase(c)} title="Edit case details (banks, advisor, backups, submission type, etc.)">
                      <IPencil size={13} /> Details
                    </button>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => nav({ name: "case", id: c.id })}>
                    Open <IArrowR size={12} />
                  </button>
                  <button className="btn btn-ghost btn-sm" title="Mark lost — kept on record with a reason"
                    onClick={() => { setLosingCase({ id: c.id, caseNumber: c.caseNumber, customer: c.customer }); setLoseReason(""); }}>
                    Lost
                  </button>
                  {canDelete && (
                    <button className="btn btn-ghost btn-sm !px-2" title="Delete permanently (admin) — for accidental creations"
                      onClick={() => setDelCase({ id: c.id, caseNumber: c.caseNumber, customer: c.customer })}>
                      <ITrash size={13} />
                    </button>
                  )}
                  <button className="btn btn-mint btn-sm ml-auto" onClick={() => setConvertingCase(c)} title="Run the pre-flight checklist, then move this lead into the live pipeline">
                    Convert to case
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pager + the "showing X–Y of Z" line. Only rendered when there is more
          than one page, so a small funnel stays uncluttered. */}
      {leads.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-[var(--ink-faint)]">
          <span className="mono">
            Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, leads.length)} of {leads.length}
            {filter !== "all" && ` (${filter === "ready" ? "ready" : filter})`}
          </span>
          {pageCount > 1 && (
            <div className="flex items-center gap-1">
              <button className="btn btn-ghost btn-sm" disabled={safePage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                ← Newer
              </button>
              <span className="mono px-1.5" style={{ color: "var(--ink-dim)" }}>{safePage} / {pageCount}</span>
              <button className="btn btn-ghost btn-sm" disabled={safePage === pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
                Older →
              </button>
            </div>
          )}
        </div>
      )}

      {qualifyingCase && (
        <Modal title={`Qualify Lead Profile � ${qualifyingCase.caseNumber}`} sub={qualifyingCase.customer} onClose={() => setQualifyingCase(null)} width={680}>
          <CaseProfileEditor c={qualifyingCase} onSaved={() => setQualifyingCase(null)} />
        </Modal>
      )}

      {convertingCase && <ConvertLeadModal c={convertingCase} onClose={() => setConvertingCase(null)} />}

      {addingBankTo && <AddBankModal c={addingBankTo} cases={cases} onClose={() => setAddingBankTo(null)} />}

      {/* Edit Case Details Modal — for portal/agent leads that need full field completion */}
      {editingCase && <EditCaseDetailsModal c={editingCase} onClose={() => setEditingCase(null)} onSaved={() => { setEditingCase(null); toast("success", "Case details updated."); }} />}
    </div>
  );
}

const fmtMoneyShort = (n: number) => (n > 0 ? "AED " + (n / 1_000_000).toFixed(2).replace(/\.?0+$/, "") + "M" : "—");

/* EditCaseDetailsModal — mirrors the New Case modal fields so portal/agent leads
   can be fully fleshed out without opening Case 360. */
function EditCaseDetailsModal({
  c, onClose, onSaved,
}: {
  c: {
    id: number; caseNumber: string; customer: string; loanAmount: number; banks: string; stage: string; ownerId: number;
    advisorId?: number | null; backup1Id?: number | null; backup2Id?: number | null;
    source: string; partnerName?: string | null; partnerSharePct?: number | null;
    whatsapp?: string | null; waGroup?: string | null; transactionType?: string | null;
    propertyLocation?: string | null; coApplicantName?: string | null;
    bankRm?: string | null; partnerRm?: string | null; bankRms?: Record<string, string>;
    employmentProfile?: string; propertyType?: string; residency?: string;
    submissionType?: string; channelId?: number | null; channelName?: string | null;
    channelRatePct?: number;
  };
  onClose: () => void;
  onSaved: () => void;
}) {
  // `cases` is needed by AddBankModal to render the other legs of this deal.
  const { users, updateCase, toast, banks: allBanks, channels: allChannels, flags, me, stages, cases } = useHfmcStore();
  const activeStages = useMemo(() => stages?.filter((s: any) => s.active).sort((a: any, b: any) => a.sortOrder - b.sortOrder) ?? [], [stages]);
  const [bankList, setBankList] = useState<string[]>(() => {
    try { return JSON.parse(c.banks); } catch { return []; }
  });
  const [submissionType, setSubmissionType] = useState<"direct" | "channel">(c.submissionType === "channel" ? "channel" : "direct");
  const [channelId, setChannelId] = useState<number | null>(c.channelId ?? null);
  const [amount, setAmount] = useState(c.loanAmount);
  const [stage, setStage] = useState(c.stage);
  const [ownerId, setOwnerId] = useState(c.ownerId);
  const [advisorId, setAdvisorId] = useState<string>(c.advisorId ? String(c.advisorId) : "");
  const [backup1Id, setBackup1Id] = useState<string>(c.backup1Id ? String(c.backup1Id) : "");
  const [backup2Id, setBackup2Id] = useState<string>(c.backup2Id ? String(c.backup2Id) : "");
  const [source, setSource] = useState(c.source);
  const [partnerName, setPartnerName] = useState(c.partnerName ?? "");
  const [share, setShare] = useState(c.partnerSharePct ?? 20);
  const [customShare, setCustomShare] = useState("");
  const [transactionType, setTransactionType] = useState(c.transactionType ?? "");
  const [propertyLocation, setPropertyLocation] = useState(c.propertyLocation ?? "");
  const [coApplicantName, setCoApplicantName] = useState(c.coApplicantName ?? "");
  const [bankRm, setBankRm] = useState(c.bankRm ?? "");
  const [partnerRm, setPartnerRm] = useState(c.partnerRm ?? "");
  const [bankRms, setBankRms] = useState<Record<string, string>>(c.bankRms ?? {});
  const [employmentProfile, setEmploymentProfile] = useState(c.employmentProfile ?? "Salaried");
  const [propertyType, setPropertyType] = useState(c.propertyType ?? "Ready");
  const [residency, setResidency] = useState(c.residency ?? "Resident Expatriate");
  const [whatsapp, setWhatsapp] = useState(c.whatsapp ?? "");
  const [waGroup, setWaGroup] = useState(c.waGroup ?? "");
  const [addingBankTo, setAddingBankTo] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // The bank this case sits with, resolved to a master row so its logo and
  // contacts can be rendered. `banks` holds exactly one name per case.
  const currentBank = useMemo(
    () => allBanks.find((b: any) => b.name === bankList[0]) ?? null,
    [allBanks, bankList],
  );

  const submit = async () => {
    if (busy) return;
    if (!c.customer.trim()) return setErr("Customer name is required.");
    const amt = Number(amount);
    if (!amt || amt <= 0) return setErr("Enter a valid loan amount in AED.");
    setBusy(true);
    try {
      const partner = ["Agent", "Broker", "Referral"].includes(source)
        ? { kind: source as "Agent" | "Broker" | "Referral", name: partnerName, sharePct: share === 0 ? Number(customShare) : share }
        : null;
      const selectedChannel = channelId ? allChannels.find((ch: any) => ch.id === channelId) : null;
      await updateCase(c.id, {
        customer: c.customer,
        banks: bankList,
        loanAmount: amt,
        stage,
        ownerId,
        advisorId: advisorId ? Number(advisorId) : null,
        backup1Id: backup1Id ? Number(backup1Id) : null,
        backup2Id: backup2Id ? Number(backup2Id) : null,
        source: source as any,
        partner,
        whatsapp,
        waGroup: waGroup.trim() || null,
        submissionType,
        channelId: selectedChannel?.id ?? null,
        channelName: selectedChannel?.name ?? null,
        channelRatePct: selectedChannel?.commissionPct ?? 0,
        transactionType: transactionType || undefined,
        propertyLocation: propertyLocation || null,
        coApplicantName: coApplicantName.trim() || null,
        employmentProfile: employmentProfile as any,
        propertyType: propertyType as any,
        residency: residency as any,
        bankRm: (bankRms[bankList[0]] ?? bankRm).trim() || null,
        bankRms: bankRms,
        partnerRm: partnerRm.trim() || null,
      });
      toast("success", `${c.caseNumber} details updated.`);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update case.");
    }
    setBusy(false);
  };

  const needsPartner = source === "Agent" || source === "Broker" || source === "Referral";
  const partnerOptions = allChannels?.filter((p: any) => p.active && p.kind === source) ?? []; // agents are in partners, not channels

  return (
    <>
    <Modal onClose={onClose} title={`Edit Case Details — ${c.caseNumber}`} sub={c.customer} width={580}>
      <div className="space-y-3.5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Customer name</label>
            <input className="input" readOnly value={c.customer} />
          </div>
          <div>
            <label className="label">Loan amount (AED)</label>
            <input className="input mono" type="number" min={0} step={10000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Client WhatsApp</label>
            <input className="input mono" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+971 50 123 4567" />
          </div>
          <div>
            <label className="label">WhatsApp group link <span className="normal-case tracking-normal" style={{ color: "var(--ink-faint)" }}>— optional</span></label>
            <input className="input mono" value={waGroup} onChange={(e) => setWaGroup(e.target.value)} placeholder="https://chat.whatsapp.com/…" />
          </div>
        </div>

        {/* ONE bank per case. The per-bank model splits a multi-bank deal into
            sibling cases (see the per-bank section in CODEBASE.md), so a second
            bank here must create a sibling via the add-bank endpoint — ticking a
            second chip would produce the invalid single-row/multi-bank shape and
            leave that bank with no reference number and no checklist of its own. */}
        <div>
          <label className="label">Bank</label>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 flex-1 min-w-0"
              style={{ background: "var(--bg2)", border: "1px solid var(--line)" }}>
              {currentBank ? (
                <>
                  <BankLogo bank={currentBank} size={26} />
                  <span className="text-[12.5px] font-semibold truncate">{currentBank.name}</span>
                  {flags?.viewRevenue && <span className="mono text-[11px] text-[var(--ink-faint)]">{currentBank.ratePct}%</span>}
                </>
              ) : (
                <span className="text-[12px] text-[var(--ink-faint)]">No bank yet</span>
              )}
              <select
                className="select !w-auto !py-1 text-[11.5px] ml-auto"
                value={bankList[0] ?? ""}
                onChange={(e) => setBankList(e.target.value ? [e.target.value] : [])}
                title="Which bank this case sits with"
              >
                <option value="">— none —</option>
                {allBanks.filter((b: any) => b.active).map((b: any) => (
                  <option key={b.id} value={b.name}>{b.name}{flags?.viewRevenue ? ` · ${b.ratePct}%` : ""}</option>
                ))}
              </select>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" title="Open this deal with another bank — each bank gets its own case number, documents and stage"
              onClick={() => setAddingBankTo(c)}>
              <IBank size={13} /> Add bank
            </button>
          </div>
          <p className="text-[10.5px] text-[var(--ink-faint)] m-0 mt-1.5">
            A deal can sit with several banks, but each is its own case with its own reference number and documents — use
            <strong> Add bank</strong> rather than listing a second bank here.
          </p>
          {bankList.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {bankList.map((bn) => {
                const bank = allBanks.find((b: any) => b.name === bn);
                const rm = bankRms[bn] ?? bank?.contacts?.[0]?.name ?? "";
                return (
                  <div key={bn} className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11.5px] font-disp font-semibold" style={{ minWidth: 90 }}>{bn} RM</span>
                    <select className="select !w-auto !py-1 text-[11.5px]" value={rm}
                      onChange={(e) => setBankRms((prev) => ({ ...prev, [bn]: e.target.value }))}>
                      {(bank?.contacts ?? []).map((cont: any, i: number) => (
                        <option key={i} value={cont.name}>{cont.name}{cont.phone ? " · " + cont.phone : ""}{cont.email ? " · " + cont.email : ""}</option>
                      ))}
                      <option value="">— type below —</option>
                    </select>
                    {!bank?.contacts?.length && (
                      <input className="input !py-1 text-[11.5px]" style={{ width: 200 }} placeholder="RM name · phone"
                        value={rm} onChange={(e) => setBankRms((prev) => ({ ...prev, [bn]: e.target.value }))} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <label className="label">Submission type</label>
          <div className="flex gap-1.5">
            <button type="button" className="chip transition-all flex-1 justify-center"
              style={submissionType === "direct" ? { background: "rgba(67,214,155,0.12)", borderColor: "var(--mint)", color: "var(--mint)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}
              onClick={() => { setSubmissionType("direct"); setChannelId(null); }}>
              Direct to bank
            </button>
            <button type="button" className="chip transition-all flex-1 justify-center"
              style={submissionType === "channel" ? { background: "rgba(242,176,76,0.14)", borderColor: "var(--amber)", color: "var(--amber)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}
              onClick={() => setSubmissionType("channel")}>
              Through channel
            </button>
          </div>
          {submissionType === "channel" && (
            <select className="select mt-2" value={channelId ?? ""} onChange={(e) => setChannelId(e.target.value ? parseInt(e.target.value, 10) : null)}>
              <option value="">Select channel…</option>
              {allChannels?.filter((ch: any) => ch.active).map((ch: any) => (
                <option key={ch.id} value={ch.id}>{ch.name}{flags?.viewRevenue ? ` — ${ch.commissionPct}% of loan` : ""}</option>
              ))}
            </select>
          )}
          {submissionType === "channel" && channelId && (
            <div className="mt-2">
              <label className="label">Partner RM / coordinator <span className="normal-case tracking-normal" style={{ color: "var(--ink-faint)" }}>— pick from their saved contacts or type</span></label>
              <div className="flex gap-1.5 flex-wrap">
                <select className="select !w-auto !py-1 text-[11.5px]" value={partnerRm}
                  onChange={(e) => setPartnerRm(e.target.value)}>
                  <option value="">— none / type below —</option>
                  {(allChannels.find((ch: any) => ch.id === channelId)?.contacts ?? []).map((cont: any, i: number) => (
                    <option key={i} value={cont.name + (cont.phone ? " · " + cont.phone : "")}>{cont.name}{cont.phone ? " · " + cont.phone : ""}{cont.email ? " · " + cont.email : ""}</option>
                  ))}
                </select>
                {partnerRm === "" && (
                  <input className="input !py-1 text-[11.5px] mono" style={{ width: 220 }} placeholder="RM name · phone · email"
                    value={partnerRm} onChange={(e) => setPartnerRm(e.target.value)} />
                )}
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="label">Stage</label>
            <select className="select" value={stage} onChange={(e) => setStage(e.target.value)}>
              {activeStages.map((s: any) => <option key={s.id} value={s.label}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Case owner</label>
            <select className="select" value={ownerId} onChange={(e) => setOwnerId(parseInt(e.target.value, 10))}>
              {users.filter((u: any) => u.active && u.role !== "Head of Company" && u.role !== "PA to HoC").map((u: any) => (
                <option key={u.id} value={u.id}>{u.name} · {u.role}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Client-facing advisor <span className="normal-case tracking-normal" style={{ color: "var(--ink-faint)" }}>· on the client&apos;s Ask card</span></label>
            <select className="select" value={advisorId} onChange={(e) => setAdvisorId(e.target.value)}>
              <option value="">— none (portal default) —</option>
              {users.filter((u: any) => u.active && u.role !== "Head of Company" && u.role !== "PA to HoC").map((u: any) => (
                <option key={u.id} value={u.id}>{u.name} · {u.role}{u.phone ? " · " + u.phone : ""}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Backup 1 <span className="normal-case tracking-normal" style={{ color: "var(--ink-faint)" }}>· covers leave, sees & works the file</span></label>
            <select className="select" value={backup1Id} onChange={(e) => setBackup1Id(e.target.value)}>
              <option value="">— none —</option>
              {users.filter((u: any) => u.active && u.id !== ownerId).map((u: any) => (
                <option key={u.id} value={u.id}>{u.name} · {u.role}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Backup 2 <span className="normal-case tracking-normal" style={{ color: "var(--ink-faint)" }}>· covers leave, sees & works the file</span></label>
            <select className="select" value={backup2Id} onChange={(e) => setBackup2Id(e.target.value)}>
              <option value="">— none —</option>
              {users.filter((u: any) => u.active && u.id !== ownerId && String(u.id) !== backup1Id).map((u: any) => (
                <option key={u.id} value={u.id}>{u.name} · {u.role}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Where did it come from?</label>
            <select className="select" value={source} onChange={(e) => { setSource(e.target.value); setPartnerName(""); }}>
              <option value="Direct">Direct</option>
              <option value="Agent">Agent</option>
              <option value="Broker">Broker</option>
              <option value="Referral">Referral</option>
              <option value="Website">Website</option>
              <option value="Walk-in">Walk-in</option>
              <option value="Other">Other</option>
            </select>
          </div>
        </div>

        {/* --- MIS operational (collapsible) --- */}
        <details className="rounded-lg" style={{ background: "var(--tint)", border: "1px solid var(--line-soft)" }}>
          <summary className="px-3 py-2 cursor-pointer font-disp text-[12px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.08em]">
            More details (optional) — profile, transaction, location, co-applicant, bank RM
          </summary>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 pt-0">
            <div>
              <label className="label">Employment profile · <span style={{ color: "var(--amber)" }}>drives document checklist</span></label>
              <select className="select" value={employmentProfile} onChange={(e) => setEmploymentProfile(e.target.value)}>
                <option value="Salaried">Salaried</option>
                <option value="Self-Employed">Self-Employed</option>
                <option value="Business Owner">Business Owner</option>
                <option value="High Net Worth">High Net Worth</option>
              </select>
            </div>
            <div>
              <label className="label">Residency</label>
              <select className="select" value={residency} onChange={(e) => setResidency(e.target.value)}>
                <option value="Resident Expatriate">Resident Expatriate</option>
                <option value="UAE National">UAE National</option>
                <option value="Non-Resident">Non-Resident</option>
              </select>
            </div>
            <div>
              <label className="label">Property type · <span style={{ color: "var(--amber)" }}>drives document checklist</span></label>
              <select className="select" value={propertyType} onChange={(e) => setPropertyType(e.target.value)}>
                <option value="Ready">Ready</option>
                <option value="Off-Plan">Off-Plan</option>
                <option value="Land">Land</option>
              </select>
            </div>
            <div>
              <label className="label">Transaction type</label>
              <select className="select" value={transactionType} onChange={(e) => setTransactionType(e.target.value)}>
                <option value="">— select —</option>
                <option value="Purchase">Purchase</option>
                <option value="Buyout">Buyout / Refinance</option>
                <option value="Top-up">Top-up</option>
                <option value="Equity Release">Equity Release</option>
              </select>
            </div>
            <div>
              <label className="label">Property location</label>
              <select className="select" value={propertyLocation} onChange={(e) => setPropertyLocation(e.target.value)}>
                <option value="">— select —</option>
                <option value="Dubai">Dubai</option>
                <option value="Abu Dhabi">Abu Dhabi</option>
                <option value="Sharjah">Sharjah</option>
                <option value="Ajman">Ajman</option>
                <option value="Ras Al Khaimah">Ras Al Khaimah</option>
                <option value="Fujairah">Fujairah</option>
                <option value="Umm Al Quwain">Umm Al Quwain</option>
              </select>
            </div>
            <div>
              <label className="label">Co-applicant</label>
              <input className="input" value={coApplicantName} onChange={(e) => setCoApplicantName(e.target.value)} placeholder="e.g. Fatima Al Mansoori" />
            </div>
            <div>
              <label className="label">Bank RM</label>
              <input className="input" value={bankRm} onChange={(e) => setBankRm(e.target.value)} placeholder="e.g. Ahmed (ENBD)" />
            </div>
          </div>
        </details>

        {needsPartner && (
          <div className="rounded-lg p-3 anim-fade-up" style={{ background: "rgba(242,176,76,0.05)", border: "1px solid rgba(242,176,76,0.2)" }}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">{source} name</label>
                <select className="select" value={partnerName} onChange={(e) => setPartnerName(e.target.value)}>
                  <option value="">Select…</option>
                  {/* Partners would be fetched from a partners list; simplified for now */}
                  <option value={partnerName}>{partnerName || "—"}</option>
                </select>
              </div>
              <div>
                <label className="label">Their share of our commission</label>
                <div className="flex flex-wrap gap-1.5">
                  {[10, 15, 20, 25, 30, 40, 50].map((s) => (
                    <button key={s} type="button" className="chip transition-all" onClick={() => setShare(s)}
                      style={share === s ? { background: "rgba(242,176,76,0.14)", borderColor: "var(--amber)", color: "var(--amber)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}>
                      {s}%
                    </button>
                  ))}
                  <button type="button" className="chip transition-all" onClick={() => setShare(0)}
                    style={share === 0 ? { background: "rgba(242,176,76,0.14)", borderColor: "var(--amber)", color: "var(--amber)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}>
                    Custom
                  </button>
                  {share === 0 && <input className="input mono" style={{ width: 84 }} type="number" min={1} max={100} placeholder="%" value={customShare} onChange={(e) => setCustomShare(e.target.value)} />}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {err && <p className="text-[12.5px] mt-2.5 mb-0" style={{ color: "var(--coral)" }}>{err}</p>}

      <div className="flex items-center justify-between gap-2 mt-5 pt-4" style={{ borderTop: "1px solid var(--line-soft)" }}>
        <span className="text-[11.5px] text-[var(--ink-faint)]">
          {currentBank
            ? `With ${currentBank.name}${c.caseNumber ? ` · ${c.caseNumber}` : ""}`
            : "Bank TBC — pick one, or Add bank to open a separate file for another bank"}
        </span>
        <div className="flex gap-2">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Save details"}
          </button>
        </div>
      </div>
    </Modal>

      {/* Shopping to another bank opens a SIBLING case, so it is a separate
          record. It renders as a sibling of this dialog (not nested inside it)
          so the two overlays do not stack on top of each other. */}
      {addingBankTo && <AddBankModal c={addingBankTo} cases={cases} onClose={() => setAddingBankTo(null)} />}
    </>
  );
}
