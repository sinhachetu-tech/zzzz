// Admin → Pricing → Deal exceptions (TIER 3).
//
// The most dangerous screen in the app, deliberately hard to use. A tier-3 exception
// prices ONE case below the standard floor, so every guard in the API is mirrored
// here as a visible requirement rather than a hidden error after the user has typed
// everything: a written reason, an expiry, and a second approver who is not you.
"use client";

import { useCallback, useEffect, useState } from "react";
import { Chip, EmptyState } from "@/components/hfmc/ui";
import { useHfmcStore } from "@/lib/client-store";
import { fmtDate, todayISO } from "@/lib/format";

interface Exception {
  id: number; caseId: number; caseNumber: string; customer: string;
  rateDeltaBps: number; feeWaive: boolean; reason: string;
  approvedBy: string; validFrom: string; validTo: string;
  createdBy: string; createdAt: string; expired: boolean;
}

function daysInForce(e: Exception): string {
  const ms = new Date(e.validTo).getTime() - new Date(todayISO()).getTime();
  const d = Math.ceil(ms / 86400000);
  return d > 0 ? `${d} day${d === 1 ? "" : "s"} left` : "expired";
}

export function DealExceptions() {
  const { cases, users, me, toast } = useHfmcStore();
  const [items, setItems] = useState<Exception[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    caseId: "", rateDeltaBps: "-25", feeWaive: false,
    reason: "", approvedBy: "", validTo: "",
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/deal-exceptions");
      if (res.ok) setItems(((await res.json()) as { items: Exception[] }).items ?? []);
    } catch {
      /* leave the list as-is rather than blanking a working view */
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch; the setState is inside an async callback, not the effect body
  useEffect(() => { void load(); }, [load]);

  // the hard requirements as a live checklist, not a wall of errors afterwards
  const checks = [
    { ok: !!form.caseId, label: "Pick the case this applies to" },
    { ok: form.reason.trim().length >= 8, label: "Write why (8+ characters) — this is a permanent record" },
    { ok: !!form.approvedBy && form.approvedBy !== me?.name, label: "Second approver, and it cannot be you" },
    { ok: !!form.validTo, label: "Set an expiry — exceptions are never permanent" },
    { ok: form.rateDeltaBps !== "0" || form.feeWaive, label: "A rate change in bps, or a fee waiver" },
  ];
  const canSave = checks.every((c) => c.ok);

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/deal-exceptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: form.caseId,
          rateDeltaBps: Number(form.rateDeltaBps),
          feeWaive: form.feeWaive,
          reason: form.reason,
          approvedBy: form.approvedBy,
          validFrom: todayISO(),
          validTo: form.validTo,
        }),
      });
      const j = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) { toast("error", j.error ?? "Could not create the exception."); return; }
      toast("success", "Exception created. It is audited and will expire on its own.");
      setForm({ caseId: "", rateDeltaBps: "-25", feeWaive: false, reason: "", approvedBy: "", validTo: "" });
      await load();
    } catch {
      toast("error", "Could not create the exception.");
    } finally {
      setBusy(false);
    }
  };

  const endNow = async (id: number) => {
    const res = await fetch("/api/admin/deal-exceptions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, endNow: true }),
    });
    if (res.ok) { toast("success", "Exception ended today."); void load(); }
    else toast("error", "Could not end the exception.");
  };

  return (
    <div className="space-y-4 anim-fade-up">
      <div className="card p-4" style={{ borderLeft: "3px solid var(--coral)" }}>
        <h3 className="font-disp font-semibold text-[14px] m-0">Tier 3 — deal exceptions</h3>
        <p className="text-[12px] m-0 mt-1" style={{ color: "var(--ink-dim)" }}>
          Prices <strong>one case</strong> below the standard floor. It does not change what the engine
          quotes to anyone else, and it appears on the proposal as a separate &quot;exception pricing&quot;
          line so it is never mistaken for a bank rate. Everything here is audited.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4 items-start">
        <div className="card">
          <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: "var(--line-soft)" }}>
            <h3 className="font-disp font-semibold text-[14px] m-0">In force</h3>
            <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
              {items.filter((i) => !i.expired).length} active · {items.length} total
            </span>
          </div>
          {loading ? (
            <p className="p-4 text-[12px] m-0" style={{ color: "var(--ink-faint)" }}>Loading…</p>
          ) : items.length === 0 ? (
            <EmptyState icon={<span>∅</span>} title="No exceptions recorded"
              body="Nothing has been priced below the floor. That is the normal state." />
          ) : (
            <div className="divide-y" style={{ borderColor: "var(--line-soft)" }}>
              {items.map((e) => (
                <div key={e.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mono text-[12px] font-semibold">{e.caseNumber}</span>
                    <span className="text-[12px]">{e.customer}</span>
                    <Chip tone={e.expired ? "slate" : "coral"}>{e.expired ? "expired" : daysInForce(e)}</Chip>
                    {e.rateDeltaBps !== 0 && (
                      <span className="mono text-[12px]" style={{ color: "var(--mint)" }}>
                        {e.rateDeltaBps > 0 ? "+" : ""}{e.rateDeltaBps} bps
                      </span>
                    )}
                    {e.feeWaive && <Chip tone="mint">fee waived</Chip>}
                    {!e.expired && (
                      <button className="btn btn-ghost btn-xs ml-auto" onClick={() => endNow(e.id)}>End now</button>
                    )}
                  </div>
                  <p className="text-[11.5px] m-0 mt-1" style={{ color: "var(--ink-dim)" }}>{e.reason}</p>
                  <p className="text-[10.5px] m-0 mt-0.5" style={{ color: "var(--ink-faint)" }}>
                    raised by {e.createdBy} · approved by {e.approvedBy} · {fmtDate(e.validFrom)} → {fmtDate(e.validTo)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-4 space-y-3">
          <h3 className="font-disp font-semibold text-[13.5px] m-0">New exception</h3>
          <div>
            <label className="label">Case</label>
            <select className="select" value={form.caseId} onChange={(e) => setForm({ ...form, caseId: e.target.value })}>
              <option value="">Choose a case…</option>
              {cases.filter((c) => c.caseStatus === "Active").map((c) => (
                <option key={c.id} value={c.id}>{c.caseNumber} — {c.customer}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Rate change (bps)</label>
              <input className="input input-sm mono" inputMode="numeric" placeholder="-25"
                value={form.rateDeltaBps} onChange={(e) => setForm({ ...form, rateDeltaBps: e.target.value })} />
            </div>
            <div>
              <label className="label">Expires</label>
              <input type="date" className="input input-sm" value={form.validTo}
                onChange={(e) => setForm({ ...form, validTo: e.target.value })} />
            </div>
          </div>
          <label className="chip" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={form.feeWaive}
              onChange={(e) => setForm({ ...form, feeWaive: e.target.checked })} className="mr-1" />
            waive the processing fee on this deal
          </label>
          <div>
            <label className="label">Reason (mandatory)</label>
            <textarea className="input input-sm w-full" rows={2} placeholder="Why is this deal priced below the floor?"
              value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </div>
          <div>
            <label className="label">Second approver (not you)</label>
            <select className="select" value={form.approvedBy} onChange={(e) => setForm({ ...form, approvedBy: e.target.value })}>
              <option value="">Choose…</option>
              {users.filter((u) => u.name !== me?.name).map((u) => (
                <option key={u.id} value={u.name}>{u.name} · {u.role}</option>
              ))}
            </select>
          </div>
          {/* the requirements as a live checklist, not a wall of errors afterwards */}
          <div className="rounded p-2.5 space-y-1" style={{ background: "var(--bg2)" }}>
            {checks.map((c) => (
              <div key={c.label} className="text-[11px] flex items-start gap-1.5">
                <span style={{ color: c.ok ? "var(--mint)" : "var(--ink-faint)" }}>{c.ok ? "✓" : "○"}</span>
                <span style={{ color: c.ok ? "var(--ink-dim)" : "var(--ink-faint)" }}>{c.label}</span>
              </div>
            ))}
          </div>
          <button className="btn btn-primary btn-sm w-full justify-center" onClick={save} disabled={!canSave || busy}>
            {busy ? "Creating…" : "Create exception"}
          </button>
        </div>
      </div>
    </div>
  );
}
