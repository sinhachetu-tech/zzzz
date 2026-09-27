"use client";

import { useEffect, useState, type ReactElement } from "react";
import { useAgentStore, type AgentRoute, type AgentCase, type AgentProfile } from "./agent-store";
import { fmtMoney, ageDays, relTime, greetingFor } from "@/lib/format";
import {
  LogoMark, ICheck, ILogout, IPlus, IHome, IBriefcase, ICalc, IUsers,
  IWhatsapp, IUpload, ITrophy, ITarget, IZap, IShield, IArrowR, IAlert,
} from "@/components/icons";
import { ThemeToggle, Tabs, KpiValue } from "@/components/hfmc/ui";
import {
  CBUAE, ltvCap, emiOf, eligibleEmi, maxLoanFor, maxTenorYears, cashToClose, RULES_FOOTNOTE,
  type Residency, type PropertyCount, type TxnType, type Emirate,
} from "@/lib/agent-mortgage";

/* ============================================================
   Agent portal — app shell. Tabs: Home / Add Lead / My Leads /
   Tools / Profile. Mobile: bottom tab bar. Desktop: top pills.
   No URL routing — route lives in the store (same as the team portal).
   ============================================================ */

type TabDef = { id: AgentRoute; label: string; Icon: (p: { size?: number }) => ReactElement };
const TABS: TabDef[] = [
  { id: "home", label: "Home", Icon: IHome },
  { id: "addlead", label: "Add Lead", Icon: IPlus },
  { id: "leads", label: "My Leads", Icon: IBriefcase },
  { id: "tools", label: "Tools", Icon: ICalc },
  { id: "profile", label: "Profile", Icon: IUsers },
];

