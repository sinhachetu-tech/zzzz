// Rate Cards — the admin's pricing grid.
//
// A ROW IS A CARD, not a rate. A bank moves a rate, the follow-on margin, a floor
// and a processing fee together, and a broker reads them together — but they used to
// live in pricingJson, feesJson and a 900-line modal. Putting all four on one line
// is what makes pricing comprehensible.
//
// Read and write are the SAME grid: you are already looking at the number, so you
// click it and type. Editing is ONE FIELD AT A TIME by default, because banks very
// often send a new rate and nothing else; "move the whole card" is opt-in.
//
// Two things make the hierarchy safe rather than dangerous:
//   · an INHERITED / OVERRIDDEN badge on every field, so you can tell a default
//     from a one-off, and changing a default cannot silently move 400 products
//   · a volatility dot per column (coral monthly · amber yearly · mint negotiated),
//     so attention goes where it belongs instead of being spread evenly
//
// The grid is styled to be READ first: identity on the row, four numbers in the
// order a broker thinks (what they pay → what they pay after → what qualifies →
// what protects them), and colour reserved for things that are actually wrong.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, Modal } from "@/components/hfmc/ui";
import type { RateCard, PricingFloor } from "@/lib/bank-pricing";
import { MasterAxesPanel, MasterCreatePanel, type MasterTarget } from "@/components/views/admin/master-axes";
import { todayISO } from "@/lib/format";

export type CardFieldKey = "ratePct" | "followOn" | "floorPct" | "processingFeePct";

interface BankView {
  id: number; name: string; logoUrl: string | null;
  commissionPct: number;
  defaultsVerifiedAt: string;
  offersIslamic: boolean; offersConventional: boolean;
  defaultProcessingFeePct: number | null;
  stressBufferPct: number | null;
  maxTenorYears: number | null;
}

interface DeskData {
  cards: RateCard[];
  banks: BankView[];
  eibor: Record<string, number>;
  floor: PricingFloor;
  law: { maxDbrPct: number; vatPct: number; earlySettlementPctCap: number; earlySettlementAedCap: number };
  counts: { total: number; attention: number; warnings: number; noFloor: number };
}

const pct = (v: number | null, dp = 2) => (v == null ? "—" : `${v.toFixed(dp)}%`);

/**
 * How often a field moves — monthly / yearly / only on negotiation.
 *
 * A 6px tonal dot, not an emoji. Three emoji circles over three ordinary rate
 * columns read as three alarms, and if red is decoration then red stops meaning
 * anything. `high` is coral because a monthly-moving number deserves a glance,
 * not because it is an error.
 */
const VOL_COLOR: Record<string, string> = { high: "var(--coral)", medium: "var(--amber)", low: "var(--mint)" };
/** Freshness of a confirmation — a different question from volatility, so a
 *  different scale: grey means "nobody has ever checked", not "stable". */
const FRESH_COLOR: Record<string, string> = {
  fresh: "var(--mint)", aging: "var(--amber)", stale: "var(--coral)", never: "var(--ink-faint)",
};

function Dot({ color, faint }: { color: string | undefined; faint?: boolean }) {
  return (
    <span
      className="inline-block w-[6px] h-[6px] rounded-full align-middle"
      style={{ background: color ?? "var(--ink-faint)", opacity: faint ? 0.45 : 1 }}
      aria-hidden
    />
  );
}

/**
 * Everything wrong with a row, collapsed to one marker.
 *
 * A row can carry four issues (no rate, no floor, no stress rule, stale) and each
 * used to render as its own chip — so a mediocre row pushed its own actions off the
 * right edge of the table and the eye had to re-find the buttons every line. One
 * marker with the full list in the tooltip keeps the column width stable and the
 * severity readable in a glance: coral = will misprice, amber = soft.
 */
function RowFlags({ issues, exclusive }: { issues: RateCard["issues"]; exclusive: boolean }) {
  if (!issues.length && !exclusive) return null;
  const worst = issues.some((i) => i.severity === "error") ? "var(--coral)" : "var(--amber)";
  const detail = issues.length
    ? issues.map((i) => (i.severity === "error" ? "!! " : "! ") + i.label).join(" · ")
    : "exclusive to a developer promotion";
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] whitespace-nowrap"
      style={{ color: worst }}
      title={detail}
    >
      <Dot color={worst} />
      <span>
        {issues.length ? (issues.length > 1 ? `${issues.length} flags` : issues[0].label) : "exclusive"}
      </span>
    </span>
  );
}

/** Column-group hairline. Applies-to | pricing | protection | status: the boundary
 *  shows up only between groups, not between every column, so it partitions the row
 *  without turning the table into a lattice. */
const GRP = { borderLeft: "1px solid var(--line-soft)" };

const FIELD_LABEL: Record<CardFieldKey, string> = {
  ratePct: "Interest rate",
  followOn: "After the fixed period",
  floorPct: "Minimum rate",
  processingFeePct: "Processing fee",
};

