import io

p = 'src/app/proposal/page.tsx'
s = io.open(p, encoding='utf-8').read()

s = s.replace('import { useEffect, useState } from "react";', 'import { useEffect, useMemo, useState } from "react";')

# extend the inline quote type with the fields the inspector reads
s = s.replace('''  quote: { rateType: string; ratePct?: number | null; marginPct?: number | null; termYears?: number | null } | null;''', '''  quote: {
    rateType: string; ratePct?: number | null; marginPct?: number | null; termYears?: number | null;
    floorPct?: number | null; confidence?: string; sourceLine?: string;
    variableAfter?: { basis: string; marginPct: number; floorPct: number | null };
  } | null;''')

# add the input payload to the data interface
s = s.replace('''  eibor?: { tenor: string; ratePct: number }[];''', '''  eibor?: { tenor: string; ratePct: number }[];
  input: {
    monthlyIncome?: number; existingEmis?: number; cardLimitsTotal?: number; rentalIncome?: number;
    bonusIncome?: number; stl: boolean; loanAmount: number; propertyValue: number;
    termYears?: number; ratePref?: string;
  };''')

# move Row to module scope (react-hooks: no components defined inside components)
s = s.replace('''  const Row = ({ k, v, tone }: { k: string; v: string; tone?: "amber" | "mint" }) => (
    <div className="flex justify-between gap-2 py-1" style={{ borderBottom: "1px dashed var(--line)" }}>
      <span className="text-[11px] text-[var(--ink-faint)]">{k}</span>
      <span className="mono text-[11.5px] text-right" style={{ color: tone ? `var(--${tone})` : undefined }}>{v}</span>
    </div>
  );
  const q = r.quote;''', '''  const q = r.quote;''')
s = s.replace('''function CompareRow(''', '''function Row({ k, v, tone }: { k: string; v: string; tone?: "amber" | "mint" }) {
  return (
    <div className="flex justify-between gap-2 py-1" style={{ borderBottom: "1px dashed var(--line)" }}>
      <span className="text-[11px] text-[var(--ink-faint)]">{k}</span>
      <span className="mono text-[11.5px] text-right" style={{ color: tone ? `var(--${tone})` : undefined }}>{v}</span>
    </div>
  );
}

function CompareRow(''')

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print("fixed")
