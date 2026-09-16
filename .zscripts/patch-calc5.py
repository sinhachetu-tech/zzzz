import io

p = 'src/components/views/calculator.tsx'
s = io.open(p, encoding='utf-8').read()

old = '''          <Section num="05" title="Rate & stress" hint="assessment rate drives the DBR MPBF">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="label">Actual / contract rate %</label>
                <input className="input mono" type="number" step={0.05} min={0} value={input.actualRate}
                  onChange={(e) => up({ actualRate: Number(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="label">Load factor</label>'''

new = '''          <Section num="05" title="Rate scenario — intro / follow-on / stress" hint="DBR 1·2·3 at each stage, or fetch from a bank product">
            {/* optional engine fetch */}
            <div className="flex flex-wrap items-end gap-2 mb-3 pb-3" style={{ borderBottom: "1px dashed var(--line)" }}>
              <div>
                <label className="label">Fetch from engine — optional</label>
                <select className="select" style={{ width: 150 }} value={fetchBank}
                  onChange={(e) => { setFetchBank(e.target.value); setFetchProduct(""); }}>
                  <option value="">— bank —</option>
                  {[...new Set(bankProducts.filter((b) => b.active).map((b) => b.bankName))].sort().map((bn) => <option key={bn}>{bn}</option>)}
                </select>
              </div>
              {fetchBank && (
                <div>
                  <label className="label">Product</label>
                  <select className="select" style={{ width: 240 }} value={fetchProduct}
                    onChange={(e) => {
                      setFetchProduct(e.target.value);
                      const prod = bankProducts.find((b) => String(b.id) === e.target.value);
                      if (!prod) return;
                      const pricing = parsePricing(prod.pricingJson);
                      const quote = resolveQuote(pricing, { stl: true, termYears: 3, ftv: 80, txn: "Resale" });
                      if (!quote) { toast("error", "That product has no rate quotes filed yet."); return; }
                      const sched = rateSchedule(quote, { ON: eiborPct("ON") ?? 0, "1M": eiborPct("1M") ?? 0, "3M": eiborPct("3M") ?? 0, "6M": eiborPct("6M") ?? 0, "1Y": eiborPct("1Y") ?? 0 }, prod.stressBufferPct ?? 0);
                      if (sched.introTermYears && sched.introTermYears > 0) {
                        setRateStyle("fixed"); setIntroRate(sched.introRatePct ?? 0); setIntroYears(sched.introTermYears);
                        const fo = sched.followOnRatePct ?? 0;
                        const basis = (quote.variableAfter?.basis ?? "3M") as "1M" | "3M" | "6M" | "1Y";
                        setFoTenor(basis); setUseFoFinal(true); setFoFinal(fo);
                        setUseStressFinal(true); setStressFinal(sched.stressRatePct ?? fo);
                      } else {
                        setRateStyle("variable"); setFoTenor((quote.rateType.replace("_EIBOR", "") || "3M") as "1M" | "3M" | "6M" | "1Y");
                        setFoSpread(quote.marginPct ?? 0); setUseStressFinal(true); setStressFinal(sched.stressRatePct ?? 0);
                      }
                      toast("success", prod.bankName + " rates loaded — edit freely, engine link is optional.");
                    }}>
                    <option value="">— product —</option>
                    {bankProducts.filter((b) => b.active && b.bankName === fetchBank).map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
                  </select>
                </div>
              )}
            </div>

            {/* fixed vs variable */}
            <div className="flex gap-1.5 mb-3">
              <button type="button" className="chip transition-all" style={rateStyle === "fixed" ? { background: "var(--amber-tint)", borderColor: "var(--amber)", color: "var(--amber)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}
                onClick={() => setRateStyle("fixed")}>Fixed intro</button>
              <button type="button" className="chip transition-all" style={rateStyle === "variable" ? { background: "var(--amber-tint)", borderColor: "var(--amber)", color: "var(--amber)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}
                onClick={() => setRateStyle("variable")}>Day-1 variable</button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              {rateStyle === "fixed" ? (
                <>
                  <div>
                    <label className="label">Intro / fixed rate %</label>
                    <input className="input mono" type="number" step={0.01} min={0} value={introRate || ""} onChange={(e) => setIntroRate(Number(e.target.value) || 0)} />
                  </div>
                  <div>
                    <label className="label">Fixed for</label>
                    <select className="select" value={introYears} onChange={(e) => setIntroYears(Number(e.target.value))}>
                      {[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>{y} year{y > 1 ? "s" : ""}</option>)}
                    </select>
                  </div>
                </>
              ) : <div className="sm:col-span-2 text-[11.5px] text-[var(--ink-faint)] self-end pb-2">Day-1 variable: intro = follow-on (EIBOR + spread below).</div>}
              <div>
                <label className="label">Follow-on {rateStyle === "fixed" ? "after fixed term" : ""}</label>
                <div className="flex gap-1">
                  <select className="select !w-auto" value={useFoFinal ? "final" : foTenor} onChange={(e) => { if (e.target.value === "final") setUseFoFinal(true); else { setUseFoFinal(false); setFoTenor(e.target.value as typeof foTenor); } }}>
                    <option value="1M">1M EIBOR +</option>
                    <option value="3M">3M EIBOR +</option>
                    <option value="6M">6M EIBOR +</option>
                    <option value="1Y">1Y EIBOR +</option>
                    <option value="final">final figure</option>
                  </select>
                  {useFoFinal
                    ? <input className="input mono !w-24" type="number" step={0.01} value={foFinal || ""} onChange={(e) => setFoFinal(Number(e.target.value) || 0)} placeholder="%" />
                    : <input className="input mono !w-20" type="number" step={0.005} value={foSpread || ""} onChange={(e) => setFoSpread(Number(e.target.value) || 0)} placeholder="spread" />}
                </div>
              </div>
              <div>
                <label className="label">Stress rate</label>
                <div className="flex gap-1">
                  <button type="button" className="chip transition-all" style={!useStressFinal ? { background: "var(--amber-tint)", borderColor: "var(--amber)", color: "var(--amber)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}
                    onClick={() => setUseStressFinal(false)}>spread +</button>
                  {useStressFinal
                    ? <input className="input mono !w-24" type="number" step={0.01} value={stressFinal || ""} onChange={(e) => setStressFinal(Number(e.target.value) || 0)} placeholder="final %" />
                    : <input className="input mono !w-20" type="number" step={0.05} value={stressSpread || ""} onChange={(e) => setStressSpread(Number(e.target.value) || 0)} placeholder="%" />}
                </div>
              </div>
            </div>

            {/* DBR 1/2/3 + push to assessment */}
            {(() => {
              const months = r.maxTenorMonths || 300;
              const emiFor = (rate: number) => rate > 0 ? Math.round((input.requested * (rate / 100 / 12)) / (1 - Math.pow(1 + rate / 100 / 12, -months))) || 0 : 0;
              const emi1 = emiFor(scenario.intro), emi2 = emiFor(scenario.followOn), emi3 = emiFor(scenario.stress);
              const obligations = r.existingEmis;
              const income = r.eligibleIncome || 0;
              const dbr = (e: number) => income > 0 ? Math.round(((e + obligations) / income) * 1000) / 10 : 0;
              return (
                <div className="grid grid-cols-3 gap-2.5 mt-3.5 pt-3.5" style={{ borderTop: "1px dashed var(--line)" }}>
                  <div className="rounded-lg px-3 py-2" style={{ background: "var(--bg2)", border: "1px solid var(--line)" }}>
                    <div className="text-[10px] font-disp font-semibold text-[var(--ink-faint)]">DBR 1 · intro {scenario.intro.toFixed(2)}%{scenario.introYears ? ` · ${scenario.introYears}y` : ""}</div>
                    <div className="mono text-[15px] font-bold mt-0.5">{dbr(emi1)}%</div>
                    <div className="text-[10.5px] text-[var(--ink-faint)] mono">EMI {fmtAED(emi1)}</div>
                  </div>
                  <div className="rounded-lg px-3 py-2" style={{ background: "var(--bg2)", border: "1px solid var(--line)" }}>
                    <div className="text-[10px] font-disp font-semibold text-[var(--ink-faint)]">DBR 2 · follow-on {scenario.followOn.toFixed(2)}%</div>
                    <div className="mono text-[15px] font-bold mt-0.5">{dbr(emi2)}%</div>
                    <div className="text-[10.5px] text-[var(--ink-faint)] mono">EMI {fmtAED(emi2)}</div>
                  </div>
                  <div className="rounded-lg px-3 py-2" style={{ background: "var(--amber-tint)", border: "1px solid var(--amber)" }}>
                    <div className="text-[10px] font-disp font-semibold" style={{ color: "var(--amber)" }}>DBR 3 · stress {scenario.stress.toFixed(2)}%</div>
                    <div className="mono text-[15px] font-bold mt-0.5" style={{ color: "var(--amber)" }}>{dbr(emi3)}%</div>
                    <div className="text-[10.5px] text-[var(--ink-faint)] mono">EMI {fmtAED(emi3)}</div>
                  </div>
                </div>
              );
            })()}

            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mt-3.5 pt-3.5" style={{ borderTop: "1px dashed var(--line)" }}>
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
                <label className="label">Load factor</label>'''

assert old in s, "anchor not found"
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print("rate section ok")