export function RateCards({ onToast }: { onToast: (t: "success" | "error" | "info", m: string) => void }) {
  const [d, setD] = useState<DeskData | null>(null);
  // Default to ONE bank, not all: pricing work happens per bank, and starting on
  // "All banks" rendered 218 cards across 14 families — nobody reads 218 rows,
  // and an edit made while looking at 14 cards is a mistake you can see coming.
  // Persisted per admin so a reload lands where they left off.
  const [bank, setBank] = useState(() => {
    try { return localStorage.getItem("rate-cards-bank") ?? "ALL"; }
    catch { return "ALL"; }
  });
  // pickBank is called only from event handlers and load()-after-create — never
  // during render, so the lint rule about declaring it inline is a false alarm
  // (inlining it into the select would move unrelated state updates into render).
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [editing, setEditing] = useState<{ card: RateCard; field: CardFieldKey } | null>(null);
  // Stress is a RULE (kind + number), not a price, so it cannot share the numeric
  // EditPanel — a flat 5.88% and a follow-on+2% are not the same kind of input.
  const [stressEdit, setStressEdit] = useState<RateCard | null>(null);
  // Bulk: which cards are checked for a batch change. Keyed by card key.
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  // Slot close/reopen: which card, and which direction. Close needs a REASON for
  // the slot itself (why the bank doesn't offer it) plus the audit reason.
  const [slotEdit, setSlotEdit] = useState<{ card: RateCard; action: "close" | "reopen" } | null>(null);
  // Verify: stamp that a human confirmed the line(s) with the bank today. Not a
  // price change — it records that the price was CHECKED, which is the only
  // defence against a two-year-old note still quoting a client.
  const [verify, setVerify] = useState<{ card: RateCard; all: RateCard[] } | null>(null);
  // Axes: which card's transaction/term/rate-type/STL the "Applies to" cell opened.
  // WHO a price applies to is as editable as WHAT it is — an uneditable label would
  // freeze every mis-filed axis in place.
  const [axesEdit, setAxesEdit] = useState<RateCard | null>(null);
  // Master: which master's pinned axes (employment, residency, type) the header opened.
  // The NAME is derived from the axes and shown read-only beside them.
  const [masterEdit, setMasterEdit] = useState<MasterTarget | null>(null);
  // New master: a bank + pinned axes, rendered declarative — the row exists
  // because the admin declared it, not because an import left product rows behind.
  const [masterCreate, setMasterCreate] = useState<{ bankId: number | null; bankName: string } | null>(null);
  // Which master's product the "+ Add row" button is opening. A master can hold
  // several product rows, so the target must be carried on the state object —
  // guessing from rows[0] would add the rate line to the wrong product.
  const [addRow, setAddRow] = useState<{ bankProductId: number; bankName: string; productName: string } | null>(null);
  const [loading, setLoading] = useState(true);

  // pickBank commits a bank choice. Declared BEFORE load() because load-after-
  // create calls it, and declared with useCallback so its identity is stable.
  const pickBank = useCallback((name: string) => {
    setBank(name);
    setSel(new Set());
    try { localStorage.setItem("rate-cards-bank", name); } catch { /* ignore */ }
  }, []);

  const load = useCallback(async (focusProductId?: number) => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/rate-desk");
      if (!res.ok) throw new Error("load failed");
      const next = await res.json() as DeskData;
      setD(next);
      // After creating a master, land on the bank that now owns it — otherwise
      // the new row is created silently and the grid shows a different bank.
      if (focusProductId != null) {
        const owner = next.cards.find((c) => c.bankProductId === focusProductId)?.bankName;
        if (owner) pickBank(owner);
      }
    } catch {
      onToast("error", "Could not load the rate cards.");
    } finally {
      setLoading(false);
    }
  }, [onToast, pickBank]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch; the setStates are inside an async callback, not the effect body
  useEffect(() => { void load(); }, [load]);

  // Once the bank list arrives, default to the first bank — but ONLY when
  // the admin has never chosen. A saved choice (or an explicit "All banks")
  // always wins; this runs once per data load, not on every render, and it must
  // not fight pickBank() after a master is created.
  const bankDefaulted = useMemo(() => {
    if (bank !== "ALL") return bank;
    const names = (d?.banks ?? []).map((b) => b.name);
    if (!names.length) return "ALL";
    try {
      const saved = localStorage.getItem("rate-cards-bank");
      if (saved && (saved === "ALL" || names.includes(saved))) return saved;
    } catch { /* private window — fall through to the first bank */ }
    return names[0];
  }, [d, bank]);

  const cards = useMemo(() => {
    const all = d?.cards ?? [];
    return all.filter((c) => {
      if (bankDefaulted !== "ALL" && c.bankName !== bankDefaulted) return false;
      if (onlyIssues && !c.issues.length) return false;
      return true;
    });
  }, [d, bankDefaulted, onlyIssues]);

  // MASTER grouping: the pinned axes are the family identity, not the free-text
  // product name. Bank 1 has ~10 products all called "Salaried · Resident ·
  // Conventional" with cosmetic differences — grouping by name splits one true
  // master into fake families. The name becomes a subtitle inside the group.
  const groups = useMemo(() => {
    const m = new Map<string, RateCard[]>();
    for (const c of cards) {
      const k = `${c.bankId}|${c.employment}||${c.residency}||${c.mortgageType}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(c);
    }
    return [...m.entries()];
  }, [cards]);

  if (loading && !d) {
    return <div className="card p-8 text-center text-[13px]" style={{ color: "var(--ink-faint)" }}>Loading rate cards…</div>;
  }

  const banks = d?.banks ?? [];

  return (
    <div className="space-y-4 anim-fade-up">
      {/* ---- KPI strip: what needs a human ---- */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="kpi"><div className="kpi-label">Live cards</div><div className="kpi-value">{d?.counts.total ?? 0}</div></div>
        <div className="kpi"><div className="kpi-label">Missing a rate</div>
          <div className="kpi-value" style={{ color: d?.counts.attention ? "var(--coral)" : undefined }}>{d?.counts.attention ?? 0}</div></div>
        <div className="kpi"><div className="kpi-label">No minimum rate</div>
          <div className="kpi-value" style={{ color: "var(--amber)" }}>{d?.counts.noFloor ?? 0}</div>
          <div className="kpi-sub">the floor stops EIBOR going too low</div></div>
        <div className="kpi kpi-accent">
          <div className="kpi-label">EIBOR 3M</div>
          <div className="kpi-value" style={{ fontSize: 18 }}>{d?.eibor?.["3M"] != null ? `${d.eibor["3M"]}%` : "—"}</div>
          <div className="kpi-sub">live · never typed by us</div>
        </div>
      </div>

      {/* ---- filters + the law strip ---- */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: "var(--line-soft)" }}>
          <select className="select !w-auto" value={bankDefaulted} onChange={(e) => pickBank(e.target.value)}>
            <option value="ALL">All banks</option>
            {banks.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={() => setMasterCreate({ bankId: null, bankName: bankDefaulted === "ALL" ? "" : bankDefaulted })}>
            + New master
          </button>
          <label className="chip" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={onlyIssues} onChange={(e) => { setOnlyIssues(e.target.checked); setSel(new Set()); }} className="mr-1" />
            needs attention
          </label>
          <span className="ml-auto text-[11px]" style={{ color: "var(--ink-faint)" }}>
            {cards.length} card{cards.length === 1 ? "" : "s"} · {groups.length} master{groups.length === 1 ? "" : "s"}
          </span>
        </div>
        {/* Law, not settings. Shown so nobody wonders why DBR is 50% or where VAT
            comes from — these are the CBUAE/UAE constants the engine applies. */}
        <div className="flex flex-wrap gap-x-5 gap-y-1 px-4 py-2 text-[11px]" style={{ color: "var(--ink-faint)", borderBottom: "1px solid var(--line-soft)" }}>
          <span><strong style={{ color: "var(--ink-dim)" }}>Law</strong> · DBR ceiling {d?.law.maxDbrPct ?? 50}% · VAT {d?.law.vatPct ?? 5}% on bank fees · early settlement 1% or AED 10,000</span>
          <span className="ml-auto inline-flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5"><Dot color={VOL_COLOR.high} /> monthly</span>
            <span className="inline-flex items-center gap-1.5"><Dot color={VOL_COLOR.medium} /> yearly</span>
            <span className="inline-flex items-center gap-1.5"><Dot color={VOL_COLOR.low} /> on negotiation</span>
          </span>
        </div>
      </div>

      {/*
        A batches bar rather than a modal: the admin is mid-way through selecting
        cards, so the count and the action must stay on screen while they keep
        scanning the grid.
      */}
      {sel.size > 0 && !bulkOpen && (
        <div className="card px-4 py-2.5 flex flex-wrap items-center gap-3 anim-fade-up"
          style={{ borderColor: "var(--amber)", borderLeft: "3px solid var(--amber)" }}>
          <span className="text-[12.5px] font-medium">{sel.size} card{sel.size === 1 ? "" : "s"} selected</span>
          <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
            across {new Set(cards.filter((c) => sel.has(c.key)).map((c) => c.bankProductId)).size} product(s)
          </span>
          <button className="btn btn-primary btn-sm ml-auto" onClick={() => setBulkOpen(true)}>
            Change all {sel.size} together
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      {groups.length === 0 ? (
        <EmptyState icon={<span>∅</span>} title="No rate cards match" body="Clear the filters, or import a policy in Admin → Bank Rules." />
      ) : (
        <div className="space-y-3">
          {groups.map(([key, rows]) => (
            <CardGroup key={key} master={{
              employment: rows[0].masterEmployment || rows[0].employment,
              residency: rows[0].masterResidency || rows[0].residency,
              mortgageType: rows[0].masterMortgageType || rows[0].mortgageType,
              financeType: rows[0].masterFinanceType || "Residential",
              productNames: [...new Set(rows.map((r) => r.productName))],
            }} rows={rows} bankView={banks.find((b) => b.name === rows[0].bankName)}
              onEdit={(c, f) => setEditing({ card: c, field: f })}
              onStress={(c) => { setEditing(null); setStressEdit(c); }}
              onSlot={(c, a) => setSlotEdit({ card: c, action: a })}
              onVerify={(c, all) => setVerify({ card: c, all: all ?? [c] })}
              onAxes={(c) => setAxesEdit(c)}
              onMaster={() => setMasterEdit({
                bankId: rows[0].bankId, bankName: rows[0].bankName,
                employment: rows[0].masterEmployment || rows[0].employment,
                residency: rows[0].masterResidency || rows[0].residency,
                mortgageType: rows[0].masterMortgageType || rows[0].mortgageType,
                financeType: rows[0].masterFinanceType || "Residential",
                productIds: [...new Set(rows.map((r) => r.bankProductId))],
                productNames: [...new Set(rows.map((r) => r.productName))],
              })}
              onAddRow={() => setAddRow({
                // first NON-closed row's product — a master can span product rows,
                // and the new rate line must land on the one that owns the family
                bankProductId: (rows.find((r) => r.slotState !== "CLOSED") ?? rows[0]).bankProductId,
                bankName: rows[0].bankName,
                productName: (rows.find((r) => r.slotState !== "CLOSED") ?? rows[0]).productName,
              })}
              sel={sel}
              onToggle={(key) => setSel((prev) => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })} />
          ))}
        </div>
      )}

      {editing && (
        <Modal title={`${FIELD_LABEL[editing.field]} — ${editing.card.bankName}`} sub={editing.card.productName}
          onClose={() => setEditing(null)} width={520}>
          <EditPanel
            card={editing.card}
            field={editing.field}
            onClose={() => setEditing(null)}
            onToast={onToast}
            onSaved={load}
            bare
          />
        </Modal>
      )}

      {stressEdit && (
        <Modal title={`Qualifying rate (DBR 3) — ${stressEdit.bankName}`} sub={stressEdit.productName}
          onClose={() => setStressEdit(null)} width={560}>
          <StressPanel card={stressEdit} onClose={() => setStressEdit(null)} onToast={onToast} onSaved={load} bare />
        </Modal>
      )}

      {slotEdit && (
        <Modal title={slotEdit.action === "close" ? "Close this slot" : "Reopen this slot"}
          sub={`${slotEdit.card.bankName} · ${slotEdit.card.productName}`}
          onClose={() => setSlotEdit(null)} width={520}>
          <SlotPanel card={slotEdit.card} action={slotEdit.action}
            onClose={() => setSlotEdit(null)} onToast={onToast} onSaved={load} bare />
        </Modal>
      )}

      {verify && (
        <Modal title="Confirm with the bank" sub="this records a check, it does not change a price"
          onClose={() => setVerify(null)} width={560}>
          <VerifyPanel card={verify.card} all={verify.all}
            onClose={() => setVerify(null)} onToast={onToast} onSaved={load} bare />
        </Modal>
      )}

      {axesEdit && (
        <Modal title="Who this price applies to" sub={`${axesEdit.bankName} · ${axesEdit.productName} — the rate itself does not move`}
          onClose={() => setAxesEdit(null)} width={600}>
          <SlotAxesPanel card={axesEdit}
            onClose={() => setAxesEdit(null)} onToast={onToast} onSaved={load} bare />
        </Modal>
      )}

      {bulkOpen && (
        <Modal title={`Change ${cards.filter((c) => sel.has(c.key)).length} cards together`}
          sub="applied all-or-nothing — a partial repricing is worse than none"
          onClose={() => setBulkOpen(false)} width={640}>
          <BulkPanel
            cards={cards.filter((c) => sel.has(c.key))}
            onClose={() => setBulkOpen(false)}
            onToast={onToast}
            onSaved={() => { setBulkOpen(false); setSel(new Set()); return load(); }}
            bare
          />
        </Modal>
      )}

      {masterEdit && (
        <Modal title={`Master axes — ${masterEdit.bankName}`} sub={`${masterEdit.productIds.length} product row(s) share these axes`}
          onClose={() => setMasterEdit(null)} width={560}>
          <MasterAxesPanel master={masterEdit}
            onClose={() => setMasterEdit(null)} onToast={onToast} onSaved={load} bare />
        </Modal>
      )}

      {addRow && (
        <Modal title="Add a rate row" sub="the axes are filed now; the price is filed separately"
          onClose={() => setAddRow(null)} width={600}>
          <AddRowPanel
            bankProductId={addRow.bankProductId}
            bankName={addRow.bankName}
            productName={addRow.productName}
            onClose={() => setAddRow(null)}
            onToast={onToast}
            onSaved={load}
          />
        </Modal>
      )}

      {masterCreate && (
        <Modal title="New master" sub="One bank, one family of rules — the name is derived from the axes"
          onClose={() => setMasterCreate(null)} width={560}>
          <MasterCreatePanel banks={banks} initial={masterCreate}
            onClose={() => setMasterCreate(null)} onToast={onToast}
            onSaved={async (createdId) => {
              setMasterCreate(null);
              await load(createdId);
            }} />
        </Modal>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- the grid -- */

/**
 * A resolved field with its context.
 *
 * The marker is on the OVERRIDDEN value, not the inherited one — that inversion is
 * what makes "hidden unless necessary" work. Inheritance is the quiet default (it is
 * what the bank gave us); an override is an exception a human typed by hand, and an
 * exception you cannot spot is one nobody can audit. Where the value came from is
 * still one hover away, so the blast radius of editing a bank default is discoverable
 * without being shouted in every cell.
 */
function Cell({ card, field, label, volatility, onEdit }: {
  card: RateCard; field: CardFieldKey; label: string; volatility: string; onEdit: () => void;
}) {
  const f = card[field];
  const override = f.overridden && f.value != null;
  const where = f.from === "product" ? "this row" : f.from === "bank" ? "the bank default" : "the UAE norm";
  const hint = override
    ? "override"
    : f.from !== "product" && f.value != null
      ? `from ${f.from === "bank" ? "bank" : "norm"}`
      : label;
  const detail = f.value == null
    ? label
    : override
      ? `${label} — this row differs from ${where} (${pct(f.parentValue)}); click to revise`
      : f.from !== "product"
        ? `${label} — inherited from ${where}; click to override this row`
        : `${label} — click to revise`;
  return (
    <button
      className="text-right w-full group"
      onClick={onEdit}
      title={detail}
    >
      <div className="mono text-[12.5px] group-hover:underline decoration-dotted underline-offset-4"
        style={{ color: f.value == null ? "var(--ink-faint)" : "var(--ink)" }}>
        {pct(f.value)}{override ? <sup style={{ color: "var(--amber)" }}>†</sup> : null}
      </div>
      <div className="text-[9.5px] leading-none flex items-center justify-end gap-1"
        style={{ color: override ? "var(--amber)" : "var(--ink-faint)" }}>
        <Dot color={override ? "var(--amber)" : VOL_COLOR[volatility]} />
        <span>{hint}</span>
      </div>
    </button>
  );
}

/**
 * DBR 3 — the rate the bank qualifies the client at.
 *
 * It is NOT a price, so it renders as a label rather than a percentage: "flat 5.88%"
 * and "follow-on +2%" are different rules, not different numbers. `none filed` is
 * amber because it means the client is being qualified at the follow-on rate with
 * no cushion at all — which is a real risk, not a cosmetic gap.
 */
function StressCell({ card, onEdit }: { card: RateCard; onEdit: () => void }) {
  const none = card.stress.kind === "NONE";
  return (
    <button
      className="text-right w-full group"
      onClick={onEdit}
      title="Qualifying rate (DBR 3) — this decides how much the client can borrow, not what they pay each month"
    >
      <div className="mono text-[12.5px] group-hover:underline decoration-dotted underline-offset-4"
        style={{ color: none ? "var(--amber)" : "var(--ink)" }}>
        {card.stress.label}
      </div>
      <div className="text-[9.5px] leading-none" style={{ color: none ? "var(--amber)" : "var(--ink-faint)" }}>
        {none ? "no cushion" : "DBR 3"}
      </div>
    </button>
  );
}

/** Freshness of a confirmation · mint confirmed · amber due · coral stale · grey never */
function VerifyCell({ card, onVerify }: { card: RateCard; onVerify: () => void }) {
  const v = card.verification;
  const tone = FRESH_COLOR[v.state] ?? "var(--ink-faint)";
  return (
    <button className="text-right w-full group" onClick={onVerify}
      title={`${v.note} — click to record that you confirmed this line with the bank today`}>
      <div className="text-[12.5px] group-hover:underline decoration-dotted underline-offset-4 flex items-center justify-end gap-1.5" style={{ color: tone }}>
        <Dot color={tone} />
        <span>{v.monthsAgo == null ? "never" : `${v.monthsAgo}mo`}</span>
      </div>
      <div className="text-[9.5px] leading-none" style={{ color: "var(--ink-faint)" }}>
        {v.state === "fresh" ? "verified" : v.state === "stale" ? "re-check" : v.state === "aging" ? "due soon" : "unconfirmed"}
      </div>
    </button>
  );
}

/**
 * WHO this price applies to, as one readable line.
 *
 * Four separate identity columns (Transaction / Term / STL / Profile) looked
 * "complete" but read as "Any · 3y · either · any" on most rows — because the
 * profile axis is NEVER filed (0 quotes in the database carry it) and 281 quotes
 * carry no transaction either. Columns for axes the data doesn't hold are worse
 * than no columns: they imply precision that isn't there.
 *
 * So: one composed cell showing ONLY what is actually filed, with the term as
 * the anchor (it is always filed and is the real differentiator). Absence reads
 * as absence — no "any" placeholders. Clicking opens the slot-axes editor, where
 * the full picture (including the gaps) is visible and editable.
 */
function appliesTo(c: RateCard): { main: string; sub: string | null } {
  const parts: string[] = [];
  if (c.transaction && c.transaction !== "Any") parts.push(c.transaction);
  parts.push(c.rateType === "FIXED" ? `${c.termYears ?? "?"}y fixed` : "variable day-1");
  if (c.salaryTransfer) parts.push(c.salaryTransfer);
  if (c.customerProfile) parts.push(c.customerProfile);
  const main = parts.join(" · ");
  // the EIBOR basis is context, not identity — ENBD prices off 1M, most off 3M,
  // and getting the tenor wrong silently reprices a reversion by ~16bps
  const sub = c.eiborBasis ? `${c.eiborBasis} EIBOR basis` : null;
  return { main, sub };
}

function AppliesToCell({ card, onEdit }: { card: RateCard; onEdit: () => void }) {
  const { main, sub } = appliesTo(card);
  return (
    <button className="text-left w-full group min-w-[150px]" onClick={onEdit}
      title="Who this price applies to — click to edit the transaction, term, rate type and STL axes">
      <div className="text-[12px] leading-tight group-hover:underline decoration-dotted underline-offset-4">{main}</div>
      {sub && <div className="text-[9.5px] leading-tight mt-0.5" style={{ color: "var(--ink-faint)" }}>{sub}</div>}
    </button>
  );
}

function CardGroup({ master, rows, bankView, onEdit, onStress, onSlot, onVerify, sel, onToggle, onAxes, onMaster, onAddRow }: {
  master: { employment: string; residency: string; mortgageType: string; financeType: string; productNames: string[] };
  rows: RateCard[];
  bankView?: BankView;
  onEdit: (c: RateCard, f: CardFieldKey) => void;
  onStress: (c: RateCard) => void;
  onSlot: (c: RateCard, action: "close" | "reopen") => void;
  onVerify: (c: RateCard, all?: RateCard[]) => void;
  /** Open the slot-axes editor for this card (transaction, term, rate type, STL). */
  onAxes: (c: RateCard) => void;
  /** Open the master-axes editor (employment, residency, type apply to every row in the family). */
  onMaster: () => void;
  /** Open the add-row dialog for THIS master's product. */
  onAddRow: () => void;
  sel: Set<string>;
  onToggle: (key: string) => void;
}) {
  const head = rows[0];
  const closedCount = rows.filter((r) => r.slotState === "CLOSED").length;
  const emptyCount = rows.filter((r) => r.slotState === "EMPTY").length;
  const flagged = rows.filter((r) => r.issues.length > 0).length;

  // MASTER header: the pinned axes ARE the title — this is what makes ten
  // identically-named products one family. The free-text names become a subtitle
  // listing which product rows feed the master, so a cosmetic name difference
  // never splits what is really one family again.
  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b" style={{ borderColor: "var(--line-soft)" }}>
        {bankView?.logoUrl ? (
          <img src={bankView.logoUrl} alt="" className="h-7 w-7 rounded object-contain" style={{ background: "var(--tint)" }} />
        ) : null}
        <div className="min-w-0">
          <button className="text-left group" onClick={onMaster}
            title="Edit the master axes (employment, residency, type) — applies to every row in this family">
            <span className="font-disp font-semibold text-[13.5px] leading-tight group-hover:underline decoration-dotted underline-offset-4">
              <span className="chip" style={{ marginRight: 6 }}>master</span>
              {head.bankName} · {[master.employment, master.residency, master.mortgageType, master.financeType !== "Residential" ? master.financeType : null].filter(Boolean).join(" · ") || "All clients"}
            </span>
          </button>
          <div className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
            {rows.length} row{rows.length === 1 ? "" : "s"}
            {flagged > 0 ? ` · ${flagged} need attention` : ""}
            {closedCount > 0 ? ` · ${closedCount} not offered` : ""}
            {emptyCount > 0 ? ` · ${emptyCount} missing a rate` : ""}
            {master.productNames.length > 1 ? ` · from ${master.productNames.length} product rows` : ""}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button className="btn btn-ghost btn-sm" onClick={onAddRow}
            title="Add another rate row to this master — e.g. a new transaction type or a second term">
            + Add row
          </button>
          <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--ink-faint)" }}>
            {bankView?.defaultsVerifiedAt
              ? <span title="When a human last confirmed this bank's defaults">defaults confirmed {bankView.defaultsVerifiedAt}</span>
              : <span style={{ color: "var(--amber)" }}>defaults never confirmed with the bank</span>}
            {bankView?.defaultProcessingFeePct != null && (
              <span className="chip" title="This bank's default processing fee — a product may override it">
                bank default {pct(bankView.defaultProcessingFeePct)}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        {/* One flat table per master: every ROW is a card, every number below is a
            COLUMN. The transaction/term/profile/STL identity lives on the row, not in
            the header — because a header can't hold six axes, and columns for every
            combination would explode into hundreds of empty cells. */}
        <table className="tbl w-full">
          <thead>
            <tr>
              <th style={{ width: 28, borderRight: "none" }}>
                <input
                  type="checkbox"
                  title="Select every card in this master for a batch change"
                  checked={rows.every((r) => sel.has(r.key))}
                  ref={(el) => {
                    // indeterminate = some but not all, which is the state that tells
                    // a reader "you already picked part of this group"
                    if (el) el.indeterminate = rows.some((r) => sel.has(r.key)) && !rows.every((r) => sel.has(r.key));
                  }}
                  onChange={(e) => {
                    for (const r of rows) {
                      const has = sel.has(r.key);
                      if (e.target.checked && !has) onToggle(r.key);
                      if (!e.target.checked && has) onToggle(r.key);
                    }
                  }}
                />
              </th>
              {/* Three column groups, separated by a hairline so the eye can tell WHO
                  from WHAT it costs from WHETHER it is sound. Reading across is now
                  possible without counting to the sixth column. */}
              <th style={GRP}>Applies to</th>
              {/* DBR 1 — what they pay, then DBR 2, DBR 3, in the order a broker thinks.
                  Volatility shows as a tonal dot on the column, not an emoji in the
                  header: three red circles over three ordinary numbers read as three
                  errors, and colour has to be reserved for things that are wrong. */}
              <th className="text-right whitespace-nowrap" style={GRP}>
                <span className="inline-flex items-center gap-1.5 justify-end">
                  <Dot color={VOL_COLOR.high} />
                  <span>DBR 1 · rate</span>
                </span>
              </th>
              <th className="text-right whitespace-nowrap" style={GRP}>
                <span className="inline-flex items-center gap-1.5 justify-end">
                  <Dot color={VOL_COLOR.high} />
                  <span>DBR 2 · after fixed</span>
                </span>
              </th>
              <th className="text-right whitespace-nowrap" style={GRP}>DBR 3 · qualifies at</th>
              <th className="text-right whitespace-nowrap" style={GRP}>
                <span className="inline-flex items-center gap-1.5 justify-end">
                  <Dot color={VOL_COLOR.medium} />
                  <span>Floor</span>
                </span>
              </th>
              <th className="text-right whitespace-nowrap" style={GRP}>
                <span className="inline-flex items-center gap-1.5 justify-end">
                  <Dot color={VOL_COLOR.medium} />
                  <span>Processing</span>
                </span>
              </th>
              <th className="text-right" style={GRP}>Verified</th>
              <th style={{ width: 168 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              // CLOSED is a deliberate fact, not missing data: greyed, struck through,
              // with the reason where a rate would be — and nothing clickable, because
              // there is nothing to edit. Reopening is the only action.
              if (c.slotState === "CLOSED") {
                const { main } = appliesTo(c);
                return (
                  <tr key={c.key} style={{ opacity: 0.62 }}>
                    <td>
                      <input type="checkbox" checked={sel.has(c.key)} onChange={() => onToggle(c.key)}
                        title="Select this card for a batch change" />
                    </td>
                    <td style={{ textDecoration: "line-through", color: "var(--ink-dim)" }}>{main}</td>
                    {/* 9 columns total: checkbox, applies-to, rate, follow-on, stress,
                        floor, processing, verified, actions → this spans the middle 5. */}
                    <td colSpan={5} className="text-[11.5px]" style={GRP}>
                      <span className="chip" style={{ color: "var(--ink-faint)" }}>not offered</span>{" "}
                      <span style={{ color: "var(--ink-dim)" }}>{c.closedReason ?? "no reason recorded"}</span>
                    </td>
                    <td className="text-right text-[11px]" style={{ color: "var(--ink-faint)" }}>—</td>
                    <td className="text-right whitespace-nowrap" style={{ width: 168 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => onSlot(c, "reopen")}>Reopen</button>
                    </td>
                  </tr>
                );
              }
              // EMPTY (no rate filed yet) is a chase-the-bank task, not a price. A bare
              // dash in an otherwise identical row reads as "0%" or as data loss — so the
              // row carries a dashed leading edge and a faint tint, and the label under
              // every number says what is missing rather than leaving a blank.
              const isOpen = c.slotState === "EMPTY";
              return (
              <tr key={c.key}
                style={{
                  ...(sel.has(c.key) ? { background: "var(--tint)" } : undefined),
                  ...(isOpen && !sel.has(c.key) ? { background: "color-mix(in srgb, var(--amber) 4%, transparent)" } : undefined),
                }}>
                <td style={isOpen ? { borderLeft: "2px dashed var(--amber)" } : undefined}>
                  <input type="checkbox" checked={sel.has(c.key)} onChange={() => onToggle(c.key)}
                    title="Select this card for a batch change" />
                </td>
                <td>
                  <AppliesToCell card={c} onEdit={() => onAxes(c)} />
                  {isOpen && (
                    <div className="text-[9.5px] leading-none mt-0.5" style={{ color: "var(--amber)" }}>
                      no rate filed yet
                    </div>
                  )}
                </td>
                {/* Every cell below is a real <td>. Cell/StressCell/VerifyCell used to be
                    bare <button>s sitting inside <tr> — invalid HTML that the browser
                    boxes unpredictably, which is why columns drifted out from under their
                    headers on a wide table. */}
                <td style={GRP}><Cell card={c} field="ratePct" label="DBR 1 — what the client pays during the fixed period" volatility="high" onEdit={() => onEdit(c, "ratePct")} /></td>
                <td style={GRP}><Cell card={c} field="followOn" label="DBR 2 — margin over EIBOR after the fixed period" volatility="high" onEdit={() => onEdit(c, "followOn")} /></td>
                <td style={GRP}><StressCell card={c} onEdit={() => onStress(c)} /></td>
                <td style={GRP}><Cell card={c} field="floorPct" label="floor — the rate never goes below this even if EIBOR falls" volatility="medium" onEdit={() => onEdit(c, "floorPct")} /></td>
                <td style={GRP}><Cell card={c} field="processingFeePct" label="processing fee on the loan" volatility="medium" onEdit={() => onEdit(c, "processingFeePct")} /></td>
                <td style={GRP}><VerifyCell card={c} onVerify={() => onVerify(c, rows)} /></td>
                <td className="text-right whitespace-nowrap" style={{ width: 168 }}>
                  {/* One collapsed marker instead of a chip per issue: a four-flag row
                      used to push this cell past the column width and bury the action. */}
                  <RowFlags issues={c.issues} exclusive={c.isExclusive} />
                  {/* CLOSED rows return early above, so reaching here means the slot is open */}
                  <button className="btn btn-ghost btn-sm ml-1" title="Mark this slot as deliberately not offered — needs a reason"
                    onClick={() => onSlot(c, "close")}>Close</button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- edit panel -- */

/**
 * Edit ONE field of ONE card. Deliberately not "edit the card": banks routinely send
 * a new rate and nothing else, so a panel that moved the floor and the fee alongside
 * it would quietly change numbers the bank never touched. `applyWholeCard` is an
 * explicit opt-in for the days a bank does reprice everything together.
 */
function EditPanel({ card, field, onClose, onToast, onSaved, bare }: {
  card: RateCard; field: CardFieldKey;
  onClose: () => void;
  onToast: (t: "success" | "error" | "info", m: string) => void;
  onSaved: () => Promise<void>;
  bare?: boolean;
}) {
  const current = card[field].value;
  const [value, setValue] = useState(current == null ? "" : String(current));
  const [from, setFrom] = useState(todayISO());
  const [reason, setReason] = useState("");
  const [wholeCard, setWholeCard] = useState(false);
  const [busy, setBusy] = useState(false);

  const next = Number(value);
  const deltaBps = current != null && Number.isFinite(next) ? Math.round((next - current) * 100) : null;
  const invalid = value.trim() !== "" && (!Number.isFinite(next) || next < 0 || next > 100);

  // the follow-on gap decides the client's cost over a long tenure, so show the
  // consequence of the edit rather than just the new number
  const projectedFollowOn = useMemo(() => {
    if (card.eiborNow == null) return null;
    const margin = field === "followOn" ? (Number.isFinite(next) ? next : card.followOn.value) : card.followOn.value;
    return margin == null ? null : Math.round((card.eiborNow + margin) * 1000) / 1000;
  }, [card, field, next]);

  /** One commit path. `val` is the field's new value — null clears it, which is
   *  how a row REVERTS to the inherited bank default rather than storing 0. */
  const commit = async (val: number | null, label: string) => {
    if (!reason.trim()) { onToast("error", "A reason is required — it is written to the change log."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/rate-desk", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "card",
          bankProductId: card.bankProductId,
          quoteIndex: card.quoteIndex,
          field,
          value: val,
          effectiveFrom: from,
          reason: reason.trim(),
          applyWholeCard: wholeCard,
        }),
      });
      const j = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) { onToast("error", j.error ?? "Could not save."); return; }
      onToast("success", wholeCard
        ? `${card.bankName} · ${card.productName} card moved.`
        : label);
      onClose();
      await onSaved();
    } catch {
      onToast("error", "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (invalid) { onToast("error", "Enter a percentage between 0 and 100."); return; }
    await commit(value.trim() === "" ? null : next,
      `${FIELD_LABEL[field]}: ${pct(current)} → ${pct(Number.isFinite(next) ? next : null)}.`);
  };

  // Revert = clear the row's own value so it falls back to the bank default again.
  // It is a first-class action because an override you cannot undo is an override
  // that will still be there after the reason for it has been forgotten.
  const revert = async () =>
    commit(null, `${FIELD_LABEL[field]} now follows the bank default again.`);

  return (
    <div className={bare ? undefined : "card p-4 anim-fade-up"} style={bare ? undefined : { borderColor: "var(--amber)" }}>
      {!bare && (
      <div className="flex flex-wrap items-baseline gap-2 mb-1">
        <span className="font-disp font-semibold text-[13px]">
          {FIELD_LABEL[field]} — {card.bankName} · {card.productName}
        </span>
        <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
          {card.transaction} · {card.rateType === "FIXED" ? `${card.termYears ?? 0}y fixed` : "variable"}
          {card.salaryTransfer ? ` · ${card.salaryTransfer}` : ""}
        </span>
      </div>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <div className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--ink-faint)] font-semibold">
            {card[field].from === "product"
              ? card[field].overridden ? "Override on this row" : "This row's own value"
              : `Inherited from ${card[field].from === "bank" ? "the bank" : "the UAE norm"}`}
          </div>
          <div className="mono text-[13px]">{pct(current)}</div>
          {/* What it WOULD be without the override — the one number that makes an
              override reversible instead of just a fact. Shown only when the row
              actually deviates, so the inherited case stays quiet. */}
          {card[field].overridden && card[field].parentValue != null && (
            <div className="text-[11px] mt-0.5" style={{ color: "var(--ink-faint)" }}>
              bank default {pct(card[field].parentValue)}
            </div>
          )}
        </div>
        <div>
          <label className="label">New value (%)</label>
          <input className="input input-sm mono !w-28" inputMode="decimal" autoFocus value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") onClose(); }} />
        </div>
        {deltaBps != null && (
          <div className="mono text-[13px]" style={{ color: deltaBps < 0 ? "var(--mint)" : "var(--amber)" }}>
            {deltaBps >= 0 ? "+" : ""}{deltaBps} bps
          </div>
        )}
        <div>
          <label className="label">Effective from</label>
          <input type="date" className="input input-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
      </div>

      <div className="mt-3">
        <label className="label">Reason (required)</label>
        <input className="input input-sm w-full" placeholder="e.g. monthly bank repricing" value={reason}
          onChange={(e) => setReason(e.target.value)} />
      </div>

      {field !== "processingFeePct" && projectedFollowOn != null && (
        <p className="text-[11.5px] m-0 mt-2" style={{ color: "var(--ink-dim)" }}>
          After the fixed period this card resolves to{" "}
          <strong className="mono">{pct(projectedFollowOn)}</strong> at today&apos;s{" "}
          {card.eiborBasis ?? ""} EIBOR of {pct(card.eiborNow)} — EIBOR moves, the margin does not.
        </p>
      )}

      {field !== "processingFeePct" && (
        <label className="chip mt-2" style={{ cursor: "pointer" }} title="Only when the bank moved the whole card at once">
          <input type="checkbox" checked={wholeCard} onChange={(e) => setWholeCard(e.target.checked)} className="mr-1" />
          the bank moved the whole card — apply to rate, margin and floor
        </label>
      )}

      <p className="text-[11px] m-0 mt-2" style={{ color: invalid ? "var(--coral)" : "var(--ink-faint)" }}>
        {invalid ? "Enter a percentage between 0 and 100."
          : `The current line is closed the day before ${from} and a new dated line takes over, so this is reversible and never rewrites history.`}
      </p>

      <div className="flex items-center gap-2 mt-3">
        {/* Revert only exists when there is something to revert to — an inherited
            value has no bank default behind it, so offering a revert there would
            promise inheritance that isn't there. */}
        {card[field].overridden && card[field].parentValue != null && (
          <button className="btn btn-ghost btn-sm" onClick={revert} disabled={busy || !reason.trim()}
            title={`Clear this row's own value and fall back to ${pct(card[field].parentValue)} — a reason is required`}>
            Revert to {pct(card[field].parentValue)}
          </button>
        )}
        <button className="btn btn-ghost btn-sm ml-auto" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={busy || !reason.trim() || invalid}>
          {busy ? "Saving…" : "Commit revision"}
        </button>
      </div>
    </div>
  );
}

