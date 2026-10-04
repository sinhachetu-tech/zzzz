"use client";

import { useCallback, useEffect, useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { ClientDocDto } from "@/lib/types";
import { Chip, EmptyState } from "@/components/hfmc/ui";
import { ILayers, IPlus, ITrash } from "@/components/icons";

/* The client's PERSON-LEVEL document vault (Phase G).
 *
 * WHY IT IS SEPARATE FROM THE CASE VAULT: the case vault is per-engagement. A passport
 * belongs to the human, so uploading it once here satisfies the EID slot on the mortgage,
 * the golden visa AND the will. This is the "documents already on file for this client"
 * surface, with one-click attach onto the case in front of you.
 *
 * TWO FIELDS CARRY THE POLICY, both visible on every row:
 *   · the owning DEPARTMENT — provenance, never rewritten when another department
 *     attaches the file. A bank valuation stays "Mortgage" even on a will.
 *   · SHARING — All (default; the realistic failure is a missing passport, not a leaked
 *     one) | Team | Department.
 */
export function ClientVaultPanel({ clientId, caseId }: { clientId: number | null; caseId: number }) {
  const { serviceLines, toast } = useHfmcStore();
  const [docs, setDocs] = useState<ClientDocDto[]>([]);
  // Starts TRUE so the first paint shows the loading state without the effect ever
  // calling setState synchronously — see the effect below.
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: "", category: "KYC", serviceLineId: "", sharing: "All" });

  // `reload` is used by the action handlers; the effect has its own copy so a
  // re-render triggered by setDocs cannot re-trigger the fetch.
  const reload = useCallback(async () => {
    if (!clientId) return;
    try {
      const res = await fetch(`/api/client-documents?clientId=${clientId}`);
      if (!res.ok) throw new Error("could not load");
      const j = await res.json();
      setDocs(j.documents ?? []);
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

   
  // in the async continuation below, never synchronously in the effect body.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!clientId) { setDocs([]); setLoading(false); return; }
      try {
        const res = await fetch(`/api/client-documents?clientId=${clientId}`);
        if (cancelled) return;
        const j = res.ok ? await res.json() : { documents: [] };
        if (!cancelled) setDocs(j.documents ?? []);
      } catch {
        if (!cancelled) setDocs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  if (!clientId) {
    return (
      <div className="card p-4 mt-4">
        <p className="text-[12.5px] text-[var(--ink-faint)] m-0">
          No client record is linked to this case yet, so there is no personal document vault to show.
        </p>
      </div>
    );
  }

  const run = async (label: number, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  const create = () =>
    run(-1, async () => {
      const title = draft.title.trim();
      if (!title) return;
      const res = await fetch("/api/client-documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId, title, category: draft.category, sharing: draft.sharing,
          serviceLineId: draft.serviceLineId ? Number(draft.serviceLineId) : null,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not add");
      toast("success", "Requested. The client can upload it from their portal.");
      setDraft({ title: "", category: "KYC", serviceLineId: "", sharing: "All" });
      setAdding(false);
      await reload();
    });

  // The whole point of the vault: attach an existing file to THIS case without
  // re-uploading it.
  const attach = (doc: ClientDocDto) =>
    run(doc.id, async () => {
      const res = await fetch("/api/client-documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientDocumentId: doc.id, attachToCaseId: caseId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not attach");
      toast("success", `${doc.title} attached to this case.`);
      await reload();
    });

  const setSharing = (doc: ClientDocDto, sharing: string) =>
    run(doc.id, async () => {
      const res = await fetch(`/api/client-documents?id=${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sharing }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not update");
      await reload();
    });

  const remove = (doc: ClientDocDto) =>
    run(doc.id, async () => {
      const res = await fetch(`/api/client-documents?id=${doc.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not remove");
      toast("success", "Removed from the vault.");
      await reload();
    });
  return (
    <div className="card p-4 mt-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h4 className="font-semibold text-[13px] m-0 flex items-center gap-1.5">
            <ILayers size={14} /> On file for this client
          </h4>
          <p className="text-[11.5px] text-[var(--ink-faint)] m-0 mt-0.5">
            One copy per person, usable by every service. Attach instead of re-uploading.
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setAdding((v) => !v)}>
          <IPlus size={13} /> Request
        </button>
      </div>

      {adding && (
        <div className="rounded-lg p-3 mb-3" style={{ background: "var(--tint)" }}>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="input"
              placeholder="e.g. Emirates ID (front &amp; back)"
              value={draft.title}
              autoFocus
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
            <select className="select" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
              {["KYC", "Income", "Asset", "Property", "Other"].map((c) => <option key={c}>{c}</option>)}
            </select>
            <select
              className="select"
              value={draft.serviceLineId}
              onChange={(e) => setDraft({ ...draft, serviceLineId: e.target.value })}
            >
              <option value="">Firm-wide (no department)</option>
              {serviceLines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <select className="select" value={draft.sharing} onChange={(e) => setDraft({ ...draft, sharing: e.target.value })}>
              <option value="All">Anyone can use it</option>
              <option value="Team">Owning department only</option>
              <option value="Department">Department only (strict)</option>
            </select>
          </div>
          <div className="flex gap-2 mt-2">
            <button className="btn btn-primary btn-sm" disabled={busy === -1} onClick={create}>Add</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-[12px] text-[var(--ink-faint)] m-0">Loading…</p>
      ) : docs.length === 0 ? (
        <EmptyState
          icon={null}
          title="Nothing on file yet"
          body="Request a document and the client uploads it once from their portal — every service then reuses it."
        />
      ) : (
        <div className="space-y-1.5">
          {docs.map((d) => {
            const uses = d.attachedTo ?? [];
            const attachedHere = uses.some((a) => a.caseId === caseId);
            return (
              <div key={d.id} className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ background: "var(--tint)" }}>
                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] font-medium truncate m-0">{d.title}</p>
                  <p className="text-[10.5px] text-[var(--ink-faint)] m-0 truncate">
                    {d.category}
                    {d.serviceLineName ? ` · ${d.serviceLineName}` : " · firm-wide"}
                    {d.hasFile ? "" : " · not uploaded yet"}
                    {uses.length > 0 ? ` · used on ${uses.length} case${uses.length > 1 ? "s" : ""}` : ""}
                  </p>
                </div>
                <select
                  className="select select-sm"
                  value={d.sharing}
                  disabled={busy === d.id}
                  onChange={(e) => setSharing(d, e.target.value)}
                  title="Who may use this document"
                >
                  <option value="All">All</option>
                  <option value="Team">Team</option>
                  <option value="Department">Dept</option>
                </select>
                {attachedHere ? (
                  <Chip tone="mint">on this case</Chip>
                ) : (
                  <button className="btn btn-ghost btn-sm" disabled={busy === d.id} onClick={() => attach(d)}>Attach</button>
                )}
                <button className="btn btn-ghost btn-sm" title="Remove from vault" disabled={busy === d.id} onClick={() => remove(d)}>
                  <ITrash size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
