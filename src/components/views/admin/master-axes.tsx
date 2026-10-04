// Edit a MASTER's pinned axes: employment, residency, mortgage type, property type.
//
// WHY these three are pinned and not per-slot: changing employment changes the
// RULES, not just the price — Mashreq is 85% LTV / AED 15k salaried vs 75% /
// AED 25k self-employed, and DIB prices self-employed at 65%. So everything inside
// a master shares one set of rules, and the axes that carry those rules cannot vary
// per row.
//
// The NAME is derived from these axes and shown read-only beside them, because the
// only thing worse than a name that disagrees with its axes is an editor that lets
// it happen. Bank 16 currently holds two master rows whose type is blank — that is
// exactly what a free-text name field costs.
//
// A save rewrites the typed column AND the derived name on every product row in
// the family (they must never disagree), and audits each row separately so the
// change log names every product it touched.
"use client";

import { useState } from "react";

export interface MasterTarget {
  bankId: number;
  bankName: string;
  employment: string;
  residency: string;
  mortgageType: string;
  financeType: string;
  productIds: number[];
  productNames: string[];
}

const EMPLOYMENT = ["Salaried", "Self-Employed", "Salaried or Self-Employed"];
const RESIDENCY = ["Resident", "Non-Resident"];
const LOAN_KIND = ["Conventional", "Islamic"];
const FINANCE = ["Residential", "Commercial"];