/**
 * File the DBR-3 stress RULE for a card.
 *
 * Separate from EditPanel on purpose: this input is a kind PLUS a number, and the
 * kind is what actually matters. "Flat 5.88%" and "follow-on +2%" are different
 * bank behaviours — ADIB genuinely qualifies on its floor, ENBD on 1-month EIBOR —
 * and collapsing them into one percentage is how a client gets qualified wrongly.
 *
 * `NONE` writes null (no rule), which is honest and distinct from a rule whose
 * value has simply not been filled in yet.
 */
function StressPanel({ card, onClose, onToast, onSaved, bare }: {
  card: RateCard;
  onClose: () => void;
  onToast: (t: "success" | "error" | "info", m: string) => void;
  onSaved: () => Promise<void>;
  bare?: boolean;
}) {
  const known = ["FLAT", "EIBOR_PLUS_MARGIN", "RELATIVE_TO_FOLLOWON", "FLOOR_PLUS", "NONE"];
  const [kind, setKind] = useState(known.includes(card.stress.kind) ? card.stress.kind : "NONE");
  const [value, setValue] = useState(card.stress.value == null ? "" : String(card.stress.value));
  const [from, setFrom] = useState(todayISO());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const needsNumber = kind !== "NONE";
  const next = Number(value);
  const invalid = needsNumber && (value.trim() === "" || !Number.isFinite(next) || next < 0 || next > 100);

  const save = async () => {
    if (!reason.trim()) { onToast("error", "A reason is required — it is written to the change log."); return; }
    if (invalid) { onToast("error", "Enter the percentage for this rule."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/rate-desk", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "card",
          bankProductId: card.bankProductId,
          quoteIndex: card.quoteIndex,
          field: "stress",
          stressKind: kind,
          value: needsNumber && value.trim() !== "" ? next : null,
          effectiveFrom: from,
          reason: reason.trim(),
        }),
      });
      const j = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) { onToast("error", j.error ?? "Could not save."); return; }
      onToast("success", kind === "NONE"
        ? `${card.bankName} · ${card.productName}: stress rule cleared.`
        : `${card.bankName} · ${card.productName} now has a typed stress rule.`);
      onClose();
      await onSaved();
    } catch {
      onToast("error", "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={bare ? undefined : "card p-4 anim-fade-up"} style={bare ? undefined : { borderColor: "var(--amber)" }}>
      {!bare && (
      <div className="flex flex-wrap items-baseline gap-2 mb-1">
        <span className="font-disp font-semibold text-[13px]">
          Qualifying rate (DBR 3) — {card.bankName} · {card.productName}
        </span>
        <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
          {card.transaction} · {card.rateType === "FIXED" ? `${card.termYears ?? 0}y fixed` : "variable"}
        </span>
      </div>
      )}

      <p className="text-[11.5px] m-0 mb-2" style={{ color: "var(--ink-dim)" }}>
        Not what the client pays — the rate the bank tests them against to decide{" "}
        <em>how much they can borrow</em>. With no rule filed the engine uses the follow-on rate with no
        cushion: a real answer, but a soft one.
      </p>

      {card.stress.kind === "BANK_BUFFER" && (
        <p className="text-[11.5px] m-0 mb-2" style={{ color: "var(--amber)" }}>
          This card currently qualifies at the follow-on rate plus a flat{" "}
          <strong className="mono">{card.stress.value}%</strong> buffer we inferred for the bank. Filing a typed
          rule below replaces that approximation with the bank&apos;s actual methodology.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="label">How the bank tests it</label>
          <select className="select !w-auto" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="NONE">No rule filed — use the follow-on rate</option>
            <option value="FLAT">Flat rate the bank states</option>
            <option value="EIBOR_PLUS_MARGIN">EIBOR + margin + buffer</option>
            <option value="RELATIVE_TO_FOLLOWON">Follow-on rate + buffer</option>
            <option value="FLOOR_PLUS">Floor + buffer (holds if EIBOR falls)</option>
          </select>
        </div>
        {needsNumber && (
          <div>
            <label className="label">{kind === "FLAT" ? "Rate (%)" : "Added (%)"}</label>
            <input className="input input-sm mono !w-28" inputMode="decimal" autoFocus value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") onClose(); }} />
          </div>
        )}
        <div>
          <label className="label">Effective from</label>
          <input type="date" className="input input-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
      </div>

      <div className="mt-3">
        <label className="label">Reason (required)</label>
        <input className="input input-sm w-full" placeholder="e.g. bank confirmed stress methodology, Sep 2026"
          value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>

      <p className="text-[11px] m-0 mt-2" style={{ color: invalid ? "var(--coral)" : "var(--ink-faint)" }}>
        {invalid ? "Enter the percentage for this rule."
          : `The current line is closed the day before ${from} and a new dated line takes over — reversible, never a rewrite.`}
      </p>

      <div className="flex items-center gap-2 mt-3">
        <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={busy || !reason.trim() || invalid}>
          {busy ? "Saving…" : "Commit rule"}
        </button>
      </div>
    </div>
  );
}

/**
 * Record that a human confirmed these line(s) with the bank.
 *
 * Deliberately NOT the edit panel: no price moves here. A bank sends one
 * confirmation covering its whole card, so the default is the whole master —
 * verifying 40 rows one at a time is why nobody would ever do it, and an
 * unverified catalogue is where a two-year-old note quietly quotes a client.
 * The note is optional because "phoned the bank, nothing changed" is a
 * perfectly good reason.
 */
function VerifyPanel({ card, all, onClose, onToast, onSaved, bare }: {
  card: RateCard; all: RateCard[];
  onClose: () => void;
  onToast: (t: "success" | "error" | "info", m: string) => void;
  onSaved: () => Promise<void>;
  bare?: boolean;
}) {
  const [scope, setScope] = useState<"one" | "master">("master");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const targets = scope === "master" ? all : [card];
  const stale = targets.filter((t) => t.verification.state === "stale" || t.verification.state === "never").length;

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/rate-desk", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "verify",
          cards: targets.map((t) => ({ bankProductId: t.bankProductId, quoteIndex: t.quoteIndex })),
          note: note.trim() || "confirmed with the bank",
        }),
      });
      const j = await res.json().catch(() => ({})) as { error?: string; verified?: number };
      if (!res.ok) { onToast("error", j.error ?? "Could not record the confirmation."); return; }
      onToast("success", `${j.verified ?? targets.length} line(s) marked confirmed today — nothing about the pricing changed.`);
      onClose();
      await onSaved();
    } catch {
      onToast("error", "Could not record the confirmation.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={bare ? undefined : "card p-4 anim-fade-up"} style={bare ? undefined : { borderColor: "var(--mint)" }}>
      {!bare && (
      <div className="font-disp font-semibold text-[13px] mb-1">
        Confirm with the bank — this records a check, it does not change a price
      </div>
      )}
      <p className="text-[11.5px] m-0 mb-3" style={{ color: "var(--ink-dim)" }}>
        {card.bankName} · {card.productName} · {card.transaction} ·{" "}
        {card.rateType === "FIXED" ? `${card.termYears ?? 0}y fixed` : "variable"}
      </p>

      <div className="flex flex-wrap gap-2 mb-3">
        {all.length > 1 && (
          <label className="chip" style={{ cursor: "pointer" }}>
            <input type="radio" className="mr-1" checked={scope === "master"} onChange={() => setScope("master")} />
            the whole master ({all.length} lines)
          </label>
        )}
        <label className="chip" style={{ cursor: "pointer" }}>
          <input type="radio" className="mr-1" checked={scope === "one" || all.length <= 1} onChange={() => setScope("one")} />
          just this line
        </label>
      </div>

      {stale > 0 && (
        <p className="text-[11.5px] m-0 mb-3 inline-flex items-start gap-1.5" style={{ color: "var(--amber)" }}>
          <span className="mt-[5px]"><Dot color="var(--amber)" /></span>
          <span>
            {stale} of these {stale === 1 ? "has" : "have"} never been confirmed or {stale === 1 ? "is" : "are"} overdue —
            this is exactly the kind of line that can be quoting out of date.
          </span>
        </p>
      )}

      <label className="label">What did the bank say? (optional)</label>
      <input className="input input-sm w-full" placeholder="e.g. phoned the RM, card unchanged for October"
        value={note} onChange={(e) => setNote(e.target.value)} />

      <div className="flex items-center gap-2 mt-3">
        <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={busy}>
          {busy ? "Recording…" : `Mark ${targets.length} line(s) confirmed today`}
        </button>
      </div>
    </div>
  );
}

