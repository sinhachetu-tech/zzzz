"use client";
import { CaseProfileEditor } from "@/components/views/case-profile-editor";
import { parseCaseProfile, computeJointAffordability } from "@/lib/case-profile";

/* Leads view — the top of the funnel. Lead-stage cases (including portal
   self-registrations) with qualify / assign / convert actions. Converting
   moves the lead into the live pipeline (WhatsApp Group Creation). */

import { useMemo, useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import { fmtDate, relTime } from "@/lib/format";
import { Avatar, Chip, EmptyState, Modal } from "@/components/hfmc/ui";
import { IArrowR, IWhatsapp } from "@/components/icons";

export default function Leads() {
  const { cases, users, userById, updateCase, toast, nav, me, flags } = useHfmcStore();
  const [filter, setFilter] = useState<"all" | "mine" | "unassigned">("all");
  const [qualifyingCase, setQualifyingCase] = useState<any>(null);

  const canAssign = !!(flags?.issueTasks || flags?.admin || flags?.super);
  const leads = useMemo(
    () =>
      cases.filter((c) => c.stage === "Lead" && c.caseStatus === "Active")
        .filter((c) =>
          filter === "all" ? true
          : filter === "unassigned" ? !c.ownerId || c.ownerId === 1
          : c.ownerId === me?.id,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [cases, filter, me?.id],
  );

  const convert = async (c: { id: number; caseNumber: string }) => {
    await updateCase(c.id, { stage: "WhatsApp Group Creation" });
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
                  <button className="btn btn-ghost btn-sm" onClick={() => nav({ name: "case", id: c.id })}>
                    Open <IArrowR size={12} />
                  </button>
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
    </div>
  );
}

const fmtMoneyShort = (n: number) => (n > 0 ? "AED " + (n / 1_000_000).toFixed(2).replace(/\.?0+$/, "") + "M" : "—");
