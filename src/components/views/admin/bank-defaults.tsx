// Admin → Pricing → Bank defaults.
//
// The inherited layer. Almost every "constant" lives here rather than on 59 product
// rows: max tenor was identical across 14/14 of our banks, and stress buffer is one
// number per bank. A product that disagrees sets its own value and is badged
// OVERRIDDEN, so changing a default here cannot silently move an unknown number of
// products.
//
// The fields here were MEASURED, not guessed: `dbrPct`, `cardRulePct`, `bonusPct`,
// `rentalIncomePct`, `maxAgeSalaried` and `serviceMonthsMin` were all recorded on
// ZERO of 76 products, so the engine was silently falling back to hardcoded defaults
// for every one of them. Filling them in here is the highest-value content work
// available — each one is a real rule the bank publishes and the engine obeys.
"use client";

import { useCallback, useEffect, useState } from "react";
import { Chip } from "@/components/hfmc/ui";
import { fmtDateTime, todayISO } from "@/lib/format";

interface BankDefaults {
  id: number;
  name: string;
  logoData?: unknown;
  // identity
  ratePct: number;
  posPoints: string;
  negPoints: string;
  // the inherited numeric defaults
  defaultProcessingFeePct: number | null;
  maxTenorYears: number | null;
  maxLtvNational: number | null;
  maxLtvExpatriate: number | null;
  minSalaryAed: number | null;
  totalTatDays: number | null;
  paTatDays: number | null;
  stressBufferPct: number | null;
  cardRulePct: number | null;
  bonusPct: number | null;
  rentalIncomePct: number | null;
  maxAgeSalaried: number | null;
  maxAgeSelfEmp: number | null;
  serviceMonthsMin: number | null;
  firstPropertyOnly: boolean;
  // what the bank offers, as a SET
  offersIslamic: boolean;
  offersConventional: boolean;
  /** When a human last confirmed these defaults with the bank (ISO date, "" = never).
   *  An un-confirmed "constant" is a guess, so an empty value renders as ⚠. */
  defaultsVerifiedAt: string;
  // how many products override each field — the blast radius of a change here
  overrides: Record<string, number>;
  productCount: number;
}

/** field key on the API -> how it is labelled and typed */
const FIELDS: { key: keyof BankDefaults; label: string; unit?: string; hint?: string; group: string }[] = [
  { key: "defaultProcessingFeePct", label: "Default processing fee", unit: "%", group: "Fees", hint: "products may override — e.g. off-plan" },
  { key: "stressBufferPct", label: "Stress buffer", unit: "%", group: "Fees", hint: "added to the follow-on rate for the DSR test (DBR 3)" },
  { key: "cardRulePct", label: "Card limits counted", unit: "%", group: "Affordability", hint: "share of credit-card limits added to DBR" },
  { key: "bonusPct", label: "Bonus counted", unit: "%", group: "Affordability" },
  { key: "rentalIncomePct", label: "Rental counted", unit: "%", group: "Affordability" },
  { key: "maxLtvNational", label: "Max LTV — UAE National", unit: "%", group: "Limits" },
  { key: "maxLtvExpatriate", label: "Max LTV — Expatriate", unit: "%", group: "Limits" },
  { key: "minSalaryAed", label: "Min. monthly salary", unit: "AED", group: "Limits" },
  { key: "maxTenorYears", label: "Max tenure", unit: "years", group: "Limits" },
  { key: "maxAgeSalaried", label: "Age at maturity — salaried", unit: "yrs", group: "Limits" },
  { key: "maxAgeSelfEmp", label: "Age at maturity — self-employed", unit: "yrs", group: "Limits" },
  { key: "serviceMonthsMin", label: "Min. service with employer", unit: "months", group: "Limits" },
  { key: "totalTatDays", label: "Total TAT", unit: "working days", group: "Timeline" },
  { key: "paTatDays", label: "Pre-approval TAT", unit: "working days", group: "Timeline" },
];

const GROUPS = ["Fees", "Affordability", "Limits", "Timeline"];

