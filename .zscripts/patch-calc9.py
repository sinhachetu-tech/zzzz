import io

p = 'src/components/views/calculator.tsx'
s = io.open(p, encoding='utf-8').read()

# ---------- helper: robust quote resolution + apply, in component scope ----------
anchor = '''  const eiborPct = (t: string) => eibor.find((e) => e.tenor === t)?.ratePct ?? null;'''
helper = '''  const eiborPct = (t: string) => eibor.find((e) => e.tenor === t)?.ratePct ?? null;

  // resolve a product's live quote against the CURRENT deal shape, with a
  // relaxation cascade so any filed quote can be found (exact -> any txn ->
  // either STL -> day-1 variable). No more "only DIB fetches".
  const applyProduct = (prod: (typeof bankProducts)[number]) => {
    const pricing = parsePricing(prod.pricingJson) ?? { quotes: [] };
    const today = new Date().toISOString().slice(0, 10);
    const ftv = prod.maxLtvExpatriate ?? 80;
    const txnMap: Record<string, string | null> = {
      "Resale": "Resale", "Primary Handover": "Primary Handover", "Buyout": "Buyout",
      "Buyout + Equity Release": "Buyout + Equity Release", "Equity Release": "Equity Release",
    };
    const txn = txnMap[dealTxn] ?? null;
    const attempts: Parameters<typeof resolveQuote>[1][] = [];
    for (const t of [3, 1, 5, 2, 4]) {
      attempts.push({ stl: input.stl, termYears: t, ftv, txn, on: today });
      attempts.push({ stl: input.stl, termYears: t, ftv, txn: null, on: today });
    }
    attempts.push({ stl: input.stl, termYears: null, ftv, txn, on: today });
    attempts.push({ stl: input.stl, termYears: null, ftv, txn: null, on: today });
    attempts.push({ stl: null, termYears: null, ftv, txn: null, on: today });
    const quote = attempts.map((a) => resolveQuote(pricing, a)).find(Boolean);
    if (!quote) {
      toast("error", "That product has no rate quotes filed yet.");
      setFetched(null); setIntroRate(0); setFoSpread(0); setFoFinal(0);
      setStressSpread(""); setStressFinal("");
      return false;
    }
    setFetched({ bankName: prod.bankName, quotes: pricing.quotes });
    const sched = rateSchedule(quote, { ON: eiborPct("ON") ?? 0, "1M": eiborPct("1M") ?? 0, "3M": eiborPct("3M") ?? 0, "6M": eiborPct("6M") ?? 0, "1Y": eiborPct("1Y") ?? 0 }, prod.stressBufferPct ?? 0);
    if (sched.introTermYears && sched.introTermYears > 0) {
      setRateStyle("fixed"); setIntroRate(sched.introRatePct ?? 0); setIntroYears(sched.introTermYears);
      const fo = sched.followOnRatePct ?? 0;
      const basis = (quote.variableAfter?.basis ?? "3M") as "1M" | "3M" | "6M" | "1Y";
      setFoTenor(basis); setUseFoFinal(true); setFoFinal(fo);
      setStressSpread(""); setStressFinal(String(sched.stressRatePct ?? fo));
    } else {
      setRateStyle("variable"); setFoTenor((quote.rateType.replace("_EIBOR", "") || "3M") as "1M" | "3M" | "6M" | "1Y");
      setFoSpread(quote.marginPct ?? 0); setUseFoFinal(false); setFoFinal(0);
      setStressSpread(""); setStressFinal(String(sched.stressRatePct ?? 0));
    }
    return true;
  };'''
assert anchor in s
s = s.replace(anchor, helper, 1)

# ---------- bank select: clearing clears ALL figures; picking a bank auto-selects its product ----------
old_bank = '''                <select className="select" style={{ width: 150 }} value={fetchBank}
                  onChange={(e) => { setFetchBank(e.target.value); setFetchProduct(""); setFetched(null); setIntroRate(0); }}>'''
new_bank = '''                <select className="select" style={{ width: 150 }} value={fetchBank}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFetchBank(v); setFetchProduct(""); setFetched(null);
                    setIntroRate(0); setFoSpread(0); setFoFinal(0);
                    setStressSpread(""); setStressFinal("");
                    if (!v) return; // bank cleared -> every fetched figure cleared with it
                    const first = currentProducts.find((b) => b.bankName === v);
                    if (first) { setFetchProduct(String(first.id)); applyProduct(first); } // auto-select the product
                  }}>'''
assert old_bank in s
s = s.replace(old_bank, new_bank)

# ---------- product select: delegate to applyProduct ----------
import re
m = re.search(r'onChange=\{\(e\) => \{\n\s*setFetchProduct\(e\.target\.value\);\n\s*const prod = bankProducts\.find\(\(b\) => String\(b\.id\) === e\.target\.value\);\n\s*if \(!prod\) return;.*?toast\("success", prod\.bankName \+ " rates loaded — edit freely, engine link is optional\."\);\n\s*\}\}>', s, re.S)
assert m, "product onChange block not found"
new_prod = '''onChange={(e) => {
                      setFetchProduct(e.target.value);
                      const prod = bankProducts.find((b) => String(b.id) === e.target.value);
                      if (!prod) return;
                      if (applyProduct(prod)) toast("success", prod.bankName + " rates loaded — edit freely, engine link is optional.");
                    }}>'''
s = s[:m.start()] + new_prod + s[m.end():]

# ---------- tenure switch: also re-resolve via the same cascade (uses fetched quotes) ----------
old_tenor = '''                        if (fetched) {
                          const hit = fetched.quotes.find((qq) => qq.termYears === y && (qq.stl == null || qq.stl) && qq.rateType === "FIXED");
                          setIntroRate(hit?.ratePct ?? 0);
                          if (!hit) toast("info", fetched.bankName + " has no " + y + "-year rate filed — enter it manually.");
                        }'''
new_tenor = '''                        if (fetched) {
                          const hit = fetched.quotes.find((qq) => qq.termYears === y && qq.rateType === "FIXED");
                          setIntroRate(hit?.ratePct ?? 0);
                          if (!hit) toast("info", fetched.bankName + " has no " + y + "-year rate filed — enter it manually.");
                        }'''
if old_tenor in s:
    s = s.replace(old_tenor, new_tenor)
    print("tenor filter relaxed")

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print("fetch fixes ok")
