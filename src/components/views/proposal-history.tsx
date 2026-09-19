"use client";

/* Proposal history — saved Bank Match runs on this case, with lifecycle
   status (draft / sent / won / lost) the team leader can move.
   Draft = generated, not shared. Sent = with the client (date-stamped).
   Won/Lost = outcome — feeds Reports → Proposal pipeline. */

import { useHfmcStore } from "@/lib/client-store";
import type { LoanCase } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { Chip } from "@/components/hfmc/ui";

const STATUS_TONE: Record<string, "slate" | "sky" | "mint" | "coral"> = {
  draft: "slate", sent: "sky", won: "mint", lost: "coral",
};

const STATUS_MEANING: Record<string, string> = {
  draft: "numbers not shared yet",
  sent: "with the client — follow up",
  won: "client chose this proposal",
  lost: "client went elsewhere",
};

export function ProposalHistory({ c }: { c: LoanCase }) {
  const { caseProposals, setProposalStatus, toast } = useHfmcStore();
  const list = caseProposals.filter((x) => x.caseId === c.id).sort((a, b) => b.version - a.version);

  const move = (id: number, s: "draft" | "sent" | "won" | "lost") => {
    setProposalStatus(id, s);
    toast("success", `Proposal marked ${s.toUpperCase()} — ${STATUS_MEANING[s]}.`);
  };

  return (
    <div className="card anim-fade-up">
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
        <h3 className="font-disp font-semibold text-[14px] m-0">Proposal history</h3>
        {list.length > 0 && (
          <span className="mono text-[10.5px] px-1.5 py-0.5 rounded ml-1"
            style={{ background: "var(--amber-tint)", color: "var(--amber)" }}>
            {list.filter((v) => v.status === "sent").length} awaiting client
          </span>
        )}
        <span className="text-[11.5px] text-[var(--ink-faint)] ml-auto">{list.length} saved</span>
      </div>
      {list.length === 0 ? (
        <p className="px-4 py-4 text-[12.5px] text-[var(--ink-faint)] m-0">
          No saved proposals yet — run a Bank Match, then &quot;Generate proposal&quot; and &quot;Save to case&quot;.
        </p>
      ) : (
        <div className="p-4 space-y-2">
          {list.map((v) => (
            <div key={v.id} className="rounded-lg px-3 py-2 flex flex-wrap items-center gap-2" style={{ background: "var(--tint)" }}>
              <span className="mono text-[12px]" style={{ color: "var(--amber)" }}>v{v.version}</span>
              <Chip tone={STATUS_TONE[v.status] ?? "slate"}>{v.status}</Chip>
              <span className="text-[11.5px] text-[var(--ink-dim)]">
                {v.mode === "internal" ? "internal" : "client"} · {v.productIds.length} bank(s) · {fmtDate(v.createdAt)}
                {v.authorName ? ` · by ${v.authorName}` : ""}
              </span>
              {v.sentAt && v.status !== "draft" && (
                <span className="text-[10.5px] text-[var(--ink-faint)]">sent {fmtDate(v.sentAt)}</span>
              )}
              {v.decidedAt && (v.status === "won" || v.status === "lost") && (
                <span className="text-[10.5px] text-[var(--ink-faint)]">decided {fmtDate(v.decidedAt)}</span>
              )}
              <span className="ml-auto inline-flex gap-1.5">
                {(["draft", "sent", "won", "lost"] as const).map((s) => (
                  <button key={s} className="btn btn-ghost btn-sm !px-2 text-[10.5px]" title={STATUS_MEANING[s]}
                    style={v.status === s ? { color: "var(--amber)", fontWeight: 600 } : { color: "var(--ink-faint)" }}
                    onClick={() => move(v.id, s)} disabled={v.status === s}>
                    {s}
                  </button>
                ))}
              </span>
            </div>
          ))}
          <p className="text-[10.5px] text-[var(--ink-faint)] m-0">
            Draft = generated, numbers not shared yet · Sent = shared with the client (date-stamped, shows in the awaiting list) · Won/Lost = outcome, feeds Reports → Proposal pipeline. Old versions keep the numbers they were generated with.
          </p>
        </div>
      )}
    </div>
  );
}
