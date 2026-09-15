import io

p = 'src/app/proposal/page.tsx'
s = io.open(p, encoding='utf-8').read()

# extend interfaces
s = s.replace('''  posPoints: string | null;
  negPoints: string | null;
}''', '''  posPoints: string | null;
  negPoints: string | null;
  policy: {
    tenorYears: number | null; maxLtvNational: number | null; maxLtvExpatriate: number | null;
    minLoan: number | null; maxLoan: number | null; minSalary: number | null; dbrPct: number | null;
    cardRulePct: number | null; bonusPct: number | null; rentalIncomePct: number | null;
    rentalCapPctOfSalary: number | null; stressBufferPct: number | null;
    totalTatDays: number | null; paTatDays: number | null;
  } | null;
}''')
s = s.replace('''  costs: { equity: number; transferFees: { label: string; note: string; amount: number }[]; sellerFees: { label: string; note: string; amount: number }[]; transferTotal: number; grossCashNeeded: number };''', '''  costs: { equity: number; transferFees: { label: string; note: string; amount: number }[]; sellerFees: { label: string; note: string; amount: number }[]; transferTotal: number; grossCashNeeded: number };
  eibor?: { tenor: string; ratePct: number }[];''')

# inspector UI: insert before the side-by-side comparison heading
s = s.replace('''        {/* side-by-side comparison */}
        <h3 className="font-disp font-semibold text-[14px] mt-6 mb-2">Side-by-side comparison</h3>''', '''        <ProductInspector data={data} />

        {/* side-by-side comparison */}
        <h3 className="font-disp font-semibold text-[14px] mt-6 mb-2">Side-by-side comparison</h3>''')

