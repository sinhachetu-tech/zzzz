"use client";

import { useEffect, useState } from "react";

export function useReveal(delay = 0): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { r2 = window.setTimeout(() => setOn(true), delay); });
    return () => { cancelAnimationFrame(r1); window.clearTimeout(r2); };
  }, [delay]);
  return on;
}

export function useCountUp(target: number, dur = 750): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, dur]);
  return v;
}

export interface BarItem { label: string; value: number; color: string; sub?: string }

export function BarList({ items, unit = "" }: { items: BarItem[]; unit?: string }) {
  const on = useReveal();
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={it.label}>
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <span className="text-[12.5px] text-[var(--ink-dim)] truncate">{it.label}</span>
            <span className="mono text-[12px] text-[var(--ink)]">
              {it.value}{unit}
              {it.sub ? <span className="text-[var(--ink-faint)] ml-1.5">{it.sub}</span> : null}
            </span>
          </div>
          <div className="h-[7px] rounded-full overflow-hidden" style={{ background: "var(--track)" }}>
            <div
              className="h-full rounded-full"
              style={{
                width: on ? `${(it.value / max) * 100}%` : "0%",
                background: `linear-gradient(90deg, ${it.color}88, ${it.color})`,
                transition: `width 0.9s cubic-bezier(0.22, 1, 0.36, 1) ${i * 70}ms`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export interface DonutSeg { label: string; value: number; color: string }

export function Donut({ segments, size = 148, centerLabel }: { segments: DonutSeg[]; size?: number; centerLabel: string }) {
  const on = useReveal(120);
  const sum = segments.reduce((s, x) => s + x.value, 0);
  const total = Math.max(sum, 1);
  const r = 56;
  const C = 2 * Math.PI * r;
  // precompute cumulative offsets purely (no mutation during render)
  const offsets = segments.reduce<{ off: number; dash: number; acc: number }[]>((out, s) => {
    const acc = out.length ? out[out.length - 1].acc : 0;
    const frac = s.value / total;
    out.push({ off: -acc * C, dash: frac * C, acc: acc + frac });
    return out;
  }, []);
  return (
    <div className="flex items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox="0 0 140 140">
          <circle cx="70" cy="70" r={r} fill="none" stroke="var(--track)" strokeWidth="13" />
          {segments.map((s, i) => {
            const { off, dash } = offsets[i];
            return (
              <circle
                key={s.label}
                cx="70" cy="70" r={r} fill="none" stroke={s.color} strokeWidth="13" strokeLinecap="butt"
                strokeDasharray={`${on ? dash : 0} ${C}`} strokeDashoffset={off}
                transform="rotate(-90 70 70)"
                style={{ transition: `stroke-dasharray 0.9s cubic-bezier(0.22,1,0.36,1) ${i * 90}ms` }}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-disp text-[26px] font-bold leading-none">{sum}</span>
          <span className="text-[10.5px] uppercase tracking-[0.12em] text-[var(--ink-faint)] mt-1">{centerLabel}</span>
        </div>
      </div>
      <div className="space-y-2 min-w-0">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-[12.5px]">
            <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: s.color }} />
            <span className="text-[var(--ink-dim)] truncate">{s.label}</span>
            <span className="mono text-[var(--ink)] ml-auto pl-3">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Spark({ points, color = "#f2b04c", width = 120, height = 34 }: { points: number[]; color?: string; width?: number; height?: number }) {
  const on = useReveal(200);
  const max = Math.max(...points, 1);
  const step = width / Math.max(points.length - 1, 1);
  const coords = points.map((p, i) => `${i * step},${height - 3 - (p / max) * (height - 8)}`).join(" ");
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        points={coords} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
        style={{ strokeDasharray: 400, strokeDashoffset: on ? 0 : 400, transition: "stroke-dashoffset 1.2s ease 0.2s" }}
      />
      {points.length > 0 && (
        <circle
          cx={(points.length - 1) * step}
          cy={height - 3 - (points[points.length - 1] / max) * (height - 8)}
          r="2.6" fill={color}
          style={{ opacity: on ? 1 : 0, transition: "opacity 0.3s ease 1.2s" }}
        />
      )}
    </svg>
  );
}

/* Half-circle gauge — one quiet arc sweep when a value changes (no library,
   same stroke-dasharray pattern as Donut, honours prefers-reduced-motion). */
export function Dial({ value, cap, display, label, size = 220 }: { value: number; cap: number; display: string; label: string; size?: number }) {
  const on = useReveal(150);
  const frac = Math.max(0.02, Math.min(1, cap > 0 ? value / cap : 0));
  const k = size / 220;
  const r = 52 * k;
  const C = Math.PI * r;
  const color = value > cap ? "var(--coral)" : value > cap * 0.8 ? "var(--amber)" : "var(--mint)";
  const h = 118 * k;
  const inset = 18 * k;
  const sw = Math.max(6, 12 * k);
  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <div className="relative" style={{ width: size, height: h }}>
        <svg width={size} height={h} viewBox={`0 0 ${size} ${h}`} aria-hidden="true">
          <path d={`M ${inset} ${h - 6} A ${r} ${r} 0 0 1 ${size - inset} ${h - 6}`} fill="none" stroke="var(--track)" strokeWidth={sw} strokeLinecap="round" />
          <path
            d={`M ${inset} ${h - 6} A ${r} ${r} 0 0 1 ${size - inset} ${h - 6}`} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"
            strokeDasharray={`${on ? frac * C : 0.02 * C} ${C}`}
            style={{ transition: "stroke-dasharray 0.7s cubic-bezier(0.22,1,0.36,1), stroke 0.3s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-1 pointer-events-none">
          <span className="font-disp font-bold leading-none" style={{ color, fontSize: 26 * k }}>{display}</span>
        </div>
      </div>
      <span className="text-[10.5px] uppercase tracking-[0.1em] text-[var(--ink-faint)] font-disp font-semibold text-center">{label}</span>
    </div>
  );
}