export function AgentDashboard() {
  const { me, route, setRoute, logout } = useAgentStore();
  if (!me) return null;

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <div className="app-bg" />
      <style>{SLIDER_CSS}</style>

      {/* top bar */}
      <header className="sticky top-0 z-40 border-b" style={{ borderColor: "var(--line-soft)", background: "color-mix(in srgb, var(--bg) 92%, transparent)", backdropFilter: "blur(8px)" }}>
        <div className="max-w-[900px] mx-auto px-4 py-2.5 flex items-center gap-2.5">
          <LogoMark size={26} />
          <div className="flex-1">
            <div className="font-disp font-bold text-[13px] leading-none">HFMC Partners</div>
            <div className="text-[8px] uppercase tracking-[0.16em] text-[var(--ink-faint)] mt-0.5">{me.kind} Portal</div>
          </div>
          <ThemeToggle compact />
          <button className="text-[var(--ink-faint)] hover:text-[var(--coral)] transition-colors" onClick={logout} title="Sign out">
            <ILogout size={16} />
          </button>
        </div>
        {/* desktop pills */}
        <div className="hidden md:flex max-w-[900px] mx-auto px-4 pb-2.5">
          <Tabs
            scroll
            value={route}
            onChange={setRoute}
            options={TABS.map(({ id, label, Icon }) => ({
              value: id, label, icon: <Icon size={14} />,
            }))}
          />
        </div>
      </header>

      <main className="max-w-[900px] mx-auto px-4 py-5 space-y-4 pb-28 md:pb-10">
        {route === "home" && <HomeTab goto={setRoute} />}
        {route === "addlead" && <AddLeadTab goto={setRoute} />}
        {route === "leads" && <LeadsTab goto={setRoute} />}
        {route === "tools" && <ToolsTab />}
        {route === "profile" && <ProfileTab />}
      </main>

      {/* mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex border-t"
        style={{ borderColor: "var(--line-soft)", background: "color-mix(in srgb, var(--bg) 94%, transparent)", backdropFilter: "blur(10px)" }}>
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setRoute(id)}
            className="flex-1 flex flex-col items-center gap-0.5 py-2.5"
            style={{ color: route === id ? "var(--amber)" : "var(--ink-faint)" }}>
            <Icon size={19} />
            <span className="text-[10.5px] font-disp font-semibold leading-tight">{label.split(" ")[0]}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

/* ================= HOME ================= */

function HomeTab({ goto }: { goto: (r: AgentRoute) => void }) {
  const { me, cases, stats, profile, desk } = useAgentStore();
  const [copied, setCopied] = useState(false);
  // same helper as the staff dashboard, so partners and staff are greeted identically
  const greeting = greetingFor(me?.name);
  const firstTime = cases.length === 0;
  const sharePct = profile?.sharePct ?? 20;
  const recent = cases.slice(0, 3);

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(`${window.location.origin}/agent`); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ }
  };

  return (
    <>
      {/* hero */}
      <div className="anim-fade-up rounded-2xl p-5 relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--amber) 16%, var(--raised)), var(--raised))", border: "1px solid color-mix(in srgb, var(--amber) 35%, var(--line))" }}>
        <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full" style={{ background: "radial-gradient(circle, rgba(242,176,76,0.14), transparent 70%)" }} />
        <h1 className="font-disp font-bold text-[24px] tracking-tight m-0">{greeting}</h1>
        <p className="text-[12.5px] text-[var(--ink-dim)] mt-0.5 mb-0">{me?.name}</p>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className="chip !py-1" style={{ background: "rgba(67,214,155,0.12)", borderColor: "var(--mint)", color: "var(--mint)" }}>
            <ITrophy size={12} /> {sharePct}% commission on every closed referral
          </span>
          <span className="chip !py-1" style={{ background: "var(--tint)", borderColor: "var(--line)", color: "var(--ink-dim)" }}>
            <IZap size={12} /> paid within 24 hours of booking
          </span>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          <button className="btn btn-primary btn-sm" onClick={() => goto("addlead")}><IPlus size={14} /> Add a mortgage lead</button>
          <button className="btn btn-ghost btn-sm" onClick={() => goto("tools")}><ICalc size={14} /> Mortgage calculator</button>
        </div>
      </div>

      {/* first-lead empty state */}
      {firstTime && (
        <div className="card anim-fade-up p-6 rounded-2xl text-center" style={{ borderStyle: "dashed", borderWidth: 1.5 }}>
          <div className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center mb-3"
            style={{ background: "var(--amber-tint)", color: "var(--amber)" }}><IPlus size={22} /></div>
          <h3 className="font-disp font-bold text-[16px] m-0">Add your first mortgage lead</h3>
          <p className="text-[12.5px] text-[var(--ink-dim)] m-0 mt-1.5 max-w-[380px] mx-auto leading-relaxed">
            <span className="inline-flex mr-1 -mt-0.5" style={{ color: "var(--mint)" }}><IShield size={12} /></span>
            Partner referrals are protected — your leads are never visible to any other agent.
          </p>
          <button className="btn btn-primary btn-sm mt-4" onClick={() => goto("addlead")}><IPlus size={14} /> Add lead</button>
        </div>
      )}

      {/* stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 anim-fade-up">
        <StatCard label="Active referrals" value={String(stats.activeCount)} count={stats.activeCount} sub={`${fmtMoney(stats.totalPipelineValue)} in flight`} color="var(--amber)" />
        <StatCard label="Booked deals" value={String(stats.bookedCount)} count={stats.bookedCount} sub={stats.lostCount ? `${stats.lostCount} lost` : "none lost"} color="var(--mint)" />
        <StatCard label="Commission earned" value={fmtMoney(stats.totalCommissionEarned)} sub="from booked deals" color="var(--amber)" highlight />
        <StatCard label="Projected" value={fmtMoney(stats.projectedCommission)} sub="from active deals" color="var(--sky)" />
      </div>

      {/* mortgage desk */}
      <div className="card anim-fade-up p-4 flex items-center gap-3.5 rounded-2xl" style={{ borderColor: "color-mix(in srgb, var(--mint) 30%, var(--line))" }}>
        <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 font-disp font-bold text-[13px]"
          style={{ background: "linear-gradient(135deg, var(--mint), #2aa77a)", color: "#06251a" }}>
          {(desk?.name || "HF").split(" ").map((w) => w[0]).slice(0, 2).join("")}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10.5px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)]">Your mortgage desk</div>
          <div className="text-[14.5px] font-medium leading-tight">{desk?.name || "HFMC Partnership Team"}</div>
          <div className="text-[11px] text-[var(--ink-faint)]">Qualifies your lead within the hour · replies fast on WhatsApp</div>
        </div>
        {desk?.phone && (
          <a className="btn btn-mint btn-sm shrink-0"
            href={`https://wa.me/${desk.phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Hi HFMC, I'm ${me?.name ?? "a partner"} — I have a mortgage lead to discuss.`)}`}
            target="_blank" rel="noreferrer">
            <IWhatsapp size={14} /> Ask
          </a>
        )}
      </div>

      {/* quick tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 anim-fade-up">
        <QuickTile Icon={IPlus} title="Add a lead" sub="30 seconds, name + number" onClick={() => goto("addlead")} />
        <QuickTile Icon={ICalc} title="Calculator" sub="UAE quick eligibility" onClick={() => goto("tools")} />
        <QuickTile Icon={IBriefcase} title="My leads" sub={`${cases.length} referred`} onClick={() => goto("leads")} />
        <QuickTile Icon={copied ? ICheck : IArrowR} title={copied ? "Link copied" : "Invite link"} sub="share the partner portal" onClick={copyLink} />
      </div>

      {/* recent referrals */}
      {recent.length > 0 && (
        <div className="card anim-fade-up rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--line-soft)" }}>
            <h3 className="font-disp font-semibold text-[13px] m-0">Latest referrals</h3>
            <button className="text-[11.5px] font-disp font-semibold" style={{ color: "var(--amber)" }} onClick={() => goto("leads")}>View all</button>
          </div>
          <div className="divide-y" style={{ borderColor: "var(--line-soft)" }}>
            {recent.map((c) => (
              <div key={c.id} className="px-4 py-3 flex items-center gap-3">
                <StatusDot c={c} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium m-0 truncate">{c.customer}</p>
                  <p className="text-[11px] text-[var(--ink-faint)] m-0 mt-0.5">
                    <span className="mono">{c.caseNumber}</span> · {c.stage} · {ageDays(c.createdAt)}d old
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="mono text-[12px] m-0">{fmtMoney(c.loanAmount)}</p>
                  <p className="text-[10.5px] text-[var(--ink-faint)] m-0">est. <span className="mono" style={{ color: "var(--mint)" }}>{fmtMoney(c.commission.partnerCut)}</span></p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[10.5px] text-[var(--ink-faint)] text-center m-0">HFMC Mortgage · UAE · Commission figures are indicative and subject to final bank payout.</p>
    </>
  );
}

function StatCard({ label, value, sub, color, highlight, count }: { label: string; value: string; sub: string; color: string; highlight?: boolean; count?: number }) {
  // built on the shared .kpi primitive so this strip shares a baseline with the
  // dashboard/admin/calculator tiles (was its own 19px/10.5px sizing)
  // `count` is passed only for the plain-integer tiles; money tiles arrive
  // pre-formatted (fmtMoney) and can't be counted without re-parsing the string.
  return (
    <div className={"kpi kpi-plain" + (highlight ? " kpi-accent" : "")}>
      <div className="kpi-label">{label}</div>
      {count !== undefined
        ? <KpiValue value={count} style={{ color }} />
        : <div className="kpi-value" style={{ color }}>{value}</div>}
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}

function QuickTile({ Icon, title, sub, onClick }: { Icon: (p: { size?: number }) => ReactElement; title: string; sub: string; onClick: () => void }) {
  return (
    <button className="card p-4 rounded-2xl text-left transition-all hover:-translate-y-0.5" onClick={onClick}
      style={{ cursor: "pointer" }}>
      <span className="inline-flex w-8 h-8 rounded-lg items-center justify-center mb-2" style={{ background: "var(--amber-tint)", color: "var(--amber)" }}><Icon size={16} /></span>
      <div className="text-[12.5px] font-disp font-semibold leading-tight">{title}</div>
      <div className="text-[10.5px] text-[var(--ink-faint)] mt-0.5">{sub}</div>
    </button>
  );
}

function StatusDot({ c }: { c: AgentCase }) {
  const color = c.caseStatus === "Active" ? "var(--amber)" : c.caseStatus === "Closed" ? "var(--mint)" : "var(--ink-faint)";
  return <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />;
}

/* ================= ADD LEAD ================= */

function AddLeadTab({ goto }: { goto: (r: AgentRoute) => void }) {
  const { createLead, me } = useAgentStore();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [details, setDetails] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<string | null>(null); // name of the lead created

  const phoneRaw = phone.trim();
  const fullPhone = phoneRaw.startsWith("+") ? phoneRaw : `+971${phoneRaw.replace(/^0+/, "")}`;

  const submit = async () => {
    if (!name.trim()) return setErr("Your client's full name is required.");
    if (!phoneRaw || phoneRaw.replace(/\D/g, "").length < 7) return setErr("Enter a valid phone number.");
    setLoading(true); setErr(null);
    const res = await createLead({ name: name.trim(), phone: fullPhone, email: email.trim() || undefined, description: details.trim() || undefined });
    setLoading(false);
    if (!res.ok) return setErr(res.error || "Could not create lead.");
    setDone(name.trim());
  };

  if (done) {
    return (
      <div className="card anim-scale-in p-8 rounded-2xl text-center max-w-[480px] mx-auto">
        <div className="w-14 h-14 rounded-full mx-auto flex items-center justify-center mb-4"
          style={{ background: "rgba(67,214,155,0.14)", color: "var(--mint)" }}><ICheck size={26} /></div>
        <h2 className="font-disp font-bold text-[20px] m-0">Lead received!</h2>
        <p className="text-[13px] text-[var(--ink-dim)] m-0 mt-2 leading-relaxed">
          <strong>{done}</strong> is now on your private referral list. The HFMC desk will call them shortly to qualify the mortgage — you&apos;ll see every stage update here.
        </p>
        <div className="flex flex-wrap justify-center gap-2.5 mt-5">
          <button className="btn btn-ghost btn-sm" onClick={() => { setDone(null); setName(""); setEmail(""); setPhone(""); setDetails(""); }}><IPlus size={14} /> Add another</button>
          <button className="btn btn-primary btn-sm" onClick={() => goto("leads")}><IBriefcase size={14} /> View my leads</button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[520px] mx-auto space-y-4">
      <div className="anim-fade-up">
        <h1 className="font-disp font-bold text-[20px] tracking-tight m-0">Add a new lead</h1>
        <p className="text-[12.5px] text-[var(--ink-faint)] m-0 mt-0.5">Please provide the following details</p>
      </div>

      <div className="card anim-fade-up p-5 rounded-2xl space-y-4">
        <div>
          <label className="label">Full name *</label>
          <input className="input" autoFocus placeholder="e.g. Mohammed Al Mansoori" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Your client&apos;s email</label>
          <input className="input" type="email" placeholder="client@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label">Your client&apos;s phone number *</label>
          <div className="flex items-stretch gap-0 rounded-xl overflow-hidden" style={{ border: "1px solid var(--line)", background: "var(--tint)" }}>
            <span className="flex items-center px-3.5 mono text-[13px]" style={{ background: "var(--bg2)", borderRight: "1px solid var(--line-soft)", color: "var(--ink-dim)" }}>+971</span>
            <input className="input !border-0 !bg-transparent mono flex-1" placeholder="50 123 4567" value={phone}
              onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
          </div>
        </div>
        <div>
          <label className="label">Give us more details <span className="text-[var(--ink-faint)] normal-case tracking-normal">· optional</span></label>
          <textarea className="textarea" rows={3} placeholder="Budget, ready vs off-plan, salaried or self-employed, area…" value={details} onChange={(e) => setDetails(e.target.value)} />
        </div>
        {err && (
          <p className="text-[12.5px] m-0 anim-fade-in flex items-center gap-1.5" style={{ color: "var(--coral)" }}><IAlert size={13} /> {err}</p>
        )}
        <button className="btn btn-primary w-full justify-center !py-2.5" onClick={submit} disabled={loading}>
          {loading ? "Submitting…" : "Continue"}
        </button>
        <p className="text-[11px] text-[var(--ink-faint)] text-center m-0">
          Ensure your client details are correct — leads are attributed to you by name &amp; number and are never visible to other agents.
        </p>
      </div>
      <p className="text-[10.5px] text-[var(--ink-faint)] text-center m-0">Referred by {me?.name} · HFMC {me?.kind}</p>
    </div>
  );
}

/* ================= MY LEADS ================= */

function LeadsTab({ goto }: { goto: (r: AgentRoute) => void }) {
  const { cases, stages } = useAgentStore();
  const [filter, setFilter] = useState<"All" | "Active" | "Closed" | "Lost">("All");
  const [openId, setOpenId] = useState<number | null>(null);

  const shown = cases.filter((c) => filter === "All" || c.caseStatus === filter);
  const counts = {
    All: cases.length,
    Active: cases.filter((c) => c.caseStatus === "Active").length,
    Closed: cases.filter((c) => c.caseStatus === "Closed").length,
    Lost: cases.filter((c) => c.caseStatus === "Lost").length,
  };

  if (cases.length === 0) {
    return (
      <div className="card anim-fade-up p-8 rounded-2xl text-center mt-6" style={{ borderStyle: "dashed", borderWidth: 1.5 }}>
        <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-3" style={{ background: "var(--amber-tint)", color: "var(--amber)" }}><IBriefcase size={24} /></div>
        <h3 className="font-disp font-bold text-[16px] m-0">Add your first mortgage lead</h3>
        <p className="text-[12.5px] text-[var(--ink-dim)] m-0 mt-1.5 max-w-[380px] mx-auto leading-relaxed">
          Partner mortgage referrals are protected — they are never accessible to any other agent.
        </p>
        <button className="btn btn-primary btn-sm mt-4" onClick={() => goto("addlead")}><IPlus size={14} /> Add lead</button>
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between flex-wrap gap-2 anim-fade-up">
        <h1 className="font-disp font-bold text-[20px] tracking-tight m-0">My leads</h1>
        <button className="btn btn-primary btn-sm" onClick={() => goto("addlead")}><IPlus size={14} /> Add</button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1 anim-fade-up">
        {(["All", "Active", "Closed", "Lost"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className="shrink-0 px-3 py-1.5 rounded-lg text-[11.5px] font-disp font-semibold transition-all"
            style={filter === f
              ? { background: "var(--amber-tint)", color: "var(--amber)", border: "1px solid color-mix(in srgb, var(--amber) 40%, var(--line))" }
              : { background: "var(--tint)", color: "var(--ink-faint)", border: "1px solid var(--line-soft)" }}>
            {f} · {counts[f]}
          </button>
        ))}
      </div>

      {shown.length === 0 && <p className="text-[12.5px] text-[var(--ink-faint)] text-center py-6 m-0">No {filter.toLowerCase()} leads yet.</p>}

      {shown.map((c) => {
        const open = openId === c.id;
        return (
          <div key={c.id} className="card anim-fade-up rounded-2xl overflow-hidden">
            <button className="w-full text-left px-4 py-3.5 flex items-center gap-3" onClick={() => setOpenId(open ? null : c.id)} style={{ cursor: "pointer" }}>
              <StatusDot c={c} />
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-medium m-0 truncate">{c.customer}</p>
                <p className="text-[11px] text-[var(--ink-faint)] m-0 mt-0.5 truncate">
                  <span className="mono">{c.caseNumber}</span> · {c.stage} · referred {ageDays(c.createdAt)}d ago
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="mono text-[12.5px] m-0">{fmtMoney(c.loanAmount)}</p>
                <p className="text-[10.5px] text-[var(--ink-faint)] m-0">est. <span className="mono" style={{ color: "var(--mint)" }}>{fmtMoney(c.commission.partnerCut)}</span></p>
              </div>
              <span className="text-[var(--ink-faint)] shrink-0"><IChevronish open={open} /></span>
            </button>
            {open && (
              <div className="px-4 pb-4 pt-1 space-y-2.5 anim-fade-in" style={{ borderTop: "1px dashed var(--line)" }}>
                <div className="grid grid-cols-2 gap-2 pt-2.5">
                  <Field label="Status" value={c.caseStatus === "Closed" ? `Booked · ${c.wonBank ?? "—"}` : c.caseStatus} />
                  <Field label="Your share" value={`${c.partner?.sharePct ?? 0}% of bank commission`} />
                  <Field label="Bank commission" value={`${c.commission.ratePct}% · ${fmtMoney(c.commission.gross)}`} />
                  <Field label="Your est. commission" value={fmtMoney(c.commission.partnerCut)} highlight />
                </div>
                {c.statusNote && (
                  <div className="rounded-xl px-3 py-2.5" style={{ background: "var(--tint)" }}>
                    <div className="text-[10.5px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)] mb-0.5">Latest update</div>
                    <p className="text-[12px] text-[var(--ink-dim)] m-0 leading-relaxed whitespace-pre-wrap">{c.statusNote}</p>
                    <p className="text-[10.5px] text-[var(--ink-faint)] m-0 mt-1">{relTime(c.updatedAt)}</p>
                  </div>
                )}
                <div className="flex flex-wrap gap-1">
                  {stages.map((s) => {
                    const idx = stages.findIndex((x) => x.label === c.stage);
                    const reached = idx >= 0 && stages.indexOf(s) <= idx;
                    const current = s.label === c.stage;
                    return (
                      <span key={s.id} className="chip !py-0.5 text-[10.5px]"
                        style={current
                          ? { background: "rgba(242,176,76,0.16)", borderColor: "var(--amber)", color: "var(--amber)" }
                          : reached
                            ? { background: "rgba(67,214,155,0.1)", borderColor: "color-mix(in srgb, var(--mint) 40%, var(--line))", color: "var(--mint)" }
                            : { background: "var(--bg2)", borderColor: "var(--line-soft)", color: "var(--ink-faint)" }}>
                        {s.label}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function IChevronish({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 160ms" }}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)]">{label}</div>
      <div className="text-[12.5px] mt-0.5" style={{ color: highlight ? "var(--mint)" : "var(--ink)", fontWeight: highlight ? 700 : 500 }}>{value}</div>
    </div>
  );
}

/* ================= TOOLS ================= */

function ToolsTab() {
  const [tool, setTool] = useState<"calc" | "rentbuy" | "rates" | "commission">("calc");
  const items = [
    { id: "calc" as const, title: "Mortgage Calculator", sub: "Quick eligibility on UAE universal rules" },
    { id: "rentbuy" as const, title: "Rent vs Buy", sub: "Show buyers buying vs renting, monthly" },
    { id: "rates" as const, title: "Live Mortgage Rates", sub: "EIBOR curve + each bank's current best" },
    { id: "commission" as const, title: "Commission rates", sub: "Indicative commission by bank" },
  ];
  return (
    <div className="space-y-4">
      <h1 className="font-disp font-bold text-[20px] tracking-tight m-0 anim-fade-up">Tools</h1>

      {/* tool cards — tap to open */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 anim-fade-up">
        {items.map((t) => (
          <button key={t.id} className="card p-4 rounded-2xl text-left transition-all hover:-translate-y-0.5"
            style={{ cursor: "pointer", ...(tool === t.id ? { borderColor: "var(--amber)", background: "linear-gradient(135deg, color-mix(in srgb, var(--amber) 10%, var(--raised)), var(--raised))" } : {}) }}
            onClick={() => setTool(t.id)}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-[13.5px] font-disp font-semibold">{t.title}</div>
              <span className="text-[var(--ink-faint)]"><IChevronish open={tool === t.id} /></span>
            </div>
            <div className="text-[11px] text-[var(--ink-faint)] mt-1">{t.sub}</div>
          </button>
        ))}
      </div>

      <div className="anim-fade-up">
        {tool === "calc" && <MortgageCalc />}
        {tool === "rentbuy" && <RentVsBuy />}
        {tool === "rates" && <RatesTable />}
        {tool === "commission" && <CommissionTable />}
      </div>
    </div>
  );
}

/* ---- slider primitives ---- */

const SLIDER_CSS = `
input[type="range"].arange { -webkit-appearance: none; appearance: none; width: 100%; height: 22px; background: transparent; cursor: pointer; }
input[type="range"].arange::-webkit-slider-runnable-track { height: 5px; border-radius: 999px; background: var(--track); }
input[type="range"].arange::-webkit-slider-thumb { -webkit-appearance: none; width: 17px; height: 17px; border-radius: 50%; background: var(--amber); border: 2.5px solid var(--raised); box-shadow: 0 1px 5px rgba(0,0,0,0.25); margin-top: -6px; }
input[type="range"].arange::-moz-range-track { height: 5px; border-radius: 999px; background: var(--track); }
input[type="range"].arange::-moz-range-thumb { width: 13px; height: 13px; border-radius: 50%; background: var(--amber); border: 2.5px solid var(--raised); box-shadow: 0 1px 5px rgba(0,0,0,0.25); }
`;

function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(Math.abs(n) % 1_000_000 ? 1 : 0).replace(/\.0$/, "")}M`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(Math.round(n));
}

