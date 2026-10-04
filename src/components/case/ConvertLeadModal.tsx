"use client";

/* ConvertLeadModal — the gate between "an enquiry" and "a live file".

   WHY A MODAL INSTEAD OF A BUTTON: conversion used to be one click that set the
   stage and nothing else, so a lead could enter the pipeline with no phone, no
   email and no owner and then sit there looking barren in the Cases tab. The
   pre-flight below makes the gaps visible BEFORE the handover, fills the two
   cheapest ones (phone / email) inline, and refuses nothing — a broker under
   pressure can still convert, but they now have to have SEEN the red rows.

   What it does on confirm: PATCH stage → the first non-Lead stage. The API
   stamps convertedAt / convertedById on that exact call (api/cases/[id]), so
   the Cases tab can show "Converted 3d ago" and the "From lead" view can
   separate converted leads from cases created straight into the pipeline. */

import { useMemo, useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { LoanCase } from "@/lib/types";
import { Modal } from "@/components/hfmc/ui";
import { ContactLine, KycChip, resolveContact } from "@/components/case/ContactBits";
import { computeReadiness, isValidEmail, phoneDigits } from "@/lib/lead-readiness";
import { ICheck, IArrowR } from "@/components/icons";

export function ConvertLeadModal({ c, onClose }: { c: LoanCase; onClose: () => void }) {
  const { clients, users, updateCase, toast, nav, me, stages } = useHfmcStore();
  const client = clients.find((cl) => cl.id === c.clientId) ?? null;
  const contact = useMemo(() => resolveContact(c, client), [c, client]);

  const [phone, setPhone] = useState(contact.phone || c.whatsapp || "");
  const [email, setEmail] = useState(contact.email);
  const [ownerId, setOwnerId] = useState<number>(c.ownerId);
  const [advisorId, setAdvisorId] = useState<string>(c.advisorId ? String(c.advisorId) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Target stage = the first non-Lead stage in the configured order. Falls back
  // to the historic literal so this still works if an admin renames stages.
  const targetStage = useMemo(() => {
    const ordered = [...stages].filter((s) => s.active).sort((a, b) => a.sortOrder - b.sortOrder);
    return ordered.find((s) => s.label !== "Lead")?.label ?? "Document Collection";
  }, [stages]);

  const phoneOk = phoneDigits(phone).length >= 7;
  const owner = users.find((u) => u.id === ownerId);
  // ownerId 1 is the "unassigned" head-of-company bucket, so it is NOT an owner
  // for readiness purposes — that is why this tests the resolved name, not the id.
  const ownerName = ownerId > 1 ? owner?.name ?? null : null;

  // The SAME readiness rules the Leads list sorts and badges by — see
  // src/lib/lead-readiness.ts. One definition, so the modal can never disagree
  // with the list about whether a lead is ready.
  const readiness = useMemo(
    () =>
      computeReadiness({
        phone,
        email,
        eidNo: contact.eidNo,
        passportNo: contact.passportNo,
        ownerName,
        loanAmount: c.loanAmount,
        customer: c.customer,
      }),
    [phone, email, contact.eidNo, contact.passportNo, ownerName, c.loanAmount, c.customer],
  );
  const emailOk = isValidEmail(email);
  const blockers = readiness.gaps;

  const submit = async () => {
    if (!phoneOk) return setErr("A phone number of at least 7 digits is required to convert.");
    setBusy(true);
    setErr("");
    try {
      // One PATCH. The email goes through profileJson (LoanCase has no email
      // column) so syncCaseClients promotes it onto the Client master; the
      // owner/advisor/phone are plain columns.
      const patch: Record<string, unknown> = {
        stage: targetStage,
        ownerId,
        whatsapp: phone.trim(),
        advisorId: advisorId ? Number(advisorId) : null,
      };
      if (emailOk) {
        let prof: any = {};
        try { prof = JSON.parse(c.profileJson || "{}"); } catch { prof = {}; }
        patch.profileJson = JSON.stringify({
          ...prof,
          primary: {
            ...(prof.primary ?? {}),
            fullName: prof.primary?.fullName || c.customer,
            phone: phone.trim(),
            email: email.trim(),
          },
        });
      }
      await updateCase(c.id, patch);
      toast("success", `${c.caseNumber} converted — now in the live pipeline as ${targetStage}.`);
      onClose();
      nav({ name: "case", id: c.id });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not convert this lead.");
      setBusy(false);
    }
  };
  return (
    <Modal title="Convert to case" sub={`${c.caseNumber} · ${c.customer}`} onClose={onClose} width={560}>
      <p className="text-[12.5px] text-[var(--ink-dim)] m-0 mb-3.5">
        This moves <strong>{c.caseNumber}</strong> out of the funnel into <strong>{targetStage}</strong> and stamps
        the conversion date, so the pipeline can tell where it came from. Fill the gaps below first.
      </p>

      {/* Readiness checklist — the whole point of the modal */}
      <div className="card p-3.5 mb-3.5" style={{ background: "var(--tint)" }}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-disp font-semibold text-[12.5px]">Pre-flight</span>
          <span className="mono text-[11px]" style={{ color: blockers ? "var(--amber)" : "var(--mint)" }}>
            {blockers ? `${blockers} hard gap${blockers > 1 ? "s" : ""} to sort` : `ready to convert · ${readiness.score}%`}
          </span>
        </div>
        <div className="space-y-1.5">
          {readiness.items.map((k) => (
            <div key={k.label} className="flex items-start gap-2">
              <span
                className="mt-0.5 shrink-0 w-3.5 h-3.5 rounded-full flex items-center justify-center"
                style={{
                  background: k.ok ? "rgba(16,185,129,0.16)" : k.soft ? "rgba(242,176,76,0.16)" : "rgba(244,63,94,0.14)",
                  color: k.ok ? "var(--mint)" : k.soft ? "var(--amber)" : "var(--coral)",
                }}
              >
                {k.ok ? <ICheck size={9} /> : "!"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[12px]">{k.label}{k.soft && !k.ok && <span className="text-[var(--ink-faint)]"> — optional</span>}</div>
                {k.hint && <div className="text-[11px] text-[var(--ink-faint)] truncate" title={k.hint}>{k.hint}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* What is already on file, so the broker can see before retyping */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--ink-faint)]">On file</span>
        <ContactLine contact={contact} size={12} />
        <KycChip contact={contact} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Phone <span style={{ color: "var(--coral)" }}>*</span></label>
          <input className="input mono" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+971 50 123 4567" />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@email.com" />
        </div>
        <div>
          <label className="label">Owner</label>
          <select className="select" value={ownerId} onChange={(e) => setOwnerId(Number(e.target.value))}>
            <option value={1}>— unassigned —</option>
            {users.filter((u) => u.active && u.role !== "Head of Company").map((u) => (
              <option key={u.id} value={u.id}>{u.name} · {u.role}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Client-facing advisor <span className="normal-case tracking-normal text-[var(--ink-faint)]">— optional</span></label>
          <select className="select" value={advisorId} onChange={(e) => setAdvisorId(e.target.value)}>
            <option value="">— same as owner —</option>
            {users.filter((u) => u.active && u.role !== "Head of Company" && u.id !== ownerId).map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
      </div>

      {err && <p className="text-[12.5px] mt-2.5 mb-0" style={{ color: "var(--coral)" }}>{err}</p>}

      <div className="flex items-center justify-between gap-2 mt-5 pt-4" style={{ borderTop: "1px solid var(--line-soft)" }}>
        <span className="text-[11.5px] text-[var(--ink-faint)]">{me ? `Converting as ${me.name}` : ""}</span>
        <div className="flex gap-2">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-mint" onClick={submit} disabled={busy}>
            {busy ? "Converting…" : <>Convert to case <IArrowR size={13} /></>}
          </button>
        </div>
      </div>
    </Modal>
  );
}
