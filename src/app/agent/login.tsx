"use client";
import { useState } from "react";
import { useAgentStore } from "./agent-store";
import { LogoMark } from "@/components/icons";

export function AgentLogin() {
  const { hydrate } = useAgentStore();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!name.trim() || !password) { setErr("Enter your name and password."); return; }
    setLoading(true); setErr(null);
    try {
      const res = await fetch("/api/agent/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: name.trim(), password }) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setErr(e.error || "Could not sign in."); setLoading(false); }
      else { window.location.href = "/agent?t=" + Date.now(); }
    } catch { setErr("Network error."); }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg)" }}>
      <div className="app-bg" />
      <div className="w-full max-w-[400px] anim-fade-up">
        <div className="flex items-center gap-2.5 mb-8 justify-center">
          <LogoMark size={36} />
          <div>
            <div className="font-disp font-bold text-[18px] tracking-[0.04em] leading-none">HFMC</div>
            <div className="text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)] mt-0.5">Partner Portal</div>
          </div>
        </div>
        <div className="card p-6">
          <h1 className="font-disp font-bold text-[22px] tracking-tight m-0 mb-1">Partner login</h1>
          <p className="text-[13px] text-[var(--ink-dim)] mt-0 mb-5">Track your referrals and commission.</p>
          <label className="label">Your name (as registered)</label>
          <input className="input mb-3.5" placeholder="e.g. Faisal Properties" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
          <label className="label">Password</label>
          <input className="input" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
          {err && <p className="text-[12.5px] mt-2.5 mb-0 anim-fade-in" style={{ color: "var(--coral)" }}>{err}</p>}
          <button className="btn btn-primary w-full justify-center mt-5 !py-2.5" onClick={submit} disabled={loading}>{loading ? "Signing in…" : "View my referrals"}</button>
          <p className="text-[11px] text-[var(--ink-faint)] mt-3 mb-0 text-center">Demo password: <span className="mono">agent123</span></p>
        </div>
      </div>
    </div>
  );
}
