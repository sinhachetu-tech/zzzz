import io

# 1) charts.tsx: Dial gains a proportional size prop
p = 'src/components/hfmc/charts.tsx'
s = io.open(p, encoding='utf-8').read()
s = s.replace('''export function Dial({ value, cap, display, label }: { value: number; cap: number; display: string; label: string }) {
  const on = useReveal(150);
  const frac = Math.max(0.02, Math.min(1, cap > 0 ? value / cap : 0));
  const r = 52;
  const C = Math.PI * r;
  const color = value > cap ? "var(--coral)" : value > cap * 0.8 ? "var(--amber)" : "var(--mint)";
  return (
    <div className="flex flex-col items-center" style={{ width: 220 }}>
      <div className="relative" style={{ width: 220, height: 118 }}>
        <svg width={220} height={118} viewBox="0 0 220 118" aria-hidden="true">
          <path d={`M 18 112 A ${r} ${r} 0 0 1 202 112`} fill="none" stroke="var(--track)" strokeWidth="12" strokeLinecap="round" />
          <path
            d={`M 18 112 A ${r} ${r} 0 0 1 202 112`} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
            strokeDasharray={`${on ? frac * C : 0.02 * C} ${C}`}
            style={{ transition: "stroke-dasharray 0.7s cubic-bezier(0.22,1,0.36,1), stroke 0.3s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-1 pointer-events-none">
          <span className="font-disp font-bold text-[26px] leading-none" style={{ color }}>{display}</span>
        </div>
      </div>
      <span className="text-[10.5px] uppercase tracking-[0.1em] text-[var(--ink-faint)] font-disp font-semibold">{label}</span>
    </div>
  );
}''', '''export function Dial({ value, cap, display, label, size = 220 }: { value: number; cap: number; display: string; label: string; size?: number }) {
  const on = useReveal(150);
  const frac = Math.max(0.02, Math.min(1, cap > 0 ? value / cap : 0));
  const k = size / 220;
  const r = 52 * k;
  const C = Math.PI * r;
  const color = value > cap ? "var(--coral)" : value > cap * 0.8 ? "var(--amber)" : "var(--mint)";
  const h = 118 * k;
  const inset = 18 * k;
  const sw = Math.max(6, 12 * k);
  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <div className="relative" style={{ width: size, height: h }}>
        <svg width={size} height={h} viewBox={`0 0 ${size} ${h}`} aria-hidden="true">
          <path d={`M ${inset} ${h - 6} A ${r} ${r} 0 0 1 ${size - inset} ${h - 6}`} fill="none" stroke="var(--track)" strokeWidth={sw} strokeLinecap="round" />
          <path
            d={`M ${inset} ${h - 6} A ${r} ${r} 0 0 1 ${size - inset} ${h - 6}`} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"
            strokeDasharray={`${on ? frac * C : 0.02 * C} ${C}`}
            style={{ transition: "stroke-dasharray 0.7s cubic-bezier(0.22,1,0.36,1), stroke 0.3s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-1 pointer-events-none">
          <span className="font-disp font-bold leading-none" style={{ color, fontSize: 26 * k }}>{display}</span>
        </div>
      </div>
      <span className="text-[10.5px] uppercase tracking-[0.1em] text-[var(--ink-faint)] font-disp font-semibold text-center">{label}</span>
    </div>
  );
}''')
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print("dial ok")

# 2) calculator: MpbfHeadline takes the scenario; three dials replace the single one
p = 'src/components/views/calculator.tsx'
s = io.open(p, encoding='utf-8').read()

s = s.replace('''          <MpbfHeadline r={r} input={input} />''', '''          <MpbfHeadline r={r} input={input} scenario={scenario} rateStyle={rateStyle} foTenor={foTenor} foSpread={foSpread} />''')

# find the MpbfHeadline signature and extend it
import re
m = re.search(r'function MpbfHeadline\(\{ r, input \}: \{ r: MortgageResult; input: MortgageInput \}\)', s)
if m:
    s = s.replace(m.group(0), 'function MpbfHeadline({ r, input, scenario, rateStyle, foTenor, foSpread }: { r: MortgageResult; input: MortgageInput; scenario: { intro: number; introYears: number; followOn: number; stress: number }; rateStyle: "fixed" | "variable"; foTenor: "1M" | "3M" | "6M" | "1Y"; foSpread: number })')

# replace the single dial with three stage dials
old = '''      <div className="flex justify-center">
        <Dial value={r.dbrAfter} cap={MAX_DBR} display={fmtPct(r.dbrAfter)} label="DBR after mortgage" />
      </div>'''
new = '''      {/* DBR 1·2·3 — the same EMI math as the scenario section, one dial per stage */}
      {(() => {
        const months = r.maxTenorMonths || 300;
        const emiFor = (rate: number) => rate > 0 ? Math.round((input.requested * (rate / 100 / 12)) / (1 - Math.pow(1 + rate / 100 / 12, -months))) || 0 : 0;
        const dbr = (e: number) => r.eligibleIncome > 0 ? Math.round(((e + r.existingEmis) / r.eligibleIncome) * 1000) / 10 : 0;
        const cap = r.maxDbr || 50;
        const stages: [string, number, string][] = rateStyle === "fixed"
          ? [["DBR 1 · intro", scenario.intro, `${scenario.introYears || 0}y`],
             ["DBR 2 · follow-on", scenario.followOn, `${foTenor}+${foSpread}%`],
             ["DBR 3 · stress", scenario.stress, "qualifies"]]
          : [["DBR 1 · day-1", scenario.intro, `${foTenor}+${foSpread}%`],
             ["DBR 2 · ongoing", scenario.followOn, "same basis"],
             ["DBR 3 · stress", scenario.stress, "qualifies"]];
        return (
          <div className="grid grid-cols-3 gap-1 justify-items-center mt-4 pt-3.5" style={{ borderTop: "1px dashed var(--line)" }}>
            {stages.map(([label, rate, note]) => {
              const emi = emiFor(rate);
              const val = dbr(emi);
              return (
                <div key={label} className="flex flex-col items-center">
                  <Dial value={val} cap={cap} display={`${val}%`} label={label} size={124} />
                  <span className="mono text-[10px] text-[var(--ink-faint)] -mt-0.5">{rate.toFixed(2)}% · {fmtAED(emi)}/mo · {note}</span>
                </div>
              );
            })}
          </div>
        );
      })()}'''
assert old in s, "single-dial anchor missing"
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print("three dials ok")
