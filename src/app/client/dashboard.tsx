"use client";

import { useMemo, useState } from "react";
import { useClientStore } from "./client-store";
import { fmtMoney, fmtDate, fmtDateTime, relTime, todayISO } from "@/lib/format";
import { LogoMark, ICheck, IClock, IWhatsapp, IDownload, IUpload, ILogout } from "@/components/icons";

export function ClientDashboard() {
  const { me, engagements, case: c, stages, stageTransitions, documents, advisor, logout, switchCase, vaultDocuments } = useClientStore();

  const activeStages = useMemo(() => stages.filter((s) => s.active).sort((a, b) => a.sortOrder - b.sortOrder), [stages]);
  const currentIdx = activeStages.findIndex((s) => s.label === c?.stage);
  const showPreApproval = currentIdx >= activeStages.findIndex((s) => s.label === "Pre-Approval");
  const showFOL = currentIdx >= activeStages.findIndex((s) => s.label === "Final Approval");

  if (!c) return null;

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <div className="app-bg" />
      {/* header */}
      <header className="border-b" style={{ borderColor: "var(--line-soft)", background: "color-mix(in srgb, var(--bg) 92%, transparent)", backdropFilter: "blur(6px)" }}>
        <div className="max-w-[640px] mx-auto px-4 py-3 flex items-center gap-2.5">
          <LogoMark size={28} />
          <div className="flex-1">
            <div className="font-disp font-bold text-[14px] leading-none">HFMC</div>
            <div className="text-[8.5px] uppercase tracking-[0.16em] text-[var(--ink-faint)] mt-0.5">Client Portal</div>
          </div>
          <button className="text-[var(--ink-faint)] hover:text-[var(--coral)] transition-colors" onClick={logout} title="Sign out">
            <ILogout size={16} />
          </button>
        </div>
      </header>

      {/* parallel bank journeys — one login, every engagement of this client */}
      {engagements.length > 1 && c && (
        <div className="max-w-[640px] mx-auto px-4 pt-3">
          <div className="rounded-xl p-3" style={{ background: "var(--raised)", border: "1px solid var(--line-soft)" }}>
            <div className="text-[10px] uppercase tracking-[0.12em] font-disp font-semibold text-[var(--ink-faint)] mb-2">
              Your finance journeys · {engagements.length} banks in parallel
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {engagements.map((e) => {
                const on = e.id === c.id;
                return (
                  <button key={e.id}
                    onClick={() => switchCase(e.id)}
                    className="shrink-0 rounded-lg px-3 py-2 text-left transition-all"
                    style={on
                      ? { background: "var(--amber-tint)", border: "1px solid var(--amber)" }
                      : { background: "var(--bg2)", border: "1px solid var(--line)" }}>
                    <div className="mono text-[11px] font-semibold" style={{ color: on ? "var(--amber)" : "var(--ink-dim)" }}>
                      {(e.banks && e.banks.length ? e.banks.join(" + ") : "Bank TBC")}
                    </div>
                    <div className="text-[10px] text-[var(--ink-faint)]">{e.caseNumber} · {e.stage}</div>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-[var(--ink-faint)] m-0 mt-1.5">Tap a bank to see that journey — stage, documents and updates are per bank.</p>
          </div>
        </div>
      )}

      <main className="max-w-[640px] mx-auto px-4 py-5 space-y-4 pb-12">
        {/* case header */}
        <div className="anim-fade-up">
          <div className="flex items-center gap-2 mb-1">
            <span className="mono text-[13px]" style={{ color: "var(--amber)" }}>{c.caseNumber}</span>
            {c.onHold && (
              <span className="chip" style={{ background: "rgba(242,176,76,0.14)", borderColor: "var(--amber)", color: "var(--amber)" }}>ON HOLD</span>
            )}
          </div>
          <h1 className="font-disp font-bold text-[22px] tracking-tight m-0">{c.customer}</h1>
          <p className="text-[12.5px] text-[var(--ink-faint)] mt-0.5 mb-0">
            {fmtMoney(c.loanAmount)} · {c.transactionType || "Mortgage"} · {c.propertyLocation || "UAE"}
          </p>
        </div>

        {/* stage pipeline — visual progress */}
        <div className="card p-4 anim-fade-up">
          <h3 className="font-disp font-semibold text-[13px] m-0 mb-3">Your application progress</h3>
          <div className="space-y-0">
            {activeStages.map((s, i) => {
              const done = i < currentIdx;
              const current = i === currentIdx;
              return (
                <div key={s.id} className="flex items-center gap-3 relative">
                  {/* connector line */}
                  {i < activeStages.length - 1 && (
                    <div className="absolute left-[11px] top-[24px] w-[2px]" style={{ height: 20, background: done ? "var(--mint)" : "var(--line)" }} />
                  )}
                  <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 z-10" style={{
                    background: done ? "var(--mint)" : current ? "var(--amber)" : "var(--track)",
                    color: done || current ? "#fff" : "var(--ink-faint)",
                  }}>
                    {done ? <ICheck size={13} /> : i + 1}
                  </span>
                  <span className="text-[13px] font-disp" style={{ color: current ? "var(--ink)" : done ? "var(--ink-dim)" : "var(--ink-faint)", fontWeight: current ? 600 : 400 }}>
                    {s.label}
                  </span>
                  {current && <span className="ml-auto mono text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(242,176,76,0.14)", color: "var(--amber)" }}>current</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* status note — what's happening now */}
        {c.statusNote && (
          <div className="card p-4 anim-fade-up" style={{ borderLeft: "3px solid var(--amber)" }}>
            <h3 className="font-disp font-semibold text-[12.5px] m-0 mb-2" style={{ color: "var(--amber)" }}>LATEST UPDATE</h3>
            <p className="text-[13px] text-[var(--ink-dim)] m-0 leading-relaxed whitespace-pre-wrap">{c.statusNote}</p>
          </div>
        )}

        {/* on hold info */}
        {c.onHold && c.holdReason && (
          <div className="card p-4 anim-fade-up" style={{ borderLeft: "3px solid var(--coral)" }}>
            <h3 className="font-disp font-semibold text-[12.5px] m-0 mb-1" style={{ color: "var(--coral)" }}>ON HOLD</h3>
            <p className="text-[13px] text-[var(--ink-dim)] m-0">{c.holdReason}</p>
            {c.holdUntil && <p className="text-[11px] text-[var(--ink-faint)] m-0 mt-1">Expected to resume: {fmtDate(c.holdUntil)}</p>}
          </div>
        )}

        {/* pre-approval details */}
        {showPreApproval && (c.preApprovalAmount || c.preApprovalDate) && (
          <div className="card p-4 anim-fade-up">
            <h3 className="font-disp font-semibold text-[13px] m-0 mb-3">Pre-approval details</h3>
            <div className="grid grid-cols-2 gap-3">
              {c.preApprovalDate && <Field label="Date" value={fmtDate(c.preApprovalDate)} />}
              {c.preApprovalAmount != null && <Field label="Approved amount" value={fmtMoney(c.preApprovalAmount)} highlight />}
              {c.preApprovalTenure != null && <Field label="Tenure" value={`${c.preApprovalTenure} months`} />}
              {c.preApprovalRoi != null && <Field label="Rate of interest" value={`${c.preApprovalRoi}%`} />}
            </div>
          </div>
        )}

        {/* FOL details */}
        {showFOL && (c.folAmount || c.folDate) && (
          <div className="card p-4 anim-fade-up" style={{ borderColor: "var(--mint)" }}>
            <h3 className="font-disp font-semibold text-[13px] m-0 mb-3">Final offer letter</h3>
            <div className="grid grid-cols-2 gap-3">
              {c.folDate && <Field label="Date" value={fmtDate(c.folDate)} />}
              {c.folAmount != null && <Field label="Loan amount" value={fmtMoney(c.folAmount)} highlight />}
              {c.folTenure != null && <Field label="Tenure" value={`${c.folTenure} months`} />}
              {c.folRoi != null && <Field label="Rate of interest" value={`${c.folRoi}%`} />}
            </div>
          </div>
        )}

        {/* timeline */}
        {stageTransitions.length > 0 && (
          <div className="card p-4 anim-fade-up">
            <h3 className="font-disp font-semibold text-[13px] m-0 mb-3">Timeline</h3>
            <div className="space-y-3">
              {stageTransitions.slice(0, 10).map((t) => (
                <div key={t.id} className="flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: "var(--amber)" }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px] m-0 leading-snug">
                      <strong className="font-medium">{t.fromStage} → {t.toStage}</strong>
                    </p>
                    {t.comment && <p className="text-[11.5px] text-[var(--ink-dim)] m-0 mt-0.5">{t.comment}</p>}
                    <p className="text-[10.5px] text-[var(--ink-faint)] m-0 mt-0.5">{relTime(t.at)} · by {t.userName}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* document vault — upload cards */}
        <DocUploadCards caseId={c.id} vaultDocuments={vaultDocuments} legacyDocuments={documents} />

        {/* advisor contact */}
        {advisor && (
          <div className="card p-4 anim-fade-up" style={{ background: "color-mix(in srgb, var(--mint) 5%, var(--surface))" }}>
            <h3 className="font-disp font-semibold text-[13px] m-0 mb-2">Your advisor</h3>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-[14px] font-medium m-0">{advisor.name}</p>
                <p className="text-[11.5px] text-[var(--ink-faint)] m-0">{advisor.role}</p>
              </div>
              {c.whatsapp && (
                <a className="btn btn-mint btn-sm" href={`https://wa.me/${c.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(`Hello, I have a question about my case ${c.caseNumber}.`)}`} target="_blank" rel="noreferrer">
                  <IWhatsapp size={14} /> WhatsApp
                </a>
              )}
            </div>
          </div>
        )}

        <p className="text-[10px] text-[var(--ink-faint)] text-center mt-4 mb-0">
          HFMC Mortgage · UAE · This is a live status update. For urgent queries, contact your advisor.
        </p>
      </main>
    </div>
  );
}

function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[9.5px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)]">{label}</div>
      <div className="mono text-[14px] mt-0.5" style={{ color: highlight ? "var(--mint)" : "var(--ink)", fontWeight: highlight ? 700 : 500 }}>{value}</div>
    </div>
  );
}

/* Document upload cards — client-visible vault items with drag-free upload,
   live status, and clear rejection feedback for re-upload. */

type VaultDoc = {
  id: number; title: string; category: string; status: string;
  clientCanUpload: boolean; rejectionReason: string; notes: string;
  fileName: string | null; fileSize: number | null; uploadedAt: string | null;
};

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  "Verified": { bg: "rgba(67,214,155,0.12)", color: "var(--mint)" },
  "Uploaded": { bg: "rgba(87,194,234,0.14)", color: "var(--sky)" },
  "Rejected": { bg: "rgba(242,115,99,0.12)", color: "var(--coral)" },
  "Waived": { bg: "rgba(140,166,176,0.14)", color: "var(--ink-faint)" },
  "Pending upload": { bg: "rgba(242,176,76,0.14)", color: "var(--amber)" },
};

function DocUploadCards({ caseId, vaultDocuments, legacyDocuments }: {
  caseId: number;
  vaultDocuments: VaultDoc[];
  legacyDocuments: { id: number; fileName: string; fileSize: number; uploadedAt: string }[];
}) {
  const [uploading, setUploading] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [justDone, setJustDone] = useState<number | null>(null);

  const upload = async (docId: number, file: File) => {
    setUploading(docId); setErr(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`/api/documents/${docId}/upload`, { method: "POST", body: fd });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setErr(e.error || "Upload failed — try again.");
      } else {
        setJustDone(docId);
        setTimeout(() => setJustDone(null), 2500);
        setTimeout(() => window.location.reload(), 800);
      }
    } catch {
      setErr("Network error — try again.");
    }
    setUploading(null);
  };

  const pending = vaultDocuments.filter((d) => d.status !== "Verified" && d.status !== "Waived");
  const done = vaultDocuments.filter((d) => d.status === "Verified" || d.status === "Waived");

  return (
    <div className="card p-4 anim-fade-up">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="font-disp font-semibold text-[13px] m-0 flex-1">Your documents</h3>
        <span className="mono text-[11px]" style={{ color: done.length === vaultDocuments.length && vaultDocuments.length > 0 ? "var(--mint)" : "var(--amber)" }}>
          {done.length}/{vaultDocuments.length} done
        </span>
      </div>
      <p className="text-[11.5px] text-[var(--ink-faint)] m-0 mb-3">
        Upload clear photos or PDFs straight from your phone — your advisor reviews each one.
      </p>
      {err && <p className="text-[12px] m-0 mb-2.5" style={{ color: "var(--coral)" }}>{err}</p>}

      {pending.length > 0 && (
        <div className="space-y-2 mb-3">
          {pending.map((d) => (
            <div key={d.id} className="rounded-lg px-3 py-2.5" style={{
              background: d.status === "Rejected" ? "rgba(242,115,99,0.06)" : "var(--tint)",
              border: d.status === "Rejected" ? "1px solid rgba(242,115,99,0.3)" : "1px solid var(--line-soft)",
            }}>
              <div className="flex items-center gap-2">
                <span className="text-[12.5px] font-medium flex-1">{d.title}</span>
                <span className="mono text-[10px] px-1.5 py-0.5 rounded" style={STATUS_STYLE[d.status] ?? STATUS_STYLE["Pending upload"]}>{d.status}</span>
              </div>
              {d.notes && <p className="text-[11px] text-[var(--ink-dim)] m-0 mt-1">{d.notes}</p>}
              {d.status === "Rejected" && d.rejectionReason && (
                <p className="text-[11.5px] m-0 mt-1 leading-snug" style={{ color: "var(--coral)" }}>
                  Needs attention: {d.rejectionReason}
                </p>
              )}
              {d.fileName && (
                <p className="text-[10.5px] text-[var(--ink-faint)] m-0 mt-1">
                  You uploaded: <a href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer" className="mono" style={{ color: "var(--sky)" }}>{d.fileName} ↗</a>
                </p>
              )}
              {d.clientCanUpload && (
                <label className="btn btn-ghost btn-sm w-full justify-center mt-2" style={{ cursor: uploading === d.id ? "wait" : "pointer" }}>
                  <IUpload size={13} /> {uploading === d.id ? "Uploading…" : d.status === "Rejected" || d.fileName ? "Upload again" : "Upload photo or PDF"}
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) upload(d.id, f);
                    }}
                  />
                </label>
              )}
            </div>
          ))}
        </div>
      )}

      {pending.length === 0 && vaultDocuments.length > 0 && (
        <p className="text-[12px] m-0 mb-3" style={{ color: "var(--mint)" }}>
          All documents are in — thank you! Your advisor may still request extras later.
        </p>
      )}

      {done.length > 0 && (
        <div className="space-y-1.5 pt-3" style={{ borderTop: "1px dashed var(--line)" }}>
          {done.map((d) => (
            <div key={d.id} className="flex items-center gap-2 rounded-lg px-3 py-1.5" style={{ background: "var(--tint)" }}>
              <span className="shrink-0" style={{ color: d.status === "Waived" ? "var(--ink-faint)" : "var(--mint)", display: "inline-flex" }}><ICheck size={13} /></span>
              <span className="text-[12px] flex-1 truncate" style={{ color: d.status === "Waived" ? "var(--ink-faint)" : undefined }}>
                {d.title}{d.status === "Waived" ? " (not required)" : ""}
              </span>
              {justDone === d.id && <span className="text-[10.5px] mono" style={{ color: "var(--mint)" }}>received ✓</span>}
              {d.fileName && <a href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer" className="text-[10.5px] mono" style={{ color: "var(--sky)" }}>view ↗</a>}
            </div>
          ))}
        </div>
      )}

      {vaultDocuments.length === 0 && legacyDocuments.length > 0 && (
        <div className="space-y-2 mb-3">
          {legacyDocuments.map((d) => (
            <div key={d.id} className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ background: "var(--tint)" }}>
              <IUpload size={14} className="text-[var(--ink-faint)] shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-medium truncate m-0">{d.fileName}</p>
                <p className="text-[10.5px] text-[var(--ink-faint)] m-0">{relTime(d.uploadedAt)} · {(d.fileSize / 1024).toFixed(0)} KB</p>
              </div>
              <ICheck size={14} className="text-[var(--mint)] shrink-0" />
            </div>
          ))}
        </div>
      )}
      {vaultDocuments.length === 0 && legacyDocuments.length === 0 && (
        <p className="text-[12.5px] text-[var(--ink-faint)] m-0">No documents requested yet — your advisor will list what's needed here.</p>
      )}
    </div>
  );
}
