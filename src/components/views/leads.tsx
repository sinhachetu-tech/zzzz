"use client";
import { CaseProfileEditor } from "@/components/views/case-profile-editor";
import { parseCaseProfile, computeJointAffordability } from "@/lib/case-profile";

/* Leads view — the top of the funnel. Lead-stage cases (including portal
   self-registrations) with qualify / assign / convert actions. Converting
   moves the lead into the live pipeline (Document Collection). */

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

export default function Leads() {
  const { cases, users, userById, updateCase, deleteCase, toast, nav, me, flags, banks, channels, stages, openNewCase } = useHfmcStore();
  const [filter, setFilter] = useState<"all" | "mine" | "unassigned">("all");
  const [qualifyingCase, setQualifyingCase] = useState<any>(null);
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
  const leads = useMemo(
    () =>
      cases.filter((c) => c.stage === "Lead" && c.caseStatus === "Active")
        .filter((c) =>
          filter === "all" ? true
            : filter === "unassigned" ? !c.ownerId || c.ownerId === 1
              : c.ownerId === me?.id,
        )
        // Stale first — oldest leads need the nudge most.
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [cases, filter, me?.id],
  );

  const convert = async (c: { id: number; caseNumber: string }) => {
    await updateCase(c.id, { stage: "Document Collection" });
    toast("success", `${c.caseNumber} converted — moved into the live pipeline.`);
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
        <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "var(--line)" }}>
          {(["all", "mine", "unassigned"] as const).map((f) => (
            <button key={f} className="px-3 py-1.5 text-[12px] font-disp font-semibold transition-colors"
              style={filter === f ? { background: "var(--amber-tint)", color: "var(--amber)" } : { color: "var(--ink-faint)" }}
              onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "mine" ? "Mine" : "Unassigned"}
            </button>
          ))}
        </div>
        {/* Add Lead button in Leads view */}
        <button className="btn btn-primary btn-sm ml-2" onClick={() => openNewCase()}>
          Add lead
        </button>
      </div>

      {leads.length === 0 ? (
        <div className="card p-10">
          <EmptyState
            icon={<IArrowR size={24} />}
            title="No leads in the funnel"
            body="New portal registrations and manually added Lead-stage cases appear here for qualification."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {leads.map((c) => {
            const age = leadAge(c.createdAt);
            const owner = userById(c.ownerId);
            const unassigned = c.ownerId === 1 || !owner;
            return (
              <div key={c.id} className="card p-4 anim-fade-up" style={{ borderLeft: "3px solid var(--amber)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {(() => {
                      const prof = parseCaseProfile(c.profileJson, { customer: c.customer, loanAmount: c.loanAmount, coApplicantName: c.coApplicantName });
                      const joint = computeJointAffordability(prof);
                      return (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="mono text-[12px]" style={{ color: "var(--amber)" }}>{c.caseNumber}</span>
                          <Chip tone="slate">{c.source}</Chip>
                          {unassigned && <Chip tone="coral">unassigned</Chip>}
                          <Chip tone={age.tone}>⏱ {age.label}</Chip>
                          {c.clientId && <Chip tone="amber">known client</Chip>}
                          <Chip tone={joint.badgeTone}>{joint.badgeLabel}</Chip>
                        </div>
                      );
                    })()}
                    <div className="font-disp font-semibold text-[15px] mt-1">{c.customer}</div>
                    <p className="text-[11.5px] text-[var(--ink-dim)] m-0 mt-1 leading-snug">
                      {c.statusNote || "No inquiry note."}
                    </p>
                    <p className="text-[10.5px] text-[var(--ink-faint)] m-0 mt-1">
                      {fmtDate(c.createdAt)} · {relTime(c.createdAt)} · {fmtMoneyShort(c.loanAmount)} target
                    </p>
                  </div>
                  {c.whatsapp && (
                    <a className="btn btn-mint btn-sm !px-2" title="WhatsApp the lead" target="_blank" rel="noreferrer"
                      href={`https://wa.me/${c.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(`Hello, this is HFMC regarding your home finance inquiry (${c.caseNumber}).`)}`}>
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
                  <button className="btn btn-mint btn-sm ml-auto" onClick={() => convert(c)}>
                    Convert to case
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {qualifyingCase && (
        <Modal title={`Qualify Lead Profile � ${qualifyingCase.caseNumber}`} sub={qualifyingCase.customer} onClose={() => setQualifyingCase(null)} width={680}>
          <CaseProfileEditor c={qualifyingCase} onSaved={() => setQualifyingCase(null)} />
        </Modal>
      )}

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
  const { users, updateCase, toast, banks: allBanks, channels: allChannels, flags, me, stages } = useHfmcStore();
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const toggleBank = (name: string) =>
    setBankList((prev) => (prev.includes(name) ? prev.filter((b) => b !== name) : [...prev, name]));

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

        <div>
          <label className="label">Banks submitted to <span className="normal-case tracking-normal" style={{ color: "var(--ink-faint)" }}>— multiple OK</span></label>
          <div className="flex flex-wrap gap-1.5">
            {allBanks.filter((b: any) => b.active).map((b: any) => {
              const on = bankList.includes(b.name);
              return (
                <button key={b.id} type="button" onClick={() => toggleBank(b.name)} className="chip transition-all"
                  style={on ? { background: "rgba(242,176,76,0.14)", borderColor: "var(--amber)", color: "var(--amber)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}>
                  {b.name} {flags?.viewRevenue && <span className="opacity-70">{b.ratePct}%</span>}
                </button>
              );
            })}
          </div>
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
          {bankList.length === 0 ? "Bank TBC" : `${bankList.length} bank${bankList.length > 1 ? "s" : ""} in play`}
        </span>
        <div className="flex gap-2">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Save details"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
