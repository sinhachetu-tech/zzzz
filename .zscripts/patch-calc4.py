import io

p = 'src/components/views/calculator.tsx'
s = io.open(p, encoding='utf-8').read()

# ---------- 5) ClientPicker component ----------
s = s.replace('''export default function Calculator() {''', '''/* Client picker — search the client master by name, mobile, email or EID. */
function ClientPicker({ clients, cases, onPick, onClose }: {
  clients: { id: number; fullName: string; phone: string; email: string | null; eidNo: string | null; emirate: string | null; dob: string | null; residency: string; employmentProfile: string; monthlySalary: number }[];
  cases: { id: number; clientId: number | null; profileJson?: string | null }[];
  onPick: (c: { id: number; fullName: string; dob: string | null; emirate: string | null; residency: string; employmentProfile: string }) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return clients.slice(0, 8);
    return clients.filter((c) =>
      c.fullName.toLowerCase().includes(t) ||
      (c.phone || "").includes(t.replace(/\D/g, "")) ||
      (c.email ?? "").toLowerCase().includes(t) ||
      (c.eidNo ?? "").includes(t.replace(/\D/g, ""))
    ).slice(0, 10);
  }, [q, clients]);
  return (
    <div className="px-5 py-4">
      <input className="input" autoFocus placeholder="Name, mobile, email or Emirates ID…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-3 space-y-1.5 max-h-[46vh] overflow-y-auto">
        {hits.length === 0 && <p className="text-[12.5px] text-[var(--ink-faint)] m-0 py-3 text-center">No match — type the name, part of the mobile, email or EID.</p>}
        {hits.map((c) => (
          <button key={c.id} className="w-full text-left rounded-lg px-3 py-2 hover:bg-[var(--tint)] transition-colors" style={{ border: "1px solid var(--line-soft)" }}
            onClick={() => onPick(c)}>
            <span className="text-[13px] font-medium">{c.fullName}</span>
            <span className="block text-[11px] text-[var(--ink-faint)] mono">
              {[c.phone, c.email, c.eidNo ? "EID ✓" : null, c.employmentProfile].filter(Boolean).join(" · ")}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Calculator() {''')

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print("picker ok")
