import io

p = 'src/components/views/admin.tsx'
s = io.open(p, encoding='utf-8').read()

# 1) AI draft mapper: preserve variableAfter (it was dropped)
s = s.replace('''        floorPct: (q.floorPct ?? null) as number | null,
        ftvMax: (q.ftvMax ?? null) as number | null,''', '''        floorPct: (q.floorPct ?? null) as number | null,
        variableAfter: (q.variableAfter ?? undefined) as RateQuote["variableAfter"],
        ftvMax: (q.ftvMax ?? null) as number | null,''')

# 2) 4y tenure option
s = s.replace('''              <option value="3">3y fixed</option>
              <option value="5">5y fixed</option>''', '''              <option value="3">3y fixed</option>
              <option value="4">4y fixed</option>
              <option value="5">5y fixed</option>''')

# 3) after-fixed-term recipe inputs for FIXED quotes
s = s.replace('''            {q.rateType === "FIXED" ? (
              <input className="input mono !w-24 !py-1 text-[11.5px]" type="number" step={0.01} placeholder="rate %"
                value={q.ratePct ?? ""} onChange={(e) => update(i, { ratePct: e.target.value === "" ? null : Number(e.target.value) })} />
            ) : (
              <input className="input mono !w-24 !py-1 text-[11.5px]" type="number" step={0.001} placeholder="margin %"
                value={q.marginPct ?? ""} onChange={(e) => update(i, { marginPct: e.target.value === "" ? null : Number(e.target.value) })} />
            )}''', '''            {q.rateType === "FIXED" ? (
              <input className="input mono !w-24 !py-1 text-[11.5px]" type="number" step={0.01} placeholder="rate %"
                value={q.ratePct ?? ""} onChange={(e) => update(i, { ratePct: e.target.value === "" ? null : Number(e.target.value) })} />
            ) : (
              <input className="input mono !w-24 !py-1 text-[11.5px]" type="number" step={0.001} placeholder="margin %"
                value={q.marginPct ?? ""} onChange={(e) => update(i, { marginPct: e.target.value === "" ? null : Number(e.target.value) })} />
            )}
            {q.rateType === "FIXED" && (
              <>
                <select className="select !w-auto !py-1 text-[11.5px]"
                  value={q.variableAfter?.basis ?? ""}
                  title="What the rate becomes after the fixed term ends — almost every UAE product reverts to EIBOR + margin"
                  onChange={(e) => update(i, {
                    variableAfter: e.target.value
                      ? { basis: e.target.value as "1M" | "3M" | "6M" | "1Y", marginPct: 0, floorPct: null }
                      : undefined,
                  })}>
                  <option value="">no follow-on</option>
                  <option value="1M">then 1M EIBOR +</option>
                  <option value="3M">then 3M EIBOR +</option>
                  <option value="6M">then 6M EIBOR +</option>
                  <option value="1Y">then 1Y EIBOR +</option>
                </select>
                {q.variableAfter && (
                  <input className="input mono !w-24 !py-1 text-[11.5px]" type="number" step={0.001} placeholder="then margin %"
                    value={q.variableAfter.marginPct}
                    onChange={(e) => update(i, { variableAfter: { ...q.variableAfter!, marginPct: Number(e.target.value) || 0 } })} />
                )}
                {q.variableAfter && (
                  <input className="input mono !w-20 !py-1 text-[11.5px]" type="number" step={0.01} placeholder="then floor %"
                    value={q.variableAfter.floorPct ?? ""}
                    onChange={(e) => update(i, { variableAfter: { ...q.variableAfter!, floorPct: e.target.value === "" ? null : Number(e.target.value) } })} />
                )}
              </>
            )}''')

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print("ok")
