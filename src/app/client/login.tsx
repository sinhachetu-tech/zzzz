"use client";

import { useState } from "react";
import { useClientStore } from "./client-store";
import { LogoMark } from "@/components/icons";

export function ClientLogin() {
  const { hydrate } = useClientStore();
  const [mode, setMode] = useState<"login" | "register">("login");

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg)" }}>
      <div className="app-bg" />
      <div className="w-full max-w-[400px] anim-fade-up">
        <div className="flex items-center gap-2.5 mb-8 justify-center">
          <LogoMark size={36} />
          <div>
            <div className="font-disp font-bold text-[18px] tracking-[0.04em] leading-none">HFMC</div>
            <div className="text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)] mt-0.5">Client Portal</div>
          </div>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-1.5 mb-4">
          <button className="chip transition-all flex-1 justify-center" style={mode === "login" ? { background: "rgba(242,176,76,0.14)", borderColor: "var(--amber)", color: "var(--amber)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }} onClick={() => setMode("login")}>
            I have a case
          </button>
          <button className="chip transition-all flex-1 justify-center" style={mode === "register" ? { background: "rgba(67,214,155,0.12)", borderColor: "var(--mint)", color: "var(--mint)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }} onClick={() => setMode("register")}>
            I&apos;m new — apply
          </button>
        </div>

        {mode === "login" ? <LoginForm hydrate={hydrate} /> : <RegisterForm hydrate={hydrate} />}
      </div>
    </div>
  );
}

function LoginForm({ hydrate }: { hydrate: () => Promise<void> }) {
  const [caseNumber, setCaseNumber] = useState("");
  const [phoneLast4, setPhoneLast4] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!caseNumber.trim() || !phoneLast4.trim()) { setErr("Enter your case number and last 4 digits."); return; }
    setLoading(true); setErr(null);
    try {
      const res = await fetch("/api/client/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caseNumber: caseNumber.trim(), phoneLast4: phoneLast4.trim() }) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setErr(e.error || "Could not sign in."); setLoading(false); }
      else {
        // Hard redirect to /client (with timestamp to bypass cache).
        // The Set-Cookie from the login response is in the jar by the time
        // the browser processes the navigation.
        window.location.href = "/client?t=" + Date.now();
      }
    } catch { setErr("Network error."); setLoading(false); }
  };

  return (
    <div className="card p-6">
      <h1 className="font-disp font-bold text-[22px] tracking-tight m-0 mb-1">Track your case</h1>
      <p className="text-[13px] text-[var(--ink-dim)] mt-0 mb-5">Enter your case number and phone to see live status.</p>
      <label className="label">Case number</label>
      <input className="input mono mb-3.5" placeholder="e.g. HFMC-0001" value={caseNumber} onChange={(e) => setCaseNumber(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      <label className="label">Last 4 digits of your phone</label>
      <input className="input mono" type="text" inputMode="numeric" maxLength={4} placeholder="••••" value={phoneLast4} onChange={(e) => setPhoneLast4(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && submit()} />
      {err && <p className="text-[12.5px] mt-2.5 mb-0 anim-fade-in" style={{ color: "var(--coral)" }}>{err}</p>}
      <button className="btn btn-primary w-full justify-center mt-5 !py-2.5" onClick={submit} disabled={loading}>{loading ? "Checking…" : "View my case"}</button>
    </div>
  );
}

function RegisterForm({ hydrate }: { hydrate: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [propertyValue, setPropertyValue] = useState("");
  const [employment, setEmployment] = useState("Salaried");
  const [message, setMessage] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!name.trim()) return setErr("Your name is required.");
    if (!phone.trim()) return setErr("Your phone number is required.");
    setLoading(true); setErr(null);
    try {
      const res = await fetch("/api/client/register", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(), phone: phone.trim(), email: email.trim() || undefined,
          propertyValue: propertyValue ? Number(propertyValue) : undefined,
          employmentType: employment, message: message.trim() || undefined,
        }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setErr(e.error || "Could not register."); setLoading(false); }
      else { window.location.href = "/client?t=" + Date.now(); }
    } catch { setErr("Network error."); }
    setLoading(false);
  };

  return (
    <div className="card p-6">
      <h1 className="font-disp font-bold text-[22px] tracking-tight m-0 mb-1">Apply for a mortgage</h1>
      <p className="text-[13px] text-[var(--ink-dim)] mt-0 mb-5">Fill in your details — an advisor will contact you within 24 hours.</p>
      <label className="label">Full name *</label>
      <input className="input mb-3" placeholder="e.g. Mohammed Al Mansoori" value={name} onChange={(e) => setName(e.target.value)} />
      <label className="label">Phone number *</label>
      <input className="input mono mb-3" placeholder="+971 50 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <label className="label">Email (optional)</label>
      <input className="input mb-3" type="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="label">Property value (AED)</label>
          <input className="input mono" type="number" placeholder="1,500,000" value={propertyValue} onChange={(e) => setPropertyValue(e.target.value)} />
        </div>
        <div>
          <label className="label">Employment</label>
          <select className="select" value={employment} onChange={(e) => setEmployment(e.target.value)}>
            <option>Salaried</option>
            <option>Self-Employed</option>
          </select>
        </div>
      </div>
      <label className="label">Message (optional)</label>
      <textarea className="textarea mb-3" rows={2} placeholder="Tell us what you're looking for…" value={message} onChange={(e) => setMessage(e.target.value)} />
      {err && <p className="text-[12.5px] mt-2.5 mb-0 anim-fade-in" style={{ color: "var(--coral)" }}>{err}</p>}
      <button className="btn btn-mint w-full justify-center mt-4 !py-2.5" onClick={submit} disabled={loading}>{loading ? "Submitting…" : "Submit application"}</button>
      <p className="text-[11px] text-[var(--ink-faint)] mt-3 mb-0 text-center">We&apos;ll create your case file and an advisor will reach out.</p>
    </div>
  );
}
