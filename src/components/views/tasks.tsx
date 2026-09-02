"use client";

import { useMemo, useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { RoleFlags } from "@/lib/domain";
import type { LoanCase, Task, Tone } from "@/lib/types";
import { fmtDateTime, relTime, todayISO } from "@/lib/format";
import { Avatar, Chip, DueChip, EmptyState, Modal, Seg } from "@/components/hfmc/ui";
import { ICheck, ISearch, ITasks } from "@/components/icons";

type Tab = "open" | "done" | "all";

/**
 * A task can be completed/edited by the current user when:
 *   - they are super/admin, OR
 *   - they own the task, OR
 *   - they created the task.
 * (`canEditTask` is intentionally computed locally — it is not on the store.)
 */
function canEditTask(t: Task, meId: number | undefined, flags: RoleFlags | null): boolean {
  if (!flags) return false;
  if (flags.super || flags.admin) return true;
  if (meId != null && (t.ownerId === meId || t.createdBy === meId)) return true;
  return false;
}

function waitingTone(waitingFor: string): Tone {
  if (waitingFor === "Client") return "sky";
  if (waitingFor === "Bank") return "amber";
  if (waitingFor === "Internal") return "slate";
  return "coral";
}

function DoneModal({ t, onClose }: { t: Task; onClose: () => void }) {
  const completeTask = useHfmcStore((s) => s.completeTask);
  const toast = useHfmcStore((s) => s.toast);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await completeTask(t.id, remarks);
      toast("success", `"${t.description}" marked done.`);
      onClose();
    } catch {
      toast("error", "Could not complete task. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Complete task"
      sub={t.description}
      onClose={onClose}
      width={440}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Not yet
          </button>
          <button className="btn btn-mint" onClick={submit} disabled={busy}>
            <ICheck size={15} /> Mark done
          </button>
        </>
      }
    >
      <label className="label">Remarks (optional)</label>
      <textarea
        className="textarea"
        rows={3}
        placeholder="What happened?"
        value={remarks}
        onChange={(e) => setRemarks(e.target.value)}
        autoFocus
      />
    </Modal>
  );
}