export function BankDefaults({ onToast }: { onToast: (t: "success" | "error" | "info", m: string) => void }) {
  const [items, setItems] = useState<BankDefaults[]>([]);
  const [editing, setEditing] = useState<BankDefaults | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/bank-defaults");
      if (res.ok) setItems(((await res.json()) as { items: BankDefaults[] }).items ?? []);
    } catch { /* leave the list as-is rather than blanking it */ } finally { setLoading(false); }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch; the setStates are inside an async callback, not the effect body
  useEffect(() => { void load(); }, [load]);

  const startEdit = (b: BankDefaults) => {
    setEditing(b);
    setReason("");
    const d: Record<string, string> = {};
    for (const f of FIELDS) {
      const v = b[f.key];
      d[f.key] = v == null ? "" : String(v);
    }
    // seeded separately: it is not a numeric default, so it is not in FIELDS
    d.defaultsVerifiedAt = b.defaultsVerifiedAt ?? "";
    d.posPoints = b.posPoints ?? "";
    d.negPoints = b.negPoints ?? "";
    setDraft(d);
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/bank-defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editing.id, reason: reason.trim(), ...draft }),
      });
      const j = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) { onToast("error", j.error ?? "Could not save."); return; }
      const affected = Object.values(editing.overrides ?? {}).reduce((s, n) => s + n, 0);
      onToast("success", affected
        ? `${editing.name} saved — ${affected} product override${affected === 1 ? "" : "s"} still win over these.`
        : `${editing.name} defaults saved.`);
      setEditing(null);
      await load();
    } catch { onToast("error", "Could not save."); } finally { setBusy(false); }
  };

  if (loading) return <div className="card p-8 text-center text-[13px]" style={{ color: "var(--ink-faint)" }}>Loading bank defaults…</div>;

  return (
    <div className="space-y-4 anim-fade-up">
      <div className="card p-4" style={{ borderLeft: "3px solid var(--mint)" }}>
        <h3 className="font-disp font-semibold text-[14px] m-0">Bank defaults</h3>
        <p className="text-[12px] m-0 mt-1" style={{ color: "var(--ink-dim)" }}>
          The layer every product inherits. A product that disagrees sets its own value and is badged
          {" "}<strong>overridden</strong> — so changing a default here never silently moves a product that
          meant something different. Six of these fields were recorded on <em>zero</em> products before, so the
          engine was quietly guessing them.
        </p>
      </div>

      {editing && (
        <div className="card p-4" style={{ borderColor: "var(--amber)" }}>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="font-disp font-semibold text-[13.5px]">{editing.name}</span>
            <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
              {editing.productCount} product{editing.productCount === 1 ? "" : "s"} · commission {editing.ratePct}%
            </span>
            <button className="btn btn-ghost btn-sm ml-auto" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
          </div>
          {GROUPS.map((g) => (
            <div key={g} className="mb-3">
              <div className="text-[10.5px] uppercase tracking-[0.08em] font-semibold mb-1.5" style={{ color: "var(--ink-faint)" }}>{g}</div>
              <div className="rf-form-grid-sm">
                {FIELDS.filter((f) => f.group === g).map((f) => {
                  const n = editing.overrides?.[f.key] ?? 0;
                  return (
                    <label key={f.key} className="flex flex-col gap-1">
                      <span className="text-[10.5px] text-[var(--ink-faint)] font-semibold">
                        {f.label}{f.unit ? ` (${f.unit})` : ""}
                        {n > 0 && <span style={{ color: "var(--amber)" }}> · {n} override{n > 1 ? "s" : ""}</span>}
                      </span>
                      <input className="input input-sm mono" inputMode="decimal" placeholder="inherit"
                        value={draft[f.key] ?? ""}
                        onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
                      {f.hint && <span className="text-[9.5px]" style={{ color: "var(--ink-faint)" }}>{f.hint}</span>}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-end gap-3 mt-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] text-[var(--ink-faint)] font-semibold">Confirmed with the bank on</span>
              <input type="date" className="input input-sm" value={draft.defaultsVerifiedAt ?? ""}
                onChange={(e) => setDraft({ ...draft, defaultsVerifiedAt: e.target.value })} />
            </label>
            {/* Positives / watch-outs. These live on BankItem (per bank, not per
                product) and were READ-ONLY everywhere — the proposal and the
                product sheet showed them, but no screen could edit them, so they
                were only ever populated by the seed. Internal-only: /api/proposal
                sends them when mode === "internal" and never to a client. */}
            <label className="flex flex-col gap-1 flex-1 min-w-[220px]">
              <span className="text-[10.5px] text-[var(--ink-faint)] font-semibold">
                <span style={{ color: "var(--mint)" }}>Strengths</span> — what to negotiate for (internal only)
              </span>
              <input className="input input-sm" value={draft.posPoints ?? ""} placeholder="e.g. fast approvals on salary transfer"
                onChange={(e) => setDraft({ ...draft, posPoints: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 flex-1 min-w-[220px]">
              <span className="text-[10.5px] text-[var(--ink-faint)] font-semibold">
                <span style={{ color: "var(--coral)" }}>Watch-outs</span> — known friction (internal only)
              </span>
              <input className="input input-sm" value={draft.negPoints ?? ""} placeholder="e.g. slow on non-STL, valuation outsourced"
                onChange={(e) => setDraft({ ...draft, negPoints: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 flex-1 min-w-[200px]">
              <span className="text-[10.5px] text-[var(--ink-faint)] font-semibold">Reason (required)</span>
              <input className="input input-sm" placeholder="e.g. confirmed with RM, Sep card" value={reason}
                onChange={(e) => setReason(e.target.value)} />
            </label>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={busy || !reason.trim()}>
              {busy ? "Saving…" : "Save defaults"}
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="overflow-x-auto">
          <table className="tbl w-full">
            <thead>
              <tr>
                <th>Bank</th>
                <th className="text-right">Processing</th>
                <th className="text-right">Max LTV exp</th>
                <th className="text-right">Min salary</th>
                <th className="text-right">Max tenor</th>
                <th className="text-right">Stress buffer</th>
                <th className="text-right">Offers</th>
                <th className="text-right">Last confirmed</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((b) => {
                const ov = b.overrides ?? {};
                const cell = (v: number | null, field: string, suffix = "") => (
                  <span className="mono">
                    {v == null ? <span style={{ color: "var(--ink-faint)" }}>inherit</span> : `${v.toLocaleString()}${suffix}`}
                    {ov[field] ? <sup style={{ color: "var(--amber)" }} title={`${ov[field]} product(s) override this`}>*</sup> : null}
                  </span>
                );
                return (
                  <tr key={b.id}>
                    <td className="whitespace-nowrap font-medium">{b.name}</td>
                    <td className="text-right">{cell(b.defaultProcessingFeePct, "defaultProcessingFeePct", "%")}</td>
                    <td className="text-right">{cell(b.maxLtvExpatriate, "maxLtvExpatriate", "%")}</td>
                    <td className="text-right">{cell(b.minSalaryAed, "minSalaryAed")}</td>
                    <td className="text-right">{cell(b.maxTenorYears, "maxTenorYears", "y")}</td>
                    <td className="text-right">{cell(b.stressBufferPct, "stressBufferPct", "%")}</td>
                    <td className="text-right whitespace-nowrap text-[11px]">
                      {b.offersIslamic ? "Islamic " : ""}{b.offersConventional ? "Conventional" : ""}
                      {!b.offersIslamic && !b.offersConventional ? <span style={{ color: "var(--ink-faint)" }}>—</span> : null}
                    </td>
                    <td className="text-right text-[11px]">
                      {b.defaultsVerifiedAt
                        ? <span style={{ color: "var(--ink-dim)" }}>{b.defaultsVerifiedAt}</span>
                        : <span style={{ color: "var(--amber)" }} title="Nobody has confirmed these defaults with the bank">⚠ never</span>}
                    </td>
                    <td className="text-right">
                      <button className="btn btn-ghost btn-xs" onClick={() => startEdit(b)}>edit</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[10.5px] px-4 py-2 m-0" style={{ color: "var(--ink-faint)" }}>
          <sup style={{ color: "var(--amber)" }}>*</sup> = some products override this value, so they keep their own.
          {" "}&quot;inherit&quot; means no bank default is set — the engine uses the UAE norm. DBR 50% and VAT 5% are law, not here.
        </p>
      </div>
    </div>
  );
}