function Slider({ label, value, min, max, step, onChange, format, hint }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format: (v: number) => string; hint?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-0.5">
        <label className="label !mb-0">{label}</label>
        <span className="mono text-[12.5px] font-semibold" style={{ color: "var(--amber)" }}>{format(value)}</span>
      </div>
      <input type="range" className="arange" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <p className="text-[10.5px] text-[var(--ink-faint)] m-0 -mt-1">{hint}</p>}
    </div>
  );
}

function SegGroup<T extends string>({ label, value, opts, onChange }: {
  label: string; value: T; opts: readonly T[]; onChange: (v: T) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <Tabs
        className="flex-wrap"
        value={value}
        onChange={onChange}
        options={opts.map((o) => ({ value: o, label: o }))}
      />
    </div>
  );
}

/* ---- mortgage calculator (UAE universal rules, sliders) ---- */

function MortgageCalc() {
  const [residency, setResidency] = useState<Residency>("Resident Expatriate");
  const [property, setProperty] = useState<PropertyCount>("First property");
  const [txn, setTxn] = useState<TxnType>("Ready / Resale");
  const [emirate, setEmirate] = useState<Emirate>("Dubai");
  const [employment, setEmployment] = useState<"Salaried" | "Self-Employed">("Salaried");

  const [income, setIncome] = useState(30_000);
  const [emis, setEmis] = useState(0);
  const [cards, setCards] = useState(0);
  const [age, setAge] = useState(32);
  const [rate, setRate] = useState(3.99);
  const [price, setPrice] = useState(1_500_000);

  const tenorMax = maxTenorYears(age, employment);
  const [tenorReq, setTenorReq] = useState(25);
  const tenor = Math.min(tenorReq, Math.max(1, tenorMax));

  const ltv = ltvCap(residency, property, txn, price);
  const affordable = eligibleEmi(income, emis, cards);
  const maxLoan = maxLoanFor(affordable, rate, tenor);
  const priceLoan = Math.round((price * ltv) / 100);
  const priceEmi = emiOf(priceLoan, rate, tenor);
  const overBudget = priceEmi > affordable;
  const dbrUsed = income > 0 ? Math.min(100, Math.round(((priceEmi + emis + (cards * CBUAE.cardRepayPct) / 100) / income) * 100)) : 0;
  const cash = cashToClose(price, priceLoan, emirate);
  const budget = Math.round(maxLoan / (ltv / 100));

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {/* inputs */}
      <div className="card p-5 rounded-2xl space-y-4">
        <h3 className="font-disp font-semibold text-[13px] m-0">Client &amp; property</h3>
        <SegGroup label="Nationality" value={residency} opts={["UAE National", "Resident Expatriate", "Non-Resident"] as const} onChange={setResidency} />
        <SegGroup label="Property" value={property} opts={["First property", "Second property"] as const} onChange={setProperty} />
        <SegGroup label="Transaction" value={txn} opts={["Ready / Resale", "Off-plan", "Buyout + equity release", "Land / self-build"] as const} onChange={setTxn} />
        <div className="grid grid-cols-2 gap-3">
          <SegGroup label="Emirate" value={emirate} opts={["Dubai", "Abu Dhabi", "Other emirates"] as const} onChange={setEmirate} />
          <SegGroup label="Employment" value={employment} opts={["Salaried", "Self-Employed"] as const} onChange={setEmployment} />
        </div>
        <Slider label="Monthly income" value={income} min={5000} max={200000} step={1000} onChange={setIncome} format={(v) => fmtMoney(v)} />
        <Slider label="Existing monthly EMIs" value={emis} min={0} max={60000} step={500} onChange={setEmis} format={(v) => fmtMoney(v)} />
        <Slider label="Credit-card limits (total)" value={cards} min={0} max={500000} step={5000} onChange={setCards} format={(v) => fmtMoney(v)}
          hint="Banks count 5% of card limits as a monthly repayment (CBUAE rule)." />
        <div>
          <div className="flex items-baseline justify-between mb-0.5">
            <label className="label !mb-0">Client&apos;s age</label>
            <span className="mono text-[12.5px] font-semibold" style={{ color: "var(--amber)" }}>{age}</span>
          </div>
          <input type="range" className="arange" min={21} max={65} step={1} value={age} onChange={(e) => setAge(Number(e.target.value))} />
          <p className="text-[10.5px] text-[var(--ink-faint)] m-0 -mt-1">
            Tenure is capped at {CBUAE.maxTenorYears}y and by age at loan maturity ({employment === "Salaried" ? CBUAE.maturityAgeSalaried : CBUAE.maturityAgeSelfEmp} for {employment === "Salaried" ? "salaried" : "self-employed"}).
          </p>
        </div>
        <Slider label="Interest rate" value={rate} min={2.49} max={8.99} step={0.05} onChange={setRate} format={(v) => `${v.toFixed(2)}%`} />
        <Slider label="Tenure" value={tenor} min={1} max={Math.max(1, tenorMax)} step={1} onChange={setTenorReq} format={(v) => `${v} years`}
          hint={tenorMax < 25 ? `Capped at ${tenorMax}y by age ${age} at maturity.` : undefined} />
        <Slider label="Property price" value={price} min={300000} max={20000000} step={50000} onChange={setPrice} format={(v) => fmtMoney(v)} />
      </div>

      {/* results */}
      <div className="space-y-4">
        {tenorMax <= 0 ? (
          <div className="card p-5 rounded-2xl anim-fade-up" style={{ borderColor: "var(--coral)" }}>
            <p className="text-[13px] m-0 flex items-center gap-2" style={{ color: "var(--coral)" }}><IAlert size={15} /> Age {age} is beyond the maturity cap — no tenure is possible at this age.</p>
          </div>
        ) : (
          <>
            <div className="card p-5 rounded-2xl anim-fade-up" style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--amber) 12%, var(--raised)), var(--raised))", borderColor: "color-mix(in srgb, var(--amber) 35%, var(--line))" }}>
              <div className="text-[10.5px] uppercase tracking-[0.12em] font-disp font-semibold text-[var(--ink-faint)]">Indicative max finance</div>
              <div className="font-disp font-bold text-[26px] mt-0.5" style={{ color: "var(--amber)" }}>{fmtMoney(Math.round(maxLoan))}</div>
              <div className="text-[11.5px] text-[var(--ink-dim)] mt-1">
                {affordable > 0
                  ? <>affordable EMI {fmtMoney(Math.round(affordable))}/mo at {rate.toFixed(2)}% × {tenor}y → property budget ≈ <strong>{fmtMoney(budget)}</strong> at {ltv}% LTV</>
                  : <>existing commitments already use the full 50% DBR ceiling — no headroom</>}
              </div>
            </div>

            <div className="card p-5 rounded-2xl anim-fade-up space-y-3">
              <div className="flex items-baseline justify-between">
                <h3 className="font-disp font-semibold text-[13px] m-0">For the {fmtMoney(price)} property</h3>
                <span className="chip !py-0.5 text-[10.5px]" style={{ background: "var(--tint)", color: "var(--ink-dim)" }}>{ltv}% LTV</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Down payment" value={fmtMoney(Math.round(cash.downPayment))} />
                <Field label="Loan amount" value={fmtMoney(priceLoan)} />
                <Field label="Monthly EMI" value={`${fmtMoney(Math.round(priceEmi))}/mo`} highlight={!overBudget} />
                <Field label="Est. cash to close" value={fmtMoney(Math.round(cash.total))} />
              </div>
              <div>
                <div className="flex justify-between text-[10.5px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)] mb-1">
                  <span>DBR used {dbrUsed}% · cap {CBUAE.dbrPct}%</span>
                  <span>{overBudget ? "over" : "within"} limit</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--track)" }}>
                  <div className="h-full rounded-full transition-all duration-500" style={{
                    width: `${Math.max(2, dbrUsed)}%`,
                    background: dbrUsed > CBUAE.dbrPct ? "var(--coral)" : "linear-gradient(90deg, var(--mint), #2aa77a)",
                  }} />
                </div>
                {overBudget
                  ? <p className="text-[11.5px] m-0 mt-2" style={{ color: "var(--coral)" }}>EMI exceeds the client&apos;s affordable {fmtMoney(Math.round(affordable))}/mo — lower the price, extend tenure or reduce commitments.</p>
                  : <p className="text-[11.5px] text-[var(--ink-dim)] m-0 mt-2">This property fits the client&apos;s eligibility. Cash to close includes {emirate === "Dubai" ? "4%" : "2%"} DLD fee, 0.25% mortgage registration, 2% agency &amp; valuation.</p>}
              </div>
            </div>

            <p className="text-[10.5px] text-[var(--ink-faint)] m-0 leading-relaxed">{RULES_FOOTNOTE}</p>
          </>
        )}
      </div>
    </div>
  );
}