/** The transactions a rate line can be filed against — the same list everywhere,
 *  so an added row and a re-filed row can never describe "Resale" differently. */
const TXNS = ["Primary Handover", "Resale", "Buyout", "Buyout + Equity Release", "Equity Release", "Land"];
const CHIP_ON = { cursor: "pointer", borderColor: "var(--mint)", color: "var(--ink)" } as const;
const CHIP_OFF = { cursor: "pointer", color: "var(--ink-faint)" } as const;
const summarizeAxes = (txns: string[], stl: Array<"STL" | "NSTL">, rateType: string, term: number | null) =>
  [
    txns.length ? txns.join("/") : "all transactions",
    rateType === "FIXED" ? `${term ?? "?"}y fixed` : "variable day-1",
    stl.length === 2 || stl.length === 0 ? "STL or NSTL" : stl[0],
  ].join(" · ");

/**
 * The axis pickers themselves, shared by "re-file an existing row" and "add a row".
 *
 * Extracted so the two panels cannot drift: if you fix the transaction vocabulary
 * in one, the other picks it up, and a row added today matches a row edited
 * tomorrow. Pure presentational — no fetching, no saving.
 */
function AxesFields({ txns, setTxns, stl, setStl, rateType, setRateType, term, setTerm, basis, setBasis }: {
  txns: string[]; setTxns: (v: string[]) => void;
  stl: Array<"STL" | "NSTL">; setStl: (v: Array<"STL" | "NSTL">) => void;
  rateType: string; setRateType: (v: string) => void;
  term: number | null; setTerm: (v: number | null) => void;
  basis: string; setBasis: (v: string) => void;
}) {
  return (
    <>
      <div className="mb-3">
        <label className="label">Transactions (nothing ticked = all)</label>
        <div className="flex flex-wrap gap-1.5">
          {TXNS.map((t) => (
            <label key={t} className="chip" style={txns.includes(t) ? CHIP_ON : CHIP_OFF}>
              <input type="checkbox" className="mr-1" checked={txns.includes(t)}
                onChange={() => setTxns(txns.includes(t) ? txns.filter((x) => x !== t) : [...txns, t])} />{t}
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-4 mb-3">
        <div>
          <label className="label">Rate type</label>
          <select className="select !w-auto" value={rateType} onChange={(e) => setRateType(e.target.value)}>
            <option value="FIXED">Fixed for a term</option>
            <option value="1M_EIBOR">Variable — 1M EIBOR</option>
            <option value="3M_EIBOR">Variable — 3M EIBOR</option>
            <option value="6M_EIBOR">Variable — 6M EIBOR</option>
          </select>
        </div>
        {rateType === "FIXED" && (
          <>
            <div>
              <label className="label">Fixed for (years)</label>
              <select className="select !w-auto" value={term == null ? "" : String(term)}
                onChange={(e) => setTerm(e.target.value === "" ? null : Number(e.target.value))}>
                <option value="">— pick —</option>
                {[1, 2, 3, 4, 5, 7].map((t) => <option key={t} value={t}>{t}y</option>)}
              </select>
            </div>
            <div>
              <label className="label">Reverts to</label>
              <select className="select !w-auto" value={basis} onChange={(e) => setBasis(e.target.value)}>
                {["1M", "3M", "6M", "1Y"].map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          </>
        )}
        <div>
          <label className="label">Salary transfer</label>
          <div className="flex gap-1.5">
            {(["STL", "NSTL"] as const).map((s) => (
              <label key={s} className="chip" style={stl.includes(s) ? CHIP_ON : CHIP_OFF}>
                <input type="checkbox" className="mr-1" checked={stl.includes(s)}
                  onChange={() => setStl(stl.includes(s) ? stl.filter((x) => x !== s) : [...stl, s])} />{s}
              </label>
            ))}
          </div>
          <div className="text-[10px] mt-1" style={{ color: "var(--ink-faint)" }}>tick both or neither = either</div>
        </div>
      </div>
      <div className="rounded px-3 py-2 mb-3 text-[12px]" style={{ background: "var(--bg2)" }}>
        {rateType === "FIXED" && term == null
          ? <span style={{ color: "var(--amber)" }}>Pick a fixed term to complete this row.</span>
          : <>Applies to: <strong>{summarizeAxes(txns, stl, rateType, term)}</strong></>}
      </div>
    </>
  );
}

/**
 * Edit the slot's own axes: which transactions, what term, which rate type, STL or not.
 *
 * WHO a price applies to is as editable as WHAT it is. The axes an importer filed
 * are guesses from prose — 281 quotes carry no transaction at all, and the legacy
 * boolean stl:true/false silently became either when the column preferred the set
 * form. An "Applies to" cell that could not be opened would freeze every one of
 * those mis-filings in place forever.
 *
 * An edit here NEVER moves a rate: it re-files the axes on the same dated line and
 * stamps it verified, because reading the policy sheet again is what confirms both.
 */
function SlotAxesPanel({ card, onClose, onToast, onSaved, bare }: {
  card: RateCard;
  onClose: () => void;
  onToast: (t: "success" | "error" | "info", m: string) => void;
  onSaved: () => Promise<void>;
  bare?: boolean;
}) {
  const [txns, setTxns] = useState<string[]>([...card.slotTxns]);
  const [stl, setStl] = useState<Array<"STL" | "NSTL">>([...card.slotStl]);
  const [term, setTerm] = useState<number | null>(card.slotTermYears);
  const [rateType, setRateType] = useState(card.slotRateType);
  const [basis, setBasis] = useState(card.slotBasis ?? "3M");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!reason.trim()) { onToast("error", "A reason is required — it is written to the change log."); return; }
    if (rateType === "FIXED" && term == null) { onToast("error", "A fixed line needs a term — pick how many years."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/rate-desk", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "slot-axes",
          bankProductId: card.bankProductId, quoteIndex: card.quoteIndex,
          txns, termYears: rateType === "FIXED" ? term : 0, rateType,
          eiborBasis: rateType === "FIXED" ? basis : rateType.replace("_EIBOR", ""),
          salaryTransfer: stl, reason: reason.trim(),
        }),
      });
      const j = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) { onToast("error", j.error ?? "Could not save."); return; }
      onToast("success", `Now applies to: ${summarizeAxes(txns, stl, rateType, term)}. The rate itself did not move.`);
      onClose();
      await onSaved();
    } catch {
      onToast("error", "Could not save.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={bare ? undefined : "card p-4 anim-fade-up"} style={bare ? undefined : { borderColor: "var(--amber)" }}>
      {!bare && (
      <div className="font-disp font-semibold text-[13px] mb-1">Who this price applies to</div>
      )}
      <p className="text-[11.5px] m-0 mb-3" style={{ color: "var(--ink-dim)" }}>
        {card.bankName} · {card.productName} — the rate itself does not move.
      </p>
      <AxesFields
        txns={txns} setTxns={setTxns}
        stl={stl} setStl={setStl}
        rateType={rateType} setRateType={setRateType}
        term={term} setTerm={setTerm}
        basis={basis} setBasis={setBasis}
      />
      <div>
        <label className="label">Your reason (written to the change log)</label>
        <input className="input input-sm w-full" placeholder="e.g. policy sheet says buyout only"
          value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="flex items-center gap-2 mt-3">
        <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={save}
          disabled={busy || !reason.trim() || (rateType === "FIXED" && term == null)}>
          {busy ? "Saving…" : "Re-file the axes"}
        </button>
      </div>
    </div>
  );
}

