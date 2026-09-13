"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { LoanCase, Reply, Task } from "@/lib/types";
import { EMPLOYMENT_PROFILES, LOAN_TYPES, PROPERTY_LOCATIONS, PROPERTY_TYPES, RESIDENCIES, TRANSACTION_TYPES } from "@/lib/types";
import {
  ageDays, caseStatusOf, fmtDate, fmtDateTime, fmtMoney, inDaysISO, primaryBank, relTime, todayISO,
} from "@/lib/format";
import { Avatar, Chip, DueChip, Modal, SectionLabel, StatusChip } from "@/components/hfmc/ui";
import { BankChips, CaseStateChip, CommissionPanel, ConfirmModal, SourceChip, WaButtons } from "@/components/hfmc/bits";
import { DocVault } from "@/components/views/doc-vault";
import { BankMatchPanel } from "@/components/views/bank-match";
import {
  IArrowR, IBank, ICalc, ICheck, IChevronL, IClock, IFlag, IHistory, IPlus, IRobot, ISparkles, ITrash, IZap,
} from "@/components/icons";

function ReplyThread({ replies, onSend }: { replies: Reply[]; onSend: (text: string) => void }) {
  const { userById } = useHfmcStore();
  const [draft, setDraft] = useState("");
  const send = () => { if (!draft.trim()) return; onSend(draft); setDraft(""); };
  return (
    <div className="mt-3 space-y-2">
      {replies.map((r) => (
        <div key={r.id} className="flex items-start gap-2 anim-fade-in">
          <Avatar name={userById(r.userId)?.name ?? "?"} size={22} />
          <div className="min-w-0 flex-1 rounded-lg px-3 py-2" style={{ background: "var(--tint)", border: "1px solid var(--line-soft)" }}>
            <div className="flex items-baseline gap-2">
              <span className="text-[12px] font-semibold">{userById(r.userId)?.name ?? "—"}</span>
              <span className="mono text-[10px] text-[var(--ink-faint)]">{relTime(r.at)}</span>
            </div>
            <p className="text-[12.5px] text-[var(--ink-dim)] m-0 mt-0.5 leading-snug">{r.text}</p>
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <input className="input !py-[6px]" placeholder="Reply…" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
        <button className="btn btn-ghost btn-sm" onClick={send}>Send</button>
      </div>
    </div>
  );
}

function AddTaskModal({ open, onClose, caseId }: { open: boolean; onClose: () => void; caseId: number }) {
  const { tasks, users, whyPending: whyMaster, waitingFor: waitMaster, me, addTask, toast, canInstruct } = useHfmcStore();
  const caseTasks = tasks.filter((t) => t.caseId === caseId);
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState(me?.id ?? 0);
  const [waitingFor, setWaitingFor] = useState("Client");
  const [whyPending, setWhyPending] = useState("Documents awaited");
  const [dueDate, setDueDate] = useState(inDaysISO(3));
  const [err, setErr] = useState("");

  if (!open) return null;

  const submit = async () => {
    if (!description.trim()) return setErr("What needs doing?");
    try {
      await addTask(caseId, { description: description.trim(), ownerId, waitingFor, whyPending, dueDate });
      toast("success", "Task added.");
      setDescription(""); setErr(""); onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not add task."); }
  };

  return (
    <Modal title="Add a task" sub={`${caseTasks.length} task${caseTasks.length === 1 ? "" : "s"} on this case`} onClose={onClose} width={500}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={submit}>Add task</button></>}>
      <div className="space-y-3">
        <div>
          <label className="label">What needs doing?</label>
          <input className="input" autoFocus value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Submit application to Mashreq" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Owner</label>
            <select className="select" value={ownerId} onChange={(e) => setOwnerId(parseInt(e.target.value, 10))} disabled={!canInstruct()}>
              {users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Due date</label>
            <input className="input mono" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Waiting for</label>
            <select className="select" value={waitingFor} onChange={(e) => setWaitingFor(e.target.value)}>
              {waitMaster.map((w) => <option key={w.id}>{w.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Why pending</label>
            <select className="select" value={whyPending} onChange={(e) => setWhyPending(e.target.value)}>
              {whyMaster.map((w) => <option key={w.id}>{w.label}</option>)}
            </select>
          </div>
        </div>
        {!canInstruct() && <p className="text-[11.5px] text-[var(--ink-faint)] m-0">You can only assign tasks to yourself — only managers can reassign.</p>}
      </div>
      {err && <p className="text-[12.5px] mt-2.5 mb-0" style={{ color: "var(--coral)" }}>{err}</p>}
    </Modal>
  );
}

function StageUpdateModal({ open, onClose, caseId }: { open: boolean; onClose: () => void; caseId: number }) {
  const { cases, stages, updateCase, toast } = useHfmcStore();
  const c = cases.find((x) => x.id === caseId);
  const [stage, setStage] = useState(c?.stage ?? "");
  const [comment, setComment] = useState("");
  const activeStages = [...stages].filter((s) => s.active).sort((a, b) => a.sortOrder - b.sortOrder);
  if (!open || !c) return null;
  const submit = async () => {
    if (stage === c.stage) { onClose(); return; }
    await updateCase(caseId, { stage, stageComment: comment.trim() });
    toast("success", `Stage moved to ${stage}.`);
    setComment("");
    onClose();
  };
  return (
    <Modal title="Move stage" sub={c.caseNumber} onClose={onClose} width={480}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={submit}>Move</button></>}>
      <div className="space-y-3">
        <div className="space-y-2">
          {activeStages.map((s) => (
            <button key={s.id} className="w-full text-left rowlink rounded-lg px-3 py-2.5 flex items-center gap-3"
              style={{ border: "1px solid", borderColor: stage === s.label ? "var(--amber)" : "var(--line-soft)", background: stage === s.label ? "rgba(242,176,76,0.06)" : "transparent" }}
              onClick={() => setStage(s.label)}>
              <span className="font-disp font-semibold text-[13px]">{s.label}</span>
              {c.stage === s.label && <Chip tone="amber">current</Chip>}
              {stage === s.label && c.stage !== s.label && <span className="ml-auto mono text-[11px] text-[var(--amber)]">→ moving</span>}
            </button>
          ))}
        </div>
        {stage !== c.stage && (
          <div className="anim-fade-up">
            <label className="label">Why are you moving the stage? <span className="normal-case tracking-normal" style={{ color: "var(--ink-faint)" }}>— logged in stage history</span></label>
            <textarea
              className="textarea"
              rows={3}
              placeholder="e.g. Client confirmed property, submitting to ADCB today."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              autoFocus
            />
          </div>
        )}
      </div>
    </Modal>
  );
}

function OutcomeModal({ open, onClose, caseId }: { open: boolean; onClose: () => void; caseId: number }) {
  const { cases, banks, updateCase, toast } = useHfmcStore();
  const c = cases.find((x) => x.id === caseId);
  const [status, setStatus] = useState<"Closed" | "Lost">(c?.caseStatus === "Lost" ? "Lost" : "Closed");
  const [wonBank, setWonBank] = useState(c?.wonBank ?? c?.banks[0] ?? "");
  if (!open || !c) return null;
  const submit = async () => {
    const patch: Record<string, unknown> = { caseStatus: status };
    if (status === "Closed") patch.wonBank = wonBank || null;
    await updateCase(caseId, patch);
    toast("success", status === "Closed" ? `Booked! Won by ${wonBank}.` : "Marked lost.");
    onClose();
  };
  return (
    <Modal title="Set outcome" sub={c.caseNumber} onClose={onClose} width={440}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={submit}>Confirm</button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <button className="rowlink rounded-lg px-3 py-3 text-center" style={{ border: "1px solid", borderColor: status === "Closed" ? "var(--mint)" : "var(--line-soft)", background: status === "Closed" ? "rgba(67,214,155,0.07)" : "transparent" }} onClick={() => setStatus("Closed")}>
            <div className="font-disp font-semibold text-[14px]" style={{ color: status === "Closed" ? "var(--mint)" : "var(--ink-dim)" }}>Booked</div>
            <div className="text-[11px] text-[var(--ink-faint)] mt-0.5">Won the deal</div>
          </button>
          <button className="rowlink rounded-lg px-3 py-3 text-center" style={{ border: "1px solid", borderColor: status === "Lost" ? "var(--coral)" : "var(--line-soft)", background: status === "Lost" ? "rgba(242,115,99,0.07)" : "transparent" }} onClick={() => setStatus("Lost")}>
            <div className="font-disp font-semibold text-[14px]" style={{ color: status === "Lost" ? "var(--coral)" : "var(--ink-dim)" }}>Lost</div>
            <div className="text-[11px] text-[var(--ink-faint)] mt-0.5">Didn't convert</div>
          </button>
        </div>
        {status === "Closed" && (
          <div>
            <label className="label">Winning bank</label>
            <select className="select" value={wonBank} onChange={(e) => setWonBank(e.target.value)}>
              <option value="">— select —</option>
              {banks.filter((b) => b.active).map((b) => <option key={b.id} value={b.name}>{b.name} ({b.ratePct}%)</option>)}
            </select>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ---------------- AI Case Copilot ---------------- */

function CaseCopilot({ caseId }: { caseId: number }) {
  const { cases, caseById } = useHfmcStore();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const c = caseById(caseId);

  const generate = async () => {
    setOpen(true);
    if (markdown) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/ai/insights", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "AI unavailable");
      const data = await res.json();
      setMarkdown(data.markdown);
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI unavailable");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="card p-4 anim-fade-up" style={{ borderLeft: "3px solid var(--sky)" }}>
        <div className="flex items-center gap-2 mb-1">
          <IRobot size={15} className="text-[var(--sky)]" />
          <h3 className="font-disp font-semibold text-[13.5px] m-0">AI Case Copilot</h3>
        </div>
        <p className="text-[12px] text-[var(--ink-faint)] m-0 mb-3">
          Reads the case, tasks, and activity log, then writes a snapshot, risk flags, and prioritised next actions.
        </p>
        <button className="btn btn-sm w-full justify-center" style={{ background: "var(--sky)", color: "#fff" }} onClick={generate}>
          <ISparkles size={14} /> {markdown ? "Re-read insights" : "Generate insights"}
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 anim-fade-in" style={{ background: "rgba(4,12,15,0.74)", backdropFilter: "blur(4px)" }} onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="card anim-scale-in w-full max-w-[680px] max-h-[88vh] flex flex-col" style={{ background: "var(--raised)" }}>
            <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-[var(--line-soft)]">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(87,194,234,0.14)", color: "var(--sky)" }}><IRobot size={16} /></div>
                <div>
                  <h3 className="font-disp text-[15px] font-semibold m-0">AI Case Copilot</h3>
                  <p className="text-[11.5px] text-[var(--ink-faint)] m-0">{c?.caseNumber} · {c?.customer}</p>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm !px-2" onClick={() => setOpen(false)} aria-label="Close"><IChevronL size={15} className="rotate-180" /></button>
            </div>
            <div className="px-5 py-4 overflow-y-auto">
              {loading && (
                <div className="flex items-center gap-3 py-8 justify-center">
                  <div className="w-5 h-5 rounded-full border-2 border-[var(--sky)] border-t-transparent animate-spin" />
                  <span className="text-[13px] text-[var(--ink-faint)]">Reading the case file…</span>
                </div>
              )}
              {error && !loading && (
                <div className="rounded-lg p-3 text-[13px]" style={{ background: "rgba(242,115,99,0.08)", color: "var(--coral)", border: "1px solid rgba(242,115,99,0.3)" }}>
                  {error}
                </div>
              )}
              {markdown && !loading && (
                <div className="prose-ai" dangerouslySetInnerHTML={{ __html: renderMd(markdown) }} />
              )}
              {!markdown && !loading && !error && (
                <p className="text-[13px] text-[var(--ink-faint)] m-0">No insights yet.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* tiny markdown renderer — headings, bold, lists */
function renderMd(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = md.split("\n");
  let html = "";
  let inUl = false, inOl = false;
  const closeLists = () => { if (inUl) { html += "</ul>"; inUl = false; } if (inOl) { html += "</ol>"; inOl = false; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^##\s+/.test(line)) { closeLists(); html += `<h2>${esc(line.replace(/^##\s+/, ""))}</h2>`; continue; }
    if (/^#\s+/.test(line)) { closeLists(); html += `<h2>${esc(line.replace(/^#\s+/, ""))}</h2>`; continue; }
    if (/^\s*[-*]\s+/.test(line)) { if (!inUl) { closeLists(); html += "<ul>"; inUl = true; } html += `<li>${inline(esc(line.replace(/^\s*[-*]\s+/, "")))}</li>`; continue; }
    if (/^\s*\d+\.\s+/.test(line)) { if (!inOl) { closeLists(); html += "<ol>"; inOl = true; } html += `<li>${inline(esc(line.replace(/^\s*\d+\.\s+/, "")))}</li>`; continue; }
    if (line.trim() === "") { closeLists(); continue; }
    closeLists();
    html += `<p>${inline(esc(line))}</p>`;
  }
  closeLists();
  return html;
}
function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

/* ---------------- MIS operational fields ---------------- */

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="label">{label}{hint && <span className="normal-case tracking-normal" style={{ color: "var(--ink-faint)" }}> — {hint}</span>}</label>
      {children}
    </div>
  );
}

/** Auto-save text input — uncontrolled, remounts when the saved value changes so
 *  the field always reflects the latest server value after hydrate. */
function SaveText({
  value, onSave, placeholder, mono, type = "text",
}: {
  value: string; onSave: (v: string) => void; placeholder?: string; mono?: boolean; type?: "text" | "date" | "number";
}) {
  return (
    <input
      key={`v-${value}`}
      className={`input ${mono ? "mono" : ""}`}
      type={type}
      defaultValue={value}
      placeholder={placeholder}
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v !== value) onSave(v);
      }}
    />
  );
}

function MisPanel({ c }: { c: LoanCase }) {
  const { users, updateCase, toast } = useHfmcStore();
  const save = (field: string, value: unknown) =>
    updateCase(c.id, { [field]: value }).then(() => toast("success", "Saved."));

  return (
    <div className="card p-4 anim-fade-up" style={{ borderLeft: "3px solid var(--amber)" }}>
      <div className="flex items-center gap-2 mb-3">
        <IFlag size={14} className="text-[var(--amber)]" />
        <h3 className="font-disp font-semibold text-[13.5px] m-0">Status &amp; operations</h3>
        {c.onHold && <span className="ml-auto chip" style={{ color: "var(--amber)", background: "rgba(242,176,76,0.12)", borderColor: "rgba(242,176,76,0.4)" }}>ON HOLD</span>}
      </div>

      {/* status note — the most important field */}
      <Field label="Status note" hint="auto-saves on blur">
        <textarea
          key={`note-${c.statusNote ?? ""}`}
          className="textarea"
          rows={3}
          placeholder="Today's narrative — what's happening, what's blocking, what's next."
          defaultValue={c.statusNote ?? ""}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== (c.statusNote ?? "")) save("statusNote", v);
          }}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3 mt-3">
        <Field label="Employment profile" hint="drives the vault">
          <select className="select" value={c.employmentProfile} onChange={(e) => save("employmentProfile", e.target.value)}>
            {EMPLOYMENT_PROFILES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="Residency">
          <select className="select" value={c.residency} onChange={(e) => save("residency", e.target.value)}>
            {RESIDENCIES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="Property type" hint="drives the vault">
          <select className="select" value={c.propertyType} onChange={(e) => save("propertyType", e.target.value)}>
            {PROPERTY_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="Transaction type">
          <select
            className="select"
            value={c.transactionType || ""}
            onChange={(e) => save("transactionType", e.target.value)}
          >
            <option value="">— select —</option>
            {TRANSACTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Bank RM">
          <SaveText value={c.bankRm ?? ""} placeholder="RM name at bank" onSave={(v) => save("bankRm", v || null)} />
        </Field>
        <Field label="VRM (internal)">
          <select
            className="select"
            value={c.vrmId ?? ""}
            onChange={(e) => save("vrmId", e.target.value ? parseInt(e.target.value, 10) : null)}
          >
            <option value="">— unassigned —</option>
            {users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="Property location">
          <select
            className="select"
            value={c.propertyLocation ?? ""}
            onChange={(e) => save("propertyLocation", e.target.value || null)}
          >
            <option value="">— select —</option>
            {PROPERTY_LOCATIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Co-applicant">
          <SaveText value={c.coApplicantName ?? ""} placeholder="Optional" onSave={(v) => save("coApplicantName", v || null)} />
        </Field>
        <Field label="Loan type">
          <select
            className="select"
            value={c.loanType ?? ""}
            onChange={(e) => save("loanType", e.target.value || null)}
          >
            <option value="">— select —</option>
            {LOAN_TYPES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>
        <Field label="File submitted date">
          <SaveText value={c.fileSubmittedDate ?? ""} type="date" mono onSave={(v) => save("fileSubmittedDate", v || null)} />
        </Field>
        <Field label="Bank tenor (months)">
          <SaveText value={c.bankTenor != null ? String(c.bankTenor) : ""} type="number" mono placeholder="e.g. 300" onSave={(v) => save("bankTenor", v ? Number(v) : null)} />
        </Field>
        <Field label="Bank rate (%)">
          <SaveText value={c.bankRate != null ? String(c.bankRate) : ""} type="number" mono placeholder="e.g. 4.49" onSave={(v) => save("bankRate", v ? Number(v) : null)} />
        </Field>
      </div>

      {/* on hold toggle */}
      <div className="mt-3 pt-3" style={{ borderTop: "1px dashed var(--line)" }}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div>
            <div className="text-[12.5px] font-medium">On hold</div>
            <div className="text-[11px] text-[var(--ink-faint)]">Park the case with a reason and optional resume date.</div>
          </div>
          <button
            type="button"
            onClick={() => save("onHold", !c.onHold)}
            className="btn btn-sm"
            style={c.onHold
              ? { background: "rgba(242,176,76,0.14)", color: "var(--amber)", borderColor: "var(--amber)" }
              : { background: "var(--bg2)", color: "var(--ink-dim)", borderColor: "var(--line)" }}
          >
            {c.onHold ? "On hold" : "Active"}
          </button>
        </div>
        {c.onHold && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 anim-fade-up">
            <Field label="Hold reason">
              <SaveText value={c.holdReason ?? ""} placeholder="e.g. Awaiting client salary certificate" onSave={(v) => save("holdReason", v || null)} />
            </Field>
            <Field label="Hold until">
              <SaveText value={c.holdUntil ?? ""} type="date" mono onSave={(v) => save("holdUntil", v || null)} />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Stage transition log ---------------- */

function StageHistoryPanel({ caseId }: { caseId: number }) {
  const { stageTransitions } = useHfmcStore();
  const rows = useMemo(
    () => stageTransitions.filter((t) => t.caseId === caseId).sort((a, b) => b.at.localeCompare(a.at)),
    [stageTransitions, caseId]
  );
  return (
    <div className="card anim-fade-up">
      <div className="p-4 border-b flex items-center gap-2" style={{ borderColor: "var(--line-soft)" }}>
        <IHistory size={14} className="text-[var(--ink-faint)]" />
        <h3 className="font-disp font-semibold text-[14px] m-0">Stage history</h3>
        <span className="text-[11.5px] text-[var(--ink-faint)] ml-auto">{rows.length} move{rows.length === 1 ? "" : "s"}</span>
      </div>
      <div className="p-4">
        {rows.length === 0 ? (
          <p className="text-[12.5px] text-[var(--ink-faint)] m-0">No stage moves recorded yet — the first move will be logged here.</p>
        ) : (
          <div className="space-y-3">
            {rows.map((t) => (
              <div key={t.id} className="flex items-start gap-3">
                <Avatar name={t.userName ?? "?"} size={26} />
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] m-0 leading-snug">
                    <strong className="font-medium">{t.userName ?? "Someone"}</strong>{" "}
                    <span className="text-[var(--ink-dim)]">moved</span>{" "}
                    <Chip tone="slate">{t.fromStage || "—"}</Chip>{" "}
                    <span className="text-[var(--ink-dim)]">→</span>{" "}
                    <Chip tone="amber">{t.toStage}</Chip>
                  </p>
                  <p className="mono text-[10.5px] text-[var(--ink-faint)] m-0 mt-0.5">{fmtDate(t.at.slice(0, 10))} · {relTime(t.at)}</p>
                  {t.comment && (
                    <p className="text-[12px] text-[var(--ink-dim)] m-0 mt-1 leading-snug rounded-lg px-2.5 py-1.5" style={{ background: "var(--tint)", border: "1px solid var(--line-soft)" }}>
                      “{t.comment}”
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Pre-approval & FOL capture ---------------- */

function NumberSaveField({ label, hint, value, onSave, placeholder, suffix }: { label: string; hint?: string; value: number | null; onSave: (v: number | null) => void; placeholder?: string; suffix?: string }) {
  return (
    <Field label={label} hint={hint}>
      <div className="relative">
        <SaveText value={value != null ? String(value) : ""} type="number" mono placeholder={placeholder} onSave={(v) => onSave(v ? Number(v) : null)} />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[var(--ink-faint)] pointer-events-none">{suffix}</span>}
      </div>
    </Field>
  );
}

function PreApprovalPanel({ c }: { c: LoanCase }) {
  const { updateCase, toast } = useHfmcStore();
  const save = (field: string, value: unknown) =>
    updateCase(c.id, { [field]: value }).then(() => toast("success", "Saved."));
  return (
    <div className="card p-4 anim-fade-up">
      <div className="flex items-center gap-2 mb-3">
        <IBank size={14} className="text-[var(--sky)]" />
        <h3 className="font-disp font-semibold text-[13.5px] m-0">Pre-approval details</h3>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Pre-approval date">
          <SaveText value={c.preApprovalDate ?? ""} type="date" mono onSave={(v) => save("preApprovalDate", v || null)} />
        </Field>
        <NumberSaveField label="Pre-approval amount" value={c.preApprovalAmount} placeholder="e.g. 1500000" suffix="AED" onSave={(v) => save("preApprovalAmount", v)} />
        <NumberSaveField label="Pre-approval tenure" hint="months" value={c.preApprovalTenure} placeholder="e.g. 300" onSave={(v) => save("preApprovalTenure", v)} />
        <NumberSaveField label="Pre-approval ROI" value={c.preApprovalRoi} placeholder="e.g. 4.49" suffix="%" onSave={(v) => save("preApprovalRoi", v)} />
      </div>
    </div>
  );
}

function FolPanel({ c }: { c: LoanCase }) {
  const { updateCase, toast } = useHfmcStore();
  const save = (field: string, value: unknown) =>
    updateCase(c.id, { [field]: value }).then(() => toast("success", "Saved."));
  return (
    <div className="card p-4 anim-fade-up" style={{ borderLeft: "3px solid var(--mint)" }}>
      <div className="flex items-center gap-2 mb-3">
        <ICheck size={14} className="text-[var(--mint)]" />
        <h3 className="font-disp font-semibold text-[13.5px] m-0">Final Offer Letter</h3>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="FOL date">
          <SaveText value={c.folDate ?? ""} type="date" mono onSave={(v) => save("folDate", v || null)} />
        </Field>
        <NumberSaveField label="FOL amount" value={c.folAmount} placeholder="e.g. 1500000" suffix="AED" onSave={(v) => save("folAmount", v)} />
        <NumberSaveField label="FOL tenure" hint="months" value={c.folTenure} placeholder="e.g. 300" onSave={(v) => save("folTenure", v)} />
        <NumberSaveField label="FOL ROI" value={c.folRoi} placeholder="e.g. 4.49" suffix="%" onSave={(v) => save("folRoi", v)} />
      </div>
    </div>
  );
}

/* ---------------- Case Detail ---------------- */

export default function CaseDetail({ id }: { id: number }) {
  const { cases, tasks, activities, stages, banks, users, instructions, me, nav, userById, caseById, updateCase, completeTask, deleteTask, toast, flags, canInstruct } = useHfmcStore();
  const c = caseById(id);
  const [caseTab, setCaseTab] = useState<"tasks" | "documents" | "banks" | "activity">(() => {
    // stage-aware default: the work of the current stage leads the page
    if (["Document Collection", "Valuation", "MOU / FARD", "Final Approval", "Disbursement"].includes(c?.stage ?? "")) return "documents";
    if (["Pre-Approval", "Property Identification", "Bank Submission"].includes(c?.stage ?? "")) return "banks";
    return "tasks";
  });
  const [showAddTask, setShowAddTask] = useState(false);
  const [showStage, setShowStage] = useState(false);
  const [showOutcome, setShowOutcome] = useState(false);
  const [doneTarget, setDoneTarget] = useState<Task | null>(null);
  const [delTarget, setDelTarget] = useState<Task | null>(null);

  const caseTasks = useMemo(() => tasks.filter((t) => t.caseId === id), [tasks, id]);
  const caseActivities = useMemo(() => activities.filter((a) => a.caseId === id).sort((a, b) => b.at.localeCompare(a.at)), [activities, id]);
  const caseInstr = useMemo(() => instructions.filter((i) => i.caseId === id), [instructions, id]);
  const stageList = useMemo(() => [...stages].sort((a, b) => a.sortOrder - b.sortOrder), [stages]);

  if (!c) {
    return (
      <div className="card p-8 text-center">
        <p className="text-[13px] text-[var(--ink-faint)] m-0 mb-3">That case no longer exists.</p>
        <button className="btn btn-ghost" onClick={() => nav({ name: "dashboard" })}>Back to dashboard</button>
      </div>
    );
  }

  const status = caseStatusOf(c, tasks);
  const openTasks = caseTasks.filter((t) => t.status === "Open");
  const doneTasks = caseTasks.filter((t) => t.status === "Done");
  const owner = userById(c.ownerId);
  const currentStageIdx = stageList.findIndex((s) => s.label === c.stage);
  const canEdit = flags?.super || flags?.admin || c.ownerId === me?.id;
  const activeStages = stageList.filter((s) => s.active);
  const activeIdx = activeStages.findIndex((s) => s.label === c.stage);
  const preApprovalIdx = activeStages.findIndex((s) => s.label === "Pre-Approval");
  const folIdx = activeStages.findIndex((s) => s.label === "Final Approval");
  const showPreApproval = preApprovalIdx >= 0 && activeIdx >= preApprovalIdx;
  const showFol = folIdx >= 0 && activeIdx >= folIdx;

  return (
    <div className="space-y-4">
      <button className="btn btn-ghost btn-sm" onClick={() => nav({ name: "dashboard" })}>
        <IChevronL size={14} /> Pipeline
      </button>

      {/* header */}
      <div className="card p-5 anim-fade-up">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="mono text-[13px]" style={{ color: "var(--amber)" }}>{c.caseNumber}</span>
              <CaseStateChip state={c.caseStatus} />
              {c.caseStatus === "Active" && <StatusChip status={status} />}
              {c.onHold && (
                <span
                  className="chip"
                  title={c.holdReason ? `On hold — ${c.holdReason}${c.holdUntil ? ` (until ${c.holdUntil})` : ""}` : "On hold"}
                  style={{ color: "var(--amber)", background: "rgba(242,176,76,0.12)", borderColor: "rgba(242,176,76,0.4)" }}
                >
                  ON HOLD
                </span>
              )}
              <SourceChip source={c.source} />
              {c.transactionType && <Chip tone="sky">{c.transactionType}</Chip>}
              {c.propertyLocation && <Chip tone="slate">{c.propertyLocation}</Chip>}
              {c.partner && <Chip tone="amber">{c.partner.kind} · {c.partner.name}{flags?.viewRevenue ? ` @ ${c.partner.sharePct}%` : ""}</Chip>}
            </div>
            <h1 className="font-disp font-bold text-[26px] tracking-tight m-0 mt-2">{c.customer}</h1>
            <p className="text-[12.5px] text-[var(--ink-faint)] m-0 mt-1">
              opened {fmtDate(c.createdAt)} · {ageDays(c.createdAt)}d old · stage <strong className="text-[var(--ink-dim)]">{c.stage}</strong>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <WaButtons c={c} agentName={me?.name ?? ""} />
            {c.caseStatus === "Active" && (
              <>
                <button className="btn btn-ghost sm:btn-sm" onClick={() => setShowStage(true)}><IArrowR size={14} /> Move stage</button>
                <button className="btn btn-primary sm:btn-sm" onClick={() => setShowOutcome(true)}>Set outcome</button>
              </>
            )}
          </div>
        </div>

        {/* stage pipeline */}
        <div className="mt-5 flex items-center gap-1 overflow-x-auto pb-1">
          {stageList.filter((s) => s.active).map((s, i) => {
            const idx = stageList.filter((x) => x.active).findIndex((x) => x.label === c.stage);
            const done = i < idx;
            const current = i === idx;
            return (
              <div key={s.id} className="flex items-center gap-1 shrink-0">
                <button onClick={() => canEdit && setShowStage(true)} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all"
                  style={current ? { background: "rgba(242,176,76,0.12)", border: "1px solid var(--amber)" } : { border: "1px solid transparent" }}>
                  <span className="w-5 h-5 rounded-full flex items-center justify-center mono text-[10px] font-semibold"
                    style={{ background: done ? "var(--mint)" : current ? "var(--amber)" : "var(--track)", color: done || current ? "#fff" : "var(--ink-faint)" }}>
                    {done ? <ICheck size={11} /> : i + 1}
                  </span>
                  <span className="text-[11.5px] font-disp font-medium whitespace-nowrap" style={{ color: current ? "var(--ink)" : done ? "var(--ink-dim)" : "var(--ink-faint)" }}>{s.label}</span>
                </button>
                {i < stageList.filter((x) => x.active).length - 1 && <span className="w-3 h-px" style={{ background: "var(--line)" }} />}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-4 items-start">
        {/* left: stage-aware tabs */}
        <div className="space-y-4">
          <div className="card p-2 flex gap-1.5 overflow-x-auto">
            {([["tasks", "Tasks"], ["documents", "Documents"], ["banks", "Banks & proposal"], ["activity", "Activity"]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setCaseTab(k)}
                className="chip transition-all whitespace-nowrap"
                style={caseTab === k ? { background: "rgba(242,176,76,0.14)", borderColor: "var(--amber)", color: "var(--amber)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}>
                {label}
              </button>
            ))}
          </div>
          {/* tasks */}
          {(caseTab === "tasks") && (<><div className="card anim-fade-up">
            <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: "var(--line-soft)" }}>
              <div className="flex items-center gap-2">
                <h3 className="font-disp font-semibold text-[14px] m-0">Tasks</h3>
                <Chip tone={openTasks.length ? "amber" : "mint"}>{openTasks.length} open</Chip>
                <span className="text-[11.5px] text-[var(--ink-faint)]">· {doneTasks.length} done</span>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAddTask(true)}><IPlus size={13} /> Add task</button>
            </div>
            <div className="divide-y" style={{ borderColor: "var(--line-soft)" }}>
              {caseTasks.length === 0 && <p className="p-5 text-[13px] text-[var(--ink-faint)] m-0">No tasks yet — add the first action.</p>}
              {[...caseTasks].sort((a, b) => (a.status === b.status ? a.dueDate.localeCompare(b.dueDate) : a.status === "Open" ? -1 : 1)).map((t) => {
                const tOwner = userById(t.ownerId);
                const isOpen = t.status === "Open";
                const od = isOpen && t.dueDate < todayISO();
                const canTouch = flags?.super || flags?.admin || t.ownerId === me?.id || t.createdBy === me?.id;
                return (
                  <div key={t.id} className="p-4 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-[13.5px] m-0" style={{ textDecoration: isOpen ? undefined : "line-through", textDecorationColor: "var(--ink-faint)" }}>{t.description}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[11.5px] text-[var(--ink-faint)]">
                        <Chip tone={t.waitingFor === "Client" ? "sky" : t.waitingFor === "Bank" ? "amber" : t.waitingFor === "Internal" ? "slate" : "coral"}>{t.waitingFor}</Chip>
                        <span>· {t.whyPending}</span>
                        <span>· opened by {userById(t.createdBy)?.name.split(" ")[0] ?? "—"}</span>
                      </div>
                      {!isOpen && t.remarks && <p className="text-[11.5px] text-[var(--ink-faint)] m-0 mt-1 truncate">“{t.remarks}”</p>}
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <div className="flex items-center gap-2">
                        <Avatar name={tOwner?.name ?? "?"} size={22} />
                        <span className="text-[11.5px] text-[var(--ink-dim)]">{tOwner?.name.split(" ")[0] ?? "—"}</span>
                      </div>
                      {isOpen ? <DueChip dueISO={t.dueDate} /> : <span className="mono text-[11px] text-[var(--ink-faint)]">{t.completedAt ? fmtDateTime(t.completedAt) : "—"}</span>}
                      <div className="flex gap-1">
                        {isOpen && canTouch && (
                          <button className="btn btn-mint btn-sm !px-2 !py-1" title="Mark done" onClick={() => setDoneTarget(t)}><ICheck size={12} /></button>
                        )}
                        {canTouch && (
                          <button className="btn btn-ghost btn-sm !px-2 !py-1" title="Delete task" onClick={() => setDelTarget(t)}><ITrash size={12} /></button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* instructions */}
          {caseInstr.length > 0 && (
            <div className="card anim-fade-up">
              <div className="p-4 border-b flex items-center gap-2" style={{ borderColor: "var(--line-soft)" }}>
                <IFlag size={14} className="text-[var(--amber)]" />
                <h3 className="font-disp font-semibold text-[14px] m-0">Instructions</h3>
                <span className="text-[11.5px] text-[var(--ink-faint)] ml-auto">{caseInstr.filter((i) => i.status === "Open").length} open</span>
              </div>
              <div className="divide-y" style={{ borderColor: "var(--line-soft)" }}>
                {caseInstr.map((instr) => {
                  const assignee = userById(instr.assignedTo);
                  return (
                    <div key={instr.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-[13px] font-medium m-0">{instr.instruction}</p>
                        {instr.status === "Done" ? <Chip tone="mint">done</Chip> : <Chip tone="amber">open</Chip>}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[11.5px] text-[var(--ink-faint)]">
                        <span>issued by {userById(instr.issuedBy)?.name.split(" ")[0]}</span>
                        <span>· assigned to <span className="text-[var(--ink-dim)]">{assignee?.name}</span></span>
                        <span>· due {fmtDate(instr.dueDate)}</span>
                      </div>
                      {instr.status === "Open" && (flags?.super || flags?.admin || instr.assignedTo === me?.id) && (
                        <button className="btn btn-ghost btn-sm mt-2" onClick={async () => { await completeInstruction(instr.id); toast("success", "Instruction marked done."); }}>
                          <ICheck size={13} /> Mark done
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          </>)}

          {/* documents */}
          {(caseTab === "documents") && <DocVault c={c} />}

          {/* banks */}
          {(caseTab === "banks") && <BankMatchPanel c={c} />}

          {/* activity: stage history + activity log */}
          {(caseTab === "activity") && (
          <>
          {/* stage transition log */}
          <StageHistoryPanel caseId={c.id} />

          {/* activity */}
          <div className="card anim-fade-up">
            <div className="p-4 border-b flex items-center gap-2" style={{ borderColor: "var(--line-soft)" }}>
              <IHistory size={14} className="text-[var(--ink-faint)]" />
              <h3 className="font-disp font-semibold text-[14px] m-0">Activity log</h3>
            </div>
            <div className="p-4 space-y-3">
              {caseActivities.length === 0 && <p className="text-[12.5px] text-[var(--ink-faint)] m-0">No activity recorded yet.</p>}
              {caseActivities.map((a) => (
                <div key={a.id} className="flex items-start gap-3">
                  <Avatar name={userById(a.userId)?.name ?? "?"} size={26} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] m-0 leading-snug">
                      <strong className="font-medium">{userById(a.userId)?.name ?? "—"}</strong>{" "}
                      <span className="text-[var(--ink-dim)]">{a.action.toLowerCase()}</span>
                    </p>
                    <p className="mono text-[10.5px] text-[var(--ink-faint)] m-0 mt-0.5">{relTime(a.at)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          </>)}
        </div>

        {/* right: MIS + pre-approval/FOL + commission + copilot + client */}
        <div className="space-y-4">
          <MisPanel c={c} />
          {showPreApproval && <PreApprovalPanel c={c} />}
          {showFol && <FolPanel c={c} />}
          <CaseCopilot caseId={c.id} />
          <CommissionPanel c={c} />
          <div className="card p-4">
            <h3 className="font-disp font-semibold text-[13.5px] m-0 mb-3">Banks in play</h3>
            <BankChips c={c} max={99} />
            {c.banks.length > 0 && (
              <div className="mt-3 pt-3 text-[11.5px] text-[var(--ink-faint)]" style={{ borderTop: "1px dashed var(--line)" }}>
                {c.wonBank ? `Booked with ${c.wonBank}.` : "Winning bank recorded when the case books."}
              </div>
            )}
          </div>
          <div className="card p-4">
            <h3 className="font-disp font-semibold text-[13.5px] m-0 mb-3">People</h3>
            <div className="space-y-2.5">
              <div className="flex items-center gap-2.5">
                <Avatar name={owner?.name ?? "?"} size={28} />
                <div>
                  <div className="text-[12.5px] font-medium">{owner?.name ?? "—"}</div>
                  <div className="text-[11px] text-[var(--ink-faint)]">{c.ownerId === me?.id ? "you" : "case owner"} · {owner?.role}</div>
                </div>
              </div>
              {c.vrmId && userById(c.vrmId) && (
                <div className="flex items-center gap-2.5">
                  <Avatar name={userById(c.vrmId)!.name} size={28} />
                  <div>
                    <div className="text-[12.5px] font-medium">{userById(c.vrmId)!.name}</div>
                    <div className="text-[11px] text-[var(--ink-faint)]">VRM · {userById(c.vrmId)!.role}</div>
                  </div>
                </div>
              )}
              {c.bankRm && (
                <div className="flex items-center gap-2.5">
                  <Avatar name={c.bankRm} size={28} />
                  <div>
                    <div className="text-[12.5px] font-medium">{c.bankRm}</div>
                    <div className="text-[11px] text-[var(--ink-faint)]">bank relationship manager</div>
                  </div>
                </div>
              )}
              {c.coApplicantName && (
                <div className="flex items-center gap-2.5">
                  <Avatar name={c.coApplicantName} size={28} />
                  <div>
                    <div className="text-[12.5px] font-medium">{c.coApplicantName}</div>
                    <div className="text-[11px] text-[var(--ink-faint)]">co-applicant</div>
                  </div>
                </div>
              )}
              {c.partner && (
                <div className="flex items-center gap-2.5">
                  <Avatar name={c.partner.name} size={28} />
                  <div>
                    <div className="text-[12.5px] font-medium">{c.partner.name}</div>
                    <div className="text-[11px] text-[var(--ink-faint)]">{c.partner.kind}{flags?.viewRevenue ? ` · ${c.partner.sharePct}% of our commission` : ""}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="card p-4">
            <h3 className="font-disp font-semibold text-[13.5px] m-0 mb-3">Quick calc</h3>
            <p className="text-[12px] text-[var(--ink-faint)] m-0 mb-2">Run an affordability check on this client and save it to the case.</p>
            <button className="btn btn-ghost btn-sm w-full justify-center" onClick={() => nav({ name: "calculator" })}>
              <ICalc size={14} /> Open calculator
            </button>
          </div>
        </div>
      </div>

      {showAddTask && <AddTaskModal open={showAddTask} onClose={() => setShowAddTask(false)} caseId={c.id} />}
      {showStage && <StageUpdateModal open={showStage} onClose={() => setShowStage(false)} caseId={c.id} />}
      {showOutcome && <OutcomeModal open={showOutcome} onClose={() => setShowOutcome(false)} caseId={c.id} />}
      {doneTarget && (
        <DoneModal t={doneTarget} onClose={() => setDoneTarget(null)} onDone={async (remarks) => { await completeTask(doneTarget.id, remarks); toast("success", `“${doneTarget.description}” marked done.`); }} />
      )}
      {delTarget && (
        <ConfirmModal open={!!delTarget} onClose={() => setDelTarget(null)} title="Delete task?" body={<>Permanently delete <strong>{delTarget.description}</strong>?</>} confirmLabel="Delete"
          onConfirm={async () => { await deleteTask(delTarget.id); toast("success", "Task deleted."); }} />
      )}
    </div>
  );

  function completeInstruction(id: number) { return useHfmcStore.getState().completeInstruction(id); }
}

function DoneModal({ t, onClose, onDone }: { t: Task; onClose: () => void; onDone: (remarks: string) => void }) {
  const [remarks, setRemarks] = useState("");
  return (
    <Modal title="Complete task" sub={t.description} onClose={onClose} width={440}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Not yet</button><button className="btn btn-mint" onClick={() => onDone(remarks)}><ICheck size={15} /> Mark done</button></>}>
      <label className="label">Remarks (optional)</label>
      <textarea className="textarea" rows={3} placeholder="What happened?" value={remarks} onChange={(e) => setRemarks(e.target.value)} autoFocus />
    </Modal>
  );
}