/* ---- rent vs buy ---- */

function RentVsBuy() {
  const [rent, setRent] = useState(6_500);
  const [price, setPrice] = useState(1_200_000);
  const [rate, setRate] = useState(3.99);
  const [tenor, setTenor] = useState(25);
  const [residency, setResidency] = useState<Residency>("Resident Expatriate");

  const ltv = ltvCap(residency, "First property", "Ready / Resale", price);
  const loan = Math.round((price * ltv) / 100);
  const emi = emiOf(loan, rate, tenor);
  const buy = cashToClose(price, loan, "Dubai");
  const diff = emi - rent;
  const rentYear = rent * 12;
  const buyYear = emi * 12;

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="card p-5 rounded-2xl space-y-4">
        <h3 className="font-disp font-semibold text-[13px] m-0">Compare for your client</h3>
        <SegGroup label="Nationality" value={residency} opts={["UAE National", "Resident Expatriate", "Non-Resident"] as const} onChange={setResidency} />
        <Slider label="Current / offered rent" value={rent} min={2000} max={80000} step={250} onChange={setRent} format={(v) => `${fmtMoney(v)}/mo`} />
        <Slider label="Property price to buy" value={price} min={300000} max={20000000} step={50000} onChange={setPrice} format={(v) => fmtMoney(v)} />
        <Slider label="Interest rate" value={rate} min={2.49} max={8.99} step={0.05} onChange={setRate} format={(v) => `${v.toFixed(2)}%`} />
        <Slider label="Tenure" value={tenor} min={5} max={25} step={1} onChange={setTenor} format={(v) => `${v} years`} />
      </div>

      <div className="space-y-4">
        <div className="card p-5 rounded-2xl anim-fade-up" style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--amber) 12%, var(--raised)), var(--raised))", borderColor: "color-mix(in srgb, var(--amber) 35%, var(--line))" }}>
          <div className="flex items-stretch justify-between gap-3 text-center">
            <div className="flex-1">
              <div className="text-[10.5px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)]">Buy (EMI)</div>
              <div className="font-disp font-bold text-[21px] mt-0.5" style={{ color: "var(--amber)" }}>{fmtMoney(Math.round(emi))}</div>
              <div className="text-[10.5px] text-[var(--ink-faint)]">per month · {ltv}% LTV</div>
            </div>
            <div className="w-px" style={{ background: "var(--line)" }} />
            <div className="flex-1">
              <div className="text-[10.5px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)]">Rent</div>
              <div className="font-disp font-bold text-[21px] mt-0.5">{fmtMoney(rent)}</div>
              <div className="text-[10.5px] text-[var(--ink-faint)]">per month · 1–4 cheques</div>
            </div>
          </div>
          <p className="text-[12px] m-0 mt-3 text-center leading-relaxed" style={{ color: diff > 0 ? "var(--coral)" : "var(--mint)" }}>
            {diff > 0
              ? <>Buying costs ≈ <strong>{fmtMoney(Math.round(diff))}/mo more</strong> than renting — but every payment builds equity in an asset.</>
              : <>Buying is ≈ <strong>{fmtMoney(Math.round(-diff))}/mo cheaper</strong> than renting this property — and builds equity.</>}
          </p>
        </div>

        <div className="card p-5 rounded-2xl anim-fade-up space-y-3">
          <h3 className="font-disp font-semibold text-[13px] m-0">Year-one &amp; upfront</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rent, 12 months" value={fmtMoney(rentYear)} />
            <Field label="Buy, 12 EMIs" value={fmtMoney(buyYear)} />
            <Field label="Upfront to buy (cash to close)" value={fmtMoney(Math.round(buy.total))} />
            <Field label="Upfront to rent (deposit + agency)" value={fmtMoney(Math.round(rent * 1.1 + price * 0.02))} />
          </div>
          <p className="text-[11.5px] text-[var(--ink-dim)] m-0 leading-relaxed">
            Renting stays flexible; buying locks the payment for {tenor} years at {rate.toFixed(2)}% and ends with a fully-owned asset. Many buyers start with a smaller unit and rent it out later.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---- live rates ---- */

