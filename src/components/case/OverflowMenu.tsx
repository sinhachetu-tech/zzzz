"use client";

/* OverflowMenu — the "⋯" that replaced Case 360's eight peer buttons.
 *
 * WHY HAND-ROLLED RATHER THAN THE SHADCN dropdown-menu already in src/components/ui:
 * that file is vendored but never imported anywhere, so its Radix wiring is
 * untested in this app and its utility classes are shadcn-token based while
 * every Case 360 surface uses the HFMC tokens (--raised, --line-soft, --ink-dim).
 * Forty lines here are consistent with the rest of the file and depend on
 * nothing. If a Radix menu is ever adopted app-wide, this is the file to delete.
 *
 * Behaviour worth having, because this menu holds DESTRUCTIVE items:
 *   · closes on outside click, Escape, and after any selection
 *   · `danger` items are coral and separated, so "delete the file" cannot be
 *     hit by muscle memory two rows below "activity log"
 *   · the trigger is a real <button> with aria-haspopup/aria-expanded
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

export interface OverflowItem {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  /** coral + separated from the items above it */
  danger?: boolean;
}

export function OverflowMenu({
  label,
  items,
  align = "right",
}: {
  label: string;
  items: OverflowItem[];
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // last item is destructive → give it a rule above, so it reads as a different
  // kind of choice rather than the next item in a list
  const firstDanger = items.findIndex((i) => i.danger);

  return (
    <div className="relative shrink-0" ref={wrapRef}>
      <button
        type="button"
        className="btn btn-ghost btn-sm !px-2.5"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" />
        </svg>
        <span className="hidden lg:inline">More</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute z-50 mt-1 min-w-[196px] rounded-xl p-1 anim-fade-in"
          style={{
            top: "100%",
            [align]: 0,
            background: "var(--raised)",
            border: "1px solid var(--line)",
            boxShadow: "var(--shadow)",
          }}
        >
          {items.map((it) => (
            <button
              key={it.key}
              role="menuitem"
              type="button"
              className="w-full flex items-center gap-2 text-left px-2.5 py-1.5 rounded-lg text-[12.5px] transition-colors"
              style={{
                color: it.danger ? "var(--coral)" : "var(--ink)",
                borderTop: firstDanger >= 0 && it.key === items[firstDanger].key ? "1px solid var(--line-soft)" : undefined,
                marginTop: firstDanger >= 0 && it.key === items[firstDanger].key ? 4 : undefined,
                paddingTop: firstDanger >= 0 && it.key === items[firstDanger].key ? 7 : undefined,
              }}
              onClick={() => { setOpen(false); it.onSelect(); }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = it.danger ? "rgba(255,107,107,0.1)" : "var(--tint)";
              }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ color: it.danger ? "var(--coral)" : "var(--ink-faint)", display: "inline-flex" }}>
                {it.icon ?? <span style={{ width: 14 }} />}
              </span>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
