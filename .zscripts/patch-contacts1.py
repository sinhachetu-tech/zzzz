import io

p = 'src/components/views/admin.tsx'
s = io.open(p, encoding='utf-8').read()

# 1) ContactsEditor component — appended before the bank rules tab
s = s.replace('''function BankRulesTab() {''', '''/* Bank RM / partner contact editor — rows of {name, phone, email, role}. */
function ContactsEditor({ contacts, onChange }: { contacts: { name: string; phone?: string; email?: string; role?: string }[]; onChange: (c: { name: string; phone?: string; email?: string; role?: string }[]) => void }) {
  const upd = (i: number, patch: Partial<{ name: string; phone?: string; email?: string; role?: string }>) =>
    onChange(contacts.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  return (
    <div className="space-y-1.5">
      {contacts.length === 0 && <p className="text-[11.5px] text-[var(--ink-faint)] m-0">No RM/contact yet — add the relationship manager&apos;s name, phone and email.</p>}
      {contacts.map((c, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5">
          <input className="input !py-1 text-[11.5px]" style={{ width: 150 }} placeholder="RM name" value={c.name} onChange={(e) => upd(i, { name: e.target.value })} />
          <input className="input mono !py-1 text-[11.5px]" style={{ width: 130 }} placeholder="+971…" value={c.phone ?? ""} onChange={(e) => upd(i, { phone: e.target.value })} />
          <input className="input !py-1 text-[11.5px]" style={{ width: 170 }} placeholder="email" value={c.email ?? ""} onChange={(e) => upd(i, { email: e.target.value })} />
          <input className="input !py-1 text-[11.5px]" style={{ width: 120 }} placeholder="role/desk" value={c.role ?? ""} onChange={(e) => upd(i, { role: e.target.value })} />
          <button className="btn btn-ghost btn-sm !px-2" style={{ color: "var(--coral)" }} onClick={() => onChange(contacts.filter((_, idx) => idx !== i))} title="Remove contact">✕</button>
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" onClick={() => onChange([...contacts, { name: "" }])}>+ Add contact</button>
    </div>
  );
}

function BankRulesTab() {''')

# 2) bank edit modal: contacts field — find bank editing state (name/ratePct/active)
s = s.replace('''interface BankDraft {
  id: number;
  name: string;
  ratePct: number;
  active: boolean;
}''', '''interface BankDraft {
  id: number;
  name: string;
  ratePct: number;
  active: boolean;
  contacts: { name: string; phone?: string; email?: string; role?: string }[];
}''')
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print("contacts editor inserted")