/**
 * Open a NEW row in a master — the button that was missing.
 *
 * A master's rows are its rate lines. Until now they only existed because an
 * importer left them behind, so when a bank published a new transaction type
 * (or a second term) there was nowhere to put it. This is the "somewhere".
 *
 * Deliberately creates the row EMPTY with its axes filed and NO rate: the honest
 * state for "the bank offers this combination, we have not been told the price".
 * It will sit in the grid carrying `no rate`, never a fake 0%. The first rate gets
 * filed with the normal card edit, one field at a time.
 */
function AddRowPanel({ bankProductId, bankName, productName, onClose, onToast, onSaved }: {
  bankProductId: number;
  bankName: string;
  productName: string;
  onClose: () => void;
  onToast: (t: "success" | "error" | "info", m: string) => void;
  onSaved: () => Promise<void>;
}) {
  const [txns, setTxns] = useState<string[]>([]);
  const [stl, setStl] = useState<Array<"STL" | "NSTL">>([]);
  const [rateType, setRateType] = useState("FIXED");
  const [term, setTerm] = useState<number | null>(3);
  const [basis, setBasis] = useState("3M");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!reason.trim()) { onToast("error", "A reason is required — it is written to the change log."); return; }
    if (rateType === "FIXED" && term == null) { onToast("error", "A fixed line needs a term — pick how many years."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/rate-desk", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "slot-add",
          bankProductId,
          txns, termYears: rateType === "FIXED" ? term : 0, rateType,
          eiborBasis: basis, salaryTransfer: stl,
          reason: reason.trim(),
        }),
      });
      const j = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) { onToast("error", j.error ?? "Could not add the row."); return; }
      onToast("success", `Row added to ${bankName} — empty and waiting for its first rate.`);
      onClose();
      await onSaved();
    } catch {
      onToast("error", "Could not add the row.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="text-[11.5px] m-0 mb-3" style={{ color: "var(--ink-dim)" }}>
        {bankName} · {productName} — adds one rate line. It is created <strong>empty</strong>:
        the axes are filed, the price is not, so it shows in the grid with a <code>no rate</code> flag
        rather than a number you did not intend.
      </p>

      <AxesFields
        txns={txns} setTxns={setTxns}
        stl={stl} setStl={setStl}
        rateType={rateType} setRateType={setRateType}
        term={term} setTerm={setTerm}
        basis={basis} setBasis={setBasis}
      />

      <div>
        <label className="label">Your reason (written to the change log)</label>
        <input className="input input-sm w-full" placeholder="e.g. bank confirmed a 5y buyout line for October"
          value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>

      <div className="flex items-center gap-2 mt-3">
        <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={save}
          disabled={busy || !reason.trim() || (rateType === "FIXED" && term == null)}>
          {busy ? "Adding…" : "Add empty row"}
        </button>
      </div>
    </>
  );
}

