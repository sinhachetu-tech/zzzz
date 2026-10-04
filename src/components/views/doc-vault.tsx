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
import { ICheck, IPencil, IPlus, ITrash, IUpload, IX, IDownload, ILayers, IFileText, IImage, IMail, IGripVertical, IChevronUp, IChevronDown, IImage as IImageIcon, IFile, ITrash2 } from "@/components/icons";

const STATUS_TONE: Record<string, "mint" | "amber" | "coral" | "sky" | "slate"> = {
  "Verified": "mint",
  "Uploaded": "sky",
  "Rejected": "coral",
  "Waived": "slate",
  "Pending upload": "amber",
};

const CATEGORY_ORDER = ["Chat", "KYC", "Income", "Property", "Bank & Liabilities", "Valuation", "Transfer", "Internal Underwriting", "Other"];

/** Human-readable file size for the storage line under each document. */
function kb(n?: number | null): string {
  if (!n) return "—";
  return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocVault({ c }: { c: LoanCase }) {
  const { caseDocuments, docRules, saveDoc, deleteDoc, addAdhocDoc, uploadDoc, compressDoc, selectDocVersion, mergeDocs, convertToPdf, downloadZip, borrowDocument, cases, flags, toast } = useHfmcStore();
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
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [converting, setConverting] = useState<{ doc: CaseDocument; crop?: { x: number; y: number; width: number; height: number } } | null>(null);
  const [mergeName, setMergeName] = useState("");
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [borrowing, setBorrowing] = useState(false);
  const [mergeItems, setMergeItems] = useState<CaseDocument[]>([]);

  // Everything this SAME client already has on another case, with a file on it.
  // Scoped to the person (primary or co-partner), because that is where a broker
  // will actually look for a document they know the client has already sent.
  const borrowable = useMemo(() => {
    const personIds = [c.clientId, c.secondPartyClientId].filter(Boolean) as number[];
    if (personIds.length === 0) return [];
    const caseById = new Map(cases.map((k) => [k.id, k]));
    return caseDocuments.filter((d) => {
      if (d.caseId === c.id) return false;
      if (!d.hasFile) return false;
      const other = caseById.get(d.caseId);
      if (!other) return false;
      return [other.clientId, other.secondPartyClientId].some((x) => x && personIds.includes(x));
    });
  }, [caseDocuments, cases, c.id, c.clientId, c.secondPartyClientId]);
  const uploadTarget = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // rebuilds the preview copy; the original for the bank is never touched
  const onCompress = async (d: CaseDocument) => {
    setCompressId(d.id);
    await compressDoc(d.id, d.hasCompressed);
    setCompressId(null);
  };

  // Selection handlers
  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAll = () => {
    const ids = new Set(filteredDocs.filter((d) => d.hasFile).map((d) => d.id));
    setSelectedIds(ids);
  };
  const clearSelection = () => setSelectedIds(new Set());

  // Merge selected documents - open modal with drag-and-drop reorder
  const openMergeModal = () => {
    const ids = selectedIds; // keep as Set for .has()
    if (ids.size < 2) return;
    // Get docs in current filtered order, but only selected ones
    const selectedDocs = filteredDocs.filter((d) => ids.has(d.id));
    setMergeItems(selectedDocs);
    setMergeName(`merged-${c.caseNumber}-${Date.now()}.pdf`);
    setShowMergeModal(true);
  };

  const moveMergeItem = (index: number, direction: "up" | "down") => {
    setMergeItems((prev) => {
      const next = [...prev];
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= next.length) return prev;
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const removeMergeItem = (docId: number) => {
    setMergeItems((prev) => prev.filter((d) => d.id !== docId));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(docId);
      return next;
    });
  };

  const onMerge = async () => {
    if (mergeItems.length < 2) return;
    const name = mergeName.trim() || `merged-${Date.now()}.pdf`;
    await mergeDocs(mergeItems.map((d) => d.id), name);
    clearSelection();
    setShowMergeModal(false);
    setMergeName("");
    setMergeItems([]);
  };

  // Inline convert image to PDF (replaces the file in the vault)
  const onConvertImageToPdf = async (doc: CaseDocument) => {
    const newName = doc.fileName?.replace(/\.[^.]+$/, ".pdf") || "document.pdf";
    await convertToPdf(doc.id, undefined, newName);
  };

  // Download selected as ZIP for email attachment
  const onDownloadZip = async (useCompressed = false) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const result = await downloadZip(ids, `documents-${c.caseNumber}-${Date.now()}.zip`, useCompressed);
    if (result?.downloadUrl) {
      window.open(result.downloadUrl, "_blank");
    }
    clearSelection();
  };

  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [editingNameId, setEditingNameId] = useState<number | null>(null);
  const [nameInput, setNameInput] = useState("");

  const allCategories = useMemo(() => {
    const present = new Set<string>();
    for (const d of docs) {
      if (d.category) present.add(d.category);
    }
    const ordered = CATEGORY_ORDER.filter((k) => present.has(k));
    for (const k of present) {
      if (!ordered.includes(k)) ordered.push(k);
    }
    return ["All", ...ordered];
  }, [docs]);

  const filteredDocs = useMemo(() => {
    if (selectedCategory === "All") return docs;
    return docs.filter((d) => d.category === selectedCategory);
  }, [docs, selectedCategory]);

  const grouped = useMemo(() => {
    const map = new Map<string, CaseDocument[]>();
    for (const d of filteredDocs) {
      const list = map.get(d.category) ?? [];
      list.push(d);
      map.set(d.category, list);
    }
    const ordered = CATEGORY_ORDER.filter((k) => map.has(k));
    const extra = Array.from(map.keys()).filter((k) => !CATEGORY_ORDER.includes(k));
    return [...ordered, ...extra].map((k) => ({ category: k, items: map.get(k)! }));
  }, [filteredDocs]);

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
          <>
            {/* Copy from another case. The automatic sibling copy in add-bank
                fires once, silently, and only at the moment a bank is added — so
                it never answers "the EID is on the other leg, how do I get it
                across?", and cannot help legs that predate it. This is the
                manual, discoverable version, scoped to the SAME CLIENT. */}
            {borrowable.length > 0 && (
              <button
                className="btn btn-ghost sm:btn-sm"
                onClick={() => setBorrowing(true)}
                title={`This client already has ${borrowable.length} document(s) on their other case(s)`}
              >
                Copy from another case ({borrowable.length})
              </button>
            )}
            <button className="btn btn-primary sm:btn-sm" onClick={() => setAdding(true)}>
              <IPlus size={14} /> Add document
            </button>
          </>
        )}
      </div>

      {/* Category filter pills */}
      {docs.length > 0 && allCategories.length > 2 && (
        <div className="flex items-center gap-1.5 px-4 pt-2.5 pb-2 overflow-x-auto border-b" style={{ borderColor: "var(--line-soft)" }}>
          {allCategories.map((cat) => {
            const count = cat === "All" ? docs.length : docs.filter((d) => d.category === cat).length;
            const isSel = selectedCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className="chip text-[11px] px-2.5 py-0.5 font-medium transition-all"
                style={
                  isSel
                    ? { background: "var(--mint, #10b981)", color: "#fff", borderColor: "var(--mint, #10b981)" }
                    : { background: "var(--bg2)", color: "var(--ink-dim)", borderColor: "var(--line-soft)" }
                }
              >
                {cat} <span className="opacity-80 text-[10.5px] ml-1 mono">({count})</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Bulk action bar — appears when documents are selected */}
      {selectedIds.size > 0 && canManage && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b" style={{ borderColor: "var(--line-soft)", background: "var(--bg2)" }}>
          <span className="text-[11px] font-medium text-[var(--ink-dim)]">{selectedIds.size} selected</span>
          <button className="btn btn-ghost btn-sm" onClick={selectAll} title="Select all visible">
            <span className="text-[10.5px]">All</span>
          </button>
          <button className="btn btn-ghost btn-sm" onClick={clearSelection} title="Clear selection">
            <span className="text-[10.5px]">Clear</span>
          </button>
          <div className="flex-1" />
          {/* Merge */}
          <button
            className="btn btn-primary btn-sm"
            disabled={selectedIds.size < 2}
            onClick={openMergeModal}
            title="Merge selected into one PDF (drag to reorder)"
          >
            <ILayers size={13} /> Merge to PDF
          </button>
          {/* Download as ZIP for email — secondary action */}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => onDownloadZip(false)}
            title="Download selected as ZIP for email attachment"
          >
            <IDownload size={13} /> ZIP
          </button>
        </div>
      )}
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
                    {canManage && d.hasFile && (
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-[var(--line)] text-[var(--mint)] focus:ring-[var(--mint)]"
                        checked={selectedIds.has(d.id)}
                        onChange={() => toggleSelect(d.id)}
                        title="Select for bulk actions"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {editingNameId === d.id ? (
                          <input
                            className="input !py-0.5 !px-1.5 text-[12.5px] font-medium max-w-[280px]"
                            autoFocus
                            value={nameInput}
                            onChange={(e) => setNameInput(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.key === "Enter") {
                                await saveDoc(d.id, { displayName: nameInput.trim() || null });
                                setEditingNameId(null);
                              } else if (e.key === "Escape") {
                                setEditingNameId(null);
                              }
                            }}
                            onBlur={async () => {
                              if (nameInput.trim() !== (d.displayName || d.title)) {
                                await saveDoc(d.id, { displayName: nameInput.trim() || null });
                              }
                              setEditingNameId(null);
                            }}
                          />
                        ) : (
                          <span
                            className="text-[12.5px] font-medium cursor-pointer hover:underline flex items-center gap-1 group"
                            title={canManage ? "Click to rename" : undefined}
                            onClick={() => {
                              if (canManage) {
                                setEditingNameId(d.id);
                                setNameInput(d.displayName || d.title);
                              }
                            }}
                          >
                            {d.displayName || d.title}
                            {canManage && (
                              <IPencil size={11} className="opacity-40 group-hover:opacity-100 transition-opacity text-[var(--ink-faint)]" />
                            )}
                          </span>
                        )}
                        {d.source === "chat" && <Chip tone="sky">from chat</Chip>}
                        {d.mandatory && <span title="Mandatory" style={{ color: "var(--coral)" }}>*</span>}
                        <Chip tone={d.visibleToClient ? "sky" : "slate"}>{d.visibleToClient ? "client visible" : "internal"}</Chip>
                        {d.templateId == null && <Chip tone="amber">ad-hoc</Chip>}
                        {canManage && (
                          <select
                            className="select !py-0 !px-1.5 text-[10.5px] h-[22px] bg-transparent border-none text-[var(--ink-faint)] hover:text-[var(--ink)] cursor-pointer"
                            value={d.category}
                            title="Change category"
                            onChange={(e) => saveDoc(d.id, { category: e.target.value })}
                          >
                            {DOC_CATEGORIES.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                          </select>
                        )}
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
                              <span className="text-[10.5px] text-[var(--ink-faint)]">send:</span>
                              <button
                                className="chip !px-1.5 !py-0.5 text-[10.5px]"
                                title="Full quality — the version banks want"
                                onClick={() => selectDocVersion(d.id, "original")}
                                style={d.selectedVersion === "original" ? { borderColor: "var(--sky)", color: "var(--sky)" } : undefined}
                              >
                                original
                              </button>
                              <button
                                className="chip !px-1.5 !py-0.5 text-[10.5px]"
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
                      {/* Convert image to PDF (inline - replaces file in vault) */}
                      {d.hasFile && canManage && d.fileType?.startsWith("image/") && (
                        <button
                          className="btn btn-ghost btn-sm !px-1 text-[10.5px]"
                          title="Convert to PDF (replaces image in vault)"
                          onClick={() => onConvertImageToPdf(d)}
                        >
                          <IFileText size={11} /> → PDF
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

      {/* Copy-from-another-case picker */}
      {borrowing && (
        <Modal
          title="Copy from this client's other case"
          sub="Same file, no re-upload. It arrives as “Uploaded” — check it, then mark it verified."
          onClose={() => setBorrowing(false)}
          width={620}
        >
          {borrowable.length === 0 ? (
            <p className="text-[12.5px] text-[var(--ink-faint)] m-0">
              This client has no documents with files on any other case yet.
            </p>
          ) : (
            <div className="space-y-1.5 max-h-[52vh] overflow-y-auto">
              {borrowable.map((d) => {
                const from = cases.find((k) => k.id === d.caseId);
                const already = d.templateId != null && docs.some((x) => x.templateId === d.templateId && x.hasFile);
                return (
                  <div key={d.id} className="flex items-center gap-2 rounded-lg px-2.5 py-2" style={{ background: "var(--tint)", border: "1px solid var(--line-soft)" }}>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-medium truncate">{d.displayName || d.title}</div>
                      <div className="mono text-[10.5px] text-[var(--ink-faint)] truncate">
                        {from?.caseNumber} · {from?.banks[0] ?? "no bank"} · {d.fileName}
                      </div>
                    </div>
                    {already ? (
                      <span className="chip shrink-0" style={{ fontSize: "9.5px", color: "var(--mint)", background: "rgba(16,185,129,0.12)", borderColor: "rgba(16,185,129,0.3)" }}>
                        already here
                      </span>
                    ) : (
                      <button
                        className="btn btn-mint btn-sm shrink-0"
                        onClick={async () => {
                          try {
                            await borrowDocument(c.id, d.id, d.templateId);
                          } catch (e) {
                            toast("error", e instanceof Error ? e.message : "Could not copy that document.");
                          }
                        }}
                      >
                        Copy
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Modal>
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

      {/* Merge modal with drag-and-drop reorder */}
      {showMergeModal && (
        <MergeModal
          items={mergeItems}
          onReorder={setMergeItems}
          onRemove={removeMergeItem}
          mergeName={mergeName}
          setMergeName={setMergeName}
          onMerge={onMerge}
          onClose={() => { setShowMergeModal(false); setMergeName(""); setMergeItems([]); }}
        />
      )}

    </div>
  );
}

/* ---------------- add ad-hoc ---------------- */

/* "Application Form" is its own category because an application form is NOT a
   client-supplied document — it is one the BROKER fills in and sends to the bank.
   Banks commonly want it "filled, not signed" (the RM signs, or e-signature
   happens separately), so it has its own lifecycle rather than living under
   Income/KYC where it would be treated like something to collect. */
const DOC_CATEGORIES = ["Chat", "KYC", "Income", "Property", "Bank & Liabilities", "Application Form", "Valuation", "Transfer", "Internal Underwriting", "Other"];

/** Statuses an APPLICATION FORM moves through. `status` is a plain String column,
 *  not a DB enum, so these cost no migration — but they must be understood by
 *  the vault's status filter or an unsigned form will look "not done". */
export const FORM_STATUSES = [
  "Filled (unsigned)",
  "Submitted to bank",
  "Signed",
  "Returned by bank",
] as const;

/** Documents that are outstanding = no file attached AND not explicitly waived.
 *  A stored "done" flag would drift from reality; deriving it cannot. */
export function isDocOutstanding(status: string, hasFile: boolean): boolean {
  if (status === "Waived") return false;
  return !hasFile;
}

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
  const [displayName, setDisplayName] = useState(doc.displayName ?? "");
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
          <button className="btn btn-primary" onClick={() => onSave({ title, displayName: displayName.trim() || null, category, mandatory, visibleToClient, clientCanUpload, expiryDate, notes })}>
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
        <div>
          <label className="label">Custom Display Name (optional override)</label>
          <input className="input" placeholder="e.g. Emirates ID — Lakshmi Nair" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
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

/* ---------------- convert to PDF ---------------- */

function ConvertToPdfModal({ doc, onClose, onConfirm }: { doc: CaseDocument; onClose: () => void; onConfirm: (crop?: { x: number; y: number; width: number; height: number }) => Promise<void> }) {
  const [crop, setCrop] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [outputName, setOutputName] = useState(doc.fileName?.replace(/\.[^.]+$/, ".pdf") || "document.pdf");

  return (
    <Modal
      title="Convert to PDF"
      onClose={onClose}
      width={480}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onConfirm(crop || undefined)}>
            <IFileText size={14} /> Convert
          </button>
        </>
      }
    >
      <p className="text-[12.5px] text-[var(--ink-dim)] mt-0 mb-3">
        Convert <strong>{doc.fileName}</strong> to PDF. Optionally crop the image first.
      </p>
      <div className="space-y-3">
        <div>
          <label className="label">Output filename</label>
          <input className="input" value={outputName} onChange={(e) => setOutputName(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setCrop(null)}
            style={!crop ? { borderColor: "var(--mint)", color: "var(--mint)" } : undefined}
          >
            No crop (full image)
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setCrop({ x: 0, y: 0, width: 1000, height: 1414 });
            }}
          >
            A4 portrait
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setCrop({ x: 0, y: 0, width: 1414, height: 1000 });
            }}
          >
            A4 landscape
          </button>
        </div>
        {crop && (
          <div className="p-3 rounded border" style={{ borderColor: "var(--line-soft)", background: "var(--bg2)" }}>
            <p className="text-[11px] font-medium m-0 mb-1">Crop area (pixels):</p>
            <div className="grid grid-cols-4 gap-2 text-[11px] mono">
              <div>X: {crop.x}</div>
              <div>Y: {crop.y}</div>
              <div>W: {crop.width}</div>
              <div>H: {crop.height}</div>
            </div>
            <p className="text-[10.5px] text-[var(--ink-faint)] m-0 mt-1">For precise cropping, use an image editor before upload, or implement a canvas cropper.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ---------------- merge modal with drag-and-drop ---------------- */

interface MergeModalProps {
  items: CaseDocument[];
  onReorder: (items: CaseDocument[]) => void;
  onRemove: (docId: number) => void;
  mergeName: string;
  setMergeName: (name: string) => void;
  onMerge: () => Promise<void>;
  onClose: () => void;
}

function MergeModal({ items, onReorder, onRemove, mergeName, setMergeName, onMerge, onClose }: MergeModalProps) {
  const moveItem = (index: number, direction: "up" | "down") => {
    const next = [...items];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= next.length) return;
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    onReorder(next);
  };

  const totalSize = items.reduce((sum, d) => sum + (d.fileSize || 0), 0);
  const fmtSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  return (
    <Modal
      title="Merge to PDF"
      onClose={onClose}
      width={560}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={items.length < 2 || !mergeName.trim()}
            onClick={onMerge}
          >
            <ILayers size={14} /> Merge {items.length} documents
          </button>
        </>
      }
    >
      <p className="text-[12.5px] text-[var(--ink-dim)] mt-0 mb-3">
        Drag to reorder — merged in this sequence. Originals stay in vault.
      </p>

      {/* Reorderable list */}
      <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1" style={{ scrollbarWidth: "thin" }}>
        {items.map((doc, index) => (
          <div
            key={doc.id}
            className="flex items-center gap-2 p-2 rounded bg-[var(--bg2)] border transition-colors"
            style={{ borderColor: "var(--line-soft)" }}
          >
            <button
              type="button"
              className="btn btn-ghost btn-sm p-1 text-[var(--ink-faint)] hover:text-[var(--ink)]"
              onClick={() => moveItem(index, "up")}
              disabled={index === 0}
              title="Move up"
              aria-label="Move up"
            >
              <IChevronUp size={14} />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm p-1 text-[var(--ink-faint)] hover:text-[var(--ink)]"
              onClick={() => moveItem(index, "down")}
              disabled={index === items.length - 1}
              title="Move down"
              aria-label="Move down"
            >
              <IChevronDown size={14} />
            </button>
            <span className="text-[11px] mono text-[var(--ink-dim)] min-w-[1.5rem] text-right">{index + 1}.</span>
            <span className="w-6 h-6 flex items-center justify-center rounded" style={{ background: doc.fileType?.startsWith("image/") ? "rgba(139,92,246,0.12)" : "rgba(16,185,129,0.12)" }}>
              {doc.fileType?.startsWith("image/") ? <span style={{ color: "var(--violet)" }}><IImageIcon size={12} /></span> : <span style={{ color: "var(--mint)" }}><IFile size={12} /></span>}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium truncate m-0">{doc.displayName || doc.title}</p>
              <p className="text-[10.5px] mono text-[var(--ink-faint)] m-0">{doc.fileName} · {fmtSize(doc.fileSize || 0)}</p>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm p-1 text-[var(--coral)] hover:bg-[rgba(242,115,99,0.1)] rounded"
              onClick={() => onRemove(doc.id)}
              title="Remove from merge"
              aria-label={`Remove ${doc.title}`}
            >
              <ITrash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      {items.length < 2 && (
        <p className="text-[11px] text-[var(--coral)] mt-2 text-center">Add at least 2 documents to merge</p>
      )}

      <div className="mt-3 pt-3 border-t flex items-center justify-between text-[11px] mono text-[var(--ink-faint)]" style={{ borderColor: "var(--line-soft)" }}>
        <span>{items.length} documents</span>
        <span>Est. size: ~{fmtSize(totalSize)}</span>
      </div>

      <div className="mt-3">
        <label className="label">Output filename</label>
        <input
          className="input"
          autoFocus
          value={mergeName}
          onChange={(e) => setMergeName(e.target.value)}
          placeholder="merged-document.pdf"
        />
      </div>
    </Modal>
  );
}
