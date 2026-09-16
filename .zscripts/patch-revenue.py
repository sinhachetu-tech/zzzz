import io

p = 'src/components/views/reports.tsx'
s = io.open(p, encoding='utf-8').read()

# insert the Projected revenue report after DailyMisReport
s = s.replace('''      <DailyMisReport visCases={visCases} userById={userById} toast={toast} />''',
'''      <DailyMisReport visCases={visCases} userById={userById} toast={toast} />

      {canRevenue && <ProjectedRevenue visCases={visCases} userById={userById} banks={banks} />}''')

# the component itself, before DailyMisReport definition
s = s.replace('''function DailyMisReport({ visCases, userById, toast }: {''', '''/* Projected revenue — per-bank scenarios without phantom totals.
   A client filing at 3 banks creates 3 cases; each case shows ITS bank's
   expected commission individually, but consolidation counts the engagement
   once: booked cases at actual, open engagements at best-case (max). */
function ProjectedRevenue({ visCases, userById, banks }: {
  visCases: LoanCase[]; userById: (id: number) => User | undefined; banks: BankItem[];
}) {
  const active = visCases.filter((c) => c.caseStatus === "Active");
  const booked = visCases.filter((c) => c.caseStatus === "Closed" && c.wonBank);

  // group open cases into engagements (client + amount + creation day)
  const groups = useMemo(() => {
    const map = new Map<string, LoanCase[]>();
    for (const c of active) {
      const key = (c.clientId ?? "c" + c.customer) + "|" + c.loanAmount + "|" + c.createdAt.slice(0, 10);
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return [...map.values()];
  }, [active]);

  const rows = useMemo(() => groups.map((g) => {
    const perBank = g.map((c) => ({ c, ...commissionFor(c, banks) }));
    const best = perBank.reduce((a, b) => (b.net > a.net ? b : a), perBank[0]);
    return {
      key: g[0].id,
      customer: g[0].customer,
      owner: userById(g[0].ownerId)?.name.split(" ")[0] ?? "—",
      amount: g[0].loanAmount,
      banks: perBank,
      best,
      split: g.length > 1,
    };
  }).sort((a, b) => b.best.net - a.best.net), [groups, banks, userById]);

  const bookedNet = booked.reduce((s, c) => s + commissionFor(c, banks).net, 0);
  const pipelineBest = rows.reduce((s, r) => s + r.best.net, 0);
  const phantom = rows.reduce((s, r) => s + r.banks.reduce((t, b) => t + b.net, 0) - r.best.net, 0);

  return (
    <div className="card anim-fade-up">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
        <h3 className="font-disp font-semibold text-[14px] m-0">Projected revenue — per bank, consolidated once</h3>
        <span className="text-[11.5px] text-[var(--ink-faint)]">
          each bank case shows its own expected commission · totals count every engagement only once
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3 p-4 pb-0">
        <div className="rounded-lg px-3 py-2.5" style={{ background: "var(--tint)" }}>
          <div className="text-[10px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)]">Booked (actual)</div>
          <div className="font-disp font-bold text-[20px] mono" style={{ color: "var(--mint)" }}>{fmtMoney(bookedNet)}</div>
          <div className="text-[10.5px] text-[var(--ink-faint)]">{booked.length} disbursed file{booked.length === 1 ? "" : "s"}</div>
        </div>
        <div className="rounded-lg px-3 py-2.5" style={{ background: "var(--amber-tint)" }}>
          <div className="text-[10px] uppercase tracking-[0.1em] font-disp font-semibold" style={{ color: "var(--amber)" }}>Pipeline (best case)</div>
          <div className="font-disp font-bold text-[20px] mono" style={{ color: "var(--amber)" }}>{fmtMoney(pipelineBest)}</div>
          <div className="text-[10.5px] text-[var(--ink-faint)]">{rows.length} open engagement{rows.length === 1 ? "" : "s"} — max per engagement</div>
        </div>
        <div className="rounded-lg px-3 py-2.5" style={{ background: "var(--tint)" }}>
          <div className="text-[10px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)]">Avoided double-count</div>
          <div className="font-disp font-bold text-[20px] mono">{fmtMoney(phantom)}</div>
          <div className="text-[10.5px] text-[var(--ink-faint)]">phantom revenue from multi-bank duplicates, excluded</div>
        </div>
      </div>
      <div className="overflow-x-auto p-4 pt-3">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-[var(--ink-faint)] text-left">
              <th className="py-1.5">Client</th><th>Owner</th><th>Amount</th><th>Bank scenarios (net of partner/channel)</th><th>Best case (counted once)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} style={{ borderTop: "1px dashed var(--line)" }}>
                <td className="py-2 font-medium">{r.customer}</td>
                <td className="text-[var(--ink-dim)]">{r.owner}</td>
                <td className="mono">{fmtMoney(r.amount)}</td>
                <td>
                  <div className="flex flex-wrap gap-1.5">
                    {r.banks.map((b) => (
                      <span key={b.c.id} className="chip !py-0.5 text-[10.5px] mono"
                        style={b.c.id === r.best.c.id ? { borderColor: "var(--amber)", color: "var(--amber)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}
                        title={b.c.banks.join(", ") + (b.c.bankRm ? " · RM " + b.c.bankRm : "")}>
                        {b.c.banks[0] ?? "TBC"} {fmtMoney(b.net)}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="mono font-semibold" style={{ color: "var(--amber)" }}>{fmtMoney(r.best.net)}{r.split ? <span className="text-[10px] text-[var(--ink-faint)] font-normal"> (of {r.banks.length} banks)</span> : null}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="py-3 text-[var(--ink-faint)]">No open cases — projected pipeline is empty.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DailyMisReport({ visCases, userById, toast }: {''')

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print("revenue report ok")
