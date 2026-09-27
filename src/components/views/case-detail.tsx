"use client";
import { CaseProfileEditor } from "@/components/views/case-profile-editor";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { LoanCase, Reply, Task } from "@/lib/types";
import {
  caseStatusOf, fmtDate, fmtDateTime, fmtDue, fmtMoney, inDaysISO, isOverdueDue, parseTaskDue, relTime,
} from "@/lib/format";
import { Avatar, Chip, DueChip, Modal, StatusChip } from "@/components/hfmc/ui";
import { CaseStateChip, CommissionPanel, ConfirmModal, SourceChip, WaButtons, waClientLink } from "@/components/hfmc/bits";
import { DocVault } from "@/components/views/doc-vault";
import { StageJourney } from "@/components/case/StageJourney";
import { StageDrawer } from "@/components/case/StageDrawer";
import { CaseHero } from "@/components/case/CaseHero";
import { ProfileStrip } from "@/components/case/ProfileStrip";
import { DocActionRow } from "@/components/case/DocActionRow";
import type { StageKey } from "@/lib/workflow/types";
import type { CaseTab } from "@/components/case/stage-parts";
import { DailyMisTab } from "@/components/views/daily-mis";
import { BankMatchPanel } from "@/components/views/bank-match";
import { ProposalHistory } from "@/components/views/proposal-history";
import { ChatPanel } from "@/components/chat/ChatPanel";
import {
  IArrowR, IBank, ICheck, IChevronL, IEye, IFlag, IHistory, IPlus, IRobot, ISparkles, ITrash, IWhatsapp,
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
              <span className="mono text-[10.5px] text-[var(--ink-faint)]">{relTime(r.at)}</span>
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
  // Optional clock time — empty keeps the legacy end-of-day reading ("date only")
  const [dueTime, setDueTime] = useState("");
  const [err, setErr] = useState("");

  if (!open) return null;

  const submit = async () => {
    if (!description.trim()) return setErr("What needs doing?");
    if (!dueDate) return setErr("Pick a due date.");
    // "2026-03-04" + "14:30" → "2026-03-04T14:30" (local wall-clock, no zone)
    const due = dueTime ? `${dueDate}T${dueTime}` : dueDate;
    try {
      await addTask(caseId, { description: description.trim(), ownerId, waitingFor, whyPending, dueDate: due });
      toast("success", "Task added.");
      setDescription(""); setDueTime(""); setErr(""); onClose();
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
            <label className="label">Due time <span className="normal-case tracking-normal" style={{ color: "var(--ink-faint)" }}>— optional</span></label>
            <input className="input mono" type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
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
    if (status === "Closed") {
      // deal-won ritual — Shell renders the one-shot burst on this event
      window.dispatchEvent(new CustomEvent("hfmc:deal-won", { detail: { customer: c.customer } }));
    }
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
        <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="modal-pop w-full max-w-[680px]">
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
  const { updateCase, toast } = useHfmcStore();
  const [expanded, setExpanded] = useState(false);
  const save = (field: string, value: unknown) =>
    updateCase(c.id, { [field]: value }).then(() => toast("success", "Saved."));

  return (
    <div className="card p-4 anim-fade-up" style={{ borderLeft: "3px solid var(--amber)" }}>
      <div className="flex items-center gap-2 mb-3">
        <IFlag size={14} className="text-[var(--amber)]" />
        <h3 className="font-disp font-semibold text-[13.5px] m-0">Bank Tracking</h3>
        {c.onHold && <span className="ml-auto chip" style={{ color: "var(--amber)", background: "rgba(242,176,76,0.12)", borderColor: "rgba(242,176,76,0.4)" }}>ON HOLD</span>}
      </div>

      {/* bank-tracking fields — the only fields that don't belong in the Profile tab */}
      <button
        className="flex items-center gap-1.5 text-[11px] text-[var(--ink-faint)] mb-2 cursor-pointer hover:text-[var(--ink-dim)] transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <span style={{ display: "inline-flex", transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>
          <IArrowR size={11} />
        </span>
        {expanded ? "Hide fields" : "Show fields — edit only when something changed"}
      </button>

      {expanded && (
        <div className="grid grid-cols-2 gap-3 mt-1 anim-fade-up">
          <Field label="Bank RM">
            <SaveText value={c.bankRm ?? ""} placeholder="RM name at bank" onSave={(v) => save("bankRm", v || null)} />
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
      )}

      {/* on hold toggle */}
      <div className="mt-3 pt-3" style={{ borderTop: "1px dashed var(--line)" }}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div>
            <div className="text-[12.5px] font-medium">On hold</div>
            <div className="text-[11px] text-[var(--ink-faint)]">Park the case with a reason and optional resume date.</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={c.onHold}
            onClick={() => save("onHold", !c.onHold)}
            className="relative inline-flex items-center h-6 w-11 rounded-full transition-colors shrink-0 focus:outline-none"
            style={{ background: c.onHold ? "var(--amber)" : "var(--line)" }}
          >
            <span
              className="inline-block w-4 h-4 rounded-full bg-white shadow transition-transform"
              style={{ transform: c.onHold ? "translateX(22px)" : "translateX(2px)" }}
            />
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
  const { cases, tasks, activities, stages, banks, users, instructions, me, nav, userById, caseById, updateCase, deleteCase, completeTask, deleteTask, toast, flags, canInstruct } = useHfmcStore();
  const c = caseById(id);
  const [caseTab, setCaseTab] = useState<CaseTab>(() => {
    // stage-aware default: a fresh lead opens on its profile (that IS the lead's
    // work); every other stage opens on the daily workspace
    return c?.stage === "Lead" ? "profile" : "daily";
  });
  const [profileSubTab, setProfileSubTab] = useState<"primary" | "property" | "joint">("primary");
  const [showInspector, setShowInspector] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("hfmc.caseInspectorOpen");
      if (saved !== null) return saved === "true";
    }
    return true;
  });
  const toggleInspector = () => {
    setShowInspector((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("hfmc.caseInspectorOpen", String(next));
      } catch { }
      return next;
    });
  };
  const [showAddTask, setShowAddTask] = useState(false);
  const [showStage, setShowStage] = useState(false);
  const [showOutcome, setShowOutcome] = useState(false);
  const [doneTarget, setDoneTarget] = useState<Task | null>(null);
  const [delTarget, setDelTarget] = useState<Task | null>(null);
  const [delCaseOpen, setDelCaseOpen] = useState(false);
  const [journeyKey, setJourneyKey] = useState<StageKey | null>(null);
  const [taskFilter, setTaskFilter] = useState<"All" | "Client" | "Bank" | "Internal" | "Urgent">("All");

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
  // 2) STICKY ACTION HEADER — Next Best Action = oldest open task by exact due instant.
  const nextBest = [...openTasks].sort((a, b) => (parseTaskDue(a.dueDate)?.getTime() ?? 0) - (parseTaskDue(b.dueDate)?.getTime() ?? 0))[0] ?? null;
  const waNudge = nextBest && c.whatsapp ? waClientLink(c.whatsapp, c.caseNumber, c.customer, me?.name ?? "") : null;
  const currentStageIdx = stageList.findIndex((s) => s.label === c.stage);
  const canEdit = flags?.super || flags?.admin || c.ownerId === me?.id;
  const activeStages = stageList.filter((s) => s.active);
  const activeIdx = activeStages.findIndex((s) => s.label === c.stage);
  const preApprovalIdx = activeStages.findIndex((s) => s.label === "Pre-Approval");
  const folIdx = activeStages.findIndex((s) => s.label === "FOL + Loan Booking");
  const showPreApproval = preApprovalIdx >= 0 && activeIdx >= preApprovalIdx;
  const showFol = folIdx >= 0 && activeIdx >= folIdx;

  return (
    <div className="space-y-4">
      {/* 2) STICKY ACTION HEADER — context + primary CTA stay visible while scrolling the 360 */}
      <div className="case-stickybar flex flex-wrap items-center gap-2 p-2 bg-[var(--bg2)]">
        <button className="btn btn-ghost btn-sm !px-2 shrink-0" onClick={() => nav({ name: "dashboard" })} title="Back to pipeline">
          <IChevronL size={14} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="mono text-[11.5px] shrink-0 truncate" style={{ color: "var(--amber)" }}>{c.caseNumber}</span>
            <span className="text-[13.5px] font-disp font-semibold truncate">{c.customer}</span>
            {c.caseStatus === "Active" ? <StatusChip status={status} /> : <CaseStateChip state={c.caseStatus} />}
            <span className="chip hidden md:inline" style={{ fontSize: 10, background: "rgba(242,176,76,0.1)", color: "var(--amber)", borderColor: "rgba(242,176,76,0.3)" }}>{c.stage}</span>
            <span className="mono text-[12px] text-[var(--ink-dim)] hidden sm:inline">{fmtMoney(c.loanAmount)}</span>
          </div>
          {nextBest ? (
            <p className="text-[11.5px] m-0 mt-0.5 truncate" style={{ color: "var(--ink-dim)" }}>
              <span style={{ color: "var(--amber)" }}>⚡ {fmtDue(nextBest.dueDate)}:</span> {nextBest.description}
            </p>
          ) : (
            <p className="text-[11.5px] m-0 mt-0.5" style={{ color: "var(--mint)" }}>✓ No open tasks — file is clean.</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          {waNudge && (
            <a className="btn btn-mint btn-sm !px-2.5" href={waNudge} target="_blank" rel="noreferrer" title={`Nudge ${c.customer} about: ${nextBest?.description ?? ""}`}>
              <IWhatsapp size={14} /><span className="hidden lg:inline">Nudge</span>
            </a>
          )}
          <button className="btn btn-ghost btn-sm !px-2.5 mt-1 sm:mt-0" onClick={() => setShowAddTask(true)} title="Add a task"><IPlus size={14} /><span className="hidden lg:inline">Task</span></button>
          <button className="btn btn-ghost btn-sm !px-2.5 mt-1 sm:mt-0" onClick={() => setShowStage(true)} title="Move stage"><IArrowR size={14} /><span className="hidden lg:inline">Stage</span></button>
          <button className="btn btn-ghost btn-sm !px-2.5 mt-1 sm:mt-0" onClick={() => setCaseTab("banks")} title="Run bank match"><IBank size={14} /><span className="hidden lg:inline">Match</span></button>
          <button
            className="btn btn-ghost btn-sm !px-2.5 mt-1 sm:mt-0"
            onClick={toggleInspector}
            title={showInspector ? "Hide case details inspector" : "Show case details inspector"}
            style={showInspector ? { color: "var(--amber)", background: "rgba(242,176,76,0.12)" } : undefined}
          >
            <IEye size={14} /><span className="hidden lg:inline">{showInspector ? "Hide Details" : "Details"}</span>
          </button>
        </div>
      </div>

      {/* hero — case no + customer + chips + action buttons merged in */}
      <CaseHero
        c={c}
        status={status}
        actions={
          <>
            <WaButtons c={c} agentName={me?.name ?? ""} />
            {c.caseStatus === "Active" && (
              <button className="btn btn-primary btn-sm" onClick={() => setShowOutcome(true)}>Set outcome</button>
            )}
            {(flags?.admin || flags?.super) && (
              <button
                className="btn btn-ghost btn-sm !px-2"
                title="Delete permanently (admin) — accidental creations only; use Set outcome → Lost otherwise"
                onClick={() => setDelCaseOpen(true)}
                style={{ color: "var(--coral)" }}
              >
                <ITrash size={14} />
              </button>
            )}
          </>
        }
      />

      {/* overview card — profile strip (hidden if profile tab active) + stage journey */}
      <div className="card p-5 anim-fade-up">
        {/* brief profile — click a card to jump into Profile tab */}
        {caseTab !== "profile" && (
          <ProfileStrip
            c={c}
            onEdit={(tab, subTab) => {
              setCaseTab(tab);
              if (subTab) setProfileSubTab(subTab);
            }}
          />
        )}

        {/* journey — 5 stage cards (click for Now / To-do / Procedure / Actions) */}
        <div className={caseTab !== "profile" ? "mt-4" : ""}>
          <StageJourney c={c} onOpen={setJourneyKey} />
        </div>
        {journeyKey && (
          <StageDrawer c={c} stageKey={journeyKey} onClose={() => setJourneyKey(null)} onTab={setCaseTab} />
        )}
      </div>

      {/* workspace navigation bar — prominent switcher anchoring the workspace below */}
      <DocActionRow
        c={c}
        active={caseTab}
        onTab={setCaseTab}
        showInspector={showInspector}
        onToggleInspector={toggleInspector}
      />

      <div className={`grid grid-cols-1 ${showInspector ? "xl:grid-cols-[1fr_340px]" : ""} gap-4 items-start`}>
        {/* left: stage-aware tabs — DocActionRow above is the primary tab navigation */}
        <div className="space-y-4">
          {/* profile */}
          {(caseTab === "profile") && <CaseProfileEditor c={c} initialTab={profileSubTab} />}

          {/* daily MIS */}
          {(caseTab === "daily") && <DailyMisTab c={c} />}

          {/* tasks */}
          {(caseTab === "tasks") && (<><div className="card anim-fade-up anim-reveal">
            <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: "var(--line-soft)" }}>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-disp font-semibold text-[14px] m-0">Tasks</h3>
                <Chip tone={openTasks.length ? "amber" : "mint"}>{openTasks.length} open</Chip>
                <span className="text-[11.5px] text-[var(--ink-faint)]">· {doneTasks.length} done</span>
                {/* waitingFor quick-filter chips */}
                <div className="flex items-center gap-1 ml-2">
                  {(["All", "Client", "Bank", "Internal", "Urgent"] as const).map((f) => (
                    <button
                      key={f}
                      className="chip"
                      onClick={() => setTaskFilter((prev) => prev === f ? "All" : f)}
                      style={taskFilter === f && f !== "All" ? { background: "rgba(242,176,76,0.15)", color: "var(--amber)", borderColor: "rgba(242,176,76,0.4)" } : taskFilter === "All" && f === "All" ? { background: "rgba(var(--mint-rgb),0.1)", color: "var(--mint)", borderColor: "rgba(var(--mint-rgb),0.3)" } : undefined}
                    >{f}</button>
                  ))}
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAddTask(true)}><IPlus size={13} /> Add task</button>
            </div>
            <div className="divide-y" style={{ borderColor: "var(--line-soft)" }}>
              {caseTasks.length === 0 && <p className="p-5 text-[13px] text-[var(--ink-faint)] m-0">No tasks yet — add the first action.</p>}
              {[...caseTasks].filter((t) => taskFilter === "All" || t.waitingFor === taskFilter || (taskFilter === "Urgent" && isOverdueDue(t.dueDate))).sort((a, b) => (a.status === b.status ? (parseTaskDue(a.dueDate)?.getTime() ?? 0) - (parseTaskDue(b.dueDate)?.getTime() ?? 0) : a.status === "Open" ? -1 : 1)).map((t) => {
                const tOwner = userById(t.ownerId);
                const isOpen = t.status === "Open";
                const od = isOpen && isOverdueDue(t.dueDate);
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
                          <button className="btn btn-ghost btn-sm mt-2" onClick={async () => { await useHfmcStore.getState().completeInstruction(instr.id); toast("success", "Instruction marked done."); }}>
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

          {/* chat */}
          {(caseTab === "chat") && (
            <div className="card h-[600px] overflow-hidden anim-fade-up">
              <ChatPanel
                caseId={c.id}
                caseNumber={c.caseNumber}
                customerName={c.customer}
                userRole="STAFF"
                allowThreadSwitch={true}
              />
            </div>
          )}

          {/* banks + proposals: match panel followed by proposal history */}
          {(caseTab === "banks") && <>
            <BankMatchPanel c={c} />
            <ProposalHistory c={c} />
          </>}

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

        {/* right: collapsible details inspector */}
        {showInspector && (
          <div className="space-y-4 xl:w-[340px] shrink-0 anim-fade-in">
            <div className="flex items-center justify-between px-1">
              <span className="mono text-[10.5px] uppercase tracking-wider font-bold text-[var(--ink-faint)]">
                Case Details
              </span>
              <button
                type="button"
                onClick={toggleInspector}
                className="btn btn-ghost btn-sm !py-0.5 !px-1.5 text-[11px] text-[var(--ink-faint)] hover:text-[var(--ink)]"
                title="Collapse details panel"
              >
                Hide ×
              </button>
            </div>
            {/* People — owner, VRM (with inline edit), advisor, backups, partner */}
            <div className="card p-4">
              <h3 className="font-disp font-semibold text-[13.5px] m-0 mb-3">People</h3>
              <div className="space-y-2.5">
                {/* Owner */}
                <div className="flex items-center gap-2.5">
                  <Avatar name={owner?.name ?? "?"} size={28} />
                  <div>
                    <div className="text-[12.5px] font-medium">{owner?.name ?? "—"}</div>
                    <div className="text-[11px] text-[var(--ink-faint)]">{c.ownerId === me?.id ? "you" : "case owner"} · {owner?.role}</div>
                  </div>
                </div>
                {/* VRM — display + inline edit in one place */}
                <div className="flex items-center gap-2.5">
                  <span style={{ opacity: c.vrmId ? 1 : 0.4 }}>
                    <Avatar name={c.vrmId ? (userById(c.vrmId)?.name ?? "?") : "?"} size={28} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium">{c.vrmId ? (userById(c.vrmId)?.name ?? "—") : "—"}</div>
                    <div className="text-[11px] text-[var(--ink-faint)]">VRM{c.vrmId ? ` · ${userById(c.vrmId)?.role ?? ""}` : " · unassigned"}</div>
                  </div>
                  {canEdit && (
                    <select className="select !w-auto !py-1 text-[11px]" value={c.vrmId ? String(c.vrmId) : ""}
                      title="Assign VRM"
                      onChange={async (e) => {
                        await updateCase(c.id, { vrmId: e.target.value ? parseInt(e.target.value, 10) : null });
                        toast("success", e.target.value ? "VRM assigned." : "VRM removed.");
                      }}>
                      <option value="">— none —</option>
                      {users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  )}
                </div>
                {/* Bank RM — display only (edited in Bank Tracking panel) */}
                {c.bankRm && (
                  <div className="flex items-center gap-2.5">
                    <Avatar name={c.bankRm} size={28} />
                    <div>
                      <div className="text-[12.5px] font-medium">{c.bankRm}</div>
                      <div className="text-[11px] text-[var(--ink-faint)]">bank relationship manager</div>
                    </div>
                  </div>
                )}
                {/* Co-applicant */}
                {c.coApplicantName && (
                  <div className="flex items-center gap-2.5">
                    <Avatar name={c.coApplicantName} size={28} />
                    <div>
                      <div className="text-[12.5px] font-medium">{c.coApplicantName}</div>
                      <div className="text-[11px] text-[var(--ink-faint)]">co-applicant</div>
                    </div>
                  </div>
                )}
                {/* Client-facing advisor — may differ from the owner who runs the file */}
                {(() => {
                  const advId = c.advisorId ?? c.ownerId;
                  const adv = userById(advId);
                  const canAssignAdvisor = flags?.super || flags?.admin || c.ownerId === me?.id;
                  return (
                    <div className="flex items-center gap-2.5">
                      <Avatar name={adv?.name ?? "?"} size={28} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] font-medium">{adv?.name ?? "—"}</div>
                        <div className="text-[11px] text-[var(--ink-faint)]">advisor · {adv?.role}</div>
                      </div>
                      {canAssignAdvisor && (
                        <select className="select !w-auto !py-1 text-[11px]" value={String(advId)}
                          title="Appoint the client-facing advisor"
                          onChange={async (e) => {
                            await updateCase(c.id, { advisorId: Number(e.target.value) });
                            toast("success", "Advisor appointed.");
                          }}>
                          {users.filter((u) => u.active && u.role !== "Head of Company" && u.role !== "PA to HoC").map((u) => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                })()}
                {/* Backups — Backup 1 / Backup 2 labeling (consistent; no B1/B2 shorthand) */}
                {([1, 2] as const).map((n) => {
                  const bid = n === 1 ? c.backup1Id : c.backup2Id;
                  const bUser = bid ? userById(bid) : undefined;
                  const canAssign = flags?.super || flags?.admin || c.ownerId === me?.id;
                  return (
                    <div key={n} className="flex items-center gap-2.5" style={{ opacity: bid ? 1 : 0.6 }}>
                      <span className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[10.5px] font-disp font-bold"
                        style={{ background: bid ? "var(--amber-tint)" : "var(--tint)", color: bid ? "var(--amber)" : "var(--ink-faint)" }}>
                        {n}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] font-medium">{bUser?.name ?? "—"}</div>
                        <div className="text-[11px] text-[var(--ink-faint)]">{bid ? `Backup ${n} · covering · ${bUser?.role ?? ""}` : `Backup ${n} — not set`}</div>
                      </div>
                      {canAssign && (
                        <select className="select !w-auto !py-1 text-[11px]" value={bid ? String(bid) : ""}
                          title={`Appoint backup ${n}`}
                          onChange={async (e) => {
                            const val = e.target.value ? Number(e.target.value) : null;
                            await updateCase(c.id, n === 1 ? { backup1Id: val } : { backup2Id: val });
                            toast("success", val ? `Backup ${n} appointed — they can now open and work this file.` : `Backup ${n} removed.`);
                          }}>
                          <option value="">— none —</option>
                          {users.filter((u) => u.active && u.id !== c.ownerId && (n === 1 ? u.id !== c.backup2Id : u.id !== c.backup1Id)).map((u) => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                })}
                {c.profileClientVerifiedAt && (
                  <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--mint)" }}>
                    <ICheck size={12} /> Client verified their own data sheet on {fmtDate(c.profileClientVerifiedAt.slice(0, 10))}
                  </div>
                )}
                {c.partner && (
                  <div className="flex items-center gap-2.5">
                    <Avatar name={c.partner.name} size={28} />
                    <div>
                      <div className="text-[12.5px] font-medium">{c.partner.name}</div>
                      <div className="text-[11px] text-[var(--ink-faint)]">{c.partner.kind}{flags?.viewRevenue ? ` · ${c.partner.sharePct}% of our commission` : ""}</div>
                      {c.partnerRm && <div className="text-[11px] text-[var(--ink-dim)]">RM: {c.partnerRm}</div>}
                    </div>
                  </div>
                )}

                {/* Client Connection & Notification Overrides */}
                <div className="pt-2.5 mt-2 border-t" style={{ borderColor: "var(--line-soft)" }}>
                  <div className="flex items-center justify-between text-[11px] mb-1.5">
                    <span className="font-semibold text-[var(--ink-dim)]">Client Channel Overrides</span>
                    <span className="text-[10.5px] text-[var(--ink-faint)]">3-tier hierarchy</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {(["push", "whatsapp", "email"] as const).map((ch) => {
                      const overrides = (c.notificationOverrides as Record<string, boolean> | null) || {};
                      const isExplicitOff = overrides[ch] === false;
                      const isOn = ch === "email" ? overrides[ch] === true : !isExplicitOff;
                      return (
                        <button
                          key={ch}
                          type="button"
                          className="chip text-[10.5px] px-2 py-0.5"
                          style={
                            isOn
                              ? { background: "rgba(16,185,129,0.12)", color: "var(--mint)", borderColor: "rgba(16,185,129,0.4)" }
                              : { background: "rgba(244,63,94,0.1)", color: "var(--coral)", borderColor: "rgba(244,63,94,0.3)" }
                          }
                          title={`Click to toggle ${ch}`}
                          onClick={async () => {
                            const updated = { ...overrides, [ch]: !isOn };
                            await updateCase(c.id, { notificationOverrides: updated });
                            toast("info", `${ch.toUpperCase()} notification for this client set to ${!isOn ? "ON" : "OFF"}`);
                          }}
                        >
                          {ch === "whatsapp" ? "WhatsApp" : ch === "push" ? "Push" : "Email"}: {isOn ? "ON ✓" : "OFF ✕"}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
            {/* Client file */}
            <ClientFileCard c={c} />
            {/* Pre-approval (stage-conditional) */}
            {showPreApproval && <PreApprovalPanel c={c} />}
            {/* FOL (stage-conditional) */}
            {showFol && <FolPanel c={c} />}
            {/* Commission */}
            <CommissionPanel c={c} />
            {/* AI Copilot */}
            <CaseCopilot caseId={c.id} />
            {/* Bank Tracking (collapsed by default — rarely edited) */}
            <MisPanel c={c} />
          </div>
        )}
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
      {delCaseOpen && (
        <ConfirmModal open onClose={() => setDelCaseOpen(false)} title={`Delete ${c.caseNumber}?`}
          body={<>Permanently delete the case for <strong>{c.customer}</strong> — including its tasks, documents, proposals and history? Only for accidental creations; use <strong>Set outcome → Lost</strong> otherwise.</>}
          confirmLabel="Delete permanently"
          onConfirm={async () => { await deleteCase(c.id); }} />
      )}
    </div>
  );
}

/* Client file card — the person behind this case, and every other
   engagement we have with them (past mortgages, a second-party role,
   future buyouts / insurance work all land on the same record). */
function ClientFileCard({ c }: { c: LoanCase }) {
  const { clients, cases, nav } = useHfmcStore();
  const client = clients.find((cl) => cl.id === c.clientId) ?? null;
  const second = clients.find((cl) => cl.id === c.secondPartyClientId) ?? null;
  const engagements = client
    ? cases.filter((k) => k.id !== c.id && (k.clientId === client.id || k.secondPartyClientId === client.id))
    : [];

  if (!client) return null;

  return (
    <div className="card p-4 anim-fade-up">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="font-disp font-semibold text-[13.5px] m-0">Client file</h3>
        {engagements.length > 0 && <Chip tone="amber">repeat client</Chip>}
      </div>
      <div className="flex items-center gap-2.5">
        <Avatar name={client.fullName} size={34} />
        <div className="min-w-0">
          <div className="text-[13px] font-medium truncate">{client.fullName}</div>
          <div className="text-[10.5px] text-[var(--ink-faint)]">
            {client.phone ? `+${client.phone}` : "no phone"} · {client.residency}
            {client.eidNo ? " · EID on record" : ""}
          </div>
        </div>
      </div>
      {(client.monthlySalary > 0 || client.employmentProfile) && (
        <div className="mt-2.5 pt-2.5 text-[11.5px] text-[var(--ink-dim)]" style={{ borderTop: "1px dashed var(--line)" }}>
          {client.employmentProfile}{client.companyName ? ` · ${client.companyName}` : ""}
          {client.monthlySalary > 0 && ` · latest salary AED ${client.monthlySalary.toLocaleString()}`}
        </div>
      )}
      {engagements.length > 0 && (
        <div className="mt-2.5 pt-2.5 space-y-1" style={{ borderTop: "1px dashed var(--line)" }}>
          <div className="text-[10.5px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)]">Other engagements</div>
          {engagements.slice(0, 5).map((k) => (
            <button key={k.id} className="block text-left text-[11.5px] hover:underline" style={{ color: "var(--ink-dim)" }}
              onClick={() => nav({ name: "case", id: k.id })}>
              {k.caseNumber} · {k.customer} · {k.stage} · {k.caseStatus}
            </button>
          ))}
        </div>
      )}
      {second && (
        <div className="mt-2.5 pt-2.5 text-[11.5px] text-[var(--ink-faint)]" style={{ borderTop: "1px dashed var(--line)" }}>
          Second party: <span className="text-[var(--ink-dim)]">{second.fullName}</span>
          {second.eidNo ? " · EID on record" : ""}
        </div>
      )}
    </div>
  );
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
