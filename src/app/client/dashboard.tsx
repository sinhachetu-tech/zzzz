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
  const progressPct = activeStages.length > 1 && currentIdx >= 0 ? Math.round((currentIdx / (activeStages.length - 1)) * 100) : 0;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = (c?.customer || "").split(" ")[0] || "";

  if (!c) return null;

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <div className="app-bg" />
      <style>{`@keyframes cpulse { 0%,100%{box-shadow:0 0 0 0 rgba(242,176,76,0.5)} 50%{box-shadow:0 0 0 8px rgba(242,176,76,0)} }`}</style>

      {/* top bar */}
      <header className="sticky top-0 z-40 border-b" style={{ borderColor: "var(--line-soft)", background: "color-mix(in srgb, var(--bg) 92%, transparent)", backdropFilter: "blur(8px)" }}>
        <div className="max-w-[680px] mx-auto px-4 py-2.5 flex items-center gap-2.5">
          <LogoMark size={26} />
          <div className="flex-1">
            <div className="font-disp font-bold text-[13px] leading-none">HFMC</div>
            <div className="text-[8px] uppercase tracking-[0.16em] text-[var(--ink-faint)] mt-0.5">Client Portal</div>
          </div>
          <span className="mono text-[11px] text-[var(--ink-faint)] hidden sm:inline">{c.caseNumber}</span>
          <button className="text-[var(--ink-faint)] hover:text-[var(--coral)] transition-colors" onClick={logout} title="Sign out">
            <ILogout size={16} />
          </button>
        </div>
      </header>

      <main className="max-w-[680px] mx-auto px-4 py-5 space-y-4 pb-14">

        {/* hero */}
        <div className="anim-fade-up rounded-2xl p-5 relative overflow-hidden"
          style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--amber) 16%, var(--raised)), var(--raised))", border: "1px solid color-mix(in srgb, var(--amber) 35%, var(--line))" }}>
          <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full" style={{ background: "radial-gradient(circle, rgba(242,176,76,0.14), transparent 70%)" }} />
          <p className="text-[12px] text-[var(--ink-dim)] m-0">{greeting},</p>
          <h1 className="font-disp font-bold text-[24px] tracking-tight m-0 mt-0.5">{c.customer}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[12px]">
            <span className="mono" style={{ color: "var(--amber)" }}>{fmtMoney(c.loanAmount)}</span>
            <span className="text-[var(--ink-faint)]">{c.transactionType || "Mortgage"} · {c.propertyLocation || "UAE"}</span>
            {c.onHold && <span className="chip !py-0.5" style={{ background: "rgba(242,176,76,0.14)", borderColor: "var(--amber)", color: "var(--amber)" }}>ON HOLD</span>}
          </div>
          <div className="mt-4">
            <div className="flex justify-between text-[10px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)] mb-1">
              <span>{currentIdx >= 0 ? activeStages[currentIdx]?.label : "Starting"}</span>
              <span>{progressPct}%</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--track)" }}>
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(4, progressPct)}%`, background: "linear-gradient(90deg, var(--amber), #f2b04c)" }} />
            </div>
          </div>
        </div>

        {/* parallel bank journeys */}
        {engagements.length > 1 && (
          <div className="anim-fade-up">
            <div className="text-[10px] uppercase tracking-[0.12em] font-disp font-semibold text-[var(--ink-faint)] mb-2">
              Your finance journeys · {engagements.length} banks in parallel
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1.5">
              {engagements.map((e) => {
                const on = e.id === c.id;
                return (
                  <button key={e.id}
                    onClick={() => switchCase(e.id)}
                    className="shrink-0 rounded-xl px-3.5 py-2.5 text-left transition-all anim-fade-up"
                    style={on
                      ? { background: "linear-gradient(135deg, color-mix(in srgb, var(--amber) 18%, var(--raised)), var(--raised))", border: "1.5px solid var(--amber)", boxShadow: "0 4px 14px -6px rgba(242,176,76,0.4)" }
                      : { background: "var(--raised)", border: "1px solid var(--line)" }}>
                    <div className="font-disp text-[12.5px] font-semibold" style={{ color: on ? "var(--amber)" : "var(--ink-dim)" }}>
                      {e.banks && e.banks.length ? e.banks.join(" + ") : "Bank TBC"}
                    </div>
                    <div className="text-[10px] text-[var(--ink-faint)] mono">{e.caseNumber}</div>
                    <div className="text-[10px] mt-0.5 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: e.caseStatus === "Active" ? "var(--mint)" : "var(--ink-faint)" }} />
                      <span style={{ color: on ? "var(--ink-dim)" : "var(--ink-faint)" }}>{e.stage}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* advisor — right up top where it belongs */}
        {advisor && (
          <div className="card anim-fade-up p-4 flex items-center gap-3.5 rounded-2xl" style={{ borderColor: "color-mix(in srgb, var(--mint) 30%, var(--line))" }}>
            <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 font-disp font-bold text-[14px]"
              style={{ background: "linear-gradient(135deg, var(--mint), #2aa77a)", color: "#06251a" }}>
              {advisor.name.split(" ").map((w: string) => w[0]).slice(0, 2).join("")}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)]">Your dedicated advisor</div>
              <div className="text-[14.5px] font-medium leading-tight">{advisor.name}</div>
              <div className="text-[11px] text-[var(--ink-faint)]">{advisor.role} · replies within hours</div>
            </div>
            {c.whatsapp && (
              <a className="btn btn-mint btn-sm shrink-0"
                href={`https://wa.me/${c.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(`Hello, I have a question about my case ${c.caseNumber}.`)}`}
                target="_blank" rel="noreferrer">
                <IWhatsapp size={14} /> Ask
              </a>
            )}
          </div>
        )}

        {/* latest update */}
        {c.statusNote && (
          <div className="card anim-fade-up p-4 rounded-2xl" style={{ borderLeft: "3px solid var(--amber)" }}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--amber)", animation: "cpulse 2s infinite" }} />
              <h3 className="font-disp font-semibold text-[11px] uppercase tracking-[0.1em] m-0" style={{ color: "var(--amber)" }}>Latest update from your advisor</h3>
            </div>
            <p className="text-[13.5px] text-[var(--ink-dim)] m-0 leading-relaxed whitespace-pre-wrap">{c.statusNote}</p>
          </div>
        )}

        {/* on hold */}
        {c.onHold && c.holdReason && (
          <div className="card anim-fade-up p-4 rounded-2xl" style={{ borderLeft: "3px solid var(--coral)" }}>
            <h3 className="font-disp font-semibold text-[12.5px] m-0 mb-1" style={{ color: "var(--coral)" }}>ON HOLD</h3>
            <p className="text-[13px] text-[var(--ink-dim)] m-0">{c.holdReason}</p>
            {c.holdUntil && <p className="text-[11px] text-[var(--ink-faint)] m-0 mt-1">Expected to resume: {fmtDate(c.holdUntil)}</p>}
          </div>
        )}

        {/* progress — vertical journey tracker */}
        <div className="card anim-fade-up p-5 rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-disp font-semibold text-[13px] m-0">Your journey to keys in hand</h3>
            <span className="mono text-[10.5px] text-[var(--ink-faint)]">step {Math.min(currentIdx + 1, activeStages.length)} of {activeStages.length}</span>
          </div>
          <div className="relative pl-1">
            {activeStages.map((s, i) => {
              const done = i < currentIdx;
              const current = i === currentIdx;
              return (
                <div key={s.id} className="flex items-stretch gap-3.5 relative">
                  <div className="flex flex-col items-center shrink-0">
                    <span className="w-8 h-8 rounded-full flex items-center justify-center z-10 transition-all"
                      style={current ? {
                        background: "var(--amber)", color: "#fff", animation: "cpulse 2s infinite",
                      } : {
                        background: done ? "var(--mint)" : "var(--track)", color: done ? "#fff" : "var(--ink-faint)",
                      }}>
                      {done ? <ICheck size={14} /> : <span className="mono text-[11px] font-semibold">{i + 1}</span>}
                    </span>
                    {i < activeStages.length - 1 && (
                      <div className="w-[2.5px] flex-1 my-1 rounded-full" style={{ minHeight: 26, background: done ? "var(--mint)" : "var(--line)" }} />
                    )}
                  </div>
                  <div className={"pb-5 pt-1 " + (i === activeStages.length - 1 ? "pb-0" : "")}>
                    <div className="text-[13.5px] font-disp" style={{ color: current ? "var(--ink)" : done ? "var(--ink-dim)" : "var(--ink-faint)", fontWeight: current ? 600 : 400 }}>
                      {s.label}
                    </div>
                    {current && (
                      <div className="text-[11px] mt-0.5" style={{ color: "var(--amber)" }}>
                        {c.statusNote ? "in progress now" : "we are on this step"}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* pre-approval */}
        {showPreApproval && (c.preApprovalAmount || c.preApprovalDate) && (
          <div className="card anim-fade-up p-4 rounded-2xl">
            <h3 className="font-disp font-semibold text-[13px] m-0 mb-3">Pre-approval</h3>
            <div className="grid grid-cols-2 gap-3">
              {c.preApprovalDate && <Field label="Date" value={fmtDate(c.preApprovalDate)} />}
              {c.preApprovalAmount != null && <Field label="Approved amount" value={fmtMoney(c.preApprovalAmount)} highlight />}
              {c.preApprovalTenure != null && <Field label="Tenure" value={`${c.preApprovalTenure} months`} />}
              {c.preApprovalRoi != null && <Field label="Rate of interest" value={`${c.preApprovalRoi}%`} />}
            </div>
          </div>
        )}

        {/* FOL */}
        {showFOL && (c.folAmount || c.folDate) && (
          <div className="card anim-fade-up p-4 rounded-2xl" style={{ borderColor: "var(--mint)" }}>
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
          <div className="card anim-fade-up p-4 rounded-2xl">
            <h3 className="font-disp font-semibold text-[13px] m-0 mb-3">Journey log</h3>
            <div className="space-y-3">
              {stageTransitions.slice(0, 10).map((t) => (
                <div key={t.id} className="flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: "var(--amber)" }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px] m-0 leading-snug"><strong className="font-medium">{t.fromStage} → {t.toStage}</strong></p>
                    {t.comment && <p className="text-[11.5px] text-[var(--ink-dim)] m-0 mt-0.5">{t.comment}</p>}
                    <p className="text-[10.5px] text-[var(--ink-faint)] m-0 mt-0.5">{relTime(t.at)} · by {t.userName}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* documents */}
        <DocUploadCards caseId={c.id} vaultDocuments={vaultDocuments} legacyDocuments={documents} />

        <p className="text-[10px] text-[var(--ink-faint)] text-center mt-2 mb-0">
          HFMC Mortgage · UAE · Live status — for urgent matters, message your advisor above.
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
