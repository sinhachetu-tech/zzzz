"use client";

/* Daily MIS tab — the SPO's daily workspace. Captures today's progress note
   and hold state as a dated log entry (only when there's something to record),
   and shows the case's update history. The latest entry feeds the client
   portal and the team leader's consolidated MIS report. */

import { useMemo, useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { LoanCase } from "@/lib/types";
import { fmtDate, todayISO } from "@/lib/format";
import { Chip } from "@/components/hfmc/ui";
import { ICheck } from "@/components/icons";

export function DailyMisTab({ c }: { c: LoanCase }) {
  const { caseUpdates, userById, addCaseUpdate } = useHfmcStore();
  const today = todayISO();
  const log = useMemo(
    () => caseUpdates.filter((u) => u.caseId === c.id).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id),
    [caseUpdates, c.id],
  );
  const todays = log.find((u) => u.date === today);

  const [note, setNote] = useState("");
  const [onHold, setOnHold] = useState(c.onHold);
  const [holdReason, setHoldReason] = useState(c.holdReason ?? "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!note.trim()) return;
    setBusy(true);
    await addCaseUpdate(c.id, note.trim(), onHold, holdReason);
    setNote("");
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      {/* composer */}
      <div className="card anim-fade-up" style={{ borderLeft: "3px solid var(--amber)" }}>
        <div className="flex flex-wrap items-center gap-2 mb-2.5">
          <h3 className="font-disp font-semibold text-[14px] m-0">Today&apos;s update · {fmtDate(today)}</h3>
          {todays ? (
            <Chip tone="mint"><ICheck size={11} /> recorded today</Chip>
          ) : (
            <Chip tone="amber">not recorded yet</Chip>
          )}
        </div>
        <textarea
          className="textarea"
          rows={3}
          placeholder={todays ? `Already recorded: “${todays.note}” — add another entry if there's more.` : "What's happening today — progress, blockers, next step. Only write it when there's an update."}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2 mt-2.5">
          <button type="button" className="chip transition-all"
            style={onHold
              ? { background: "rgba(242,176,76,0.14)", borderColor: "var(--amber)", color: "var(--amber)" }
              : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}
            onClick={() => setOnHold(!onHold)}>
            {onHold ? "ON HOLD" : "Active"}
          </button>
          {onHold && (
            <input className="input !w-auto flex-1" style={{ minWidth: 180 }} placeholder="Hold reason (e.g. waiting on valuation)"
              value={holdReason} onChange={(e) => setHoldReason(e.target.value)} />
          )}
          <button className="btn btn-primary btn-sm ml-auto" onClick={save} disabled={busy || !note.trim()}>
            <ICheck size={14} /> {busy ? "Saving…" : "Save daily update"}
          </button>
        </div>
      </div>

      {/* log */}
      <div className="card anim-fade-up">
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
          <h3 className="font-disp font-semibold text-[13.5px] m-0">Update log · {log.length}</h3>
        </div>
        <div className="p-4 space-y-3 max-h-[420px] overflow-y-auto">
          {log.length === 0 && (
            <p className="text-[12.5px] text-[var(--ink-faint)] m-0">No updates recorded yet — the first daily note starts the register.</p>
          )}
          {log.map((u) => (
            <div key={u.id} className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: u.onHold ? "var(--coral)" : "var(--mint)" }} />
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] m-0 leading-snug whitespace-pre-wrap">{u.note}</p>
                <p className="mono text-[10.5px] text-[var(--ink-faint)] m-0 mt-0.5">
                  {fmtDate(u.date)} · {u.authorName ?? userById(u.authorId)?.name ?? "—"}
                  {u.onHold && <span style={{ color: "var(--coral)" }}> · ON HOLD{u.holdReason ? `: ${u.holdReason}` : ""}</span>}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