# the inspector component
inspector = '''/* Product inspector - the manual-testing instrument. Pick a bank + product and
   see every field that fed the calculation: client inputs, the bank's policy
   values, the exact quote used (with its source line), the EIBOR numbers, and
   each computed intermediate. Print-hidden: internal tool, never client-facing. */
function ProductInspector({ data }: { data: ProposalData }) {
  const banks = useMemo(() => [...new Set(data.results.map((r) => r.bankName))], [data]);
  const [bank, setBank] = useState(banks[0] ?? "");
  const productsOf = data.results.filter((r) => r.bankName === bank);
  const [prodId, setProdId] = useState(productsOf[0]?.bankProductId ?? 0);
  const r = data.results.find((x) => x.bankProductId === prodId) ?? productsOf[0] ?? data.results[0];
  if (!r) return null;
  const P = r.policy;
  const eiborFor = (t: string) => data.eibor?.find((e) => e.tenor === t)?.ratePct;
  const Row = ({ k, v, tone }: { k: string; v: string; tone?: "amber" | "mint" }) => (
    <div className="flex justify-between gap-2 py-1" style={{ borderBottom: "1px dashed var(--line)" }}>
      <span className="text-[11px] text-[var(--ink-faint)]">{k}</span>
      <span className="mono text-[11.5px] text-right" style={{ color: tone ? `var(--${tone})` : undefined }}>{v}</span>
    </div>
  );
  const q = r.quote;
  const va = q?.variableAfter;
  return (
    <div className="no-print my-5 rounded-xl p-4" style={{ border: "1px solid var(--amber)", background: "var(--amber-tint)" }}>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h3 className="font-disp font-semibold text-[14px] m-0">Product inspector — what the engine actually used</h3>
        <select className="select !w-auto !py-1 text-[12px]" value={bank}
          onChange={(e) => { setBank(e.target.value); const first = data.results.find((x) => x.bankName === e.target.value); setProdId(first?.bankProductId ?? 0); }}>
          {banks.map((b) => <option key={b}>{b}</option>)}
        </select>
        <select className="select !w-auto !py-1 text-[12px]" value={r.bankProductId} onChange={(e) => setProdId(Number(e.target.value))}>
          {productsOf.map((x) => <option key={x.bankProductId} value={x.bankProductId}>{x.productName}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
        <div>
          <div className="text-[10px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)] mb-1">Client inputs given to the match</div>
          <Row k="Monthly income (net)" v={"AED " + (data.input.monthlyIncome ?? 0).toLocaleString()} />
          <Row k="Existing EMIs" v={"AED " + (data.input.existingEmis ?? 0).toLocaleString()} />
          <Row k="Credit-card limits total" v={"AED " + (data.input.cardLimitsTotal ?? 0).toLocaleString()} />
          <Row k="Rental income" v={"AED " + (data.input.rentalIncome ?? 0).toLocaleString()} />
          <Row k="Bonus / variable income" v={"AED " + (data.input.bonusIncome ?? 0).toLocaleString()} />
          <Row k="Salary transfer" v={data.input.stl ? "STL" : "NSTL"} />
          <Row k="Loan requested" v={fmt(data.input.loanAmount)} />
          <Row k="Property value" v={fmt(data.input.propertyValue)} />
          <Row k="Rate preference applied" v={data.input.ratePref ?? "best available"} />
          <Row k="Fixed tenure requested" v={data.input.termYears ? data.input.termYears + "y" : "day-1 variable"} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)] mb-1">Bank policy fields consumed</div>
          <Row k="Max tenure used" v={(P?.tenorYears ?? 25) + "y" + (P?.tenorYears ? "" : " (25y norm fallback)")} />
          <Row k="Max LTV — expat / national" v={(P?.maxLtvExpatriate ?? "—") + "% / " + (P?.maxLtvNational ?? "—") + "%"} />
          <Row k="Min / max loan" v={fmt(P?.minLoan) + " – " + fmt(P?.maxLoan)} />
          <Row k="Min salary" v={P?.minSalary ? "AED " + P.minSalary.toLocaleString() : "—"} />
          <Row k="DBR ceiling" v={P?.dbrPct != null ? P.dbrPct + "%" : "50% (CBUAE default)"} />
          <Row k="Card rule" v={P?.cardRulePct != null ? P.cardRulePct + "% of limit" : "5% (CBUAE default)"} />
          <Row k="Bonus considered" v={P?.bonusPct != null ? P.bonusPct + "%" : "bank default"} />
          <Row k="Rental considered" v={(P?.rentalIncomePct != null ? P.rentalIncomePct + "%" : "bank default") + (P?.rentalCapPctOfSalary != null ? ", capped at " + P.rentalCapPctOfSalary + "% of salary" : "")} />
          <Row k="Stress buffer" v={P?.stressBufferPct != null ? "+" + P.stressBufferPct + "%" : "0"} />
          <Row k="TAT (PA / total)" v={(P?.paTatDays ?? "—") + "d / " + (P?.totalTatDays ?? "—") + "d"} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)] mb-1">Quote selected</div>
          <Row k="Rate structure" v={q?.rateType === "FIXED" ? "Fixed " + (q.termYears ?? "?") + "y" : String(q?.rateType ?? "—").replace("_EIBOR", " EIBOR")} tone="mint" />
          {q?.rateType === "FIXED"
            ? <Row k="Fixed rate" v={(q.ratePct ?? 0).toFixed(2) + "%"} tone="mint" />
            : <Row k="Margin over EIBOR" v={(q?.marginPct ?? 0).toFixed(3) + "%" + (q?.floorPct != null ? " (floor " + q.floorPct + "%)" : "")} tone="mint" />}
          {va && <Row k="After fixed term" v={va.basis.replace("_EIBOR", " EIBOR") + " + " + va.marginPct + "%" + (va.floorPct != null ? " (floor " + va.floorPct + "%)" : "")} tone="amber" />}
          <Row k="Quote source" v={q?.sourceLine ? String(q.sourceLine).slice(0, 60) : "—"} />
          <Row k="Quote confidence" v={q?.confidence ?? "—"} />
          {q?.rateType !== "FIXED" && <Row k="EIBOR (3M / 6M)" v={(eiborFor("3M") ?? "—") + "% / " + (eiborFor("6M") ?? "—") + "%"} />}
          {q?.rateType !== "FIXED" && <Row k="EIBOR (1M / 1Y)" v={(eiborFor("1M") ?? "—") + "% / " + (eiborFor("1Y") ?? "—") + "%"} />}
          {q?.rateType === "FIXED" && va && <Row k="EIBOR (follow-on basis)" v={(eiborFor(va.basis.replace("_EIBOR", "")) ?? "—") + "%"} />}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)] mb-1">Computed by the engine</div>
          <Row k="Card obligation counted" v={r.cardObligation != null ? "AED " + r.cardObligation.toLocaleString() + "/mo" : "—"} />
          <Row k="Qualifying income (after bank rules)" v={r.eligibleIncome != null ? "AED " + r.eligibleIncome.toLocaleString() : "—"} tone="mint" />
          <Row k="DBR applied" v={r.dbrPctUsed != null ? r.dbrPctUsed + "%" : "—"} />
          <Row k="Max loan by DBR" v={fmt(r.maxLoanByDbr)} />
          <Row k="Max loan by LTV (LTV " + (r.ltvPct ?? "—") + "%)" v={fmt(r.maxLoanByLtv)} />
          <Row k="Eligible loan (final)" v={fmt(r.eligibleLoan)} tone="amber" />
          <Row k="EMI on requested — intro" v={fmt(r.introEmi) + " (" + (r.dbrIntro ?? "—") + "% of income)"} />
          <Row k="EMI — after intro" v={fmt(r.followOnEmi) + " (" + (r.dbrFollowOn ?? "—") + "%)"} />
          <Row k="EMI — stress-qualified" v={fmt(r.stressEmi) + " (" + (r.dbrStress ?? "—") + "%)"} tone="amber" />
          <Row k="Processing fee / insurances" v={fmt(r.bankCosts?.processingFee) + " · " + fmt(r.bankCosts?.lifeMonthly) + "/mo · " + fmt(r.bankCosts?.propertyYearly) + "/yr"} />
          <Row k="Early / partial settlement" v={(r.earlySettlement ?? "—") + " / " + (r.partialSettlement ?? "—")} />
        </div>
      </div>
    </div>
  );
}

function CompareRow('''
s = s.replace('function CompareRow(', inspector, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print("inspector inserted")
