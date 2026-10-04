"use client";
import { useMemo, useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import { fmtDate } from "@/lib/format";
import { Avatar, Chip, EmptyState, Modal } from "@/components/hfmc/ui";
import { ConfirmModal } from "@/components/hfmc/bits";
import { IArrowR, ITrash, IPlus, IUsers } from "@/components/icons";
import { computeReadiness } from "@/lib/lead-readiness";
import { OPEN_LEAD_STATUSES } from "@/lib/types";
import type { Lead, LeadStatus } from "@/lib/types";

/* Leads view — the top of the funnel (Phase 4).
 *
   A "Lead" is its own entity, NOT a LoanCase while stage === "Lead". That
   distinction is the whole point of Phase 4: a lead is CHEAP (name, phone,
   what they are asking about, roughly how much, who referred them) and a case is
   EXPENSIVE (a stage, a document vault, an SLA clock, commission). Modelling a
   lead as a half-built case meant a website registrant who typed a name and a
   number got 40 mortgage date columns and a case number — and "how many leads
   do we have?" was unanswerable, because the row never said which line of
   business they were asking about.

   The cards print CONTACT details up front, because a lead you cannot call is
   not a lead. Everything service-specific is deliberately absent — see the
   Placement Rule in MIGRATION-NOTES.md. */

/** Lead age -> SLA tone, measured from FIRST HUMAN CONTACT, not arrival.
 *  A lead someone called on day 1 and chased on day 5 is not "5 days old" — it
 *  is 2 days since anyone touched it, which is the number that predicts death.
 *  An untouched lead is coral regardless of age, because nobody has picked up. */
function leadAge(l: Lead): { label: string; tone: "mint" | "amber" | "coral" } {
  const since = l.firstContactedAt ?? l.createdAt;
  const h = Math.max(0, (Date.now() - new Date(since).getTime()) / 3_600_000);
  if (!l.firstContactedAt) {
    return { label: h < 24 ? "not contacted" : `${Math.floor(h / 24)}d untouched`, tone: "coral" };
  }
  if (h < 24) return { label: h < 1 ? "contacted just now" : `touched ${Math.floor(h)}h ago`, tone: "mint" };
  if (h < 72) return { label: `touched ${Math.floor(h / 24)}d ago`, tone: "amber" };
  return { label: `quiet ${Math.floor(h / 24)}d`, tone: "coral" };
}

// "violet" is not one of the app's five tones (mint | amber | coral | sky |
// slate), so Qualified shares sky with New. Distinguishing New from Qualified
// visually is not worth inventing a sixth colour for — the chip text carries it.
const STATUS_TONE: Record<LeadStatus, "mint" | "amber" | "coral" | "sky" | "slate"> = {
  New: "sky", Contacted: "mint", Qualified: "sky", Nurture: "amber",
  Converted: "mint", Lost: "coral", Invalid: "slate",
};

/** Leads per page — the triage sweet spot: a morning's intake on one screen. */
const PAGE_SIZE = 10;

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

export default function Leads() {
  const { leads, serviceLines, users, me, toast, nav, createLead, updateLead, deleteLead, convertLead } = useHfmcStore();
  const [filter, setFilter] = useState<"all" | "mine" | "unassigned" | "ready">("all");
  // Default is NEWEST first: a broker opening the Leads tab is asking "what just
  // came in?". "Oldest first" (stale needs a nudge) stays one click away.
  const [sort, setSort] = useState<"newest" | "oldest" | "ready">("newest");
  const [page, setPage] = useState(1);
  const [lineFilter, setLineFilter] = useState<string>("all");
  const [showClosed, setShowClosed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [converting, setConverting] = useState<Lead | null>(null);
  const [delLead, setDelLead] = useState<Lead | null>(null);
  const [busy, setBusy] = useState(false);
  const [loseTarget, setLoseTarget] = useState<Lead | null>(null);
  const [loseReason, setLoseReason] = useState("");

  const activeLines = serviceLines.filter((s) => s.active);
  // Before the firm genuinely sells more than one thing, a service filter is a
  // control with a single option — which teaches people to ignore filters.
  const multiLine = activeLines.length > 1;

  // Only MORTGAGE is bankRaced today, so only mortgage leads need a loan figure
  // before they can be converted. Requiring it of a golden-visa lead would leave
  // it permanently "not ready" for a number that does not apply to it.
  const amountMatters = useMemo(() => {
    const map = new Map<number, boolean>();
    for (const s of activeLines) map.set(s.id, s.bankRaced);
    return map;
  }, [activeLines]);

  const readinessFor = useMemo(() => {
    const m = new Map<number, ReturnType<typeof computeReadiness>>();
    for (const l of leads) {
      m.set(l.id, computeReadiness({
        phone: l.phone, email: l.email ?? "",
        ownerName: l.ownerName ?? null,
        loanAmount: l.intendedAmount ?? 0,
        amountMatters: amountMatters.get(l.serviceLineId) ?? false,
      }));
    }
    return m;
  }, [leads, amountMatters]);

  const open = useMemo(() => leads.filter((l) => OPEN_LEAD_STATUSES.includes(l.status)), [leads]);
  const shown = useMemo(() => (showClosed ? leads : open), [leads, open, showClosed]);

  const filtered = useMemo(
    () =>
      shown
        .filter((l) => {
          if (lineFilter !== "all" && String(l.serviceLineId) !== lineFilter) return false;
          if (filter === "mine") return !!me && l.ownerId === me.id;
          if (filter === "unassigned") return !l.ownerId;
          if (filter === "ready") return readinessFor.get(l.id)?.ready;
          return true;
        })
        .sort((a, b) => {
          if (sort === "newest") return b.createdAt.localeCompare(a.createdAt);
          if (sort === "oldest") return a.createdAt.localeCompare(b.createdAt);
          return (readinessFor.get(b.id)?.score ?? 0) - (readinessFor.get(a.id)?.score ?? 0);
        }),
    [shown, filter, sort, lineFilter, readinessFor, me],
  );

  const readyCount = useMemo(() => open.filter((l) => readinessFor.get(l.id)?.ready).length, [open, readinessFor]);
  const unassignedCount = useMemo(() => open.filter((l) => !l.ownerId).length, [open]);
  // Closed leads stay reachable: converted ones are the archive (re-own, re-shop);
  // Lost and Invalid are kept apart because conflating them understates the
  // conversion rate.
  const archiveCount = useMemo(() => leads.filter((l) => !OPEN_LEAD_STATUSES.includes(l.status)).length, [leads]);

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const setStatus = async (l: Lead, status: LeadStatus) => {
    try {
      await updateLead(l.id, { status });
      toast("success", `${l.fullName} → ${status}`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not update the lead.");
    }
  };

  const assignToMe = async (l: Lead) => {
    if (!me) return;
    try {
      await updateLead(l.id, { ownerId: me.id });
      toast("success", `${l.fullName} assigned to you.`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not assign.");
    }
  };

  const doConvert = async (l: Lead) => {
    setBusy(true);
    try {
      const made = await convertLead(l.id, { loanAmount: l.intendedAmount ?? undefined });
      setConverting(null);
      toast("success", `${l.fullName} is now ${made.caseNumber} — the lead stays on file as its origin.`);
      nav({ name: "case", id: made.id });
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not convert the lead.");
    } finally {
      setBusy(false);
    }
  };

return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h2 className="font-disp text-[19px] font-semibold m-0">Leads</h2>
          <p className="text-[12px] text-[var(--ink-faint)] m-0 mt-0.5">
            {open.length} in the funnel · {readyCount} ready to convert · {unassignedCount} unassigned
          </p>
        </div>
        <div className="flex gap-2">
          <select className="select !w-auto !py-1 text-[12px]" value={sort} onChange={(e) => { setSort(e.target.value as never); setPage(1); }}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="ready">Readiness</option>
          </select>
          <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
            <IPlus size={14} /> New lead
          </button>
        </div>
      </div>

      <div className="flex gap-1.5 mb-3 flex-wrap items-center">
        {([["all", `All (${open.length})`], ["mine", "Mine"], ["unassigned", `Unassigned (${unassignedCount})`], ["ready", `Ready (${readyCount})`]] as const).map(([k, label]) => (
          <button key={k} className="chip transition-all"
            style={filter === k ? { background: "rgba(67,214,155,0.12)", borderColor: "var(--mint)", color: "var(--mint)" } : undefined}
            onClick={() => { setFilter(k); setPage(1); }}>
            {label}
          </button>
        ))}
        {multiLine && (
          <select className="select !w-auto !py-1 text-[12px] ml-1" value={lineFilter} onChange={(e) => { setLineFilter(e.target.value); setPage(1); }}>
            <option value="all">All services</option>
            {activeLines.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
          </select>
        )}
        <button className="chip ml-auto" onClick={() => setShowClosed((v) => !v)}
          style={showClosed ? { background: "rgba(87,194,234,0.12)", borderColor: "var(--sky)", color: "var(--sky)" } : undefined}>
          {showClosed ? "Showing all" : `Show closed (${archiveCount})`}
        </button>
      </div>

      {paged.length === 0 ? (
        <div className="card">
          <EmptyState icon={<IUsers size={20} />} title="No leads here"
            body={showClosed ? "Nothing matches this filter." : "New enquiries land here the moment someone asks about one of your services."} />
        </div>
      ) : (
        <div className="grid gap-2.5">
          {paged.map((l) => {
            const r = readinessFor.get(l.id);
            const age = leadAge(l);
            const line = serviceLines.find((s) => s.id === l.serviceLineId);
            const closed = !OPEN_LEAD_STATUSES.includes(l.status);
            return (
              <div key={l.id} className="card p-3.5 anim-fade-up" style={closed ? { opacity: 0.6 } : undefined}>
                <div className="flex gap-3">
                  <Avatar name={l.fullName} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-disp font-semibold text-[14px]">{l.fullName}</span>
                      <Chip tone={STATUS_TONE[l.status]}>{l.status}</Chip>
                      {multiLine && line && <Chip tone="sky">{line.shortName || line.name}</Chip>}
                      {l.productName && <span className="text-[11px] text-[var(--ink-faint)]">{l.productName}</span>}
                    </div>
                    <div className="mono text-[11px] text-[var(--ink-faint)] mt-1 truncate">
                      {[l.phone, l.email, l.source + (l.sourceDetail ? ` (${l.sourceDetail})` : "")].filter(Boolean).join(" · ") || "no contact details"}
                    </div>
                    {l.intendedAmount != null && (
                      <div className="mono text-[12px] mt-1">
                        AED {l.intendedAmount.toLocaleString()}{" "}
                        <span className="text-[var(--ink-faint)]">intended</span>
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10.5px]"
                      style={{ color: age.tone === "mint" ? "var(--mint)" : age.tone === "amber" ? "var(--amber)" : "var(--coral)" }}>
                      {age.label}
                    </div>
                    {l.ownerName
                      ? <div className="text-[11px] text-[var(--ink-faint)] mt-1">{l.ownerName}</div>
                      : <div className="text-[11px] mt-1" style={{ color: "var(--amber)" }}>unassigned</div>}
                  </div>
                </div>

{/* Duplicate warning. Ahmed can register on the website, walk into the Dubai
                    office and be typed in by an agent — three leads, one person.
                    Merging on phone alone would fuse two family members who share
                    a number, so this stays a HINT a human acts on. */}
                {l.possibleDuplicateOf && (
                  <div className="mt-2.5 text-[11.5px] px-2.5 py-1.5 rounded-md"
                    style={{ background: "rgba(242,176,76,0.1)", border: "1px solid rgba(242,176,76,0.3)", color: "var(--amber)" }}>
                    Possible duplicate — this number already belongs to {l.possibleDuplicateOf.name}. Check before qualifying.
                  </div>
                )}

                {r && !r.ready && !closed && (
                  <div className="mt-2 text-[11px] text-[var(--ink-faint)]">
                    Needs: {r.items.filter((i) => !i.ok && !i.soft).map((i) => i.label.toLowerCase()).join(", ")}
                  </div>
                )}

                {!closed && (
                  <div className="flex gap-1.5 mt-3 flex-wrap">
                    {!l.ownerId && me && (
                      <button className="btn btn-ghost btn-sm" onClick={() => assignToMe(l)}>Assign to me</button>
                    )}
                    {l.status === "New" && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setStatus(l, "Contacted")}>Mark contacted</button>
                    )}
                    {l.status !== "Qualified" && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setStatus(l, "Qualified")}>Qualify</button>
                    )}
                    <button className="btn btn-primary btn-sm" onClick={() => setConverting(l)}>
                      Convert to case <IArrowR size={13} />
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setLoseTarget(l); setLoseReason(""); }}>Mark lost</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setStatus(l, "Invalid")}
                      title="Spam, wrong number or a duplicate — not lost business">Invalid</button>
                    <button className="btn btn-ghost btn-sm !ml-auto" onClick={() => setDelLead(l)} aria-label="Delete lead">
                      <ITrash size={13} />
                    </button>
                  </div>
                )}

                {closed && (
                  <div className="mt-2.5 text-[11px] text-[var(--ink-faint)] flex gap-3 flex-wrap items-center">
                    {l.convertedAt && (
                      <span>Converted {fmtDate(l.convertedAt.slice(0, 10))} · {daysSince(l.convertedAt)}d ago</span>
                    )}
                    {l.caseId != null && (
                      <button className="btn btn-ghost btn-sm" onClick={() => nav({ name: "case", id: l.caseId! })}>
                        Open case <IArrowR size={12} />
                      </button>
                    )}
                    {l.lostReason && <span>{l.lostReason}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span className="text-[12px] text-[var(--ink-faint)] mono">Page {page} of {pages}</span>
          <button className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}

      {adding && <NewLeadModal onClose={() => setAdding(false)} />}
      {converting && (
        <ConvertLeadModal lead={converting} busy={busy} onClose={() => setConverting(null)} onConfirm={() => doConvert(converting)} />
      )}

      {loseTarget && (
        <Modal title={`Mark ${loseTarget.fullName} as lost`}
          sub="A lost lead is real interest that didn't convert. Recording the reason is what makes the funnel report honest."
          onClose={() => setLoseTarget(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setLoseTarget(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={async () => {
              try {
                await updateLead(loseTarget.id, { status: "Lost", lostReason: loseReason.trim() || "No reason given" });
                setLoseTarget(null);
                toast("success", `${loseTarget.fullName} marked lost.`);
              } catch (e) { toast("error", e instanceof Error ? e.message : "Could not save."); }
            }}>Mark lost</button>
          </>}>
          <label className="label">Reason</label>
          <input className="input" value={loseReason} onChange={(e) => setLoseReason(e.target.value)}
            placeholder="Went with a competitor, timing, price…" autoFocus />
        </Modal>
      )}

      {delLead && (
        <ConfirmModal open={!!delLead} confirmLabel="Delete lead" title={`Delete ${delLead?.fullName}?`}
          body="This lead never became a case, so nothing live is lost. This cannot be undone."
          onClose={() => setDelLead(null)}
          onConfirm={async () => {
            try {
              await deleteLead(delLead.id);
              setDelLead(null);
              toast("success", "Lead deleted.");
            } catch (e) { toast("error", e instanceof Error ? e.message : "Could not delete."); }
          }} />
      )}
    </div>
  );
}

/** New-lead form. Deliberately SHORT — a lead must cost no more than the 20
 *  seconds it takes to type a name and a number, or people stop entering them
 *  and the funnel quietly becomes incomplete. */
function NewLeadModal({ onClose }: { onClose: () => void }) {
  const { serviceLines, users, me, createLead, toast } = useHfmcStore();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [serviceLineId, setServiceLineId] = useState<string>("");
  const [productId, setProductId] = useState<string>("");
  const [intendedAmount, setIntendedAmount] = useState("");
  const [source, setSource] = useState("Direct");
  const [sourceDetail, setSourceDetail] = useState("");
  const [ownerId, setOwnerId] = useState<string>(me ? String(me.id) : "");
  const [busy, setBusy] = useState(false);

  const activeLines = serviceLines.filter((s) => s.active);
  const line = activeLines.find((s) => String(s.id) === serviceLineId);
  // A golden-visa or wills enquiry has no loan figure, so the amount box is
  // hidden rather than shown-and-discouraging. Mortgage needs it, so it shows.
  const showAmount = line?.bankRaced ?? false;

  const submit = async () => {
    if (!fullName.trim()) { toast("error", "Name is required."); return; }
    if (!serviceLineId) { toast("error", "Pick which service they're asking about."); return; }
    setBusy(true);
    try {
      await createLead({
        fullName: fullName.trim(), phone, email,
        serviceLineId: Number(serviceLineId),
        productId: productId ? Number(productId) : null,
        intendedAmount: showAmount && intendedAmount ? Number(intendedAmount) : null,
        source, sourceDetail: sourceDetail.trim(),
        ownerId: ownerId ? Number(ownerId) : null,
      });
      toast("success", `${fullName.trim()} added to the funnel.`);
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not save the lead.");
    } finally { setBusy(false); }
  };

  return (
    <Modal title="New lead" sub="Just the basics — everything else is discovered later."
      onClose={onClose} width={520}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Add lead"}</button>
      </>}>
      <div className="grid gap-3">
        <div>
          <label className="label">Name <span style={{ color: "var(--coral)" }}>*</span></label>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus placeholder="e.g. Ahmed R." />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Phone</label>
            <input className="input mono" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0501234567" inputMode="tel" />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" />
          </div>
        </div>
        <div>
          {/* Required, and first-class: without this the funnel cannot be counted
              per line of business, which is the whole reason leads are their own
              entity rather than a case stage. */}
          <label className="label">What are they asking about? <span style={{ color: "var(--coral)" }}>*</span></label>
          <select className="select" value={serviceLineId} onChange={(e) => { setServiceLineId(e.target.value); setProductId(""); }}>
            <option value="">Choose a service…</option>
            {activeLines.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
          </select>
        </div>
        {line && (line.products?.length ?? 0) > 0 && (
          <div>
            <label className="label">Specific product <span className="normal-case tracking-normal" style={{ color: "var(--ink-faint)" }}>— optional, they may not know yet</span></label>
            <select className="select" value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Not decided</option>
              {(line.products ?? []).filter((p) => p.active).map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
            </select>
          </div>
        )}
        {showAmount && (
          <div>
            <label className="label">Amount asked for</label>
            <input className="input mono" value={intendedAmount} onChange={(e) => setIntendedAmount(e.target.value)} inputMode="numeric" placeholder="e.g. 2500000" />
          </div>
        )}
<div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Source</label>
            <select className="select" value={source} onChange={(e) => setSource(e.target.value)}>
              {["Direct", "Website", "Agent", "Broker", "Referral", "WalkIn", "Social", "Event"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Owner</label>
            <select className="select" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Unassigned</option>
              {users.map((u) => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Source detail <span className="normal-case tracking-normal" style={{ color: "var(--ink-faint)" }}>— free text the dropdown can't hold</span></label>
          <input className="input" value={sourceDetail} onChange={(e) => setSourceDetail(e.target.value)} placeholder="met at GITEX stand, WhatsApp ad…" />
        </div>
      </div>
    </Modal>
  );
}

/** Convert confirmation. Says exactly what happens to the lead's record — people
 *  hold back from converting when the process is a black box. */
function ConvertLeadModal({ lead, busy, onClose, onConfirm }: {
  lead: Lead; busy: boolean; onClose: () => void; onConfirm: () => void;
}) {
  return (
    <Modal title={`Convert ${lead.fullName} to a case?`}
      sub="The lead stays on file as the case's origin — nothing is lost."
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={onConfirm} disabled={busy}>{busy ? "Converting…" : "Convert"}</button>
      </>}>
      <ul className="text-[12.5px] text-[var(--ink-faint)] m-0 pl-4 space-y-1.5">
        <li>A case is opened and enters the <b>{lead.serviceLineName}</b> journey.</li>
        <li>
          The case carries across: contact details, source, owner
          {lead.intendedAmount != null ? `, and the intended ${lead.intendedAmount.toLocaleString()}` : ""}.
        </li>
        <li>The lead is marked converted and can never be reopened — a case is live work.</li>
      </ul>
    </Modal>
  );
}