/**
 * Close or reopen a slot.
 *
 * Closing asserts — "the bank does not offer this" — so it needs
 * TWO pieces of text: the slot reason (shown in the grid where a rate would be,
 * e.g. "product withdrawn") and the audit reason (who decided, on what basis).
 * Reopening returns the slot to EMPTY; it never invents a rate.
 */
function SlotPanel({ card, action, onClose, onToast, onSaved, bare }: {
  card: RateCard; action: "close" | "reopen";
  onClose: () => void;
  onToast: (t: "success" | "error" | "info", m: string) => void;
  onSaved: () => Promise<void>;
  bare?: boolean;
}) {
  const [closedReason, setClosedReason] = useState(card.closedReason ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const reasonOk = action === "reopen" || closedReason.trim().length >= 4;

  const save = async () => {
    if (!reason.trim()) { onToast("error", "A reason is required — it is written to the change log."); return; }
    if (!reasonOk) { onToast("error", "Say why the bank doesn't offer this — otherwise it becomes a dumping ground for unfinished work."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/rate-desk", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "slot",
          bankProductId: card.bankProductId,
          quoteIndex: card.quoteIndex,
          action,
          closedReason: action === "close" ? closedReason.trim() : null,
          reason: reason.trim(),
        }),
      });
      const j = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) { onToast("error", j.error ?? "Could not save."); return; }
      onToast("success", action === "close"
        ? "Slot closed — it will never match a client case, and the reason is on record."
        : "Slot reopened as empty — file a rate when the bank confirms one.");
      onClose();
      await onSaved();
    } catch {
      onToast("error", "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={bare ? undefined : "card p-4 anim-fade-up"} style={bare ? undefined : { borderColor: "var(--amber)" }}>
      {!bare && (
      <div className="font-disp font-semibold text-[13px] mb-1">
        {action === "close" ? "Close this slot — the bank doesn't offer it" : "Reopen this slot"}
      </div>
      )}
      <p className="text-[11.5px] m-0 mb-3" style={{ color: "var(--ink-dim)" }}>
        {card.bankName} · {card.productName} · {card.transaction} ·{" "}
        {card.rateType === "FIXED" ? `${card.termYears ?? 0}y fixed` : "variable"}
        {card.salaryTransfer ? ` · ${card.salaryTransfer}` : ""}
      </p>
      {action === "close" ? (
        <div className="space-y-3">
          <div>
            <label className="label">Why doesn't the bank offer this? (shown in the grid)</label>
            <input className="input input-sm w-full" autoFocus placeholder="e.g. product withdrawn · not offered for non-residents"
              value={closedReason} onChange={(e) => setClosedReason(e.target.value)} />
          </div>
          <div>
            <label className="label">Your reason (written to the change log)</label>
            <input className="input input-sm w-full" placeholder="e.g. confirmed with RM on 30 Sep — buyout withdrawn"
              value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
      ) : (
        <div>
          <p className="text-[11.5px] m-0 mb-2" style={{ color: "var(--ink-dim)" }}>
            Closed {card.closedAt ?? ""}{card.closedReason ? ` — “${card.closedReason}”` : ""}.
            Reopening returns it to <strong>empty</strong>: visible as missing, never auto-filled.
          </p>
          <label className="label">Your reason (written to the change log)</label>
          <input className="input input-sm w-full" autoFocus placeholder="e.g. bank re-introduced buyout for October"
            value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      )}
      <div className="flex items-center gap-2 mt-3">
        <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={busy || !reason.trim() || !reasonOk}>
          {busy ? "Saving…" : action === "close" ? "Close slot" : "Reopen as empty"}
        </button>
      </div>
    </div>
  );
}

