"use client";

import { useEffect, useRef, useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import { TONE_HEX } from "@/lib/format";
import { BarList, useCountUp } from "@/components/hfmc/charts";
import { LogoMark } from "@/components/icons";
import { ThemeToggle } from "@/components/hfmc/ui";

const DEMOS = [
  { email: "super@meridian.ae", pw: "super123", label: "Super Admin", sub: "platform owner · above HoC" },
  { email: "head@meridian.ae", pw: "admin123", label: "Head of Company", sub: "supreme · issues tasks" },
  { email: "pa@meridian.ae", pw: "demo123", label: "PA to HoC", sub: "issues tasks" },
  { email: "omar@meridian.ae", pw: "demo123", label: "Mortgage Head", sub: "issues & delegates" },
  { email: "imran@meridian.ae", pw: "demo123", label: "Team Leader SPO", sub: "Dubai team · also acts as SPO" },
  { email: "aisha@meridian.ae", pw: "demo123", label: "SPO", sub: "own book only" },
  { email: "fatima@meridian.ae", pw: "demo123", label: "Team Leader VRM", sub: "Abu Dhabi · acts as VRM" },
];

export default function Login() {
  const { cases, tasks, banks, whyPending, hydrate, toast } = useHfmcStore();
  const booted = useRef(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  useEffect(() => { if (!booted.current) { booted.current = true; hydrate(); } }, [hydrate]);

  const active = cases.filter((c) => c.caseStatus === "Active");
  const booked = cases.filter((c) => c.caseStatus === "Closed");
  const bookedValue = booked.reduce((s, c) => s + c.loanAmount, 0);
  const openTasks = tasks.filter((t) => t.status === "Open");
  const nCases = useCountUp(active.length, 900);
  const nValue = useCountUp(Math.round(bookedValue / 1e6), 1100);

  const whyRows = whyPending
    .map((w) => ({ label: w.label, value: openTasks.filter((t) => t.whyPending === w.label).length, color: TONE_HEX.amber }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const login = async () => {
    if (!email.trim() || !password) {
      setErr("Enter your email and password.");
      setShake(true); window.setTimeout(() => setShake(false), 550);
      return;
    }
    const res = await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setErr(e.error || "Could not sign in.");
      setShake(true); window.setTimeout(() => setShake(false), 550);
      return;
    }
    // Set `me` immediately from the login response so the UI switches to the
    // Shell. The cookie is in the jar, but a mount-time hydrate may still be
    // racing — the store's 401 handler preserves `me`, so we retry hydrate
    // until the workspace loads. No page reload (the reload races the cookie).
    const { user } = await res.json();
    useHfmcStore.setState({ me: user, loaded: true });
    toast("success", "Signed in. The pipeline is live.");
    for (let attempt = 0; attempt < 6; attempt++) {
      await hydrate();
      if (useHfmcStore.getState().cases.length > 0) break;
      await new Promise((r) => setTimeout(r, 150));
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr]">
      <div className="app-bg" />
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle compact />
      </div>

      <div className="hidden lg:flex flex-col justify-center px-14 py-12 border-r relative overflow-hidden" style={{ borderColor: "var(--line-soft)" }}>
        <div className="flex items-center gap-3 mb-10">
          <LogoMark size={38} />
          <div>
            <div className="font-disp font-bold text-[20px] tracking-[0.04em] leading-none">HFMC</div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-faint)] mt-1">Mortgage Case Tracker · UAE</div>
          </div>
        </div>
        <p className="text-[12px] uppercase tracking-[0.16em] text-[var(--amber)] font-disp font-semibold mb-3 flex items-center gap-2">
          <span className="dot-live" /> Live book — right now
        </p>
        <h2 className="font-disp font-bold text-[44px] leading-[1.05] tracking-tight m-0">
          {nCases} cases in flight<br />across <span style={{ color: "var(--amber)" }}>{banks.length} UAE banks</span>
        </h2>
        <p className="text-[14px] text-[var(--ink-dim)] mt-4 mb-0 max-w-[420px]">
          {booked.length} booked files worth <strong className="text-[var(--ink)]">AED {nValue}M</strong> — tracked stage by stage, task by task.
        </p>
        <div className="mt-10 max-w-[420px]">
          <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--ink-faint)] font-disp font-semibold mb-3">Why the pipeline is pending</div>
          {whyRows.length ? <BarList items={whyRows} /> : <p className="text-[12.5px] text-[var(--ink-faint)] m-0">No open tasks.</p>}
        </div>
        <div className="mt-10 flex items-center gap-2 text-[11.5px] text-[var(--ink-faint)]">
          <span className="mono">partner desks</span>
          <span className="opacity-40">·</span>
          <span>{banks.length} UAE banks · commission & rates visible to permitted roles only</span>
        </div>
      </div>

      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[400px] anim-fade-up">
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <LogoMark size={30} />
            <div>
              <div className="font-disp font-bold text-[15px] tracking-[0.04em] leading-none">HFMC</div>
              <div className="text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)] mt-0.5">Mortgage Case Tracker · UAE</div>
            </div>
          </div>
          <h1 className="font-disp font-bold text-[26px] tracking-tight mt-0 mb-1">Sign in</h1>
          <p className="text-[13px] text-[var(--ink-dim)] mt-0 mb-6">The shared pipeline for the whole floor — log in from any device.</p>
          <div className={shake ? "anim-shake" : ""}>
            <label className="label">Email</label>
            <input className="input mb-3.5" type="email" placeholder="you@meridian.ae" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && login()} />
            <label className="label">Password</label>
            <input className="input" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && login()} />
          </div>
          {err && <p className="text-[12.5px] mt-2.5 mb-0 anim-fade-in" style={{ color: "var(--coral)" }}>{err}</p>}
          <button className="btn btn-primary w-full justify-center mt-5 !py-2.5" onClick={login}>Enter the tracker</button>
          <div className="flex items-center justify-between gap-2 mt-3.5 text-[11.5px]">
            <a href="/client" className="text-[var(--ink-faint)] hover:text-[var(--amber)] transition-colors">Client? Track your case →</a>
            <a href="/agent" className="text-[var(--ink-faint)] hover:text-[var(--amber)] transition-colors">Agent portal →</a>
          </div>
          <div className="mt-7">
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-[var(--ink-faint)] font-disp font-semibold mb-2.5">Demo seats — one tap</div>
            <div className="grid grid-cols-2 gap-2">
              {DEMOS.map((d) => (
                <button key={d.email} className="card card-hover text-left px-3 py-2.5" onClick={() => { setEmail(d.email); setPassword(d.pw); setErr(null); }}>
                  <span className="block text-[12px] font-disp font-semibold">{d.label}</span>
                  <span className="block text-[10.5px] text-[var(--ink-faint)] mt-0.5">{d.sub}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[var(--ink-faint)] mt-3 mb-0">
              Super Admin <span className="mono">super123</span> · HoC <span className="mono">admin123</span> · everyone else <span className="mono">demo123</span>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
