import io

p = 'src/components/views/calculator.tsx'
s = io.open(p, encoding='utf-8').read()

# 1) fix float garbage: round stress/follow-on computations
old1 = """    const sSpread = stressSpread.trim() === \"\" ? null : Number(stressSpread);
    const sFinal = stressFinal.trim() === \"\" ? null : Number(stressFinal);
    const stressOf = (base: number) => (sSpread != null ? base + sSpread : sFinal ?? base);"""
new1 = """    const sSpread = stressSpread.trim() === \"\" ? null : Number(stressSpread);
    const sFinal = stressFinal.trim() === \"\" ? null : Number(stressFinal);
    const r2 = (x: number) => Math.round(x * 10000) / 10000;
    const stressOf = (base: number) => r2(sSpread != null ? base + sSpread : sFinal ?? base);"""
assert old1 in s, "1"
s = s.replace(old1, new1)

old2 = """      const eib = eiborPct(foTenor) ?? 0;
      const rate = eib + foSpread;
      return { intro: rate, introYears: 0, followOn: rate, stress: stressOf(rate) };
    }
    const eib = eiborPct(foTenor) ?? 0;
    const followOn = useFoFinal ? foFinal : eib + foSpread;
    return { intro: introRate, introYears, followOn, stress: stressOf(followOn) };"""
new2 = """      const eib = eiborPct(foTenor) ?? 0;
      const rate = r2(eib + foSpread);
      return { intro: rate, introYears: 0, followOn: rate, stress: stressOf(rate) };
    }
    const eib = eiborPct(foTenor) ?? 0;
    const followOn = r2(useFoFinal ? foFinal : eib + foSpread);
    return { intro: introRate, introYears, followOn, stress: stressOf(followOn) };"""
assert old2 in s, "2"
s = s.replace(old2, new2)

# 2) fold the assessment cluster into the Advanced drawer
old3 = '''            <div className="flex flex-wrap items-end gap-x-6 gap-y-3 mt-3.5 pt-3.5" style={{ borderTop: "1px dashed var(--line)" }}>
              <div>
                <label className="label">Assessment rate % — drives MPBF</label>
                <input className="input mono" type="number" step={0.05} min={0} value={input.actualRate}
                  onChange={(e) => up({ actualRate: Number(e.target.value) || 0 })} />
              </div>
              <button type="button" className="btn btn-ghost btn-sm self-end" title="Optional: copy the scenario stress rate into the assessment rate"
                onClick={() => up({ actualRate: Math.round(scenario.stress * 100) / 100, stressOverride: null })}>
                Use stress ({scenario.stress.toFixed(2)}%)
              </button>
              <Stat label="Assessment in use" value={fmtPct(r.assessmentRate)} tone="var(--amber)" />
              <Stat label="Tenor used" value={tenorLabel(r.maxTenorMonths)} />
              <details className="no-print text-[12px]" style={{ minWidth: 260 }}>
                <summary className="cursor-pointer font-disp font-semibold text-[var(--ink-faint)]">Advanced — rarely needed</summary>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2.5">
                  <div>
                    <label className="label">Load factor</label>
                    <div className="flex gap-1.5 flex-wrap">
                      {[1.5, 2, 3, 4].map((l) => (
                        <button key={l} type="button" className="chip transition-all"
                          style={input.loadFactor === l && input.stressOverride == null ? { background: "var(--amber-tint)", borderColor: "var(--amber)", color: "var(--amber)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}
                          onClick={() => up({ loadFactor: l, stressOverride: null })}>
                          +{l}%
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="label">Manual stress rate — optional</label>
                    <input className="input mono" type="number" step={0.05} min={0} value={input.stressOverride ?? ""} placeholder={`auto: ${fmtPct(input.actualRate + input.loadFactor)}`}
                      onChange={(e) => up({ stressOverride: e.target.value === "" ? null : Number(e.target.value) || 0 })} />
                  </div>
                  <div>
                    <label className="label">Income multiplier cap</label>
                    <select className="select" value={input.multiplierX} onChange={(e) => up({ multiplierX: Number(e.target.value) })}>
                      <option value={0}>Off</option>
                      {[5, 6, 7, 8].map((x) => <option key={x} value={x}>{x}× annual</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Tenor override (mo)</label>
                    <input className="input mono" type="number" min={12} step={12} value={input.tenorOverrideMonths ?? ""} placeholder="auto (age)"
                      onChange={(e) => up({ tenorOverrideMonths: e.target.value === "" ? null : Number(e.target.value) || 0 })} />
                  </div>
                </div>
              </details>
            </div>
          </Section>'''
new3 = '''            <details className="mt-3.5 pt-3.5 text-[12px]" style={{ borderTop: "1px dashed var(--line)" }}>
              <summary className="cursor-pointer font-disp font-semibold text-[var(--ink-faint)]">
                Assessment rate (drives the MPBF) — currently {fmtPct(r.assessmentRate)} · tenor {tenorLabel(r.maxTenorMonths)}
              </summary>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2.5">
                <div>
                  <label className="label">Assessment rate %</label>
                  <input className="input mono" type="number" step={0.05} min={0} value={input.actualRate}
                    onChange={(e) => up({ actualRate: Number(e.target.value) || 0 })} />
                </div>
                <div className="flex items-end pb-1">
                  <button type="button" className="btn btn-ghost btn-sm" title="Copy the scenario stress rate into the assessment rate"
                    onClick={() => up({ actualRate: Math.round(scenario.stress * 100) / 100, stressOverride: null })}>
                    Use stress ({scenario.stress.toFixed(2)}%)
                  </button>
                </div>
                <div>
                  <label className="label">Load factor</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {[1.5, 2, 3, 4].map((l) => (
                      <button key={l} type="button" className="chip transition-all"
                        style={input.loadFactor === l && input.stressOverride == null ? { background: "var(--amber-tint)", borderColor: "var(--amber)", color: "var(--amber)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}
                        onClick={() => up({ loadFactor: l, stressOverride: null })}>
                        +{l}%
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="label">Manual stress rate — optional</label>
                  <input className="input mono" type="number" step={0.05} min={0} value={input.stressOverride ?? ""} placeholder={`auto: ${fmtPct(input.actualRate + input.loadFactor)}`}
                    onChange={(e) => up({ stressOverride: e.target.value === "" ? null : Number(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="label">Income multiplier cap</label>
                  <select className="select" value={input.multiplierX} onChange={(e) => up({ multiplierX: Number(e.target.value) })}>
                    <option value={0}>Off</option>
                    {[5, 6, 7, 8].map((x) => <option key={x} value={x}>{x}× annual</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Tenor override (mo)</label>
                  <input className="input mono" type="number" min={12} step={12} value={input.tenorOverrideMonths ?? ""} placeholder="auto (age)"
                    onChange={(e) => up({ tenorOverrideMonths: e.target.value === "" ? null : Number(e.target.value) || 0 })} />
                </div>
              </div>
            </details>
          </Section>'''
assert old3 in s, "3"
s = s.replace(old3, new3)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print("cluster folded, floats fixed")
