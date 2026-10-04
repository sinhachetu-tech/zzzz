"use client";

/* CaseParties — everyone else on this case, each in a role (Phase B).
 *
 * THE RULE this makes obvious: the PERSON is a Client, the ROLE lives on the case.
 * "Co-borrower" is what Fatima is on HFMC-0187; next year she may be the primary
 * on her own loan, or a guarantor on someone else's, and none of that changes who
 * she is. So this never edits a Client — it links one.
 *
 * It replaced a single `coApplicantName` free-text box, which held exactly one
 * name, had no profile behind it, and could not represent two co-applicants plus
 * a guarantor (which is normal).
 */

import { useMemo, useState } from "react";
import type { LoanCase, PartyRole } from "@/lib/types";
import { PARTY_ROLES, PARTY_ROLE_LABEL } from "@/lib/types";
import { useHfmcStore } from "@/lib/client-store";
import { Modal, Chip } from "@/components/hfmc/ui";
import { IX } from "@/components/icons";

export function CaseParties({ c }: { c: LoanCase }) {
  const { clients, partiesOfCase, addParty, updateParty, removeParty, toast, nav } = useHfmcStore();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const parties = partiesOfCase(c.id);
  const primary = clients.find((cl) => cl.id === c.clientId) ?? null;

  // Someone on the case with no party row yet — a co-borrower added before Phase B
  // existed, held only by secondPartyClientId. Surfaced so the list is never
  // quietly missing a person the bank can see.
  const legacyOnly =
    c.secondPartyClientId && !parties.some((p) => p.clientId === c.secondPartyClientId)
      ? c.secondPartyClientId
      : null;

  const act = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast("success", ok);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not update the parties on this case");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] uppercase tracking-[0.12em] font-disp font-semibold" style={{ color: "var(--sky)" }}>
          Also on this case
        </span>
        <button
          className="text-[11.5px] px-2 py-1 rounded-md hover:bg-[var(--tint)] transition-colors"
          style={{ color: "var(--ink-dim)" }}
          onClick={() => setAdding(true)}
          disabled={busy}
        >
          + Add co-borrower / co-applicant
        </button>
      </div>

      {primary && (
        <div className="flex items-center gap-2 py-1.5 text-[12.5px]">
          <span className="truncate" style={{ color: "var(--ink)" }}>{primary.fullName}</span>
          <Chip tone="mint">Main applicant</Chip>
        </div>
      )}

      {parties.map((p) => {
        const cl = clients.find((x) => x.id === p.clientId);
        const who = cl?.fullName ?? p.clientName ?? "Unknown";
        return (
          <div key={p.id} className="flex items-center gap-2 py-1.5 text-[12.5px]">
            <button
              className="truncate hover:underline text-left"
              style={{ color: "var(--ink)" }}
              onClick={() => nav({ name: "clients", clientId: p.clientId })}
              title="Open their client file"
            >
              {who}
            </button>
            <select
              className="text-[11.5px] rounded px-1.5 py-0.5"
              style={{ background: "var(--tint)", color: "var(--ink-dim)", border: "1px solid var(--line-soft)" }}
              value={p.role}
              disabled={busy}
              onChange={(e) => {
                const next = e.target.value as PartyRole;
                act(() => updateParty(c.id, p.id, next), `${who} is now a ${PARTY_ROLE_LABEL[next].toLowerCase()}.`);
              }}
            >
              {PARTY_ROLES.map((r) => (
                <option key={r} value={r}>{PARTY_ROLE_LABEL[r]}</option>
              ))}
            </select>
            <button
              className="ml-auto opacity-60 hover:opacity-100"
              title="Remove from this case — their client file is kept"
              onClick={() => act(
                () => removeParty(c.id, p.id),
                `${who} removed from this case. Their client file is untouched.`,
              )}
            >
              <IX size={13} />
            </button>
          </div>
        );
      })}
{legacyOnly && (
        <div className="flex items-center gap-2 py-1.5 text-[12.5px]">
          <span className="truncate" style={{ color: "var(--ink-dim)" }}>
            {clients.find((x) => x.id === legacyOnly)?.fullName ?? "Unknown"}
          </span>
          <Chip tone="slate" title="Recorded before the parties list existed — re-add to give them a role">
            Co-applicant / Co-borrower
          </Chip>
        </div>
      )}

      {!parties.length && !legacyOnly && (
        <p className="text-[11.5px] m-0" style={{ color: "var(--ink-faint)" }}>
          Nobody else is on this case. A co-borrower or guarantor added here gets their own
          client file, so their income and KYC are assessed in their own name.
        </p>
      )}

      {adding && (
        <AddPartyModal
          c={c}
          busy={busy}
          onClose={() => setAdding(false)}
          onSubmit={async (input) => {
            setBusy(true);
            try {
              const r = await addParty(c.id, input);
              setAdding(false);
              // Say out loud whether we matched or created. Silently minting a
              // near-duplicate of someone already on file is the failure mode here.
              toast(
                "success",
                r.createdClient
                  ? "Added, and created their client file."
                  : r.matchedBy === "eid"
                    ? "Added — matched to an existing client by Emirates ID."
                    : "Added — matched to an existing client by name and phone.",
              );
            } catch (e) {
              toast("error", e instanceof Error ? e.message : "Could not add this person");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}
function AddPartyModal({ c, busy, onClose, onSubmit }: {
  c: LoanCase;
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: {
    clientId?: number; role: PartyRole; fullName?: string; phone?: string; eidNo?: string;
  }) => Promise<void>;
}) {
  const { clients, partiesOfCase } = useHfmcStore();
  const [role, setRole] = useState<PartyRole>("CoBorrower");
  const [q, setQ] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [eidNo, setEidNo] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const onCase = new Set(partiesOfCase(c.id).map((p) => p.clientId));
  const term = q.trim().toLowerCase();

  // Existing clients, minus the main applicant (the server refuses them anyway,
  // so do not offer them) and anyone already on the case.
  const matches = useMemo(() => {
    if (!term) return [];
    const digitsOnly = term.replace(/\D/g, "");
    return clients
      .filter((cl) => {
        if (cl.id === c.clientId || onCase.has(cl.id)) return false;
        if (digitsOnly.length >= 3) return (cl.phone || "").includes(digitsOnly);
        return (
          cl.fullName.toLowerCase().includes(term) ||
          (cl.email || "").toLowerCase().includes(term) ||
          (cl.eidNo || "").includes(digitsOnly)
        );
      })
      .slice(0, 8);
  }, [clients, term, c.clientId, onCase]);

  const selected = picked != null ? clients.find((cl) => cl.id === picked) ?? null : null;

  return (
    <Modal
      title="Add someone to this case"
      sub="They become a client in their own right — a bank assesses a co-borrower's income and KYC separately, not merged with the main applicant."
      onClose={onClose}
      width={520}
      footer={
        <div className="flex items-center gap-2">
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as PartyRole)}>
            {PARTY_ROLES.map((r) => (
              <option key={r} value={r}>{PARTY_ROLE_LABEL[r]}</option>
            ))}
          </select>
          <button
            className="btn btn-primary ml-auto"
            disabled={busy || (!selected && !fullName.trim())}
            onClick={() =>
              onSubmit(
                selected
                  ? { clientId: selected.id, role }
                  : { role, fullName: fullName.trim(), phone: phone.trim(), eidNo: eidNo.trim() },
              )
            }
          >
            {busy ? "Adding…" : selected ? "Add to case" : "Create & add"}
          </button>
        </div>
      }
    >
      {selected ? (
        <div className="text-[13px]">
          <p className="m-0 mb-2" style={{ color: "var(--ink-dim)" }}>Adding:</p>
          <p className="m-0 font-disp font-semibold" style={{ color: "var(--ink)" }}>{selected.fullName}</p>
          <p className="m-0 text-[11.5px]" style={{ color: "var(--ink-faint)" }}>
            {[selected.phone, selected.eidNo].filter(Boolean).join(" · ") || "No phone or EID on file"}
          </p>
          <button
            className="text-[11.5px] mt-3 hover:underline"
            style={{ color: "var(--sky)" }}
            onClick={() => { setPicked(null); setQ(""); }}
          >
            ← Choose someone else
          </button>
        </div>
      ) : (
        <>
          <label className="label">Find someone already on file</label>
          <input
            className="input"
            autoFocus
            value={q}
            onChange={(e) => { setQ(e.target.value); setCreating(false); }}
            placeholder="Name, phone, Emirates ID or email…"
          />

          {matches.length > 0 && (
            <div className="mt-2 rounded-md" style={{ border: "1px solid var(--line-soft)" }}>
              {matches.map((cl) => (
                <button
                  key={cl.id}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] hover:bg-[var(--tint)]"
                  style={{ color: "var(--ink)" }}
                  onClick={() => { setPicked(cl.id); setCreating(false); }}
                >
                  <span className="truncate">{cl.fullName}</span>
                  <span className="ml-auto text-[11px] truncate" style={{ color: "var(--ink-faint)" }}>
                    {[cl.phone, cl.eidNo].filter(Boolean).join(" · ")}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="mt-4 pt-3" style={{ borderTop: "1px solid var(--line-soft)" }}>
            <label className="label">Or someone new</label>
            <input
              className="input"
              value={fullName}
              onChange={(e) => { setFullName(e.target.value); setCreating(!!e.target.value); }}
              placeholder="Full name"
            />
            {creating && (
              <div className="rf-form-grid-sm mt-2">
                <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />
                <input className="input mono" value={eidNo} onChange={(e) => setEidNo(e.target.value)} placeholder="Emirates ID" />
              </div>
            )}
            <p className="text-[11px] mt-1.5 mb-0" style={{ color: "var(--ink-faint)" }}>
              With an Emirates ID we match on it exactly. With only a phone we will NOT
              auto-merge — families share numbers, so you decide.
            </p>
          </div>
        </>
      )}
    </Modal>
  );
}