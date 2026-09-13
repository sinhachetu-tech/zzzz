"use client";
import { useState } from "react";
import { useAgentStore } from "./agent-store";
import { fmtMoney, fmtDate, ageDays } from "@/lib/format";
import { LogoMark, ILogout, ICheck, IBriefcase, IPlus } from "@/components/icons";

export function AgentDashboard() {
  const { me, cases, stats, stages, logout, hydrate } = useAgentStore();
  const [showLead, setShowLead] = useState(false);
  if (!me) return null;

  const active = cases.filter((c) => c.caseStatus === "Active");
  const booked = cases.filter((c) => c.caseStatus === "Closed");

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <div className="app-bg" />
      <header className="border-b" style={{ borderColor: "var(--line-soft)", background: "color-mix(in srgb, var(--bg) 92%, transparent)", backdropFilter: "blur(6px)" }}>
        <div className="max-w-[640px] mx-auto px-4 py-3 flex items-center gap-2.5">
          <LogoMark size={28} />
          <div className="flex-1">
            <div className="font-disp font-bold text-[14px] leading-none">HFMC Partners</div>
            <div className="text-[8.5px] uppercase tracking-[0.16em] text-[var(--ink-faint)] mt-0.5">{me.kind} Portal</div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setShowLead(true)}>
            <IPlus size={14} /> <span className="hidden sm:inline">Onboard lead</span>
          </button>
          <button className="text-[var(--ink-faint)] hover:text-[var(--coral)] transition-colors" onClick={logout} title="Sign out"><ILogout size={16} /></button>
        </div>
      </header>

      <main className="max-w-[640px] mx-auto px-4 py-5 space-y-4 pb-12">
        {/* welcome */}
        <div className="anim-fade-up">
          <h1 className="font-disp font-bold text-[20px] tracking-tight m-0">Welcome, {me.name}</h1>
          <p className="text-[13px] text-[var(--ink-faint)] mt-0.5 mb-0">{me.kind} · {stats.activeCount + stats.bookedCount} total referrals</p>
        </div>

        {/* stats cards */}
        <div className="grid grid-cols-2 gap-3 anim-fade-up">
          <div className="card p-4">
            <div className="text-[10px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)]">Active pipeline</div>
            <div className="font-disp font-bold text-[22px] mt-1" style={{ color: "var(--amber)" }}>{stats.activeCount}</div>
            <div className="text-[11px] text-[var(--ink-faint)] mt-0.5">{fmtMoney(stats.totalPipelineValue)} in flight</div>
          </div>
          <div className="card p-4">
            <div className="text-[10px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)]">Booked deals</div>
            <div className="font-disp font-bold text-[22px] mt-1" style={{ color: "var(--mint)" }}>{stats.bookedCount}</div>
            <div className="text-[11px] text-[var(--ink-faint)] mt-0.5">{stats.lostCount} lost</div>
          </div>
          <div className="card p-4" style={{ background: "linear-gradient(180deg, var(--amber-tint), var(--surface))" }}>
            <div className="text-[10px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--amber)]">Commission earned</div>
            <div className="font-disp font-bold text-[20px] mt-1" style={{ color: "var(--amber)" }}>{fmtMoney(stats.totalCommissionEarned)}</div>
            <div className="text-[11px] text-[var(--ink-faint)] mt-0.5">from {stats.bookedCount} booked deals</div>
          </div>
          <div className="card p-4">
            <div className="text-[10px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)]">Projected commission</div>
            <div className="font-disp font-bold text-[20px] mt-1" style={{ color: "var(--sky)" }}>{fmtMoney(stats.projectedCommission)}</div>
            <div className="text-[11px] text-[var(--ink-faint)] mt-0.5">from {stats.activeCount} active deals</div>
          </div>
        </div>

        {/* active referrals */}
        <div className="card anim-fade-up">
          <div className="p-4 border-b" style={{ borderColor: "var(--line-soft)" }}>
            <h3 className="font-disp font-semibold text-[13px] m-0">Active referrals</h3>
          </div>
          {active.length === 0 ? (
            <p className="p-4 text-[12.5px] text-[var(--ink-faint)] m-0">No active referrals.</p>
          ) : (
            <div className="divide-y" style={{ borderColor: "var(--line-soft)" }}>
              {active.map((c) => (
                <div key={c.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-[13px] m-0">{c.customer}</p>
                      <p className="text-[11px] text-[var(--ink-faint)] m-0 mt-0.5">
                        <span className="mono" style={{ color: "var(--amber)" }}>{c.caseNumber}</span> · {c.stage} · {ageDays(c.createdAt)}d old
                      </p>
                      {c.statusNote && <p className="text-[11.5px] text-[var(--ink-dim)] m-0 mt-1 truncate">{c.statusNote}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="mono text-[12px] m-0">{fmtMoney(c.loanAmount)}</p>
                      <p className="text-[10px] text-[var(--ink-faint)] m-0 mt-0.5">est. commission: <span className="mono" style={{ color: "var(--mint)" }}>{fmtMoney(c.commission.partnerCut)}</span></p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* booked deals + commission */}
        {booked.length > 0 && (
          <div className="card anim-fade-up">
            <div className="p-4 border-b" style={{ borderColor: "var(--line-soft)" }}>
              <h3 className="font-disp font-semibold text-[13px] m-0 flex items-center gap-2">
                <ICheck size={14} className="text-[var(--mint)]" /> Booked deals
              </h3>
            </div>
            <div className="divide-y" style={{ borderColor: "var(--line-soft)" }}>
              {booked.map((c) => (
                <div key={c.id} className="p-4 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-[13px] m-0">{c.customer}</p>
                    <p className="text-[11px] text-[var(--ink-faint)] m-0 mt-0.5">
                      <span className="mono" style={{ color: "var(--amber)" }}>{c.caseNumber}</span> · {c.wonBank ?? "—"} · {fmtMoney(c.loanAmount)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="mono text-[13px] font-semibold m-0" style={{ color: "var(--mint)" }}>{fmtMoney(c.commission.partnerCut)}</p>
                    <p className="text-[10px] text-[var(--ink-faint)] m-0">your commission @ {c.partner?.sharePct ?? 0}%</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t" style={{ borderColor: "var(--line)" }}>
              <div className="flex justify-between">
                <span className="font-disp font-semibold text-[13px]">Total commission earned</span>
                <span className="mono font-bold text-[15px]" style={{ color: "var(--amber)" }}>{fmtMoney(stats.totalCommissionEarned)}</span>
              </div>
            </div>
          </div>
        )}

        <p className="text-[10px] text-[var(--ink-faint)] text-center mt-4 mb-0">HFMC Mortgage · UAE · Commission figures are indicative and subject to final bank payout.</p>
      </main>

      {showLead && <LeadForm onClose={() => setShowLead(false)} onSubmitted={async () => { setShowLead(false); await hydrate(); }} agentName={me.name} />}
    </div>
  );
}

function LeadForm({ onClose, onSubmitted, agentName }: { onClose: () => void; onSubmitted: () => Promise<void>; agentName: string }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!name.trim()) return setErr("Client name is required.");
    if (!phone.trim()) return setErr("Phone number is required.");
    setLoading(true); setErr(null);
    try {
      const res = await fetch("/api/agent/lead", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), email: email.trim() || undefined, description: description.trim() || undefined }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setErr(e.error || "Could not create lead.");
      } else {
        const { case: c } = await res.json();
        await onSubmitted();
        // Don't auto-close — show success state
        setErr(null);
        setName(""); setPhone(""); setEmail(""); setDescription("");
        // Close after a brief moment
        setTimeout(() => onClose(), 1500);
      }
    } catch { setErr("Network error."); }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 anim-fade-in" style={{ background: "rgba(6,13,17,0.72)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card anim-scale-in w-full max-w-[440px]" style={{ background: "var(--raised)" }}>
        <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-[var(--line-soft)]">
          <div>
            <h3 className="font-disp text-[16px] font-semibold m-0">Onboard a new lead</h3>
            <p className="text-[12px] text-[var(--ink-faint)] mt-0.5 mb-0">Referred by {agentName}</p>
          </div>
          <button className="btn btn-ghost btn-sm !px-2" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="label">Client name *</label>
            <input className="input" autoFocus placeholder="e.g. Mohammed Al Mansoori" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">Mobile number *</label>
            <input className="input mono" placeholder="+971 50 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className="label">Email (optional)</label>
            <input className="input" type="email" placeholder="client@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label">Description (optional)</label>
            <textarea className="textarea" rows={2} placeholder="e.g. Looking for 2BR in Abu Dhabi, budget AED 1.5M, salaried" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {err && <p className="text-[12.5px] m-0 anim-fade-in" style={{ color: "var(--coral)" }}>{err}</p>}
        </div>
        <div className="px-5 py-3.5 border-t border-[var(--line-soft)] flex justify-end gap-2.5">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={loading}>
            {loading ? "Creating…" : "Create lead"}
          </button>
        </div>
      </div>
    </div>
  );
}