export default function Tasks() {
  const {
    cases, waitingFor, me, flags,
    visibleTasks, visibleCases, userById,
    nav,
  } = useHfmcStore();

  const [tab, setTab] = useState<Tab>("open");
  const [ownerF, setOwnerF] = useState("all");
  const [waitingF, setWaitingF] = useState("all");
  const [query, setQuery] = useState("");
  const [doneTarget, setDoneTarget] = useState<Task | null>(null);

  const all = useMemo(() => visibleTasks(), [visibleTasks]);

  // Lookup map for cases — prefer scoped cases, but fall back to the full
  // list so that tasks pointing at closed/deleted cases still resolve.
  const caseMap = useMemo(() => {
    const m = new Map<number, LoanCase>();
    for (const c of visibleCases()) m.set(c.id, c);
    for (const c of cases) if (!m.has(c.id)) m.set(c.id, c);
    return m;
  }, [visibleCases, cases]);

  const open = all.filter((t) => t.status === "Open");
  const done = all.filter((t) => t.status === "Done");

  const owners = useMemo(() => {
    const ids = Array.from(new Set(all.map((t) => t.ownerId)));
    return ids
      .map((id) => ({ id, name: userById(id)?.name ?? "Unassigned" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [all, userById]);

  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- userById/caseMap are stable enough; compiler can't infer store fns
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = all;
    if (tab === "open") list = list.filter((t) => t.status === "Open");
    if (tab === "done") list = list.filter((t) => t.status === "Done");
    if (ownerF !== "all") list = list.filter((t) => t.ownerId === Number(ownerF));
    if (waitingF !== "all") list = list.filter((t) => t.waitingFor === waitingF);
    if (q) {
      list = list.filter((t) => {
        const c = caseMap.get(t.caseId);
        const owner = userById(t.ownerId)?.name ?? "";
        return `${t.description} ${t.whyPending} ${c?.caseNumber ?? ""} ${c?.customer ?? ""} ${owner}`
          .toLowerCase()
          .includes(q);
      });
    }
    const today = todayISO();
    return [...list].sort((a, b) => {
      if (a.status !== b.status) return a.status === "Open" ? -1 : 1;
      if (a.status === "Open") {
        return a.dueDate.localeCompare(b.dueDate) || (a.dueDate < today ? -1 : 1);
      }
      return (b.completedAt ?? "").localeCompare(a.completedAt ?? "");
    });
  }, [all, tab, ownerF, waitingF, query, caseMap, userById]);

  const overdue = open.filter((t) => t.dueDate < todayISO()).length;
  const meId = me?.id;
  const canEdit = (t: Task) => canEditTask(t, meId, flags ?? null);

  return (
    <div className="space-y-4">
      {/* filter bar */}
      <div className="card p-4 anim-fade-up">
        <div className="flex flex-wrap items-center gap-3">
          <Seg<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "open", label: "Open", count: open.length },
              { value: "done", label: "Done", count: done.length },
              { value: "all", label: "All" },
            ]}
          />
          {overdue > 0 && tab !== "done" && (
            <Chip tone="coral" dot>
              {overdue} overdue
            </Chip>
          )}
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:ml-auto">
            <div className="relative w-full sm:w-auto flex-1 sm:flex-initial">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-faint)]">
                <ISearch size={14} />
              </span>
              <input
                className="input !pl-8 !py-[6.5px] w-full sm:w-[180px]"
                placeholder="Search tasks…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <select
              className="select !w-full sm:!w-auto !py-[6.5px] text-[12.5px]"
              value={ownerF}
              onChange={(e) => setOwnerF(e.target.value)}
            >
              <option value="all">All owners</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <select
              className="select !w-full sm:!w-auto !py-[6.5px] text-[12.5px]"
              value={waitingF}
              onChange={(e) => setWaitingF(e.target.value)}
            >
              <option value="all">Waiting on anyone</option>
              {waitingFor.map((w) => (
                <option key={w.id} value={w.label}>
                  {w.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* task table */}
      <div className="card anim-fade-up">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<ITasks size={20} />}
            title="Queue is clear"
            body="No tasks match these filters. Open a case to log the next action."
          />
        ) : (
          <div className="overflow-x-auto max-h-[calc(100vh-260px)] overflow-y-auto">
            <table className="tbl min-w-[860px]">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Case</th>
                  <th>Owner</th>
                  <th>Waiting for</th>
                  <th>Why pending</th>
                  <th>Due / done</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => {
                  const c = caseMap.get(t.caseId);
                  const owner = userById(t.ownerId);
                  const isOpen = t.status === "Open";
                  const od = isOpen && t.dueDate < todayISO();
                  return (
                    <tr
                      key={t.id}
                      className="rowlink"
                      style={{ opacity: isOpen ? 1 : 0.62 }}
                      onClick={() => nav({ name: "case", id: t.caseId })}
                    >
                      <td className="max-w-[260px]">
                        <p
                          className="font-medium m-0 leading-snug"
                          style={{
                            textDecoration: isOpen ? undefined : "line-through",
                            textDecorationColor: "var(--ink-faint)",
                          }}
                        >
                          {t.description}
                        </p>
                        <p className="text-[11px] text-[var(--ink-faint)] m-0 mt-0.5 truncate">
                          opened by{" "}
                          <span className="text-[var(--ink-dim)]">
                            {userById(t.createdBy)?.name.split(" ")[0] ?? "—"}
                          </span>{" "}
                          · {relTime(t.createdAt)}
                        </p>
                        {!isOpen && t.remarks && (
                          <p className="text-[11px] text-[var(--ink-faint)] m-0 mt-0.5 truncate">
                            “{t.remarks}”
                          </p>
                        )}
                      </td>
                      <td>
                        <span className="block">
                          <span
                            className="mono text-[12px] block transition-colors"
                            style={{ color: "var(--amber)" }}
                          >
                            {c?.caseNumber ?? "—"}
                          </span>
                          <span className="text-[11.5px] text-[var(--ink-faint)]">
                            {c?.customer ?? "deleted"} · {c?.stage ?? "—"}
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          <Avatar name={owner?.name ?? "?"} size={22} />
                          <span className="text-[12.5px]">
                            {owner?.name.split(" ")[0] ?? "—"}
                          </span>
                        </span>
                      </td>
                      <td>
                        <Chip tone={waitingTone(t.waitingFor)}>{t.waitingFor}</Chip>
                      </td>
                      <td className="text-[12.5px] text-[var(--ink-dim)] whitespace-nowrap">
                        {t.whyPending}
                      </td>
                      <td>
                        {isOpen ? (
                          <DueChip dueISO={t.dueDate} />
                        ) : (
                          <span className="mono text-[11.5px] text-[var(--ink-faint)] whitespace-nowrap">
                            {t.completedAt ? fmtDateTime(t.completedAt) : "—"}
                          </span>
                        )}
                      </td>
                      <td className="text-right" onClick={(e) => e.stopPropagation()}>
                        {isOpen && canEdit(t) ? (
                          <button
                            className="btn btn-mint sm:btn-sm"
                            onClick={() => setDoneTarget(t)}
                          >
                            <ICheck size={13} /> Done
                          </button>
                        ) : isOpen ? (
                          <span className="text-[11px] text-[var(--ink-faint)]">not yours</span>
                        ) : (
                          <span
                            className="text-[11px]"
                            style={{ color: od ? "var(--coral)" : "var(--mint)" }}
                          >
                            {od ? "was late" : "completed"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {doneTarget && <DoneModal t={doneTarget} onClose={() => setDoneTarget(null)} />}
    </div>
  );
}