function RatesTable() {
  const [data, setData] = useState<{
    eibor: { tenor: string; ratePct: number | null; updatedOn: string }[];
    rows: { bank: string; fixedFrom: number | null; variableFrom: number | null }[];
    asOf: string;
  } | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    fetch("/api/agent/rates", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData).catch(() => setErr(true));
  }, []);

  if (err) return <div className="card p-5 rounded-2xl anim-fade-up"><p className="text-[12.5px] m-0" style={{ color: "var(--coral)" }}>Could not load rates — try again in a moment.</p></div>;
  if (!data) return <div className="card p-8 rounded-2xl anim-fade-up flex justify-center"><div className="w-7 h-7 rounded-full border-2 border-[var(--amber)] border-t-transparent animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="card p-5 rounded-2xl anim-fade-up">
        <div className="flex items-baseline justify-between flex-wrap gap-1 mb-3">
          <h3 className="font-disp font-semibold text-[13px] m-0">EIBOR benchmark (central bank)</h3>
          <span className="mono text-[10.5px] text-[var(--ink-faint)]">as of {data.asOf}</span>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {data.eibor.map((e) => (
            <div key={e.tenor} className="rounded-xl px-3 py-2.5 text-center" style={{ background: "var(--tint)", border: "1px solid var(--line-soft)" }}>
              <div className="text-[10.5px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)]">{e.tenor}</div>
              <div className="mono text-[14px] font-semibold mt-0.5">{e.ratePct != null ? `${e.ratePct.toFixed(2)}%` : "—"}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card rounded-2xl anim-fade-up overflow-hidden">
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
          <h3 className="font-disp font-semibold text-[13px] m-0">Bank rates — current &quot;from&quot; figures</h3>
          <p className="text-[11px] text-[var(--ink-faint)] m-0 mt-0.5">Lowest live rate across each bank&apos;s approved products. Variable = margin + 1M EIBOR.</p>
        </div>
        {data.rows.length === 0 ? (
          <p className="px-4 py-5 text-[12.5px] text-[var(--ink-faint)] m-0">No approved bank pricing filed yet.</p>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--line-soft)" }}>
            {data.rows.map((r, i) => (
              <div key={r.bank} className="px-4 py-3 flex items-center gap-3">
                <span className="mono text-[11px] w-5 text-center shrink-0" style={{ color: i < 3 ? "var(--amber)" : "var(--ink-faint)" }}>{i + 1}</span>
                <div className="flex-1 min-w-0 text-[13px] font-medium truncate">{r.bank}</div>
                <div className="text-right shrink-0 w-24">
                  <div className="mono text-[13px]" style={{ color: "var(--amber)" }}>{r.fixedFrom != null ? `${r.fixedFrom.toFixed(2)}%` : "—"}</div>
                  <div className="text-[10.5px] text-[var(--ink-faint)] uppercase tracking-wide">fixed from</div>
                </div>
                <div className="text-right shrink-0 w-24">
                  <div className="mono text-[13px]" style={{ color: "var(--sky)" }}>{r.variableFrom != null ? `${r.variableFrom.toFixed(2)}%` : "—"}</div>
                  <div className="text-[10.5px] text-[var(--ink-faint)] uppercase tracking-wide">variable from</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="text-[10.5px] text-[var(--ink-faint)] m-0">Indicative &quot;from&quot; rates for client conversations — final pricing depends on the client profile, property and bank policy.</p>
    </div>
  );
}

/* ---- commission table ---- */

function CommissionTable() {
  const { banks, profile } = useAgentStore();
  const sharePct = profile?.sharePct ?? 20;
  return (
    <div className="space-y-4">
      <div className="card p-5 rounded-2xl anim-fade-up" style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--mint) 12%, var(--raised)), var(--raised))", borderColor: "color-mix(in srgb, var(--mint) 35%, var(--line))" }}>
        <div className="text-[10.5px] uppercase tracking-[0.12em] font-disp font-semibold text-[var(--ink-faint)]">Your referral rate</div>
        <div className="font-disp font-bold text-[24px] mt-0.5" style={{ color: "var(--mint)" }}>{sharePct}% of HFMC&apos;s commission</div>
        <div className="text-[11.5px] text-[var(--ink-dim)] mt-1">on every referred deal that books — paid within 24 hours of the payout clearing.</div>
      </div>
      <div className="card rounded-2xl anim-fade-up overflow-hidden">
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
          <h3 className="font-disp font-semibold text-[13px] m-0">Indicative commission by bank</h3>
          <p className="text-[11px] text-[var(--ink-faint)] m-0 mt-0.5">Standard bank-side commission — final terms vary by deal and promotion.</p>
        </div>
        <div className="divide-y" style={{ borderColor: "var(--line-soft)" }}>
          {banks.map((b) => (
            <div key={b.name} className="px-4 py-2.5 flex items-center justify-between gap-3">
              <span className="text-[13px] font-medium truncate">{b.name}</span>
              <span className="mono text-[12.5px]" style={{ color: "var(--amber)" }}>{b.ratePct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ================= PROFILE ================= */

function ProfileTab() {
  const { me, profile, saveProfile, changePassword, deleteAccount, logout, hydrate } = useAgentStore();
  const p: AgentProfile | null = profile;
  const [form, setForm] = useState(() => ({
    email: p?.email ?? "", phone: p?.phone ?? "", about: p?.about ?? "", expertise: p?.expertise ?? "",
    iban: p?.iban ?? "", licenseNo: p?.licenseNo ?? "",
  }));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [delPwd, setDelPwd] = useState("");
  const [delErr, setDelErr] = useState<string | null>(null);
  const [delBusy, setDelBusy] = useState(false);

  // form initializes straight from the store profile — hydrate() always lands
  // the full payload (me + profile together) before this tab mounts.

  const up = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    setSaving(true); setMsg(null);
    const res = await saveProfile(form);
    setSaving(false);
    setMsg(res.ok ? { kind: "ok", text: "Profile saved." } : { kind: "err", text: res.error || "Save failed." });
    if (res.ok) setTimeout(() => setMsg(null), 2500);
  };

  const onAvatar = (file: File) => {
    setUploading(true);
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement("canvas");
      canvas.width = 256; canvas.height = 256;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
        saveProfile({ avatarData: canvas.toDataURL("image/jpeg", 0.85) }).then(() => { setUploading(false); URL.revokeObjectURL(url); });
      } else { setUploading(false); URL.revokeObjectURL(url); }
    };
    img.onerror = () => { setUploading(false); URL.revokeObjectURL(url); };
    img.src = url;
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(`${window.location.origin}/agent`); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ }
  };

  if (!me || !p) return null;

  return (
    <div className="max-w-[560px] mx-auto space-y-4">
      <h1 className="font-disp font-bold text-[20px] tracking-tight m-0 anim-fade-up">Profile</h1>

      {/* identity card */}
      <div className="card p-5 rounded-2xl anim-fade-up flex items-center gap-4">
        <div className="relative shrink-0">
          <div className="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center font-disp font-bold text-[18px]"
            style={p.avatarData ? { background: "var(--tint)" } : { background: "linear-gradient(135deg, var(--amber), #d99a3d)", color: "#2b1c05" }}>
            {p.avatarData
              ? <img src={p.avatarData} alt="avatar" className="w-full h-full object-cover" />
              : me.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
          </div>
          <label className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center cursor-pointer"
            style={{ background: "var(--amber)", color: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.3)" }}>
            {uploading ? <span className="w-3 h-3 rounded-full border-[1.5px] border-white border-t-transparent animate-spin inline-block" /> : <IUpload size={11} />}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onAvatar(f); }} />
          </label>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-medium leading-tight">{me.name}</div>
          <div className="text-[11px] text-[var(--ink-faint)] mt-0.5">{me.kind} · earns {p.sharePct}% of commission</div>
          {p.expertise && <div className="text-[11px] mt-0.5" style={{ color: "var(--amber)" }}>{p.expertise}</div>}
        </div>
      </div>
      <p className="text-[10.5px] text-[var(--ink-faint)] text-center m-0 -mt-2">Upload profile picture · minimum 96×96px, max 256×256px (auto-resized)</p>

      {/* basic information */}
      <ProfileCard title="Basic information">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <PF label="Full name"><input className="input" value={me.name} disabled /></PF>
          <PF label="Email"><input className="input" type="email" placeholder="you@company.com" value={form.email} onChange={(e) => up({ email: e.target.value })} /></PF>
          <PF label="Phone number"><input className="input mono" placeholder="+971 50 123 4567" value={form.phone} onChange={(e) => up({ phone: e.target.value })} /></PF>
          <PF label="Area of expertise"><input className="input" placeholder="e.g. Dubai Marina · off-plan" value={form.expertise} onChange={(e) => up({ expertise: e.target.value })} /></PF>
        </div>
        <PF label="Give us more details (optional)">
          <textarea className="textarea" rows={2} placeholder="Anything the HFMC desk should know about your pipeline…" value={form.about} onChange={(e) => up({ about: e.target.value })} />
        </PF>
      </ProfileCard>

      {/* IBAN verification */}
      <ProfileCard title="IBAN verification" right={
        <span className="chip !py-0.5 text-[10.5px]" style={p.ibanVerified
          ? { background: "rgba(67,214,155,0.12)", borderColor: "var(--mint)", color: "var(--mint)" }
          : { background: "rgba(242,176,76,0.12)", borderColor: "var(--amber)", color: "var(--amber)" }}>
          {p.ibanVerified ? "verified ✓" : p.iban ? "under review" : "not submitted"}
        </span>}>
        <PF label="Payout IBAN (AE)">
          <input className="input mono" placeholder="AE00 0000 0000 0000 0000 000" value={form.iban} onChange={(e) => up({ iban: e.target.value })} />
        </PF>
        <p className="text-[10.5px] text-[var(--ink-faint)] m-0">Commission is paid here within 24 hours of booking. Changing the IBAN restarts verification by the HFMC finance team.</p>
      </ProfileCard>

      {/* broker licence */}
      <ProfileCard title="Update broker licence" right={
        <span className="chip !py-0.5 text-[10.5px]" style={p.licenseVerified
          ? { background: "rgba(67,214,155,0.12)", borderColor: "var(--mint)", color: "var(--mint)" }
          : { background: "rgba(242,176,76,0.12)", borderColor: "var(--amber)", color: "var(--amber)" }}>
          {p.licenseVerified ? "verified ✓" : p.licenseNo ? "under review" : "not submitted"}
        </span>}>
        <PF label="RERA broker card / licence no.">
          <input className="input mono" placeholder="e.g. 1234567" value={form.licenseNo} onChange={(e) => up({ licenseNo: e.target.value })} />
        </PF>
      </ProfileCard>

      <button className="btn btn-primary w-full justify-center" onClick={save} disabled={saving}>
        <ICheck size={15} /> {saving ? "Saving…" : "Submit profile changes"}
      </button>
      {msg && <p className="text-[12px] text-center m-0 anim-fade-in" style={{ color: msg.kind === "ok" ? "var(--mint)" : "var(--coral)" }}>{msg.text}</p>}

      {/* change password */}
      <PasswordCard onChange={changePassword} />

      {/* referral + feedback */}
      <ProfileCard title="Share & feedback">
        <div className="flex items-center gap-2">
          <input className="input mono !text-[11.5px] flex-1" readOnly value={`${typeof window !== "undefined" ? window.location.origin : ""}/agent`} onFocus={(e) => e.currentTarget.select()} />
          <button className="btn btn-ghost btn-sm shrink-0" onClick={copyLink}>{copied ? <ICheck size={13} /> : "Copy"}</button>
        </div>
        <p className="text-[10.5px] text-[var(--ink-faint)] m-0">Invite a fellow agent — every partner keeps their own protected leads.</p>
        <a className="text-[12px] m-0 inline-flex items-center gap-1.5" style={{ color: "var(--sky)" }}
          href="mailto:feedback?subject=HFMC%20agent%20portal%20feedback" onClick={(e) => { e.preventDefault(); window.location.href = "mailto:feedback@hfmc.ae?subject=HFMC%20agent%20portal%20feedback"; }}>
          <ITarget size={13} /> Submit feedback about the portal
        </a>
      </ProfileCard>

      {/* danger zone */}
      <div className="card p-5 rounded-2xl anim-fade-up" style={{ borderColor: "color-mix(in srgb, var(--coral) 40%, var(--line))" }}>
        <h4 className="text-[12px] font-disp font-semibold m-0 mb-1" style={{ color: "var(--coral)" }}>Delete the account</h4>
        <p className="text-[11.5px] text-[var(--ink-faint)] m-0 mb-3">Removes your portal access. Your referred cases and commission history stay with the HFMC team.</p>
        {!showDelete ? (
          <button className="btn btn-ghost btn-sm" style={{ color: "var(--coral)" }} onClick={() => setShowDelete(true)}>Delete account…</button>
        ) : (
          <div className="space-y-2 anim-fade-in">
            <input className="input" type="password" placeholder="Confirm your password" value={delPwd} onChange={(e) => setDelPwd(e.target.value)} />
            {delErr && <p className="text-[12px] m-0" style={{ color: "var(--coral)" }}>{delErr}</p>}
            <div className="flex gap-2">
              <button className="btn btn-ghost btn-sm" onClick={() => { setShowDelete(false); setDelPwd(""); setDelErr(null); }}>Cancel</button>
              <button className="btn btn-sm" style={{ background: "var(--coral)", color: "#fff" }} disabled={delBusy}
                onClick={async () => {
                  setDelBusy(true); setDelErr(null);
                  const res = await deleteAccount(delPwd);
                  if (res.ok) { await hydrate(); window.location.reload(); }
                  else { setDelErr(res.error || "Failed."); setDelBusy(false); }
                }}>
                {delBusy ? "Deleting…" : "Permanently delete"}
              </button>
            </div>
          </div>
        )}
      </div>

      <button className="btn btn-ghost w-full justify-center" style={{ color: "var(--coral)" }} onClick={logout}>
        <ILogout size={15} /> Log out
      </button>
      <p className="text-[10.5px] text-[var(--ink-faint)] text-center m-0">HFMC Mortgage · UAE · {me.kind} portal</p>
    </div>
  );
}

function ProfileCard({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card p-5 rounded-2xl anim-fade-up">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h4 className="text-[12px] font-disp font-semibold m-0 uppercase tracking-[0.08em] text-[var(--ink-faint)]">{title}</h4>
        {right}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function PF({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function PasswordCard({ onChange }: { onChange: (current: string, next: string) => Promise<{ ok: boolean; error?: string }> }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!current || !next) return setMsg({ kind: "err", text: "Fill in both fields." });
    if (next !== confirm) return setMsg({ kind: "err", text: "New passwords don't match." });
    setBusy(true); setMsg(null);
    const res = await onChange(current, next);
    setBusy(false);
    if (res.ok) { setMsg({ kind: "ok", text: "Password changed." }); setCurrent(""); setNext(""); setConfirm(""); setTimeout(() => setMsg(null), 2500); }
    else setMsg({ kind: "err", text: res.error || "Failed." });
  };

  return (
    <ProfileCard title="Change password">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <PF label="Current"><input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} /></PF>
        <PF label="New"><input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} /></PF>
        <PF label="Confirm new"><input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></PF>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <button className="btn btn-ghost btn-sm" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Update password"}</button>
        {msg && <span className="text-[12px]" style={{ color: msg.kind === "ok" ? "var(--mint)" : "var(--coral)" }}>{msg.text}</span>}
      </div>
    </ProfileCard>
  );
}
