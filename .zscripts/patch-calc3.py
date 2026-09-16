import io

p = 'src/components/views/calculator.tsx'
s = io.open(p, encoding='utf-8').read()

# ---------- 3) Applicant section: client picker + emirate/txn; WhatsApp removed ----------
s = s.replace('''              <div>
                <label className="label">Applicant name</label>
                <input className="input" value={input.name} onChange={(e) => up({ name: e.target.value })} placeholder="e.g. Mohammed Al Mansoori" />
              </div>
              <div>
                <label className="label">WhatsApp</label>
                <input className="input mono" value={input.whatsapp} onChange={(e) => up({ whatsapp: e.target.value })} placeholder="+971 50 …" />
              </div>''', '''              <div>
                <label className="label">Applicant name</label>
                <div className="flex gap-1.5">
                  <input className="input" value={input.name} onChange={(e) => up({ name: e.target.value })} placeholder="e.g. Mohammed Al Mansoori" />
                  <button className="btn btn-ghost btn-sm shrink-0" title="Search existing clients by name, mobile, email or EID" onClick={() => setPickerOpen(true)}>🔍</button>
                </div>
              </div>
              <div>
                <label className="label">Emirate · <span className="normal-case tracking-normal" style={{ color: "var(--ink-faint)" }}>pre-filled, editable</span></label>
                <select className="select" value={dealEmirate} onChange={(e) => setDealEmirate(e.target.value)}>
                  {["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "RAK", "Fujairah", "UAQ"].map((x) => <option key={x}>{x}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Transaction type · <span className="normal-case tracking-normal" style={{ color: "var(--ink-faint)" }}>pre-filled, editable</span></label>
                <select className="select" value={dealTxn} onChange={(e) => setDealTxn(e.target.value)}>
                  {["Resale", "Primary Handover", "Buyout", "Buyout + Equity Release", "Equity Release"].map((x) => <option key={x}>{x}</option>)}
                </select>
              </div>''')

# ---------- 4) Client picker modal ----------
s = s.replace('''      {mode === "transfer" ? (''', '''      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 anim-fade-in" style={{ background: "rgba(6,13,17,0.72)" }} onMouseDown={(e) => { if (e.target === e.currentTarget) setPickerOpen(false); }}>
          <div className="card anim-scale-in w-full" style={{ maxWidth: 560, background: "var(--raised)" }}>
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
              <h3 className="font-disp text-[15px] font-semibold m-0">Pick a client</h3>
              <button className="btn btn-ghost btn-sm !px-2" onClick={() => setPickerOpen(false)}>✕</button>
            </div>
            <ClientPicker
              clients={clients}
              cases={cases}
              onPick={(cl) => {
                up({
                  name: cl.fullName,
                  dob: cl.dob ?? input.dob,
                  applicantType: cl.residency === "UAE National" ? "UAE National" : "Expatriate",
                  employment: cl.employmentProfile === "Self-Employed" ? "Self-Employed" : "Salaried",
                });
                if (cl.emirate) setDealEmirate(cl.emirate);
                // co-borrower auto-fetch: a client who is a second party on another case comes in via the case profile
                const linked = cases.find((c) => c.clientId === cl.id && c.profileJson);
                if (linked) {
                  try {
                    const prof = JSON.parse(linked.profileJson || "{}");
                    const emi = Number(prof.primary?.existingEmis) || 0;
                    if (emi) setInput((prev) => ({ ...prev, liabilities: prev.liabilities.map((l, i) => (i === 0 ? { ...l, emi } : l)) }));
                  } catch { /* ignore */ }
                }
                setPickerOpen(false);
                toast("success", cl.fullName + " loaded — verify income and liabilities.");
              }}
              onClose={() => setPickerOpen(false)}
            />
          </div>
        </div>
      )}

      {mode === "transfer" ? (''')

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print("part 3 ok")
