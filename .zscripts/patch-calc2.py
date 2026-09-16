import io

p = 'src/components/views/calculator.tsx'
s = io.open(p, encoding='utf-8').read()

# ---------- main component: store hooks + client picker + deal shape + rate scenario ----------
s = s.replace('''export default function Calculator() {
  const { me, toast, nav, feeRules, docRules } = useHfmcStore();
  const [mode, setMode] = useState<CalcMode>("affordability");
  const [input, setInput] = useState<MortgageInput>(defaultInput);''', '''export default function Calculator() {
  const { me, toast, nav, feeRules, docRules, clients, cases, bankProducts, eibor } = useHfmcStore();
  const [mode, setMode] = useState<CalcMode>("affordability");
  const [input, setInput] = useState<MortgageInput>(defaultInput);
  // deal shape — auto-filled from the selected client's latest case, always editable
  const [dealEmirate, setDealEmirate] = useState("Dubai");
  const [dealTxn, setDealTxn] = useState("Resale");
  const [pickerOpen, setPickerOpen] = useState(false);
  // rate scenario — what-if over the three rates, or fetched from a bank product
  const [rateStyle, setRateStyle] = useState<"fixed" | "variable">("fixed");
  const [introRate, setIntroRate] = useState(0);
  const [introYears, setIntroYears] = useState(3);
  const [foTenor, setFoTenor] = useState<"1M" | "3M" | "6M" | "1Y">("3M");
  const [foSpread, setFoSpread] = useState(0);
  const [foFinal, setFoFinal] = useState(0);
  const [useFoFinal, setUseFoFinal] = useState(false);
  const [stressSpread, setStressSpread] = useState(0);
  const [stressFinal, setStressFinal] = useState(0);
  const [useStressFinal, setUseStressFinal] = useState(false);
  const [fetchBank, setFetchBank] = useState("");
  const [fetchProduct, setFetchProduct] = useState("");

  const eiborPct = (t: string) => eibor.find((e) => e.tenor === t)?.ratePct ?? null;

  // three-scenario rates: explicit inputs, or auto-filled from the chosen bank product.
  // DBR1/2/3 use the calculator's own qualifying income + existing obligations.
  const scenario = (() => {
    if (rateStyle === "variable") {
      const eib = eiborPct(foTenor) ?? 0;
      const rate = eib + foSpread;
      const stress = useStressFinal ? stressFinal : rate + stressSpread;
      return { intro: rate, introYears: 0, followOn: rate, stress };
    }
    const eib = eiborPct(foTenor) ?? 0;
    const followOn = useFoFinal ? foFinal : eib + foSpread;
    const stress = useStressFinal ? stressFinal : followOn + stressSpread;
    return { intro: introRate, introYears, followOn, stress };
  })();''')
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print("part 2 ok")
