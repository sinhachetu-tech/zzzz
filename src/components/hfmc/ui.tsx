"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { CaseStatus, Tone } from "@/lib/types";
import { STATUS_TONE, dueInfo, initials } from "@/lib/format";
import { IMoon, ISun, IX, ICheck, IAlert } from "../icons";

/* ---------------- theme toggle ---------------- */

function readTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    // sync with the theme set by the inline script in <head> + localStorage
    const t = readTheme();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (t !== "light") setTheme(t);
  }, []);
  const flip = () => {
    setTheme((cur) => {
      const next = cur === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("hfmc.theme", next); } catch { /* private mode */ }
      return next;
    });
  };
  return (
    <button
      className={`btn btn-ghost ${compact ? "btn-sm" : ""}`}
      onClick={flip}
      title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
      aria-label="Toggle color theme"
    >
      {theme === "light" ? <IMoon size={15} /> : <ISun size={15} />}
      {!compact && <span>{theme === "light" ? "Dark" : "Light"}</span>}
    </button>
  );
}

/* ---------------- chips ---------------- */

const CHIP_STYLES: Record<Tone, { fg: string; bg: string; bd: string }> = {
  mint: { fg: "var(--mint)", bg: "rgba(4,120,87,0.08)", bd: "rgba(4,120,87,0.3)" },
  amber: { fg: "var(--amber)", bg: "rgba(180,83,9,0.08)", bd: "rgba(180,83,9,0.3)" },
  coral: { fg: "var(--coral)", bg: "rgba(217,45,32,0.07)", bd: "rgba(217,45,32,0.3)" },
  sky: { fg: "var(--sky)", bg: "rgba(3,105,161,0.08)", bd: "rgba(3,105,161,0.3)" },
  slate: { fg: "var(--slate)", bg: "rgba(100,116,139,0.08)", bd: "rgba(100,116,139,0.3)" },
};

export function Chip({ tone, children, dot }: { tone: Tone; children: ReactNode; dot?: boolean }) {
  const s = CHIP_STYLES[tone];
  return (
    <span className="chip" style={{ color: s.fg, background: s.bg, borderColor: s.bd }}>
      {dot && <span className="w-[6px] h-[6px] rounded-full" style={{ background: s.fg }} />}
      {children}
    </span>
  );
}

export function StatusChip({ status }: { status: CaseStatus }) {
  return <Chip tone={STATUS_TONE[status]} dot={status === "Overdue"}>{status}</Chip>;
}

export function DueChip({ dueISO }: { dueISO: string }) {
  const d = dueInfo(dueISO);
  return <Chip tone={d.tone}>{d.label}</Chip>;
}

/* ---------------- avatar ---------------- */

const AV_COLORS = ["#f2b04c", "#43d69b", "#57c2ea", "#f27363", "#b48ef2", "#6fd6c3"];

export function Avatar({ name, size = 30 }: { name: string; size?: number }) {
  const idx = name.split("").reduce((s, ch) => s + ch.charCodeAt(0), 0) % AV_COLORS.length;
  const c = AV_COLORS[idx];
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-disp font-semibold shrink-0 select-none"
      style={{ width: size, height: size, fontSize: size * 0.36, color: c, background: `${c}1f`, border: `1px solid ${c}55` }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}

/* ---------------- modal ---------------- */

export function Modal({
  title, sub, onClose, children, footer, width = 480,
}: {
  title: string; sub?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 anim-fade-in"
      style={{ background: "rgba(6,13,17,0.72)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="card anim-scale-in w-full max-h-[88vh] flex flex-col" style={{ maxWidth: width, background: "var(--raised)" }}>
        <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-[var(--line-soft)]">
          <div>
            <h3 className="font-disp text-[16px] font-semibold m-0">{title}</h3>
            {sub && <p className="text-[12px] text-[var(--ink-faint)] mt-0.5 mb-0">{sub}</p>}
          </div>
          <button className="btn btn-ghost btn-sm !px-2 -mr-1.5 -mt-0.5" onClick={onClose} aria-label="Close dialog">
            <IX size={15} />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3.5 border-t border-[var(--line-soft)] flex justify-end gap-2.5">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------------- empty state ---------------- */

export function EmptyState({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-3" style={{ background: "var(--tint)", border: "1px solid var(--line-soft)", color: "var(--ink-faint)" }}>
        {icon}
      </div>
      <p className="font-disp font-semibold text-[14.5px] mb-1">{title}</p>
      <p className="text-[12.5px] text-[var(--ink-faint)] max-w-[300px] m-0">{body}</p>
    </div>
  );
}

/* ---------------- misc ---------------- */

export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="font-disp text-[11px] font-semibold uppercase tracking-[0.11em] text-[var(--ink-faint)] mb-2.5 mt-0">{children}</p>;
}

export function Seg<T extends string>({
  options, value, onChange,
}: {
  options: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg p-[3px] gap-[2px]" style={{ background: "var(--bg2)", border: "1px solid var(--line-soft)" }}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className="px-3 py-[5px] rounded-[6px] font-disp text-[12.5px] font-medium transition-all"
          style={
            value === o.value
              ? { background: "var(--raised)", color: "var(--ink)", boxShadow: "0 1px 4px rgba(15,23,42,0.12)", border: "1px solid var(--line)" }
              : { color: "var(--ink-faint)", border: "1px solid transparent" }
          }
        >
          {o.label}
          {o.count !== undefined && <span className="mono text-[11px] ml-1.5 opacity-70">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export { ICheck, IAlert };
