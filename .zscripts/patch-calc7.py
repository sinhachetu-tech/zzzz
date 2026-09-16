import io

p = 'src/components/views/calculator.tsx'
s = io.open(p, encoding='utf-8').read()

# Preview panel above the MPBF headline in the results column
old = '''        {/* ================= results column ================= */}
        <div className="space-y-4">
          <MpbfHeadline r={r} input={input} />'''
new = '''        {/* ================= results column ================= */}
        <div className="space-y-4">
          {/* proposal-style preview — the full working on one sheet, prints as-is */}
          <div className="card anim-fade-up" style={{ background: "var(--surface)" }}>
            <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5" style={{ borderBottom: "2px solid var(--amber)" }}>
              <div>
                <div className="font-disp font-bold text-[14px]">Eligibility working{input.name ? ` · ${input.name}` : ""}</div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">HFMC · indicative, not a bank approval</div>
              </div>
              <div className="text-right mono text-[11px] text-[var(--ink-faint)]">
                {dealEmirate} · {dealTxn}
                <div>{new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</div>
              </div>
            </div>
            <div className="px-4 py-3 space-y-2.5">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg px-2 py-1.5" style={{ background: "var(--tint)" }}>
                  <div className="text-[9px] uppercase tracking-[0.1em] text-[var(--ink-faint)] font-disp font-semibold">Property value</div>
                  <div className="mono text-[13px] font-semibold">{fmtAED(input.propertyValue)}</div>
                </div>
                <div className="rounded-lg px-2 py-1.5" style={{ background: "var(--amber-tint)" }}>
                  <div className="text-[9px] uppercase tracking-[0.1em] font-disp font-semibold" style={{ color: "var(--amber)"">Finance sought</div>
                  <div className="mono text-[13px] font-bold" style={{ color: "var(--amber)" }}>{fmtAED(input.requested)}</div>
                </div>
                <div className="rounded-lg px-2 py-1.5" style={{ background: "var(--tint)" }}>
                  <div className="text-[9px] uppercase tracking-[0.1em] text-[var(--ink-faint)] font-disp font-semibold">Eligible income</div>
                  <div className="mono text-[13px] font-semibold">{fmtAED(r.eligibleIncome)}/mo</div>
                </div>
              </div>

              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="text-[var(--ink-faint)] text-left">
                    <th className="py-1 font-disp text-[10px] uppercase tracking-[0.08em]">Stage</th>
                    <th>Rate</th><th>EMI</th><th>DBR</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const months = r.maxTenorMonths || 300;
                    const emiFor = (rate: number) => rate > 0 ? Math.round((input.requested * (rate / 100 / 12)) / (1 - Math.pow(1 + rate / 100 / 12, -months))) || 0 : 0;
                    const dbr = (e: number) => r.eligibleIncome > 0 ? Math.round(((e + r.existingEmis) / r.eligibleIncome) * 1000) / 10 : 0;
                    const rows: [string, number, string][] = rateStyle === "fixed"
                      ? [["1 · Intro (fixed)", scenario.intro, scenario.introYears ? `${scenario.introYears}y fixed` : "intro"],
                         ["2 · After intro", scenario.followOn, `${foTenor} EIBOR + ${foSpread}%`],
                         ["3 · Stress-qualified", scenario.stress, "qualifying rate"]]
                      : [["1 · Day-1 rate", scenario.intro, `${foTenor} EIBOR + ${foSpread}%`],
                         ["2 · Ongoing", scenario.followOn, "same basis"],
                         ["3 · Stress-qualified", scenario.stress, "qualifying rate"]];
                    return rows.map(([label, rate, note], i) => (
                      <tr key={label} style={{ borderTop: "1px dashed var(--line)" }}>
                        <td className="py-1.5">{label}<span className="text-[10px] text-[var(--ink-faint)]"> · {note}</span></td>
                        <td className="mono text-center">{rate.toFixed(2)}%</td>
                        <td className="mono text-center">{fmtAED(emiFor(rate))}</td>
                        <td className="mono text-center font-semibold" style={{ color: i === 2 ? "var(--amber)" : undefined }}>{dbr(emiFor(rate))}%</td>
                      </tr>
                    ));
                  })()}
                  <tr style={{ borderTop: "1px dashed var(--line)" }}>
                    <td className="py-1.5 text-[var(--ink-dim)]">Existing obligations</td>
                    <td /><td className="mono text-center">{fmtAED(r.existingEmis)}</td>
                    <td className="mono text-center">{r.currentDbr}%</td>
                  </tr>
                </tbody>
              </table>

              <div className="flex flex-wrap gap-x-5 gap-y-1 pt-2 mono text-[11.5px]" style={{ borderTop: "1px solid var(--line)" }}>
                <span>Assessment: <strong style={{ color: "var(--amber)" }}>{fmtPct(r.assessmentRate)}</strong></span>
                <span>Tenor: <strong>{tenorLabel(r.maxTenorMonths)}</strong></span>
                <span>DBR ceiling: <strong>{r.maxDbr}%</strong></span>
                <span>Available EMI: <strong>{fmtAED(r.availableEmi)}</strong></span>
                <span>MPBF: <strong style={{ color: "var(--mint)" }}>{fmtAED(r.mpbf ?? 0)}</strong></span>
              </div>
            </div>
          </div>

          <MpbfHeadline r={r} input={input} />'''
assert old in s
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print("preview ok")
