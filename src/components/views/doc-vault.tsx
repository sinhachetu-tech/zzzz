"use client";
import { parseCaseProfile } from "@/lib/case-profile";

/* Document Vault — per-case tab. Conditional checklist (auto-populated by the
   rule engine) + ad-hoc requirements, with upload / verify / reject / waive /
   edit / delete CRUD. */

import { useMemo, useRef, useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { CaseDocument, LoanCase } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { Chip, Modal } from "@/components/hfmc/ui";
import { ConfirmModal } from "@/components/hfmc/bits";
import { ICheck, IPlus, ITrash, IUpload, IX } from "@/components/icons";

const STATUS_TONE: Record<string, "mint" | "amber" | "coral" | "sky" | "slate"> = {
  "Verified": "mint",
  "Uploaded": "sky",
  "Rejected": "coral",
  "Waived": "slate",
  "Pending upload": "amber",
};

const CATEGORY_ORDER = ["KYC", "Income", "Property", "Bank & Liabilities", "Valuation", "Transfer", "Internal Underwriting"];

/** Human-readable file size for the storage line under each document. */
function kb(n?: number | null): string {
  if (!n) return "—";
  return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocVault({ c }: { c: LoanCase }) {
  const { caseDocuments, docRules, saveDoc, deleteDoc, addAdhocDoc, uploadDoc, compressDoc, selectDocVersion, flags, toast } = useHfmcStore();
  // document writes (upload/verify/reject/waive/delete/compress) are permission-gated
  const canManage = !!(flags?.manageDocs || flags?.super || flags?.admin);
  const docs = useMemo(() => caseDocuments.filter((d) => d.caseId === c.id), [caseDocuments, c.id]);
  const [adding, setAdding] = useState(false);
  const [rejecting, setRejecting] = useState<CaseDocument | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [deleting, setDeleting] = useState<CaseDocument | null>(null);
  const [editing, setEditing] = useState<CaseDocument | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [compressId, setCompressId] = useState<number | null>(null);
  const uploadTarget = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // rebuilds the preview copy; the original for the bank is never touched
  const onCompress = async (d: CaseDocument) => {
    setCompressId(d.id);
    await compressDoc(d.id, d.hasCompressed);
    setCompressId(null);
  };

  const grouped = useMemo(() => {
    const map = new Map<string, CaseDocument[]>();
    for (const d of docs) {
      const list = map.get(d.category) ?? [];
      list.push(d);
      map.set(d.category, list);
    }
    return CATEGORY_ORDER.filter((k) => map.has(k)).map((k) => ({ category: k, items: map.get(k)! }));
  }, [docs]);

  const verified = docs.filter((d) => d.status === "Verified" || d.status === "Waived").length;
  const applicableMandatory = docs.filter((d) => d.mandatory && d.status !== "Waived");
  const mandatoryDone = applicableMandatory.filter((d) => d.status === "Verified").length;
  const pct = docs.length ? Math.round((verified / docs.length) * 100) : 0;
  const blocked = applicableMandatory.length - mandatoryDone;

  const pendingReview = docs.filter((d) => d.status === "Uploaded");

  const onPickFile = (docId: number) => {
    uploadTarget.current = docId;
    fileInput.current?.click();
  };
  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    const id = uploadTarget.current;
    e.target.value = "";
    if (!f || !id) return;
    setBusyId(id);
    await uploadDoc(id, f);
    setBusyId(null);
  };

  return (
    <div className="card anim-fade-up">
      <input ref={fileInput} type="file" className="hidden" onChange={onFileChosen} />
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
        <div className="min-w-0 flex-1">
          <h3 className="font-disp font-semibold text-[14px] m-0 flex items-center gap-2">
            Document Vault
            <span className="mono text-[11px] text-[var(--ink-faint)] font-normal">{verified}/{docs.length} cleared</span>
            {blocked > 0 && (
              <span className="mono text-[10.5px] px-1.5 py-0.5 rounded" style={{ background: "rgba(242,115,99,0.12)", color: "var(--coral)" }}>
                {blocked} mandatory outstanding
              </span>
            )}
          </h3>
          <div className="h-[4px] rounded-full overflow-hidden mt-1.5" style={{ background: "var(--track)", maxWidth: 280 }}>
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: pct === 100 ? "var(--mint)" : "var(--amber)" }} />
          </div>
        </div>
        {pendingReview.length > 0 && (
          <span className="mono text-[10.5px] px-1.5 py-0.5 rounded" style={{ background: "rgba(87,194,234,0.14)", color: "var(--sky)" }}>
            {pendingReview.length} awaiting review
          </span>
        )}
        {canManage && (
          <button className="btn btn-primary sm:btn-sm" onClick={() => setAdding(true)}>
            <IPlus size={14} /> Add document
          </button>
        )}
      </div>
      {(() => {
        const prof = parseCaseProfile(c.profileJson, { customer: c.customer, coApplicantName: c.coApplicantName });
        if (prof.secondParty.role === "none") return null;
        const isCb = prof.secondParty.role === "co_borrower";
        return (
          <div className={`px-4 py-2 text-[11.5px] border-b flex items-center gap-2 ${isCb ? "bg-[var(--mint-tint)] text-[var(--ink)]" : "bg-[var(--amber-tint)] text-[var(--ink)]"}`} style={{ borderColor: "var(--line-soft)" }}>
            <span className="font-semibold">{isCb ? "Co-Borrower (Financial):" : "Co-Applicant (Title Only):"} {prof.secondParty.fullName || "Second Party"}</span>
            <span className="text-[var(--ink-dim)]">
              {isCb
                ? "� Full KYC + Income proofs (Salary Certificate, 6-Month Bank Statements) required for both borrowers."
                : "� KYC documents (Passport, Visa, Emirates ID) required for property title deed. Financial proofs not needed."}
            </span>
          </div>
        );
      })()}

      {docs.length === 0 ? (
        <p className="px-4 py-6 text-[12.5px] text-[var(--ink-faint)] m-0">
          No documents yet — the checklist fills automatically from the case profile (employment, property type, transaction, residency).
        </p>
      ) : (
        <div className="p-4 space-y-4">
          {grouped.map(({ category, items }) => (
            <div key={category}>
              <div className="text-[10.5px] uppercase tracking-[0.12em] font-disp font-semibold text-[var(--ink-faint)] mb-1.5">
                {category} · {items.filter((d) => d.status === "Verified").length}/{items.length}
              </div>
              <div className="space-y-1.5">
                {items.map((d) => (
                  <div key={d.id} className="rounded-lg px-3 py-2 flex flex-wrap items-center gap-2" style={{ background: "var(--tint)" }}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[12.5px] font-medium">{d.title}</span>
                        {d.mandatory && <span title="Mandatory" style={{ color: "var(--coral)" }}>*</span>}
                        <Chip tone={d.visibleToClient ? "sky" : "slate"}>{d.visibleToClient ? "client visible" : "internal"}</Chip>
                        {d.templateId == null && <Chip tone="amber">ad-hoc</Chip>}
                      </div>
                      {d.rejectionReason && (
                        <p className="text-[11px] m-0 mt-0.5" style={{ color: "var(--coral)" }}>Rejected: {d.rejectionReason}</p>
                      )}
                      {d.notes && d.status !== "Rejected" && (
                        <p className="text-[11px] text-[var(--ink-faint)] m-0 mt-0.5 truncate">{d.notes}</p>
                      )}
                      {d.fileName && (
                        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          <span className="text-[11px] mono text-[var(--ink-faint)]">
                            {d.fileName} · {kb(d.fileSize)}
                            {d.hasCompressed && (
                              <>
                                {" → "}
                                <span style={{ color: "var(--mint)" }}>{kb(d.compressedSize)}</span>
                              </>
                            )}
                          </span>
                          <a href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer" className="text-[11px] mono" style={{ color: "var(--sky)" }}>
                            View ↗
                          </a>
                          <a href={`/api/documents/${d.id}/file?download=1`} className="text-[11px] mono" style={{ color: "var(--sky)" }}>
                            Download
                          </a>
                          {d.driveLink && (
                            <a href={d.driveLink} target="_blank" rel="noreferrer" className="text-[11px] mono" style={{ color: "var(--mint)" }} title="Independent archive copy on Google Drive">
                              Drive ✓
                            </a>
                          )}
                          {d.hasCompressed && (
                            <span className="inline-flex items-center gap-1">
                              <span className="text-[10px] text-[var(--ink-faint)]">send:</span>
                              <button
                                className="chip !px-1.5 !py-0.5 text-[10px]"
                                title="Full quality — the version banks want"
                                onClick={() => selectDocVersion(d.id, "original")}
                                style={d.selectedVersion === "original" ? { borderColor: "var(--sky)", color: "var(--sky)" } : undefined}
                              >
                                original
                              </button>
                              <button
                                className="chip !px-1.5 !py-0.5 text-[10px]"
                                title="Smaller copy — WhatsApp / email"
                                onClick={() => selectDocVersion(d.id, "compressed")}
                                style={d.selectedVersion === "compressed" ? { borderColor: "var(--mint)", color: "var(--mint)" } : undefined}
                              >
                                compressed
                              </button>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <Chip tone={STATUS_TONE[d.status] ?? "slate"}>{d.status}</Chip>
                    <div className="flex items-center gap-1.5">
                      <button className="btn btn-ghost btn-sm !px-2" title={canManage ? (d.clientCanUpload ? "Upload file" : "Staff upload") : "Your designation cannot upload documents"} onClick={() => onPickFile(d.id)} disabled={busyId === d.id || !canManage}>
                        <IUpload size={13} />
                      </button>
                      {canManage && d.status !== "Verified" && d.status !== "Waived" && (
                        <button
                          className="btn btn-ghost btn-sm !px-2"
                          title="Verify"
                          style={{ color: "var(--mint)" }}
                          onClick={() => saveDoc(d.id, { status: "Verified" })}
                          disabled={d.status === "Pending upload"}
                        >
                          <ICheck size={13} />
                        </button>
                      )}
                      {canManage && d.status !== "Rejected" && (
                        <button
                          className="btn btn-ghost btn-sm !px-2"
                          title="Reject with reason"
                          style={{ color: "var(--coral)" }}
                          onClick={() => { setRejecting(d); setRejectReason(""); }}
                        >
                          <IX size={13} />
                        </button>
                      )}
                      {canManage && (
                        <button className="btn btn-ghost btn-sm !px-1 text-[10.5px]" title="Waive" onClick={() => saveDoc(d.id, { status: "Waived", notes: d.notes || "Waived — see activity log" })}>
                          Waive
                        </button>
                      )}
                      {d.hasFile && canManage && (
                        <button
                          className="btn btn-ghost btn-sm !px-1 text-[10.5px]"
                          title={d.hasCompressed ? "Re-compress (replaces the preview copy)" : "Make a smaller copy for WhatsApp / email"}
                          disabled={compressId === d.id}
                          onClick={() => onCompress(d)}
                        >
                          {compressId === d.id ? "…" : d.hasCompressed ? "↻ shrink" : "Compress"}
                        </button>
                      )}
                      {canManage && (
                        <button className="btn btn-ghost btn-sm !px-1 text-[10.5px]" title="Edit" onClick={() => setEditing(d)}>
                          Edit
                        </button>
                      )}
                      {canManage && (
                        <button className="btn btn-ghost btn-sm !px-2" title="Delete" style={{ color: "var(--coral)" }} onClick={() => setDeleting(d)}>
                          <ITrash size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <p className="text-[10.5px] text-[var(--ink-faint)] m-0">
            Checklist auto-generated from the case profile ({c.employmentProfile} · {c.propertyType} · {c.residency} · {c.transactionType || "New Purchase"}). Change the profile in Status &amp; operations to re-sync. <span style={{ color: "var(--coral)" }}>*</span> = mandatory.
          </p>
        </div>
      )}

      {/* ad-hoc add modal */}
      {adding && (
        <AddDocModal
          onClose={() => setAdding(false)}
          onAdd={async (input) => {
            await addAdhocDoc(c.id, input);
            setAdding(false);
          }}
        />
      )}

      {/* reject modal */}
      {rejecting && (
        <Modal
          title={`Reject: ${rejecting.title}`}
          onClose={() => setRejecting(null)}
          width={440}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setRejecting(null)}>Cancel</button>
              <button
                className="btn btn-danger"
                disabled={!rejectReason.trim()}
                onClick={async () => {
                  await saveDoc(rejecting.id, { status: "Rejected", rejectionReason: rejectReason });
                  toast("success", "Rejected — the client will see the reason on their portal.");
                  setRejecting(null);
                }}
              >
                Reject
              </button>
            </>
          }
        >
          <p className="text-[12.5px] text-[var(--ink-dim)] mt-0 mb-2.5">
            The reason shows on the client's portal with a re-upload prompt.
          </p>
          <input
            className="input"
            autoFocus
            placeholder='e.g. "Last month statement is missing the bank stamp"'
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
        </Modal>
      )}

      {/* edit modal */}
      {editing && (
        <EditDocModal
          doc={editing}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await saveDoc(editing.id, patch);
            setEditing(null);
          }}
        />
      )}

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={async () => { if (deleting) await deleteDoc(deleting.id); }}
        title="Remove document?"
        body={`"${deleting?.title ?? ""}" will be removed from this case's vault. Auto-populated items can come back if the profile changes again.`}
        confirmLabel="Remove"
      />
    </div>
  );
}

/* ---------------- add ad-hoc ---------------- */

const DOC_CATEGORIES = ["KYC", "Income", "Property", "Bank & Liabilities", "Valuation", "Transfer", "Internal Underwriting"];

function AddDocModal({ onClose, onAdd }: { onClose: () => void; onAdd: (input: { title: string; category: string; mandatory: boolean; visibleToClient: boolean; clientCanUpload: boolean; notes?: string }) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("KYC");
  const [mandatory, setMandatory] = useState(true);
  const [visibleToClient, setVisibleToClient] = useState(true);
  const [clientCanUpload, setClientCanUpload] = useState(true);
  const [notes, setNotes] = useState("");

  return (
    <Modal
      title="Add document requirement"
      sub="Ad-hoc, case-specific — e.g. a bank underwriter stipulation."
      onClose={onClose}
      width={480}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!title.trim()} onClick={() => onAdd({ title, category, mandatory, visibleToClient, clientCanUpload, notes: notes || undefined })}>
            <IPlus size={14} /> Add
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Document title</label>
          <input className="input" autoFocus placeholder='e.g. "ENBD stipulation: car loan settlement letter"' value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="label">Category</label>
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
            {DOC_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <ToggleChip on={mandatory} onClick={() => setMandatory(!mandatory)} onLabel="mandatory" offLabel="optional" />
          <ToggleChip on={visibleToClient} onClick={() => setVisibleToClient(!visibleToClient)} onLabel="client visible" offLabel="internal only" />
          <ToggleChip on={clientCanUpload} onClick={() => setClientCanUpload(!clientCanUpload)} onLabel="client can upload" offLabel="staff upload" />
        </div>
        <div>
          <label className="label">Notes (optional)</label>
          <input className="input" placeholder="Instructions for the client or the team" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

function ToggleChip({ on, onClick, onLabel, offLabel }: { on: boolean; onClick: () => void; onLabel: string; offLabel: string }) {
  return (
    <button type="button" className="chip transition-all" onClick={onClick}
      style={on
        ? { background: "rgba(67,214,155,0.12)", borderColor: "rgba(67,214,155,0.5)", color: "var(--mint)" }
        : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}>
      {on ? onLabel : offLabel}
    </button>
  );
}

/* ---------------- edit ---------------- */

function EditDocModal({ doc, onClose, onSave }: { doc: CaseDocument; onClose: () => void; onSave: (patch: Record<string, unknown>) => Promise<void> }) {
  const [title, setTitle] = useState(doc.title);
  const [category, setCategory] = useState(doc.category);
  const [mandatory, setMandatory] = useState(doc.mandatory);
  const [visibleToClient, setVisibleToClient] = useState(doc.visibleToClient);
  const [clientCanUpload, setClientCanUpload] = useState(doc.clientCanUpload);
  const [expiryDate, setExpiryDate] = useState(doc.expiryDate ?? "");
  const [notes, setNotes] = useState(doc.notes);

  return (
    <Modal
      title="Edit document"
      onClose={onClose}
      width={480}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave({ title, category, mandatory, visibleToClient, clientCanUpload, expiryDate, notes })}>
            Save
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Title</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Category</label>
            <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              {DOC_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Expiry date {doc.expiryDate && <span className="text-[var(--amber)]">· tracked</span>}</label>
            <input className="input mono" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
            {doc.expiryDate && <p className="text-[10.5px] text-[var(--ink-faint)] m-0 mt-1">currently {fmtDate(doc.expiryDate)}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <ToggleChip on={mandatory} onClick={() => setMandatory(!mandatory)} onLabel="mandatory" offLabel="optional" />
          <ToggleChip on={visibleToClient} onClick={() => setVisibleToClient(!visibleToClient)} onLabel="client visible" offLabel="internal only" />
          <ToggleChip on={clientCanUpload} onClick={() => setClientCanUpload(!clientCanUpload)} onLabel="client can upload" offLabel="staff upload" />
        </div>
        <div>
          <label className="label">Notes</label>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