/**
 * Change ONE field across MANY cards at once.
 *
 * A bank repricing its card moves thirty rows, not one, so doing it one at a time is
 * how a rate sheet ends up half-updated — the most dangerous state a pricing
 * catalogue can be in. The batch is applied atomically server-side: if any card
 * would breach a floor, NOTHING is written, and the reasons come back together.
 *
 * "Set to" and "shift by" are both offered because they are genuinely different
 * jobs: a monthly repricing is a shift (−5bps across the board), while a correction
 * is a set (this whole line should be 3.94%).
 */
function BulkPanel({ cards, onClose, onToast, onSaved, bare }: {
  cards: RateCard[];
  onClose: () => void;
  onToast: (t: "success" | "error" | "info", m: string) => void;
  onSaved: () => void | Promise<void>;
  bare?: boolean;
}) {
  // the processing fee is a PRODUCT field, so a card-level batch cannot carry it
  const FIELDS: { value: CardFieldKey; label: string }[] = [
    { value: "ratePct", label: "Interest rate" },
    { value: "followOn", label: "After the fixed period" },
    { value: "floorPct", label: "Minimum rate" },
  ];
  const [field, setField] = useState<CardFieldKey>("ratePct");
  const [mode, setMode] = useState<"set" | "shift">("set");
  const [value, setValue] = useState("");
  const [from, setFrom] = useState(todayISO());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const num = value.trim() === "" ? null : Number(value);
  const valid = num != null && Number.isFinite(num) && !(mode === "set" && (num < 0 || num > 100));

  /** What each card becomes — shown BEFORE committing, because "shift every card by
   *  −5bps" is only safe if you can see where each one lands. */
  const preview = useMemo(() => cards.map((c) => {
    const cur = c[field].value;
    const next = cur == null || num == null ? null : mode === "set" ? num : Math.round((cur + num) * 1000) / 1000;
    return { c, cur, next };
  }), [cards, field, mode, num]);
  const changed = preview.filter((p) => p.next != null && p.cur !== p.next);

  const save = async () => {
    if (!reason.trim()) { onToast("error", "A reason is required — it is written to the change log."); return; }
    if (!valid) { onToast("error", "Enter a number for the new value."); return; }
    setBusy(true);
    setProblems([]);
    try {
      const res = await fetch("/api/admin/rate-desk", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "bulk",
          field,
          mode,               // "set" | "shift" — the SERVER computes the per-card value
          value: num,
          cards: cards.map((c) => ({ bankProductId: c.bankProductId, quoteIndex: c.quoteIndex })),
          effectiveFrom: from,
          reason: reason.trim(),
        }),
      });
      const j = await res.json().catch(() => ({})) as { error?: string; problems?: string[]; updated?: number };
      if (!res.ok) {
        setProblems(j.problems ?? []);
        onToast("error", j.error ?? "Could not apply the batch.");
        return;
      }
      onToast("success", `${j.updated ?? changed.length} card(s) updated — each closed and re-dated, so this is reversible.`);
      await onSaved();
    } catch {
      onToast("error", "Could not apply the batch.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={bare ? undefined : "card p-4 anim-fade-up"} style={bare ? undefined : { borderColor: "var(--amber)", borderLeft: "3px solid var(--amber)" }}>
      {!bare && (
      <div className="flex flex-wrap items-baseline gap-2 mb-2">
        <span className="font-disp font-semibold text-[13.5px]">
          Batch change — {cards.length} card{cards.length === 1 ? "" : "s"}
        </span>
        <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
          across {new Set(cards.map((c) => c.bankName)).size} bank(s) · applied all-or-nothing
        </span>
        <button className="btn btn-ghost btn-sm ml-auto" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="label">Field</label>
          <select className="select !w-auto" value={field} onChange={(e) => setField(e.target.value as CardFieldKey)}>
            {FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Change</label>
          <select className="select !w-auto" value={mode} onChange={(e) => setMode(e.target.value as "set" | "shift")}>
            <option value="set">Set every card to</option>
            <option value="shift">Move every card by</option>
          </select>
        </div>
        <div>
          <label className="label">{mode === "set" ? "New value (%)" : "Shift by (points, may be negative)"}</label>
          <input className="input input-sm mono !w-32" inputMode="decimal" autoFocus value={value}
            placeholder={mode === "set" ? "3.94" : "-0.05"}
            onChange={(e) => setValue(e.target.value)} />
        </div>
        <div>
          <label className="label">Effective from</label>
          <input type="date" className="input input-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
      </div>

      <div className="mt-3">
        <label className="label">Reason (required)</label>
        <input className="input input-sm w-full" placeholder="e.g. monthly repricing, whole card moved −5bps"
          value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>

      {/* the preview is the point: a shift is only safe if you can see where each card lands */}
      {changed.length > 0 && (
        <div className="mt-3">
          <div className="text-[10.5px] uppercase tracking-[0.08em] font-semibold mb-1" style={{ color: "var(--ink-faint)" }}>
            {changed.length} card(s) would change
            {cards.length - changed.length > 0 ? ` · ${cards.length - changed.length} unchanged (already at that value or blank)` : ""}
          </div>
          <div className="overflow-x-auto rounded" style={{ background: "var(--bg2)" }}>
            <table className="tbl w-full">
              <thead>
                <tr><th>Bank · card</th><th className="text-right">Now</th><th className="text-right">Becomes</th><th className="text-right">Δ</th></tr>
              </thead>
              <tbody>
                {changed.slice(0, 8).map((p) => {
                  const d = p.cur != null && p.next != null ? Math.round((p.next - p.cur) * 1000) / 10 : null;
                  return (
                    <tr key={p.c.key}>
                      <td className="text-[11.5px] whitespace-nowrap">{p.c.bankName} · {p.c.transaction} · {p.c.rateType === "FIXED" ? `${p.c.termYears ?? 0}y` : "var"}</td>
                      <td className="text-right mono text-[11.5px]">{pct(p.cur)}</td>
                      <td className="text-right mono text-[11.5px] font-semibold">{pct(p.next)}</td>
                      <td className="text-right mono text-[11.5px]" style={{ color: d != null && d < 0 ? "var(--mint)" : "var(--amber)" }}>
                        {d == null ? "—" : `${d > 0 ? "+" : ""}${d} bps`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {changed.length > 8 && (
              <p className="text-[10.5px] px-3 py-1.5 m-0" style={{ color: "var(--ink-faint)" }}>
                …and {changed.length - 8} more.
              </p>
            )}
          </div>
        </div>
      )}

      {problems.length > 0 && (
        <div className="mt-3 rounded p-2.5" style={{ background: "rgba(220,120,120,0.08)" }}>
          <div className="text-[11px] font-semibold mb-1" style={{ color: "var(--coral)" }}>
            Nothing was changed — these cards blocked the batch:
          </div>
          {problems.map((p) => (
            <div key={p} className="text-[11px]" style={{ color: "var(--coral)" }}>· {p}</div>
          ))}
          <p className="text-[10.5px] m-0 mt-1" style={{ color: "var(--ink-faint)" }}>
            Fix or deselect these and try again. A partial repricing would leave the card half-moved, which is worse than not moving it.
          </p>
        </div>
      )}

      <p className="text-[11px] m-0 mt-2" style={{ color: valid && reason.trim() ? "var(--ink-faint)" : "var(--amber)" }}>
        {!reason.trim() ? "A reason is required — it is written to the change log."
          : !valid ? "Enter a number for the new value."
            : `Each card is closed the day before ${from} and re-dated, so this batch is reversible and never rewrites history.`}
      </p>

      <div className="flex items-center gap-2 mt-3">
        <button className="btn btn-primary btn-sm" onClick={save} disabled={busy || !valid || !reason.trim()}>
          {busy ? "Applying…" : `Apply to all ${cards.length}`}
        </button>
      </div>
    </div>
  );
}