export function MasterAxesPanel({ master, onClose, onToast, onSaved, bare }: {
  master: MasterTarget;
  onClose: () => void;
  onToast: (t: "success" | "error" | "info", m: string) => void;
  onSaved: () => Promise<void>;
  /** Inside a Modal the panel must not render its own card frame or title —
      the dialog owns those. Without this the modal shows a card inside a
      card and the header repeats itself. */
  bare?: boolean;
}) {
  // a saved value the dropdown does not know ("" or "Islamic Only") must NOT be
  // silently coerced on open — it shows as "not set on these rows" and stays that
  // way unless the human actually picks something
  const known = (v: string, list: string[]) => (list.includes(v) ? v : "");
  const [employment, setEmployment] = useState(master.employment || "Salaried");
  const [residency, setResidency] = useState(master.residency || "Resident");
  const [loanKind, setLoanKind] = useState(known(master.mortgageType, LOAN_KIND));
  const [financeType, setFinanceType] = useState(master.financeType || "Residential");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const name = [employment, residency, loanKind || "—", financeType !== "Residential" ? financeType : null]
    .filter((x): x is string => x != null).join(" · ");

  const save = async () => {
    if (!reason.trim()) { onToast("error", "A reason is required — it is written to the change log."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/rate-desk", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "master-axes",
          productIds: master.productIds,
          employment, residency,
          loanKind: loanKind || "Conventional",
          financeType,
          reason: reason.trim(),
        }),
      });
      const j = await res.json().catch(() => ({})) as { error?: string; updated?: number };
      if (!res.ok) { onToast("error", j.error ?? "Could not save."); return; }
      onToast("success", `${j.updated ?? master.productIds.length} product row(s) now read "${name}". No rate moved.`);
      onClose();
      await onSaved();
    } catch {
      onToast("error", "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return bare ? (
    <>
      <p className="text-[11.5px] m-0 mb-3" style={{ color: "var(--ink-dim)" }}>
        These axes ARE the family — every row below inherits them, because changing
        employment or residency changes the RULES (LTV cap, minimum salary), not just
        the price. Saving rewrites the derived name too, so a name can never disagree
        with its own axes. No rate moves.
      </p>

      <div className="flex flex-wrap items-end gap-4 mb-3">
        <div>
          <label className="label">Employment</label>
          <select className="select !w-auto" value={employment} onChange={(e) => setEmployment(e.target.value)}>
            {EMPLOYMENT.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Residency</label>
          <select className="select !w-auto" value={residency} onChange={(e) => setResidency(e.target.value)}>
            {RESIDENCY.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Type</label>
          <select className="select !w-auto" value={loanKind} onChange={(e) => setLoanKind(e.target.value)}>
            <option value="">— not set on these rows —</option>
            {LOAN_KIND.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Property</label>
          <select className="select !w-auto" value={financeType} onChange={(e) => setFinanceType(e.target.value)}>
            {FINANCE.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      </div>

      <div className="rounded px-3 py-2 mb-3 text-[12px]" style={{ background: "var(--bg2)" }}>
        The derived name becomes: <strong>{name}</strong>
        {master.productNames.length > 1 && (
          <span style={{ color: "var(--ink-faint)" }}>
            {" "}— replacing {master.productNames.length} cosmetic name variants
          </span>
        )}
      </div>

      <div>
        <label className="label">Your reason (written to the change log, once per row)</label>
        <input className="input input-sm w-full" placeholder="e.g. merged the two blank-type variants into Conventional"
          value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>

      <div className="flex items-center gap-2 mt-3">
        <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={busy || !reason.trim()}>
          {busy ? "Saving…" : `Apply to all ${master.productIds.length} row(s)`}
        </button>
      </div>
    </>
  ) : (
    <div className="card p-4 anim-fade-up" style={{ borderColor: "var(--amber)" }}>
      <div className="font-disp font-semibold text-[13px] mb-1">
        Master axes — {master.bankName} · {master.productIds.length} product row(s)
      </div>
      <p className="text-[11.5px] m-0 mb-3" style={{ color: "var(--ink-dim)" }}>
        These axes ARE the family — every row below inherits them, because changing
        employment or residency changes the RULES (LTV cap, minimum salary), not just
        the price. Saving rewrites the derived name too, so a name can never disagree
        with its own axes. No rate moves.
      </p>

      <div className="flex flex-wrap items-end gap-4 mb-3">
        <div>
          <label className="label">Employment</label>
          <select className="select !w-auto" value={employment} onChange={(e) => setEmployment(e.target.value)}>
            {EMPLOYMENT.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Residency</label>
          <select className="select !w-auto" value={residency} onChange={(e) => setResidency(e.target.value)}>
            {RESIDENCY.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Type</label>
          <select className="select !w-auto" value={loanKind} onChange={(e) => setLoanKind(e.target.value)}>
            <option value="">— not set on these rows —</option>
            {LOAN_KIND.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Property</label>
          <select className="select !w-auto" value={financeType} onChange={(e) => setFinanceType(e.target.value)}>
            {FINANCE.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      </div>

      <div className="rounded px-3 py-2 mb-3 text-[12px]" style={{ background: "var(--bg2)" }}>
        The derived name becomes: <strong>{name}</strong>
        {master.productNames.length > 1 && (
          <span style={{ color: "var(--ink-faint)" }}>
            {" "}— replacing {master.productNames.length} cosmetic name variants
          </span>
        )}
      </div>

      <div>
        <label className="label">Your reason (written to the change log, once per row)</label>
        <input className="input input-sm w-full" placeholder="e.g. merged the two blank-type variants into Conventional"
          value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>

      <div className="flex items-center gap-2 mt-3">
        <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={busy || !reason.trim()}>
          {busy ? "Saving…" : `Apply to all ${master.productIds.length} row(s)`}
        </button>
      </div>
    </div>
  );
}

/**
 * Declare a NEW master: one bank plus the pinned axes.
 *
 * A master is a declaration ("DIB sells to self-employed non-residents"), not a
 * by-product of imports. Before this, the only way to get a new family was to
 * import a policy sheet and approve its rows — there was no "add a master" at
 * all. Creating one writes a single BankProduct row with a starter EMPTY quote
 * line, so the family exists as one named thing the grid can show, and the
 * first rate gets filed with the normal card edit (never here, never inline
 * with the declaration).
 */
export function MasterCreatePanel({ banks, initial, onClose, onToast, onSaved }: {
  banks: Array<{ id: number; name: string }>;
  initial: { bankId: number | null; bankName: string };
  onClose: () => void;
  onToast: (t: "success" | "error" | "info", m: string) => void;
  /** The new product id, so the grid can land on the bank that now owns it. */
  onSaved: (createdId?: number) => void | Promise<void>;
}) {
  const initialId = banks.find((b) => b.name === initial.bankName)?.id ?? banks[0]?.id ?? null;
  const [bankId, setBankId] = useState<number | null>(initial.bankId ?? initialId);
  const [employment, setEmployment] = useState("Salaried");
  const [residency, setResidency] = useState("Resident");
  const [loanKind, setLoanKind] = useState("Conventional");
  const [financeType, setFinanceType] = useState("Residential");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const name = [employment, residency, loanKind || "—", financeType !== "Residential" ? financeType : null]
    .filter((x): x is string => x != null).join(" · ");

  const save = async () => {
    if (bankId == null) { onToast("error", "Pick the bank this master belongs to."); return; }
    if (!reason.trim()) { onToast("error", "A reason is required — it is written to the change log."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/rate-desk", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "master-create",
          bankId, employment, residency,
          loanKind: loanKind || "Conventional",
          financeType, reason: reason.trim(),
        }),
      });
      const j = await res.json().catch(() => ({})) as { error?: string; id?: number };
      if (!res.ok) { onToast("error", j.error ?? "Could not create the master."); return; }
      const bankName = banks.find((b) => b.id === bankId)?.name ?? "";
      onToast("success", `${bankName} · “${name}” created as a draft — file its first rate from the grid.`);
      onClose();
      await onSaved(j.id);
    } catch {
      onToast("error", "Could not create the master.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="mb-3">
        <label className="label">Bank</label>
        <select className="select !w-auto" value={bankId == null ? "" : String(bankId)}
          onChange={(e) => setBankId(e.target.value === "" ? null : Number(e.target.value))}>
          <option value="">— pick a bank —</option>
          {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      <div className="flex flex-wrap items-end gap-4 mb-3">
        <div>
          <label className="label">Employment</label>
          <select className="select !w-auto" value={employment} onChange={(e) => setEmployment(e.target.value)}>
            {EMPLOYMENT.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Residency</label>
          <select className="select !w-auto" value={residency} onChange={(e) => setResidency(e.target.value)}>
            {RESIDENCY.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Type</label>
          <select className="select !w-auto" value={loanKind} onChange={(e) => setLoanKind(e.target.value)}>
            {LOAN_KIND.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Property</label>
          <select className="select !w-auto" value={financeType} onChange={(e) => setFinanceType(e.target.value)}>
            {FINANCE.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      </div>

      <div className="rounded px-3 py-2 mb-3 text-[12px]" style={{ background: "var(--bg2)" }}>
        This creates one product row named: <strong>{name}</strong>, with a single empty
        slot waiting for its first rate.
      </div>

      <div>
        <label className="label">Your reason (written to the change log)</label>
        <input className="input input-sm w-full" placeholder="e.g. DIB confirmed a self-employed NR card for October"
          value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>

      <div className="flex items-center gap-2 mt-3">
        <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={busy || !reason.trim() || bankId == null}>
          {busy ? "Creating…" : "Create master"}
        </button>
      </div>
    </>
  );
}