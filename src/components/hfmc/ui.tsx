"use client";

import { useCallback, useEffect, useId, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, ReactNode } from "react";
// `m` (not `motion`) so this uses the LazyMotion feature bundle from
// MotionProvider — see components/hfmc/motion.tsx for why.
import { m } from "framer-motion";
import type { CaseStatus, Tone } from "@/lib/types";
import { STATUS_TONE, dueInfo, fmtDue, initials } from "@/lib/format";
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
    // wrap the swap in a View Transition so the whole palette cross-fades as one
    // unit (surfaces + borders, not just body bg). Feature-detected, and the
    // CSS gate on prefers-reduced-motion disables the animation itself.
    const apply = (next: "light" | "dark") => {
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("hfmc.theme", next); } catch { /* private mode */ }
    };
    const start = (document as Document & {
      startViewTransition?: (cb: () => void) => { finished: Promise<void> };
    }).startViewTransition;
    if (typeof start === "function") {
      setTheme((cur) => {
        const next = cur === "light" ? "dark" : "light";
        start.call(document, () => apply(next));
        return next;
      });
      return;
    }
    setTheme((cur) => {
      apply(cur === "light" ? "dark" : "light");
      return cur === "light" ? "dark" : "light";
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

export function Chip({ tone, children, dot, title }: { tone: Tone; children: ReactNode; dot?: boolean; title?: string }) {
  const s = CHIP_STYLES[tone];
  return (
    <span className="chip" title={title} style={{ color: s.fg, background: s.bg, borderColor: s.bd }}>
      {dot && <span className="w-[6px] h-[6px] rounded-full" style={{ background: s.fg }} />}
      {children}
    </span>
  );
}

export function StatusChip({ status }: { status: CaseStatus }) {
  return <Chip tone={STATUS_TONE[status]} dot={status === "Overdue"}>{status}</Chip>;
}

export function DueChip({ dueISO, title }: { dueISO: string; title?: string }) {
  const d = dueInfo(dueISO);
  return (
    <span title={title ?? fmtDue(dueISO)}>
      <Chip tone={d.tone}>{d.label}</Chip>
    </span>
  );
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
  title, sub, onClose, children, footer, width = 480, full = false,
}: {
  title: string; sub?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number;
  /** full: workspace-sized editor (fills the viewport, scrolls internally) —
      for long forms like the bank-rules editor where a popup feels cramped */
  full?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Portal to document.body: a `fixed` overlay inside any ancestor with a
  // transform/filter (cards with anim-fade-up, backdrop blur...) becomes
  // positioned relative to THAT ancestor — modals then open "below or above"
  // the content instead of centered on the viewport. Body-level portals are
  // immune to every ancestor transform.
  const mounted = typeof document !== "undefined";
  if (!mounted) return null;
  return createPortal(
    <div
      className="modal-scrim"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={"modal-pop " + (full ? "w-full h-[96vh] max-w-none" : "w-full")}
        style={full ? undefined : { maxWidth: width }}
      >
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
    </div>,
    document.body,
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

/* rAF is JavaScript, so the CSS reduced-motion kill-switch cannot stop it.
   Framer gets this for free from MotionConfig's reducedMotion="user"; a hand
   rolled rAF loop has to ask. */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* ---------------- responsive ----------------
   THE reason this file grew a `useMediaQuery`: every list screen in the app
   needed the same "wide table on desktop, stacked cards on a phone" behaviour,
   and each one was hand-writing the pair — `overflow-x-auto hidden sm:block`
   for the table plus a `sm:hidden` divide-y list for the cards, duplicated in
   cases.tsx, clients.tsx and a third place before long.

   ResponsiveList owns that switch so a new list screen is correct by
   construction and there is exactly ONE place to change the breakpoint.

   Why a JS media query and not the `sm:hidden` / `hidden sm:block` CSS pair?
   Because CSS shows BOTH trees and hides one with `display:none`. For a table
   that is a real cost: every hidden row is still built, still holds its DOM ids
   and its event handlers, and a 1,000-row table renders 2,000 rows on a phone.
   Branching in JS mounts only the tree that is actually visible.

   The `md` boundary (768px) is the same one the app shell uses to swap the
   sidebar for the drawer, so chrome and content never disagree about who owns
   the screen. It must stay in sync with the `@media (min-width: 768px)` block in
   globals.css. */

export function useMediaQuery(query: string): boolean {
  /* useSyncExternalStore rather than useState + useEffect. The store is the
     browser's matchMedia; subscribing to it is exactly what the hook contract
     is for. The effect version also had to call setMatches synchronously inside
     the effect body on first read, which trips react-hooks/set-state-in-effect
     and costs an extra render — this version has neither problem.

     getServerSnapshot returns `false`, so SSR and the first client render agree
     (no hydration mismatch) and the correct branch lands on the commit right
     after. */
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
  }, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** True on phone-width viewports — matches the `.rf-*` rules in globals.css. */
export function useIsPhone(): boolean {
  return useMediaQuery("(max-width: 767px)");
}

export function ResponsiveList({
  table, cards, isEmpty = false, empty, maxHeight, phone = "cards",
}: {
  /** the `.tbl` markup — rendered on tablet and up, inside its own scroll box */
  table: ReactNode;
  /** the stacked card markup — rendered on phones, one thumb-sized target per row */
  cards: ReactNode;
  /** when true, `empty` replaces both trees on every viewport */
  isEmpty?: boolean;
  /** the no-results panel; ignored unless `isEmpty` */
  empty?: ReactNode;
  /** caps the scrollable body (the worklists use ~60vh) */
  maxHeight?: string;
  /**
   * What a PHONE gets. Default `"cards"`.
   *
   * `"table"` keeps the real table on a phone and lets it scroll sideways inside
   * its own contained box. Use it for genuinely tabular data — money/rate/date
   * columns where a card would either drop columns or turn the numbers into
   * prose. Flattening those into cards destroys the column alignment that makes
   * a table readable, so scrolling is the honest answer there.
   *
   * `"cards"` is for worklists you tap through: name, phone, status. There the
   * card genuinely beats a 14-column table you have to pan sideways.
   */
  phone?: "cards" | "table";
}) {
  const isPhone = useIsPhone();
  if (isEmpty) return <>{empty ?? null}</>;
  // `cards` is only meaningful on a phone — on a wider screen the table wins
  // regardless, so `phone` never suppresses it.
  const showCards = isPhone && phone === "cards";
  return (
    <div className="rf-scroll rf-scroll-x" style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}>
      {showCards ? cards : table}
    </div>
  );
}

/* ---------------- KPI value (count-up) ----------------
   Reuses the same easing the app already uses in `useCountUp` (charts.tsx) —
   a cubic ease-out on rAF — so numbers in tiles feel identical to the ones in
   report cards.

   Two deliberate differences from the shared hook:
   - it animates on FIRST paint only, then snaps on later value changes. The
     store re-hydrates often (every save), and a tile that re-counts from zero
     each time reads as a glitch rather than a refresh.
   - it honours prefers-reduced-motion (see the note on the helper above). */

export function KpiValue({
  value, format, className = "", style, duration = 700,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
  style?: CSSProperties;
  duration?: number;
}) {
  const [v, setV] = useState<number>(0);
  // Later value changes land instantly. Done as a render-time adjustment (the
  // documented React pattern) rather than a setState inside the effect, which
  // would trip react-hooks/set-state-in-effect and cause a cascading render.
  const [prev, setPrev] = useState<number>(value);
  if (prev !== value) {
    setPrev(value);
    setV(value);
  }
  useEffect(() => {
    // Mount-only: the effect starts the count-up. Every setState here is inside
    // a rAF callback, never synchronous in the effect body.
    if (prefersReducedMotion() || !Number.isFinite(value) || value <= 0) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      setV(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className={`kpi-value ${className}`} style={style}>
      {format ? format(v) : v}
    </div>
  );
}

/* ---------------- tabs ----------------
   ONE component for every tab strip in the app (admin's two nav levels, the
   client + agent portals, SegGroup, the Case 360 workspace switcher, the cases
   state filter). Previously each of those hand-rolled its own markup.

   The active item is a single sliding pill driven by framer-motion's `layoutId`
   shared-layout animation, so switching tabs glides the highlight instead of
   having it jump. That is the one place framer earns its keep: it measures and
   animates for us, with no scroll/resize listeners.

   Cost controls:
   - `m.button` (not `motion.button`) so it uses the LazyMotion bundle.
   - layoutId is scoped per instance via useId(), so two strips on one screen
     (admin has two) never animate each other's highlight across the page.
   - `reducedMotion="user"` is set app-wide in MotionProvider, so users who ask
     for less motion get an instant swap and the CSS ::after underline as backup. */

const TABS_SPRING = { type: "spring", stiffness: 520, damping: 38, mass: 0.7 } as const;

export function Tabs<T extends string>({
  options, value, onChange, flush = false, scroll = false, className = "",
}: {
  options: { value: T; label: string; count?: number; icon?: ReactNode; badge?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  /** drop the track background (for a strip that sits on its own card) */
  flush?: boolean;
  /** allow horizontal scrolling instead of wrapping (headers, mobile) */
  scroll?: boolean;
  className?: string;
}) {
  const layoutId = useId();
  return (
    <div className={`tabs${flush ? " tabs-flush" : ""}${scroll ? " tabs-scroll" : ""} ${className}`}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`tabs-item${active ? " active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            {o.icon}
            {o.label}
            {o.count !== undefined && <span className="mono text-[11px] ml-1.5 opacity-70">{o.count}</span>}
            {o.badge}
            {/* the sliding highlight: one element that travels between tabs */}
            {active && !flush && (
              <m.span
                aria-hidden
                layoutId={`tabpill-${layoutId}`}
                className="tabs-pill"
                transition={TABS_SPRING}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Seg<T extends string>({
  options, value, onChange,
}: {
  options: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void;
}) {
  // thin wrapper over Tabs so admin's two nav levels and the portals are the
  // same control with the same sliding highlight
  return <Tabs options={options} value={value} onChange={onChange} />;
}

export { ICheck, IAlert };
