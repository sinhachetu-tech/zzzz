import io

p = 'src/components/views/calculator.tsx'
s = io.open(p, encoding='utf-8').read()

# 1) state: keep the fetched product's quotes so tenure switches re-resolve
s = s.replace('''  // null = assessment rate auto-follows the scenario's stress rate
  const [manualAssessment, setManualAssessment] = useState<number | null>(null);''','''  // null = assessment rate auto-follows the scenario's stress rate
  const [manualAssessment, setManualAssessment] = useState<number | null>(null);
  // quotes of the last fetched product — tenure switches re-resolve from these
  const [fetched, setFetched] = useState<{ bankName: string; quotes: ReturnType<typeof parsePricing>["quotes"] } | null>(null);''')

# 2) bank change clears fetched + rates (no stale figures from another bank)
s = s.replace('''                <select className="select" style={{ width: 150 }} value={fetchBank}
                  onChange={(e) => { setFetchBank(e.target.value); setFetchProduct(""); }}>''','''                <select className="select" style={{ width: 150 }} value={fetchBank}
                  onChange={(e) => { setFetchBank(e.target.value); setFetchProduct(""); setFetched(null); setIntroRate(0); }}>''')

# 3) product change: store ALL quotes; apply best; keep for later tenure switches
s = s.replace('''                      setFetchProduct(e.target.value);
                      const prod = bankProducts.find((b) => String(b.id) === e.target.value);
                      if (!prod) return;
                      const pricing = parsePricing(prod.pricingJson);
                      // try the requested 3y first, then other tenors, then day-1 variable
                      const quote = [3, 1, 5, 2, 4].map((t) => resolveQuote(pricing, { stl: true, termYears: t, ftv: prod.maxLtvExpatriate ?? 80, txn: "Resale" })).find(Boolean)
                        || resolveQuote(pricing, { stl: true, termYears: null, ftv: prod.maxLtvExpatriate ?? 80, txn: "Resale" });
                      if (!quote) { toast("error", "That product has no rate quotes filed yet."); return; }''','''                      setFetchProduct(e.target.value);
                      const prod = bankProducts.find((b) => String(b.id) === e.target.value);
                      if (!prod) return;
                      const pricing = parsePricing(prod.pricingJson);
                      // try the requested 3y first, then other tenors, then day-1 variable
                      const quote = [3, 1, 5, 2, 4].map((t) => resolveQuote(pricing, { stl: true, termYears: t, ftv: prod.maxLtvExpatriate ?? 80, txn: "Resale" })).find(Boolean)
                        || resolveQuote(pricing, { stl: true, termYears: null, ftv: prod.maxLtvExpatriate ?? 80, txn: "Resale" });
                      if (!quote) { toast("error", "That product has no rate quotes filed yet."); setFetched(null); setIntroRate(0); return; }
                      setFetched({ bankName: prod.bankName, quotes: pricing.quotes });''')

# 4) tenure change: re-resolve intro rate from the fetched quotes, blank if that tenor is not filed
s = s.replace('''                  <div>
                    <label className="label">Fixed for</label>
                    <select className="select" value={introYears} onChange={(e) => setIntroYears(Number(e.target.value))}>
                      {[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>{y} year{y > 1 ? "s" : ""}</option>)}
                    </select>
                  </div>''','''                  <div>
                    <label className="label">Fixed for</label>
                    <select className="select" value={introYears}
                      onChange={(e) => {
                        const y = Number(e.target.value);
                        setIntroYears(y);
                        // re-resolve from the fetched card: that tenor's rate, or blank when not filed
                        if (fetched) {
                          const hit = fetched.quotes.find((qq) => qq.termYears === y && (qq.stl == null || qq.stl) && qq.rateType === "FIXED");
                          setIntroRate(hit?.ratePct ?? 0);
                          if (!hit) toast("info", fetched.bankName + " has no " + y + "-year rate filed — enter it manually.");
                        }
                      }}>
                      {[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>{y} year{y > 1 ? "s" : ""}</option>)}
                    </select>
                  </div>''')

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print("fetch refresh ok")
