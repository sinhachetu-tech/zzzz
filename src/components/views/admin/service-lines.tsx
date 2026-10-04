"use client";

import { useMemo, useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { ServiceLineDto } from "@/lib/types";
import { Chip, EmptyState, Modal } from "@/components/hfmc/ui";
import { ConfirmModal } from "@/components/hfmc/bits";
import { ILayers, IPencil, IPlus, ITrash } from "@/components/icons";


/* Admin → Service lines — the catalogue of what the firm sells.
 *
 * WHY THIS IS ADMIN-CURABLE: the service list is a commercial decision that grows
 * ("debt restructuring" next year). It should not need a deploy.
 *
 * WHAT THE UI REFUSES TO DO, and why the server refuses too:
 *   · `code` is immutable once set — it is referenced by code in backfills, so a
 *     rename would silently orphan rows. The NAME changes on a rebrand.
 *   · A line in use cannot be deleted, only deactivated, because deleting would
 *     orphan its cases, leads, stages, doc rules and SLAs.
 *   · `bankRaced` cannot be switched off once legs exist, because then "won" and
 *     "lost race" would stop meaning anything on that line.
 */

interface LineDraft {
  id?: number;
  code: string;
  name: string;
  shortName: string;
  notes: string;
  bankRaced: boolean;
  active: boolean;
  sortOrder: number;
}

interface ProductDraft {
  id?: number;
  serviceLineId: number;
  code: string;
  name: string;
  notes: string;
  active: boolean;
  sortOrder: number;
}

const blankLine = (sortOrder: number): LineDraft => ({
  code: "", name: "", shortName: "", notes: "", bankRaced: false, active: true, sortOrder,
});
const blankProduct = (serviceLineId: number, sortOrder: number): ProductDraft => ({
  serviceLineId, code: "", name: "", notes: "", active: true, sortOrder,
});

export default function ServiceLinesAdmin() {
  const { serviceLines, cases, toast, hydrate } = useHfmcStore();
  const [line, setLine] = useState<LineDraft | null>(null);
  const [product, setProduct] = useState<ProductDraft | null>(null);
  const [del, setDel] = useState<{ kind: "line" | "product"; id: number; label: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const caseCount = useMemo(() => {
    const m = new Map<number, number>();
    for (const c of cases) if (c.serviceLineId) m.set(c.serviceLineId, (m.get(c.serviceLineId) ?? 0) + 1);
    return m;
  }, [cases]);

  const saveLine = async () => {
    if (!line) return;
    setBusy(true);
    try {
      const res = await fetch("/api/service-lines", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceLine: line }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Save failed");
      toast("success", line.id ? "Service line updated." : `${line.name} added.`);
      setLine(null);
      hydrate().catch(() => {});
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const saveProduct = async () => {
    if (!product) return;
    setBusy(true);
    try {
      const res = await fetch("/api/service-lines", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Save failed");
      toast("success", product.id ? "Product updated." : `${product.name} added.`);
      setProduct(null);
      hydrate().catch(() => {});
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!del) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/service-lines?id=${del.id}&what=${del.kind}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Delete failed");
      toast("success", "Deleted.");
      setDel(null);
      hydrate().catch(() => {});
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-disp font-semibold text-[15px] m-0">Service lines · {serviceLines.length}</h3>
          <p className="text-[12px] text-[var(--ink-faint)] m-0 mt-0.5">
            What the firm sells. Stages, document rules and reporting all hang off these. A line in use can be
            deactivated but never deleted — its history has to stay readable.
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setLine(blankLine(serviceLines.length + 1))}>
          <IPlus size={14} /> Add service line
        </button>
      </div>

      {serviceLines.length === 0 ? (
        <EmptyState icon={<ILayers size={20} />} title="No service lines" body="Run scripts/seed-service-lines.cjs --apply, or add one here." />
      ) : (
        <div className="space-y-3">
          {serviceLines.map((sl) => (
            <LineCard
              key={sl.id}
              sl={sl}
              caseCount={caseCount.get(sl.id) ?? 0}
              onEdit={() => setLine({
                id: sl.id, code: sl.code, name: sl.name, shortName: sl.shortName,
                notes: sl.notes, bankRaced: sl.bankRaced, active: sl.active, sortOrder: sl.sortOrder,
              })}
              onDelete={() => setDel({ kind: "line", id: sl.id, label: sl.name })}
              onAddProduct={() => setProduct(blankProduct(sl.id, (sl.products?.length ?? 0) + 1))}
              onEditProduct={(p) => setProduct({ ...p })}
              onDeleteProduct={(p) => setDel({ kind: "product", id: p.id, label: p.name })}
            />
          ))}
        </div>
      )}

      {line && (
        <Modal
          title={line.id ? "Edit service line" : "New service line"}
          sub={line.id ? `${line.code} — the code cannot be changed` : "Code is UPPER_SNAKE and becomes permanent"}
          onClose={() => setLine(null)}
          width={520}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setLine(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveLine} disabled={busy || !line.code.trim()}>
                {busy ? "Saving…" : "Save"}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Code</label>
                <input
                  className="input" value={line.code} disabled={!!line.id}
                  onChange={(e) => setLine({ ...line, code: e.target.value.toUpperCase().replace(/\s+/g, "_") })}
                  placeholder="GOLDEN_VISA" title={line.id ? "Permanent — referenced by code" : "e.g. GOLDEN_VISA"}
                />
              </div>
              <div>
                <label className="label">Sort order</label>
                <input className="input" type="number" value={line.sortOrder}
                  onChange={(e) => setLine({ ...line, sortOrder: Number(e.target.value) || 0 })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Name</label>
                <input className="input" value={line.name} onChange={(e) => setLine({ ...line, name: e.target.value })}
                  placeholder="Golden visa assistance" />
              </div>
              <div>
                <label className="label">Short name <span className="text-[var(--ink-faint)]">(chips)</span></label>
                <input className="input" value={line.shortName} onChange={(e) => setLine({ ...line, shortName: e.target.value })}
                  placeholder="Golden Visa" />
              </div>
            </div>
            <div>
              <label className="label">Notes</label>
              <textarea className="input" rows={2} value={line.notes} onChange={(e) => setLine({ ...line, notes: e.target.value })}
                placeholder="What this line covers, and anything staff should know" />
            </div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={line.bankRaced}
                onChange={(e) => setLine({ ...line, bankRaced: e.target.checked })} />
              <span className="text-[12.5px]">
                <span className="font-medium">Bank-raced line</span>
                <span className="block text-[11.5px] text-[var(--ink-faint)]">
                  Work is shopped to several providers and exactly one wins — so cases here have per-bank legs with
                  Won / Lost race outcomes. On for mortgage; off for wills, visas, licences.
                </span>
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={line.active} onChange={(e) => setLine({ ...line, active: e.target.checked })} />
              <span className="text-[12.5px]">Active — offer this line to staff on new work</span>
            </label>
          </div>
        </Modal>
      )}

      {product && (
        <Modal
          title={product.id ? "Edit product" : "New product"}
          sub={product.id ? product.code : "An offering within the service line"}
          onClose={() => setProduct(null)}
          width={460}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setProduct(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveProduct}
                disabled={busy || !product.code.trim() || !product.name.trim()}>
                {busy ? "Saving…" : "Save"}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Code</label>
                <input className="input" value={product.code} disabled={!!product.id}
                  onChange={(e) => setProduct({ ...product, code: e.target.value.toUpperCase().replace(/\s+/g, "-") })}
                  placeholder="GV-10" />
              </div>
              <div>
                <label className="label">Sort order</label>
                <input className="input" type="number" value={product.sortOrder}
                  onChange={(e) => setProduct({ ...product, sortOrder: Number(e.target.value) || 0 })} />
              </div>
            </div>
            <div>
              <label className="label">Name</label>
              <input className="input" value={product.name} onChange={(e) => setProduct({ ...product, name: e.target.value })}
                placeholder="Golden visa — 10 year" />
            </div>
            <div>
              <label className="label">Notes</label>
              <input className="input" value={product.notes} onChange={(e) => setProduct({ ...product, notes: e.target.value })}
                placeholder="AED 2M+ threshold" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={product.active} onChange={(e) => setProduct({ ...product, active: e.target.checked })} />
              <span className="text-[12.5px]">Active</span>
            </label>
          </div>
        </Modal>
      )}

      {del && (
        <ConfirmModal
          open={!!del}
          onClose={() => setDel(null)}
          title={`Delete ${del.kind === "line" ? "service line" : "product"}?`}
          body={`"${del.label}" will be removed. If anything still uses it this is refused — deactivate instead so the history stays readable.`}
          confirmLabel="Delete"
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}

function LineCard({
  sl, caseCount, onEdit, onDelete, onAddProduct, onEditProduct, onDeleteProduct,
}: {
  sl: ServiceLineDto;
  caseCount: number;
  onEdit: () => void;
  onDelete: () => void;
  onAddProduct: () => void;
  onEditProduct: (p: { id: number; serviceLineId: number; code: string; name: string; notes: string; active: boolean; sortOrder: number }) => void;
  onDeleteProduct: (p: { id: number; name: string }) => void;
}) {
  const products = sl.products ?? [];
  return (
    <div className="card p-3.5" style={{ opacity: sl.active ? 1 : 0.6 }}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-disp font-semibold text-[14px] truncate">{sl.name}</span>
          <span className="mono text-[11px] text-[var(--ink-faint)]">{sl.code}</span>
          {sl.bankRaced && <Chip tone="amber">bank-raced</Chip>}
          {!sl.active && <Chip tone="slate">inactive</Chip>}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11.5px] text-[var(--ink-faint)]">{caseCount} case{caseCount === 1 ? "" : "s"}</span>
          <button className="btn btn-ghost btn-sm !px-2" onClick={onAddProduct} title="Add a product">
            <IPlus size={13} /> Product
          </button>
          <button className="btn btn-ghost btn-sm !px-2" onClick={onEdit} title="Edit"><IPencil size={13} /></button>
          <button className="btn btn-ghost btn-sm !px-2" onClick={onDelete} title="Delete"><ITrash size={13} /></button>
        </div>
      </div>

      {sl.notes && <p className="text-[11.5px] text-[var(--ink-dim)] m-0 mb-2">{sl.notes}</p>}

      {products.length === 0 ? (
        <p className="text-[11.5px] text-[var(--ink-faint)] m-0">No products yet.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {products.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1.5" style={{ opacity: p.active ? 1 : 0.55 }}>
              <Chip tone="slate">{p.name}</Chip>
              <button className="text-[var(--ink-faint)] hover:text-[var(--ink)]" onClick={() => onEditProduct(p)} title="Edit">
                <IPencil size={11} />
              </button>
              <button className="text-[var(--ink-faint)] hover:text-[var(--coral)]" onClick={() => onDeleteProduct(p)} title="Delete">
                <ITrash size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}