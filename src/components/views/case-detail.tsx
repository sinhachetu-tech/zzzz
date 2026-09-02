"use client";

import { useMemo, useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { Reply, Task } from "@/lib/types";
import {
  ageDays, caseStatusOf, fmtDate, fmtDateTime, fmtMoney, inDaysISO, primaryBank, relTime, todayISO,
} from "@/lib/format";
import { Avatar, Chip, DueChip, Modal, SectionLabel, StatusChip } from "@/components/hfmc/ui";
import { BankChips, CaseStateChip, CommissionPanel, ConfirmModal, SourceChip, WaButtons } from "@/components/hfmc/bits";
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
  const activeStages = [...stages].filter((s) => s.active).sort((a, b) => a.sortOrder - b.sortOrder);
  if (!open || !c) return null;
  const submit = async () => {
    await updateCase(caseId, { stage });
    toast("success", `Stage moved to ${stage}.`);
    onClose();
  };
  return (
    <Modal title="Move stage" sub={c.caseNumber} onClose={onClose} width={420}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={submit}>Move</button></>}>
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

/* ---------------- Case Detail ---------------- */

export default function CaseDetail({ id }: { id: number }) {
  const { cases, tasks, activities, stages, banks, users, instructions, me, nav, userById, caseById, updateCase, completeTask, deleteTask, toast, flags, canInstruct } = useHfmcStore();
  const c = caseById(id);
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
              <SourceChip source={c.source} />
              {c.partner && <Chip tone="amber">{c.partner.kind} · {c.partner.name} @ {c.partner.sharePct}%</Chip>}
            </div>
            <h1 className="font-disp font-bold text-[26px] tracking-tight m-0 mt-2">{c.customer}</h1>
            <p className="text-[12.5px] text-[var(--ink-faint)] m-0 mt-1">
              opened {fmtDate(c.createdAt)} · {ageDays(c.createdAt)}d old · stage <strong className="text-[var(--ink-dim)]">{c.stage}</strong>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <WaButtons c={c} agentName={me?.name ?? ""} />
            {c.caseStatus === "Active" && (
              <>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowStage(true)}><IArrowR size={14} /> Move stage</button>
                <button className="btn btn-primary btn-sm" onClick={() => setShowOutcome(true)}>Set outcome</button>
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
        {/* left: tasks + instructions + activity */}
        <div className="space-y-4">
          {/* tasks */}
          <div className="card anim-fade-up">
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
                      <div className="flex items-center gap-2 mt-1.5 text-[11.5px] text-[var(--ink-faint)]">
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
        </div>

        {/* right: commission + copilot + client */}
        <div className="space-y-4">
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
              {c.partner && (
                <div className="flex items-center gap-2.5">
                  <Avatar name={c.partner.name} size={28} />
                  <div>
                    <div className="text-[12.5px] font-medium">{c.partner.name}</div>
                    <div className="text-[11px] text-[var(--ink-faint)]">{c.partner.kind} · {c.partner.sharePct}% of our commission</div>
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
