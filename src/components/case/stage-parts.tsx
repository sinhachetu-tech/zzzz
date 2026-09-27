"use client";
import type { LoanCase } from "@/lib/types";
import { Chip } from "@/components/hfmc/ui";
import { ICheck } from "@/components/icons";
import { fmtDate, fmtMoney } from "@/lib/format";

export type CaseTab = "profile" | "daily" | "tasks" | "documents" | "banks" | "activity" | "chat";

export function StageHead({ title, owner, branch }: { title: string; owner: string; branch: string | null }) {
  return (
    <div>
      <p className="mono text-[10.5px] text-[var(--ink-faint)] m-0">STAGE · owner: {owner}</p>
      <h3 className="font-disp font-semibold text-[17px] m-0">{title}</h3>
      {branch && branch !== "undecided" && <Chip tone="sky">branch: {branch}</Chip>}
      {branch === "undecided" && (
        <p className="text-[12px] text-[var(--ink-dim)] m-0 mt-1">Set transaction type to pick the transfer path.</p>
      )}
    </div>
  );
}

export function StageNow({ c, latest, openN, bankN, mandDone, mandTotal, oldest, moves, sla, expiring }: {
  c: LoanCase; latest: { note: string; date: string } | null;
  openN: number; bankN: number; mandDone: number; mandTotal: number;
  oldest: { description: string; dueDate: string } | null;
  moves: Array<{ toStage: string; at: string; comment: string; userName: string }>;
  sla: { age: number; max: number | null; over: number | null };
  expiring: Array<{ title: string; date: string }>;
}) {
  return (
    <div className="card p-4">
      <h4 className="font-disp font-semibold text-[13px] m-0 mb-2">What&apos;s happening now</h4>
      {latest ? (
        <p className="text-[12.5px] m-0 leading-snug">“{latest.note}” <span className="mono text-[10.5px] text-[var(--ink-faint)]">· {fmtDate(latest.date)}</span></p>
      ) : (
        <p className="text-[12.5px] text-[var(--ink-faint)] m-0">No daily update yet — log the first one below.</p>
      )}
      <div className="flex flex-wrap gap-2 mt-2.5 text-[11.5px] text-[var(--ink-dim)]">
        <Chip tone={openN ? "amber" : "mint"}>{openN} open tasks</Chip>
        {bankN > 0 && <Chip tone="amber">{bankN} with bank</Chip>}
        <Chip tone={mandTotal - mandDone ? "coral" : "mint"}>{mandDone}/{mandTotal} mandatory docs</Chip>
        <Chip tone={sla.over != null && sla.over > 0 ? "coral" : "slate"}>day {sla.age}{sla.max != null ? `/${sla.max}` : ""}</Chip>
        <span>· {fmtMoney(c.loanAmount)} · {c.banks.join(", ") || "no bank"}</span>
      </div>
      {oldest && (
        <p className="text-[12px] m-0 mt-2" style={{ color: "var(--ink-dim)" }}>
          ⚡ Next: <strong>{oldest.description}</strong> <span className="mono text-[10.5px] text-[var(--ink-faint)]">· due {fmtDate(oldest.dueDate)}</span>
        </p>
      )}
      {moves.length > 0 && (
        <div className="mt-2.5 pt-2.5 space-y-1.5" style={{ borderTop: "1px dashed var(--line)" }}>
          {moves.map((m, i) => (
            <p key={i} className="mono text-[10.5px] text-[var(--ink-faint)] m-0">
              → {m.toStage} · {fmtDate(m.at)} · {m.userName}{m.comment ? ` · ${m.comment}` : ""}
            </p>
          ))}
        </div>
      )}
      {expiring.length > 0 && (
        <p className="text-[11.5px] m-0 mt-2" style={{ color: "var(--coral)" }}>
          ⚠ expiring: {expiring.map((e) => `${e.title} (${fmtDate(e.date)})`).join(" · ")}
        </p>
      )}
    </div>
  );
}

export function StageSteps({ steps, checks, folLock, heuristic }: {
  steps: Array<{ key: string; id: string; label: string; hint?: string }>;
  checks: Record<string, boolean>;
  folLock: boolean;
  heuristic: Set<string>;
}) {
  return (
    <div className="card p-4">
      <h4 className="font-disp font-semibold text-[13px] m-0 mb-2">What to do here</h4>
      <div className="space-y-2">
        {steps.map((s) => {
          const done = !!checks[s.key];
          const locked = s.id === "4.4" && folLock;
          const sniffed = heuristic.has(s.key);
          return (
            <div key={s.id} className="flex items-start gap-2.5 rounded-lg px-2.5 py-2" style={{ background: "var(--bg2)", border: "1px solid var(--line-soft)" }}>
              <span className="w-5 h-5 rounded-full grid place-items-center text-[11px] font-bold shrink-0 mt-0.5"
                style={done ? { background: "var(--mint)", color: "#fff" } : locked ? { background: "var(--coral)", color: "#fff" } : { background: "var(--line)", color: "var(--ink-faint)" }}>
                {done ? <ICheck size={11} /> : locked ? "!" : (s.id.split(".")[1] ?? "·")}
              </span>
              <div className="min-w-0">
                <p className="text-[12.5px] font-medium m-0">
                  {s.id} · {s.label}
                  {done && sniffed && <span className="mono text-[10.5px] text-[var(--ink-faint)]"> · ~detected</span>}
                </p>
                {s.hint && <p className="text-[11px] text-[var(--ink-faint)] m-0">{s.hint}</p>}
                {locked && <p className="text-[11px] m-0" style={{ color: "var(--coral)" }}>Locked — FOL conversion (4.1) + verification (4.2) first.</p>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mono text-[10.5px] text-[var(--ink-faint)] m-0 mt-2">
        ✓ from docs & fields · ~detected from daily notes — confirm before moving.
      </p>
    </div>
  );
}

export function StageSop({ sop, gate }: { sop: string[]; gate: string }) {
  return (
    <details className="card p-4">
      <summary className="font-disp font-semibold text-[13px] cursor-pointer">Procedure reference (SOP)</summary>
      <ul className="m-0 mt-2 pl-4 space-y-1">
        {sop.map((k) => (<li key={k} className="mono text-[11.5px] text-[var(--ink-dim)]">{k}</li>))}
      </ul>
      <p className="text-[11.5px] text-[var(--ink-faint)] m-0 mt-2">Exit gate: {gate}.</p>
    </details>
  );
}

export function StageShell({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(0,0,0,0.45)" }} onClick={onClose}>
      <div className="w-full sm:!w-[460px] h-full overflow-y-auto p-4 space-y-4" style={{ background: "var(--bg)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close ✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

