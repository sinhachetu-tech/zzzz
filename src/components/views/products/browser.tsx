// Product Browser — the staff-facing catalogue of every live bank rate line.
//
// A "row" is a RATE LINE, not a BankProduct: one product publishes several rates
// (1y/3y/5y, STL/NSTL), and the axis signature a broker scans for belongs to the
// rate. So the list reads as a grid of comparable offers rather than product records.
//
// Defaults matter here: the page opens on ACTIVE products with NO filter applied,
// because a filter left on from last session is how someone ends up quoting from a
// stale shortlist. Pagination is server-side at 10/page — 10 is deliberate: enough to
// compare, few enough to scan without losing the best offer off the bottom.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, Seg } from "@/components/hfmc/ui";
import type { ProductRow } from "@/app/api/products/route";

export const PAGE_SIZE = 10;

/** One facet = one dropdown. A facet with a single value is not worth a control. */
export type FacetKey = "bank" | "employment" | "residency" | "mortgageType" | "txn" | "salaryTransfer" | "exclusivity";

export const EXCLUSIVITY: { value: string; label: string }[] = [
  { value: "", label: "All offers" },
  { value: "standard", label: "Standard only" },
  { value: "exclusive", label: "Exclusive / project-tied" },
];

export interface Filters {
  bank: string; employment: string; residency: string; mortgageType: string;
  txn: string; salaryTransfer: string; exclusivity: string;
  maxRate: string; maxLtv: string; q: string;
}

export const EMPTY_FILTERS: Filters = {
  bank: "", employment: "", residency: "", mortgageType: "", txn: "",
  salaryTransfer: "", exclusivity: "", maxRate: "", maxLtv: "", q: "",
};

export interface BrowserData {
  items: ProductRow[];
  pages: number;
  total: number;
  pageSize: number;
}

