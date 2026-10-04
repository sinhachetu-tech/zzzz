"use client";
import { CaseProfileEditor } from "@/components/views/case-profile-editor";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { LoanCase, Reply, Task } from "@/lib/types";
import { PARTY_ROLE_LABEL } from "@/lib/types";
import {
  caseStatusOf, fmtDate, fmtDateTime, fmtDue, fmtMoney, inDaysISO, isOverdueDue, parseTaskDue, relTime,
} from "@/lib/format";
import { computeCaseBlockers } from "@/lib/case-blockers";
import { Avatar, Chip, DueChip, Modal, StatusChip } from "@/components/hfmc/ui";
import { CaseStateChip, CommissionPanel, ConfirmModal, SourceChip, waClientLink } from "@/components/hfmc/bits";
import { DocVault, isDocOutstanding } from "@/components/views/doc-vault";
import { StageRail } from "@/components/case/StageRail";
import { StageDrawer } from "@/components/case/StageDrawer";
import { CaseCommandBar } from "@/components/case/CaseCommandBar";
import { CaseParties } from "@/components/case/CaseParties";
import { CaseTabBar } from "@/components/case/CaseTabBar";
import { CaseDetailsSheet, PeoplePanel } from "@/components/case/CaseDetailsSheet";
import { ProfileStrip } from "@/components/case/ProfileStrip";
import { CollectPanel } from "@/components/case/CollectPanel";
import { PersonDataSheet } from "@/components/person/PersonDataSheet";
import { seedPersonSheet } from "@/lib/person-sheet";
import type { StageKey } from "@/lib/workflow/types";
import { isJourneyConfigured, stagesForServiceLine } from "@/lib/workflow/registry";
import type { CaseTab } from "@/components/case/stage-parts";
import type { ProfileSubTab } from "@/components/views/case-profile-editor";
import { DailyMisTab } from "@/components/views/daily-mis";
import { BankMatchPanel } from "@/components/views/bank-match";
import { ProposalHistory } from "@/components/views/proposal-history";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { IBank, ICheck, IHistory, IFlag, IPlus, IRobot, ISparkles, ITrash, IWhatsapp, IChevronL, IArrowR, IPencil } from "@/components/icons";
import { ContactLine, KycChip, resolveContact } from "@/components/case/ContactBits";

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
  // The other banks on this engagement (Phase 2). Shown so the modal can say what
  // recording this win will close, instead of the numbers changing silently.
  const rivals = c ? cases.filter((o) => (c.parentCaseId == null ? o.parentCaseId === c.id : o.parentCaseId === c.parentCaseId) && o.id !== c.id && o.legStatus === "Active") : [];
  if (!open || !c) return null;
  const submit = async () => {
    const patch: Record<string, unknown> = { caseStatus: status };
    if (status === "Closed") {
      patch.wonBank = wonBank || null;
      // Booking this deal IS recording that this bank won the race. The API
      // closes every still-Active sibling as LostRace in the same transaction and
      // refuses a second winner — so this one field is what stops a beaten leg
      // sitting in the pipeline forever.
      patch.legStatus = "Won";
    } else {
      // Marking the deal lost does NOT mean this bank declined — leave legStatus
      // alone and let the broker record the real reason separately.
      patch.legStatus = "Declined";
    }
    await updateCase(caseId, patch);
    if (status === "Closed") {
      // deal-won ritual — Shell renders the one-shot burst on this event
      window.dispatchEvent(new CustomEvent("hfmc:deal-won", { detail: { customer: c.customer } }));
    }
    toast(
      "success",
      status === "Closed"
        ? `Booked! Won by ${wonBank}.${rivals.length ? ` Closed ${rivals.length} losing leg${rivals.length > 1 ? "s" : ""}.` : ""}`
        : "Marked lost.",
    );
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
            {rivals.length > 0 && (
              // Say what will close BEFORE it happens. A broker who books a deal
              // and watches three pipeline rows quietly disappear would rightly
              // stop trusting the button.
              <p className="text-[11.5px] text-[var(--ink-faint)] mt-1.5 m-0">
                Recording this win also closes {rivals.length} other bank leg{rivals.length > 1 ? "s" : ""} as{" "}
                <em>lost race</em> ({rivals.map((r) => r.banks[0] ?? r.caseNumber).join(", ")}). They stay on file for the
                buyout later.
              </p>
            )}
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

/** Every value the `#/<tab>` hash may take. Declared once so the tab bar, the
 *  hash reader and the hashchange listener cannot disagree about what a legal
 *  tab is — the failure mode being a URL that silently renders nothing. */
const CASE_TABS: CaseTab[] = ["now", "client", "documents", "money", "chat", "activity"];

export default function CaseDetail({ id }: { id: number }) {
  const {
    cases, tasks, activities, stages, users, instructions, clients, caseDocuments, caseUpdates,
    me, nav, userById, caseById, updateCase, deleteCase, completeTask, deleteTask, toast, flags, serviceLines,
    partiesOfCase,
  } = useHfmcStore();
  const c = caseById(id);

  // Phase 5: the case's service line, and the stages that belong to it. Both go
  // through the ONE shared resolver — a stage carries its line through its
  // StageSet, so an ad-hoc filter here is how a golden-visa case ends up showing
  // "Valuation".
  const line = serviceLines.find((s) => s.id === c?.serviceLineId);
  const scopedStages = stagesForServiceLine(stages, serviceLines, c?.serviceLineId);

  /* TAB IN THE URL.
   *
   * The old tab state was component-local, which meant three real bugs: a refresh
   * threw you back on Daily no matter where you were, the browser Back button
   * exited the case entirely instead of stepping back through the workspace, and
   * a teammate could not send you to "the documents tab of case 41" in a
   * message. `#/documents` fixes all three.
   *
   * READ IN THE INITIALISER, not in an effect. Seeding state from
   * window.location in a lazy useState keeps this to zero extra renders; doing it
   * in an effect would mean mounting the wrong tab and immediately correcting it,
   * which is the cascading-render pattern React's compiler rules warn about (and
   * is visible as a flash of the wrong workspace).
   *
   * WRITTEN with replaceState rather than a pushed history entry on purpose: a
   * tab click inside a case is not a place the user expects Back to return to,
   * and pushing an entry per click makes Back feel broken. The hashchange
   * listener below still handles an explicit Back or a hand-edited URL. */
  const [caseTab, setCaseTabRaw] = useState<CaseTab>(() => {
    if (typeof window === "undefined") return c?.stage === "Lead" ? "client" : "now";
    const fromHash = window.location.hash.replace(/^#\/?/, "");
    return CASE_TABS.includes(fromHash as CaseTab)
      ? (fromHash as CaseTab)
      : c?.stage === "Lead" ? "client" : "now";
  });
  const [profileSubTab, setProfileSubTab] = useState<ProfileSubTab>("primary");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const want = `#/${caseTab}`;
    if (window.location.hash !== want) window.history.replaceState(null, "", want);
  }, [caseTab]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHash = () => {
      const next = window.location.hash.replace(/^#\/?/, "") as CaseTab;
      if (CASE_TABS.includes(next)) setCaseTabRaw(next);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // UNSAVED-CHANGES GUARD on the data sheet. The sheet holds an unsaved draft, so
  // switching tab or walking away would silently drop it. A ref rather than state
  // because the guard only has to READ the flag at the moment of navigation.
  const sheetDirtyRef = useRef(false);
  const [pendingTab, setPendingTab] = useState<CaseTab | null>(null);

  const setCaseTab = useCallback((t: CaseTab) => {
    if (sheetDirtyRef.current && t !== "client") { setPendingTab(t); return; }
    setCaseTabRaw(t);
  }, [setCaseTabRaw]);

  // Browser-level guard: a refresh or back-navigation loses the draft too.
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (!sheetDirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  /* DETAILS SHEET, not a column. The old inspector was a persisted 340px rail
   * with three separate toggles; now it is an overlay with one button, which is
   * why there is no localStorage flag to migrate — the old key is simply left
   * unread (and documented below so nobody goes looking for it). */
  const [showDetails, setShowDetails] = useState(false);
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
  // Phase 5: the Move-stage picker offers ONLY this case's own service line's
  // stages. Before this it listed every stage in the book, so a golden-visa case
  // could be moved to "Valuation" — and the mortgage-only labels below
  // (preApprovalIdx / folIdx) simply resolved to -1 and silently did nothing.
  const stageList = useMemo(
    () => [...stagesForServiceLine(stages, serviceLines, c?.serviceLineId)].sort((a, b) => a.sortOrder - b.sortOrder),
    [stages, serviceLines, c?.serviceLineId],
  );

  /* BLOCKERS — one ranked list feeding BOTH the command bar's primary button and
   * its one-line strip. Derived from the same task/document/sheet rows the tab
   * bodies render, using the vault's own outstanding rule, so the button can
   * never promise something the tab it opens will contradict.
   *
   * Declared ABOVE the "case no longer exists" early return so hook order is
   * unconditional — a hook below a return is a rules-of-hooks violation and it
   * only shows up when a case is deleted mid-session, which is exactly when you
   * do not want a white screen. */
  const blockers = useMemo(() => {
    if (!c) return [];
    const docs = caseDocuments.filter((d) => d.caseId === id);
    const outstanding = docs.filter((d) => isDocOutstanding(d.status, !!d.fileName));
    return computeCaseBlockers({
      c,
      tasks: caseTasks,
      outstandingDocs: outstanding,
      clients,
      instructions: caseInstr,
      updatedOn: caseUpdates.filter((u) => u.caseId === id).map((u) => u.date),
    });
  }, [c, id, caseTasks, caseDocuments, clients, caseInstr, caseUpdates]);

  /* Stage-conditional money panels. Pre-approval and FOL figures only become
   * relevant once the case has reached those stages — the same rule the
   * inspector used, with fewer things left to hide. */
  const activeStages = useMemo(() => stageList.filter((s) => s.active), [stageList]);

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
  const canDelete = !!(flags?.admin || flags?.super);

  const activeIdx = activeStages.findIndex((s) => s.label === c.stage);
  const preApprovalIdx = activeStages.findIndex((s) => s.label === "Pre-Approval");
  const folIdx = activeStages.findIndex((s) => s.label === "FOL + Loan Booking");
  const showPreApproval = preApprovalIdx >= 0 && activeIdx >= preApprovalIdx;
  const showFol = folIdx >= 0 && activeIdx >= folIdx;

  /* WhatsApp "nudge about the thing you owe" link. It belongs beside the task it
   * refers to rather than in the header, because a header Nudge button could
   * only ever be about *some* task and the header cannot say which. */
  const overdueKey = blockers.find((b) => b.key.startsWith("task-"))?.key ?? null;
  const overdueTask = overdueKey ? caseTasks.find((t) => `task-${t.id}` === overdueKey) ?? null : null;
  const waNudge = overdueTask && c.whatsapp
    ? waClientLink(c.whatsapp, c.caseNumber, c.customer, me?.name ?? "")
    : null;

  /* One-click completion. The store writes optimistically, so this resolves on
   * click — the only await is the PATCH, and a failure rolls the row back and
   * says so rather than leaving a task that looks done and isn't. */
  const completeNow = async (t: Task) => {
    try {
      await completeTask(t.id, "");
      toast("success", `“${t.description}” marked done.`);
    } catch {
      toast("error", "Could not mark that done — try again.");
    }
  };

  const completeWithNote = async (t: Task, remarks: string) => {
    try {
      await completeTask(t.id, remarks);
      setDoneTarget(null);
      toast("success", `“${t.description}” marked done.`);
    } catch {
      toast("error", "Could not mark that done — try again.");
    }
  };

  return (
    <div className="space-y-3.5">
      {/* ONE header. It carries the identity, the contact actions, the single
          primary button (the top blocker) and the one-line answer to "what is
          owed". Nothing below it repeats any of that — which is the whole point,
          since the old screen said all of it twice. */}
      <CaseCommandBar
        c={c}
        status={status}
        blockers={blockers}
        onBack={() => nav({ name: "dashboard" })}
        onTab={setCaseTab}
        onAddTask={() => setShowAddTask(true)}
        onMoveStage={() => setShowStage(true)}
        onSetOutcome={() => setShowOutcome(true)}
        onDeleteCase={() => setDelCaseOpen(true)}
        onOpenDetails={() => setShowDetails(true)}
        canDelete={canDelete}
      />

      {/* Stage rail: one line, current stage is the button, prev/next are the
          affordances that used to require hunting for "Stage". */}
      <StageRail
        c={c}
        onOpen={setJourneyKey}
        onMove={() => setShowStage(true)}
        serviceLineName={line?.shortName || line?.name}
        journeyConfigured={isJourneyConfigured(line?.code, scopedStages.length)}
      />

      {/* The stage drawer hangs off the rail rather than off a tab body, so it is
          reachable from every workspace — it is about the STAGE, not the tab. */}
      {journeyKey && (
        <StageDrawer c={c} stageKey={journeyKey} onClose={() => setJourneyKey(null)} onTab={setCaseTab} />
      )}

      {/* Workspace switcher: four tabs + More. */}
      <CaseTabBar c={c} active={caseTab} onTab={setCaseTab} />

      <div className="space-y-4">
        {/* NOW — today's work. Tasks, instructions and the daily update are one
            workspace now; the Nudge link sits with the task it is about. */}
        {(caseTab === "now") && (<>
          {/* Nudge — deliberately attached to the overdue task, not to the
              header. A header-level "Nudge" could only ever mean "nudge about
              something"; this one names the thing. */}
          {overdueTask && waNudge && (
            <div className="card px-4 py-3 flex flex-wrap items-center gap-2 anim-fade-up"
              style={{ borderLeft: "3px solid var(--coral)" }}>
              <IWhatsapp size={15} />
              <span className="text-[12.5px] min-w-0 flex-1" style={{ color: "var(--ink-dim)" }}>
                <strong style={{ color: "var(--ink)" }}>{overdueTask.description}</strong>{" "}
                <span className="mono text-[11px]" style={{ color: "var(--coral)" }}>{fmtDue(overdueTask.dueDate)}</span>
              </span>
              <a className="btn btn-mint btn-sm" href={waNudge} target="_blank" rel="noreferrer"
                title={`Nudge ${c.customer} about ${overdueTask.description}`}>
                Nudge client
              </a>
            </div>
          )}

          <div className="card anim-fade-up anim-reveal">
      {/* Tasks card header — the opening block of the Now workspace. */}
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
                          /* ONE CLICK, not two.
                           *
                           * This used to open a modal, because completing a task
                           * took so long that asking "what happened?" felt like a
                           * reasonable thing to do while you waited. It wasn't:
                           * remarks are optional, the vast majority are empty,
                           * and the modal turned the most frequent action in the
                           * app into a two-step form.
                           *
                           * So the tick completes immediately (the store applies
                           * it optimistically, so the row moves on click) and the
                           * NOTE button next to it opens the same modal for the
                           * minority who want to record what happened. */
                          <>
                            <button
                              className="btn btn-mint btn-sm !px-2 !py-1"
                              title="Mark done"
                              aria-label={`Mark "${t.description}" done`}
                              onClick={() => completeNow(t)}
                            >
                              <ICheck size={12} />
                            </button>
                            <button
                              className="btn btn-ghost btn-sm !px-1.5 !py-1"
                              title="Mark done with a note"
                              aria-label={`Mark "${t.description}" done with a note`}
                              onClick={() => setDoneTarget(t)}
                            >
                              <IPencil size={11} />
                            </button>
                          </>
                        )}
                        {canTouch && (
                          <button className="btn btn-ghost btn-sm !px-2 !py-1" title="Delete task" aria-label={`Delete task "${t.description}"`} onClick={() => setDelTarget(t)}><ITrash size={12} /></button>
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

          {/* WHAT TO COLLECT lives inside Documents now, where it belongs: it was
              on the shared overview purely because the Documents tab was not the
              place you were already standing. Two copies of the same list on one
              screen is how people tick the wrong one. */}
          {(caseTab === "documents") && (
            <div className="space-y-4 anim-fade-up">
              <CollectPanel c={c} onOpenVault={() => undefined} />
              <DocVault c={c} />
            </div>
          )}

          {/* CLIENT — the person, all of it. Profile and the bank-application data
              sheet were two tabs describing one subject; the sheet only needed its
              own tab because it used to live in a collapsed rail. */}
          {(caseTab === "client") && (
            <div className="space-y-4 anim-fade-up">
              <ProfileStrip
                c={c}
                onEdit={(subTab) => {
                  setProfileSubTab(subTab);
                  document.getElementById("case-client-profile")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              />
              <div id="case-client-profile">
                <CaseProfileEditor c={c} initialTab={profileSubTab} />
              </div>

              {/* THE APPLICATION DATA SHEET. Its unsaved-draft guard still runs —
                  see setCaseTab — but the badge that shouts "16 needed" now lives
                  on the Client tab itself, where the sheet is, rather than on a
                  tab of its own that split the person in two. */}
              <PersonSheetCard
                c={c}
                clientId={c.clientId}
                role="Main applicant"
                onDirtyChange={(d) => { sheetDirtyRef.current = d; }}
              />
              {/* Phase B: the parties list replaces the single free-text
                  `coApplicantName` box, which could hold one name with no profile
                  behind it. Each person's own data sheet still renders below, one
                  per party — the bank assesses them separately. */}
              <CaseParties c={c} />
              {partiesOfCase(c.id).map((p) => (
                <PersonSheetCard
                  key={p.id}
                  c={c}
                  clientId={p.clientId}
                  role={PARTY_ROLE_LABEL[p.role]}
                />
              ))}
              {c.secondPartyClientId &&
                !partiesOfCase(c.id).some((p) => p.clientId === c.secondPartyClientId) && (
                  <PersonSheetCard c={c} clientId={c.secondPartyClientId} role="Co-applicant / Co-borrower" />
                )}
            </div>
          )}

          {/* MONEY — every number about the deal in one place: match, proposals,
              commission, the stage-conditional offer figures and bank tracking.
              The last two used to live in the inspector, which is precisely why
              bank tracking was "rarely edited" and never trusted. */}
          {(caseTab === "money") && (
            <div className="space-y-4 anim-fade-up">
              <BankMatchPanel c={c} />
              <ProposalHistory c={c} />
              <CommissionPanel c={c} />
              {showPreApproval && <PreApprovalPanel c={c} />}
              {showFol && <FolPanel c={c} />}
              <MisPanel c={c} />
            </div>
          )}

          {/* CHAT — read-mostly, so it lives behind More rather than taking a permanent
              tab slot next to "what I am doing right now". */}
          {(caseTab === "chat") && (
            <div className="card h-[600px] overflow-hidden anim-fade-up">
              <ChatPanel
                caseId={c.id}
                caseNumber={c.caseNumber}
                customerName={c.customer}
                userRole="STAFF"
              />
            </div>
          )}

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

      {/* DETAILS SHEET. Replaces the persistent 340px inspector rail: one button,
          one overlay, Escape to close. People / client file / copilot are the
          groups it holds; the money panels went to the Money tab instead, because
          they were only ever in the rail because there was nowhere else. */}
      {showDetails && (
        <CaseDetailsSheet
          c={c}
          onClose={() => setShowDetails(false)}
          people={<PeoplePanel c={c} />}
          clientFile={<ClientFileCard c={c} />}
          assistant={<CaseCopilot caseId={c.id} />}
        />
      )}

      {showAddTask && <AddTaskModal open={showAddTask} onClose={() => setShowAddTask(false)} caseId={c.id} />}
      {showStage && <StageUpdateModal open={showStage} onClose={() => setShowStage(false)} caseId={c.id} />}
      {showOutcome && <OutcomeModal open={showOutcome} onClose={() => setShowOutcome(false)} caseId={c.id} />}
      {doneTarget && (
        <DoneModal
          t={doneTarget}
          onClose={() => setDoneTarget(null)}
          onDone={(remarks) => completeWithNote(doneTarget, remarks)}
        />
      )}
      {delTarget && (
        <ConfirmModal open={!!delTarget} onClose={() => setDelTarget(null)} title="Delete task?" body={<>Permanently delete <strong>{delTarget.description}</strong>?</>} confirmLabel="Delete"
          onConfirm={async () => { await deleteTask(delTarget.id); toast("success", "Task deleted."); }} />
      )}
      {/* Unsaved-changes guard. Deliberately a hard block rather than a silent
          auto-save: the broker typed a partial value, and storing it as if it were
          complete is worse than asking. */}
      {pendingTab && (
        <ConfirmModal
          open
          onClose={() => setPendingTab(null)}
          title="Save before leaving the data sheet?"
          body={<>You have unsaved changes on the application data sheet. Leaving now will <strong>discard them</strong>.</>}
          confirmLabel="Discard and leave"
          onConfirm={() => {
            const t = pendingTab;
            setPendingTab(null);
            sheetDirtyRef.current = false;
            setCaseTabRaw(t);
          }}
        />
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

/* PersonSheetCard — binds PersonDataSheet to one person on a case, and owns the
 * "Request from client" action.
 *
 * The chase is a Task with waitingFor "Client" rather than a bespoke mechanism:
 * the portal already renders client tasks, so this adds no new concept.
 *
 * SELF-EMPLOYED FIELDS are hidden unless the person's employmentProfile says so,
 * which is why the shareholding-percentage question only appears for the people
 * it actually applies to.
 */

function PersonSheetCard({ c, clientId, role, onDirtyChange }: {
  c: LoanCase;
  clientId: number | null;
  role: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { clients, savePersonData, addTask, toast } = useHfmcStore();
  const client = clientId ? clients.find((cl) => cl.id === clientId) ?? null : null;

  // Seed from what we ALREADY know, so the sheet never presents as empty and
  // staff never "request from client" something the file already holds. The seed
  // is first-write-wins, so anything already answered survives it.
  //
  // Hooks run BEFORE the `if (!client)` early return below — a hook after an early
  // return is a rules-of-hooks violation, and this one was written that way first.
  const seeded = useMemo(
    () =>
      client
        ? seedPersonSheet(client.personData ?? {}, {
            fullName: client.fullName,
            eidNo: client.eidNo ?? undefined,
            passportNo: client.passportNo ?? undefined,
            dob: client.dob ?? undefined,
            nationality: client.nationality ?? undefined,
            phone: client.phone || undefined,
            email: client.email ?? undefined,
            employmentProfile: client.employmentProfile,
            companyName: client.companyName ?? undefined,
            monthlySalary: client.monthlySalary,
            variableIncome: client.variableIncome,
            rentalIncome: client.rentalIncome,
            existingEmis: client.existingEmis,
            creditCardLimits: client.creditCardLimits,
          })
        : {},
    [client],
  );

  if (!client) {
    return (
      <div className="card p-4 anim-fade-up">
        <div className="flex items-center gap-2">
          <span className="font-disp font-semibold text-[13px]">{role}</span>
          <Chip tone="slate">not linked to a client yet</Chip>
        </div>
        <p className="text-[11.5px] text-[var(--ink-faint)] m-0 mt-1.5">
          Link this person from the case profile and their data sheet appears here — and carries across to every
          other case they appear on.
        </p>
      </div>
    );
  }

  const selfEmployed = client.employmentProfile === "Self-Employed";

  const request = (missing: { path: string; label: string }[]) => {
    const summary = missing.map((f) => f.label).join(", ");
    void addTask(c.id, {
      description: `Please complete your application data sheet: ${summary}`,
      ownerId: c.ownerId,
      waitingFor: "Client",
      whyPending: "Client to complete",
      dueDate: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
    });
    toast("info", `Asked the client for ${missing.length} field${missing.length > 1 ? "s" : ""} — they can fill these in their portal.`);
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5 px-1">
        <span className="text-[11px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)]">{role}</span>
      </div>
      <PersonDataSheet
        data={seeded}
        selfEmployed={selfEmployed}
        secondParty={role !== "Main applicant"}
        onChange={(next) => savePersonData(client.id, next)}
        onRequest={request}
        onDirtyChange={onDirtyChange}
      />
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
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium truncate">{client.fullName}</div>
          {/* Contact links, not raw text — the whole point of this card is
              being able to reach the person from inside the file. Falls back
              to the client master's own fields when the case profile is thin. */}
          <div className="mt-0.5">
            <ContactLine contact={resolveContact(c, client)} size={11} />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        <Chip tone="slate">{client.residency}</Chip>
        <KycChip contact={resolveContact(c, client)} />
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
  const [busy, setBusy] = useState(false);
  const submit = () => {
    if (busy) return;
    setBusy(true);
    onDone(remarks);
  };
  return (
    <Modal title="Mark done with a note" sub={t.description} onClose={onClose} width={440}
      footer={
        <>
          {/* "Not yet" first and ghost: escaping should never be the thing your
              cursor lands on by muscle memory. */}
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-mint" onClick={submit} disabled={busy}>
            <ICheck size={15} /> {busy ? "Saving…" : "Mark done"}
          </button>
        </>
      }>
      <label className="label">What happened? (optional)</label>
      <textarea className="textarea" rows={3} placeholder="e.g. client paid the valuation fee" value={remarks}
        onChange={(e) => setRemarks(e.target.value)} autoFocus
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }} />
      <p className="text-[11px] m-0 mt-2" style={{ color: "var(--ink-faint)" }}>
        Skipping this is fine — the ✎ button on the task is only for when the detail is worth keeping.
      </p>
    </Modal>
  );
}
