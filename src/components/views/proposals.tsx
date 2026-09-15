"use client";

/* Proposals — the follow-up pipeline across all cases. Every saved proposal
   (draft / sent / won / lost) with its case, amount and age. Won/lost here is
   how the bank win-rate gets measured. CSV export for the boss's Excel. */

import { useMemo, useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import { fmtMoney, relTime } from "@/lib/format";
import { Chip, EmptyState } from "@/components/hfmc/ui";
import { IChart, IGrid } from "@/components/icons";

const STATUS: ("draft" | "sent" | "won" | "lost")[] = ["draft", "sent", "won", "lost"];

export default function Proposals() {
  const { caseProposals, cases, nav, setProposalStatus, toast } = useHfmcStore();
  const [tab, setTab] = useState<(typeof STATUS)[number] | "all">("all");

  const rows = useMemo(() => {
    return caseProposals
      .map((p) => {
        const c = cases.find((x) => x.id === p.caseId);
        return { ...p, caseNumber: c?.caseNumber ?? "—", customer: c?.customer ?? "—", loanAmount: c?.loanAmount ?? 0 };
      })
      .filter((p) => (tab === "all" ? true : p.status === tab))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [caseProposals, cases, tab]);

  const counts = Object.fromEntries(STATUS.map((st) => [st, caseProposals.filter((p) => p.status === st).length])) as Record<string, number>;
  const wonValue = caseProposals.filter((p) => p.status === "won").reduce((s, p) => s + (cases.find((c) => c.id === p.caseId)?.loanAmount ?? 0), 0);

  const exportCsv = () => {
    const header = ["Case", "Customer", "Loan amount (AED)", "Banks in proposal", "Status", "Version", "Created", "Sent at"];
    const lines = rows.map((r) => {
      const bankNames = (r.inputs as { results?: { bankName?: string }[] })?.results?.map((x) => x.bankName).filter(Boolean).join(" | ")
        || (r.productIds.length ? `product ids ${r.productIds.join(",")}` : "");
      return [r.caseNumber, r.customer, r.loanAmount, bankNames, r.status, `v${r.version}`, r.createdAt.slice(0, 10), r.sentAt?.slice(0, 10) ?? ""]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
    });
    const csv = "\uFEFF" + [header.join(","), ...lines].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `hfmc-proposals-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast("success", `Exported ${rows.length} proposals to CSV.`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-disp font-bold text-[24px] tracking-tight m-0">
            Proposals · <span style={{ color: "var(--amber)" }}>{caseProposals.length} total</span>
          </h1>
          <p className="text-[13px] text-[var(--ink-dim)] mt-0.5 mb-0">
            The follow-up pipeline — every saved bank comparison. Sent proposals awaiting a decision are your hot list.
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={exportCsv} disabled={rows.length === 0}>
          <IChart size={14} /> Export Excel (CSV)
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["all", ...STATUS] as const).map((st) => (
          <button key={st} className="chip transition-all" style={tab === st ? { background: "rgba(242,176,76,0.15)", borderColor: "var(--amber)", color: "var(--amber)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}
            onClick={() => setTab(st)}>
            {st === "all" ? `All ${caseProposals.length}` : `${st[0].toUpperCase() + st.slice(1)} ${counts[st] ?? 0}`}
          </button>
        ))}
        {wonValue > 0 && <span className="chip" style={{ background: "rgba(67,214,155,0.12)", borderColor: "var(--mint)", color: "var(--mint)" }}>Won value {fmtMoney(wonValue)}</span>}
      </div>

      {rows.length === 0 ? (
        <div className="card p-10">
          <EmptyState icon={<IGrid size={24} />} title="No proposals here yet" body="Run a Bank Match inside a case, then 'Generate proposal' and 'Save to case' — saved proposals land in this pipeline." />
        </div>
      ) : (
        <div className="card anim-fade-up overflow-x-auto">
          <table className="tbl min-w-[860px]">
            <thead>
              <tr>
                <th>Case</th><th>Customer</th><th>Amount</th><th>Banks</th><th>Status</th><th>Version</th><th>Created</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} onClick={() => nav({ name: "case", id: p.caseId })}>
                  <td className="mono text-[12.5px]" style={{ color: "var(--amber)" }}>{p.caseNumber}</td>
                  <td className="font-medium">{p.customer}</td>
                  <td className="mono">{fmtMoney(p.loanAmount)}</td>
                  <td className="text-[11.5px] text-[var(--ink-dim)]" style={{ maxWidth: 260 }}>
                    {(p.inputs as { results?: { bankName?: string }[] })?.results?.map((x) => x.bankName).filter(Boolean).join(", ") || `${p.productIds.length} products`}
                  </td>
                  <td>
                    <select className="select !w-auto !py-1 text-[11.5px]" value={p.status}
                      onClick={(e) => e.stopPropagation()}
                      onChange={async (e) => { await setProposalStatus(p.id, e.target.value); toast("success", `Proposal marked ${e.target.value}.`); }}>
                      {STATUS.map((st) => <option key={st} value={st}>{st}</option>)}
                    </select>
                  </td>
                  <td className="mono text-[11.5px]">v{p.version}</td>
                  <td className="mono text-[11.5px] text-[var(--ink-faint)]">{p.createdAt.slice(0, 10)} · {relTime(p.createdAt)}</td>
                  <td><Chip tone={p.status === "won" ? "mint" : p.status === "lost" ? "coral" : p.status === "sent" ? "amber" : "slate"}>{p.status}</Chip></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
