"use client";

/* AddBankModal — shop a lead/case to another bank, from the LEADS area.
 *
 * WHY IT LIVES HERE AND NOT IN CASE 360: a deal is shopped while it is still
 * being qualified. The person deciding "let's also try Emirates" is working the
 * lead, not a live file, and after conversion they should still be able to do it
 * without hunting for the right screen. Reachable from a lead card, from the
 * recently-converted strip, and from the Cases list.
 *
 * WHAT IT DOES: POSTs to /api/cases/:id/add-bank, which creates a SIBLING case
 * for that bank — its own HFMC number, its own stage, its own document checklist
 * resolved from DocRule.applicableBank, and its own bank reference number. It
 * copies the borrower's profile and the commercial terms, and copies NOTHING
 * that belongs to the previous bank's journey.
 *
 * The "already on this deal" panel matters: it is how a broker sees the other
 * legs, which case number belongs to which bank, and which one has the bank's
 * reference captured yet. */

import { useMemo, useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { LoanCase } from "@/lib/types";
import { Modal } from "@/components/hfmc/ui";
import { fmtMoney } from "@/lib/format";
import { IArrowR } from "@/components/icons";

export function AddBankModal({
  c,
  cases,
  onClose,
}: {
  c: LoanCase;
  cases: LoanCase[];
  onClose: () => void;
}) {
  const { banks, stages, addBankToCase, nav } = useHfmcStore();
  const [bank, setBank] = useState("");
  const [bankRef, setBankRef] = useState("");
  const [bankRm, setBankRm] = useState("");
  const [startStage, setStartStage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // The family = the root leg plus its siblings. Root is the one with no parent.
  const rootId = c.parentCaseId ?? c.id;
  const family = useMemo(
    () => cases.filter((k) => k.id === rootId || k.parentCaseId === rootId),
    [cases, rootId],
  );
  const takenBanks = useMemo(() => {
    const s = new Set<string>();
    for (const f of family) for (const b of f.banks) s.add(b);
    return s;
  }, [family]);

  const options = banks.filter((b) => b.active && !takenBanks.has(b.name));
  const selected = banks.find((b) => b.name === bank);
  const startOptions = [...stages].filter((s) => s.active).sort((a, b) => a.sortOrder - b.sortOrder);

  const submit = async () => {
    if (!bank) return setErr("Pick the bank you want to shop this to.");
    setBusy(true);
    setErr("");
    try {
      const created = await addBankToCase(c.id, {
        bank,
        bankRef: bankRef.trim(),
        bankRm: bankRm.trim(),
        startStage: startStage.trim(),
      });
      onClose();
      nav({ name: "case", id: created.id });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add that bank.");
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add a bank to this deal"
      sub={`${c.caseNumber} · ${c.customer} · ${fmtMoney(c.loanAmount)}`}
      onClose={onClose}
      width={600}
    >
      <p className="text-[12.5px] text-[var(--ink-dim)] m-0 mb-3">
        This opens a <strong>separate case for {bank || "that bank"}</strong> with its own case number, its own
        documents and its own stage. The borrower&apos;s profile carries over; nothing the previous bank has seen does.
      </p>

      {/* The other legs — so the broker can see what is already in play */}
      {family.length > 0 && (
        <div className="card p-3 mb-3" style={{ background: "var(--tint)" }}>
          <div className="text-[10.5px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)] mb-1.5">
            Already on this deal
          </div>
          <div className="space-y-1">
            {family.map((f) => (
              <div key={f.id} className="flex items-center gap-2 text-[11.5px]">
                <span className="mono shrink-0" style={{ color: "var(--amber)" }}>{f.caseNumber}</span>
                <span className="font-medium shrink-0">{f.banks.join(", ") || "no bank yet"}</span>
                <span className="text-[var(--ink-faint)] truncate">{f.stage}</span>
                <span className="ml-auto mono text-[10.5px] shrink-0" style={{ color: f.bankRef ? "var(--mint)" : "var(--ink-faint)" }}>
                  {f.bankRef ? `ref ${f.bankRef}` : "ref not captured"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {options.length === 0 ? (
        <p className="text-[12.5px] m-0" style={{ color: "var(--amber)" }}>
          Every active bank is already on this deal. Add a new bank under Admin → Banks first.
        </p>
      ) : (
        <>
          <div>
            <label className="label">Bank</label>
            <select className="select" value={bank} onChange={(e) => { setBank(e.target.value); setErr(""); }}>
              <option value="">— pick a bank —</option>
              {options.map((b) => (
                <option key={b.id} value={b.name}>{b.name}{b.ratePct ? ` · ${b.ratePct}%` : ""}</option>
              ))}
            </select>
          </div>

          {bank && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <div>
                <label className="label">
                  Their case / application no
                  <span className="normal-case tracking-normal text-[var(--ink-faint)]"> — optional, add later</span>
                </label>
                <input className="input mono" value={bankRef} onChange={(e) => setBankRef(e.target.value)} placeholder="e.g. MX-2026-88412" />
                <p className="text-[10.5px] text-[var(--ink-faint)] m-0 mt-1">
                  The number the bank quotes back to you. It is not our HFMC number.
                </p>
              </div>
              <div>
                <label className="label">Bank RM <span className="normal-case tracking-normal text-[var(--ink-faint)]">— optional</span></label>
                {selected && selected.contacts && selected.contacts.length > 0 ? (
                  <select className="select" value={bankRm} onChange={(e) => setBankRm(e.target.value)}>
                    <option value="">— none —</option>
                    {selected.contacts.map((ct, i) => (
                      <option key={i} value={ct.name}>{ct.name}{ct.phone ? ` · ${ct.phone}` : ""}</option>
                    ))}
                  </select>
                ) : (
                  <input className="input" value={bankRm} onChange={(e) => setBankRm(e.target.value)} placeholder="RM name" />
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="label">
                  Start at
                  <span className="normal-case tracking-normal text-[var(--ink-faint)]"> — this bank has seen nothing yet</span>
                </label>
                <select className="select" value={startStage} onChange={(e) => setStartStage(e.target.value)}>
                  {startOptions.map((s) => (
                    <option key={s.id} value={s.label}>{s.label}</option>
                  ))}
                </select>
                <p className="text-[10.5px] text-[var(--ink-faint)] m-0 mt-1">
                  Defaults to the start of the pipeline. Do not fast-forward this — the stage records what the bank has actually done.
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {err && <p className="text-[12.5px] mt-2.5 mb-0" style={{ color: "var(--coral)" }}>{err}</p>}

      <div className="flex justify-end gap-2 mt-4 pt-3" style={{ borderTop: "1px solid var(--line-soft)" }}>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-mint" onClick={submit} disabled={busy || !bank || options.length === 0}>
          {busy ? "Opening…" : <>Open the new bank case <IArrowR size={13} /></>}
        </button>
      </div>
    </Modal>
  );
}
