import io

p = 'src/components/views/calculator.tsx'
s = io.open(p, encoding='utf-8').read()

# ---------- 1) NumIn: zero shows as empty; typing replaces ----------
s = s.replace('''function NumIn({ value, onChange, min = 0, step = 1000, placeholder }: { value: number; onChange: (n: number) => void; min?: number; step?: number; placeholder?: string }) {
  return (
    <input className="input mono" type="number" min={min} step={step} value={Number.isFinite(value) ? value : ""} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))} />
  );
}''', '''function NumIn({ value, onChange, min = 0, step = 1000, placeholder }: { value: number; onChange: (n: number) => void; min?: number; step?: number; placeholder?: string }) {
  // a stored 0 renders empty so typing replaces it (no "0500000" fighting)
  return (
    <input className="input mono" type="number" min={min} step={step} value={Number.isFinite(value) && value !== 0 ? value : ""} placeholder={placeholder ?? "0"}
      onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))} />
  );
}''')

# ---------- 2) imports: client picker + engine quote helpers ----------
s = s.replace('''import { useHfmcStore } from "@/lib/client-store";''',
'''import { useHfmcStore } from "@/lib/client-store";
import { parsePricing, resolveQuote, rateSchedule } from "@/lib/bank-pricing";''')

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print("part 1 ok")
