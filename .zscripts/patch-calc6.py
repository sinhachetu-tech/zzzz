import io

p = 'src/components/views/calculator.tsx'
s = io.open(p, encoding='utf-8').read()

# ---------- 1) fetch: fall back across tenors and to day-1 variable ----------
old = '''                      const prod = bankProducts.find((b) => String(b.id) === e.target.value);
                      if (!prod) return;
                      const pricing = parsePricing(prod.pricingJson);
                      const quote = resolveQuote(pricing, { stl: true, termYears: 3, ftv: 80, txn: "Resale" });
                      if (!quote) { toast("error", "That product has no rate quotes filed yet."); return; }'''
new = '''                      const prod = bankProducts.find((b) => String(b.id) === e.target.value);
                      if (!prod) return;
                      const pricing = parsePricing(prod.pricingJson);
                      // try the requested 3y first, then other tenors, then day-1 variable
                      const quote = [3, 1, 5, 2, 4].map((t) => resolveQuote(pricing, { stl: true, termYears: t, ftv: prod.maxLtvExpatriate ?? 80, txn: "Resale" })).find(Boolean)
                        || resolveQuote(pricing, { stl: true, termYears: null, ftv: prod.maxLtvExpatriate ?? 80, txn: "Resale" });
                      if (!quote) { toast("error", "That product has no rate quotes filed yet."); return; }'''
assert old in s
s = s.replace(old, new)

# ---------- 2) auto-sync assessment = stress; advanced drawer for the rare knobs ----------
old2 = '''            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mt-3.5 pt-3.5" style={{ borderTop: "1px dashed var(--line)" }}>
              <div>
                <label className="label">Assessment rate % — drives MPBF</label>
                <input className="input mono" type="number" step={0.05} min={0} value={input.actualRate}
                  onChange={(e) => up({ actualRate: Number(e.target.value) || 0 })} />
              </div>
              <button type="button" className="btn btn-ghost btn-sm self-end" title="Copy the stress rate into the assessment rate"
                onClick={() => up({ actualRate: Math.round(scenario.stress * 100) / 100, stressOverride: null })}>
                Use stress ({scenario.stress.toFixed(2)}%) as assessment
              </button>
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
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mt-3.5 pt-3.5" style={{ borderTop: "1px dashed var(--line)" }}>
              <Stat label="Assessment rate" value={fmtPct(r.assessmentRate)} tone="var(--amber)" />
              <div>
                <label className="label">Income multiplier cap</label>
                <select className="select" style={{ width: 130 }} value={input.multiplierX} onChange={(e) => up({ multiplierX: Number(e.target.value) })}>
                  <option value={0}>Off</option>
                  {[5, 6, 7, 8].map((x) => <option key={x} value={x}>{x}× annual</option>)}
                </select>
              </div>
              <div>
                <label className="label">Tenor override (mo)</label>
                <input className="input mono" type="number" min={12} step={12} value={input.tenorOverrideMonths ?? ""} placeholder="auto (age)"
                  onChange={(e) => up({ tenorOverrideMonths: e.target.value === "" ? null : Number(e.target.value) || 0 })} />
              </div>
              <Stat label="Tenor used" value={tenorLabel(r.maxTenorMonths)} />
            </div>
          </Section>'''
new2 = '''            {/* assessment follows the stress rate automatically; rare overrides live in Advanced */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mt-3.5 pt-3.5" style={{ borderTop: "1px dashed var(--line)" }}>
              <Stat label="Assessment rate (auto = stress)" value={fmtPct(r.assessmentRate)} tone="var(--amber)" />
              <Stat label="Tenor used" value={tenorLabel(r.maxTenorMonths)} />
              <details className="no-print text-[12px]" style={{ minWidth: 260 }}>
                <summary className="cursor-pointer font-disp font-semibold text-[var(--ink-faint)]">Advanced — rarely needed</summary>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2.5">
                  <div>
                    <label className="label">Override assessment %</label>
                    <input className="input mono" type="number" step={0.05} min={0} value={manualAssessment ?? ""}
                      placeholder={`auto: ${fmtPct(scenario.stress)}`}
                      onChange={(e) => setManualAssessment(e.target.value === "" ? null : Number(e.target.value) || 0)} />
                  </div>
                  <div>
                    <label className="label">Fallback load factor <span className="normal-case tracking-normal text-[var(--ink-faint)]">(only when scenario above is empty)</span></label>
                    <div className="flex gap-1.5 flex-wrap">
                      {[1.5, 2, 3, 4].map((l) => (
                        <button key={l} type="button" className="chip transition-all"
                          style={input.loadFactor === l ? { background: "var(--amber-tint)", borderColor: "var(--amber)", color: "var(--amber)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}
                          onClick={() => up({ loadFactor: l, stressOverride: null })}>
                          +{l}%
                        </button>
                      ))}
                    </div>
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
assert old2 in s, "assessment cluster anchor missing"
s = s.replace(old2, new2)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print("part A ok")