export function ProductBrowser({ onOpen }: { onOpen: (bankProductId: number, quoteIndex: number) => void }) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<BrowserData | null>(null);
  const [facets, setFacets] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [openFacets, setOpenFacets] = useState(false);

  const set = useCallback(<K extends keyof Filters>(k: K, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    // any filter change MUST return to page 1, or the user lands on an empty page
    // because their old page number is now out of range
    setPage(1);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
      qs.set("page", String(page));
      const res = await fetch(`/api/products?${qs}`);
      if (!res.ok) throw new Error("load failed");
      const j = await res.json() as BrowserData & { facets: Record<string, string[]> };
      setData({ items: j.items ?? [], pages: j.pages ?? 1, total: j.total ?? 0, pageSize: j.pageSize ?? PAGE_SIZE });
      setFacets(j.facets ?? {});
    } catch {
      setData({ items: [], pages: 1, total: 0, pageSize: PAGE_SIZE });
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => { void load(); }, [load]);

  const activeCount = useMemo(
    () => Object.entries(filters).filter(([, v]) => v).length,
    [filters],
  );

  const select = (label: string, facet: FacetKey, options: { value: string; label: string }[]) => {
    const current = filters[facet];
    if (options.length <= 1 && !current) return null;
    return (
      <label key={facet} className="flex flex-col gap-1 min-w-0">
        <span className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--ink-faint)] font-semibold">{label}</span>
        <select
          className="select"
          value={current}
          onChange={(e) => set(facet, e.target.value)}
          style={current ? { borderColor: "var(--amber)", color: "var(--amber)" } : undefined}
        >
          <option value="">Any</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    );
  };

  return (
    <div className="space-y-4 anim-fade-up">
      {/* ---- filter bar: one row, always visible on desktop ---- */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
          <input className="input input-sm !w-56" placeholder="Search bank, product, profile…"
            value={filters.q} onChange={(e) => set("q", e.target.value)} />
          <button className="btn btn-ghost btn-sm sm:hidden" onClick={() => setOpenFacets((v) => !v)}>
            {openFacets ? "Hide" : "Filters"}{activeCount ? ` (${activeCount})` : ""}
          </button>
          <div className="ml-auto flex items-center gap-2">
            {activeCount > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>
                Clear {activeCount} filter{activeCount > 1 ? "s" : ""}
              </button>
            )}
            <span className="text-[11px] text-[var(--ink-faint)]">
              {loading ? "loading…" : `${data?.total ?? 0} rate lines`}
            </span>
          </div>
        </div>

        <div className={`${openFacets ? "grid" : "hidden sm:grid"} grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 px-4 py-3`}>
          {select("Bank", "bank", (facets.banks ?? []).map((v) => ({ value: v, label: v })))}
          {select("Employment", "employment", (facets.employment ?? []).map((v) => ({ value: v, label: v })))}
          {select("Residency", "residency", (facets.residency ?? []).map((v) => ({ value: v, label: v })))}
          {select("Mortgage type", "mortgageType", (facets.mortgageType ?? []).map((v) => ({ value: v, label: v })))}
          {select("Transaction", "txn", (facets.transaction ?? []).map((v) => ({ value: v, label: v })))}
          {select("Salary transfer", "salaryTransfer", [
            { value: "STL", label: "STL required" },
            { value: "NSTL", label: "No salary transfer" },
          ])}
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--ink-faint)] font-semibold">Max rate %</span>
            <input className="input input-sm mono" inputMode="decimal" placeholder="e.g. 4.00"
              value={filters.maxRate} onChange={(e) => set("maxRate", e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--ink-faint)] font-semibold">Max LTV %</span>
            <input className="input input-sm mono" inputMode="numeric" placeholder="e.g. 80"
              value={filters.maxLtv} onChange={(e) => set("maxLtv", e.target.value)} />
          </label>
          <div className="flex flex-col gap-1 min-w-0 sm:col-span-2">
            <span className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--ink-faint)] font-semibold">Exclusivity</span>
            <Seg value={filters.exclusivity} onChange={(v) => set("exclusivity", v)} options={EXCLUSIVITY} />
          </div>
        </div>
      </div>

      {loading && !data ? (
        <div className="card p-8 text-center text-[13px]" style={{ color: "var(--ink-faint)" }}>Loading products…</div>
      ) : (data?.items.length ?? 0) === 0 ? (
        <EmptyState icon={<span>∅</span>} title="No rate lines match these filters"
          body="Loosen a filter, or clear them all to see every active product." />
      ) : (
        <>
          <div className="space-y-2">
            {data!.items.map((r) => (
              <ProductCard key={r.key} r={r} onOpen={() => onOpen(r.bankProductId, r.quoteIndex)} />
            ))}
          </div>
          <Pagination page={page} pages={data!.pages} total={data!.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}

/** The axis signature, rendered as chips. This is the line brokers actually scan:
 *  "Islamic ∙ STL ∙ UAE Resident ∙ Salaried ∙ Standard ∙ Buyout" tells them who it
 *  is for before they read a single number. */
function axisChips(r: ProductRow): { text: string; tone?: "amber" | "mint" }[] {
  const out: { text: string; tone?: "amber" | "mint" }[] = [];
  out.push({ text: r.mortgageType });
  if (r.salaryTransfer) out.push({ text: r.salaryTransfer });
  out.push({ text: r.residency });
  out.push({ text: r.employment });
  if (r.customerProfile) {
    out.push({ text: r.customerProfile, tone: r.isExclusive ? "amber" : "mint" });
  }
  out.push({ text: r.transactionType });
  return out;
}

function ProductCard({ r, onOpen }: { r: ProductRow; onOpen: () => void }) {
  const chips = axisChips(r);
  const isFixed = r.rateType === "FIXED";
  const rate = r.ratePct ?? r.marginPct;
  const feePct = r.processingFeePct == null
    ? "—"
    : r.processingFeePct === 0 ? "0%" : `${r.processingFeePct}%`;

  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-lg px-3.5 py-3 transition-all hover:brightness-[1.03]"
      style={{ background: "var(--tint)", border: "1px solid var(--line-soft)", cursor: "pointer" }}
    >
      {/* axis signature — the identity of the offer, above the numbers */}
      <div className="text-[11px] leading-relaxed mb-2 truncate" style={{ color: "var(--ink-dim)" }}>
        {chips.map((c, i) => (
          <span key={c.text + i}>
            <span
              style={c.tone === "amber" ? { color: "var(--amber)", fontWeight: 600 }
                : c.tone === "mint" ? { color: "var(--mint)" }
                : undefined}
            >
              {c.text}
            </span>
            {i < chips.length - 1 ? <span style={{ color: "var(--ink-faint)" }}> ∙ </span> : null}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* bank identity with logo */}
        <div className="flex items-center gap-2 min-w-0 shrink-0" style={{ width: 180 }}>
          {r.bankLogoUrl ? (
            <img src={r.bankLogoUrl} alt="" className="h-7 w-7 rounded object-contain shrink-0"
              style={{ background: "var(--bg2)" }} />
          ) : (
            <div className="h-7 w-7 rounded shrink-0 flex items-center justify-center text-[10px] font-semibold shrink-0"
              style={{ background: "var(--bg2)", color: "var(--ink-faint)" }}>
              {r.bankName.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-[12.5px] font-semibold truncate">{r.bankName}</div>
            <div className="text-[10px] truncate" style={{ color: "var(--ink-faint)" }}>{r.productName}</div>
          </div>
        </div>

        {/* the money, in the order a broker reads it */}
        <div className="flex items-baseline gap-1.5 shrink-0" style={{ width: 96 }}>
          <span className="mono text-[15px] font-bold" style={{ color: "var(--mint)" }}>
            {rate != null ? `${rate}%` : "—"}
          </span>
        </div>
        <div className="text-[11px] shrink-0" style={{ width: 76, color: "var(--ink-dim)" }}>
          {isFixed ? `${r.termYears ?? 0}y fixed` : "variable"}
        </div>
        <div className="text-[11px] mono shrink-0" style={{ width: 74, color: "var(--ink-dim)" }}>
          {feePct} fee
        </div>
        <div className="text-[11px] mono truncate shrink-0" style={{ width: 132, color: "var(--ink-dim)" }}>
          {r.followOnLabel}
        </div>

        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {r.attention.map((a) => (
            <span key={a} className="chip" style={{ color: "var(--amber)" }} title="Worth confirming with the bank">{a}</span>
          ))}
          {r.isExclusive && (
            <span className="chip" style={{ color: "var(--amber)", borderColor: "var(--amber)" }}
              title={r.exclusivityLabel ?? "Project-tied product"}>exclusive</span>
          )}
          <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>→</span>
        </div>
      </div>
    </button>
  );
}

function Pagination({ page, pages, total, onPage }: {
  page: number; pages: number; total: number; onPage: (p: number) => void;
}) {
  if (pages <= 1) return null;
  // a short window around the current page: the first and last always reachable
  const nums: number[] = [];
  const from = Math.max(1, Math.min(page - 2, pages - 4));
  const to = Math.min(pages, Math.max(page + 2, 5));
  for (let i = from; i <= to; i++) nums.push(i);
  return (
    <div className="card px-4 py-2.5 flex flex-wrap items-center gap-2">
      <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Prev</button>
      {from > 1 && (
        <>
          <button className="btn btn-ghost btn-xs" onClick={() => onPage(1)}>1</button>
          {from > 2 && <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>…</span>}
        </>
      )}
      {nums.map((n) => (
        <button key={n} className="btn btn-xs"
          onClick={() => onPage(n)}
          style={n === page
            ? { background: "var(--amber)", color: "var(--bg)", fontWeight: 700 }
            : undefined}>
          {n}
        </button>
      ))}
      {to < pages && (
        <>
          {to < pages - 1 && <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>…</span>}
          <button className="btn btn-ghost btn-xs" onClick={() => onPage(pages)}>{pages}</button>
        </>
      )}
      <button className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next →</button>
      <span className="ml-auto text-[11px]" style={{ color: "var(--ink-faint)" }}>
        Page {page} of {pages} · {total} rate lines
      </span>
    </div>
  );
}

