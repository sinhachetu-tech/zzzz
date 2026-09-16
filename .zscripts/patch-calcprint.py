import io

p = 'src/components/views/calculator.tsx'
s = io.open(p, encoding='utf-8').read()

# 1) print CSS + button in the header row (next to Reset)
s = s.replace('''          {mode === "affordability" && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setInput(defaultInput()); toast("info", "Calculator reset."); }}>
              Reset
            </button>
          )}''','''          {mode === "affordability" && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => { setInput(defaultInput()); toast("info", "Calculator reset."); }}>
                Reset
              </button>
              <button className="btn btn-ghost btn-sm" title="Print the detailed working — inputs, all three rate stages, DBR 1/2/3, trail" onClick={() => window.print()}>
                Print / Save PDF
              </button>
            </>
          )}''')

# 2) print stylesheet: results-only sheet
s = s.replace('''export default function Calculator() {''', '''const PRINT_CSS = `
@media print {
  aside, header, nav { display: none !important; }
  .no-print { display: none !important; }
  .xl\\:grid-cols-\\[1fr_420px\\] { display: block !important; }
  .xl\\:sticky { position: static !important; max-height: none !important; overflow: visible !important; }
  .card { break-inside: avoid; border-color: #ddd !important; background: white !important; }
  body { background: white !important; }
}
`;

export default function Calculator() {''')
s = s.replace('''  const [fetchBank, setFetchBank] = useState("");''', '''  const [fetchBank, setFetchBank] = useState("");
  const printStyle = <style>{PRINT_CSS}</style>;''')
# inject the style at the return root — find the first return div of the page
s = s.replace('''  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">''','''  return (
    <div className="space-y-4">
      {printStyle}
      <div className="flex flex-wrap items-center gap-2">''')

# 3) mark input-only chrome as no-print (rate fetch row, buttons)
s = s.replace('''<button className="btn btn-ghost btn-sm shrink-0" title="Search existing clients by name, mobile, email or EID" onClick={() => setPickerOpen(true)}>🔍</button>''',
'''<button className="btn btn-ghost btn-sm shrink-0 no-print" title="Search existing clients by name, mobile, email or EID" onClick={() => setPickerOpen(true)}>🔍</button>''')
s = s.replace('''            {/* optional engine fetch */}
            <div className="flex flex-wrap items-end gap-2 mb-3 pb-3" style={{ borderBottom: "1px dashed var(--line)" }}>''','''            {/* optional engine fetch */}
            <div className="no-print flex flex-wrap items-end gap-2 mb-3 pb-3" style={{ borderBottom: "1px dashed var(--line)" }}>''')
s = s.replace('''            <button className="btn btn-ghost btn-sm self-end" title="Copy the stress rate into the assessment rate"''','''            <button className="no-print btn btn-ghost btn-sm self-end" title="Copy the stress rate into the assessment rate"''')
s = s.replace('''          <div className="card p-4 anim-fade-up flex flex-col gap-2">
            <button className="btn btn-mint justify-center" onClick={onSave}>''','''          <div className="no-print card p-4 anim-fade-up flex flex-col gap-2">
            <button className="btn btn-mint justify-center" onClick={onSave}>''')
s = s.replace('''          {/* AI advisor */}
          <AdvisorPanel input={input} r={r} />

          {/* AI document reader */}
          <DocReaderPanel onApply={applyDocRead} />''','''          {/* AI advisor */}
          <div className="no-print">
            <AdvisorPanel input={input} r={r} />
          </div>

          {/* AI document reader */}
          <div className="no-print">
            <DocReaderPanel onApply={applyDocRead} />
          </div>''')

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print("print ok")
