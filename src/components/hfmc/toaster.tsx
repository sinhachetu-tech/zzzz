"use client";

import { useHfmcStore } from "@/lib/client-store";
import { IAlert, ICheck, IX } from "../icons";

export function Toaster() {
  const toasts = useHfmcStore((s) => s.toasts);
  const dismiss = useHfmcStore((s) => s.dismissToast);
  return (
    <div className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2.5 w-[min(360px,calc(100vw-40px))]">
      {toasts.map((t) => {
        const color = t.kind === "success" ? "var(--mint)" : t.kind === "error" ? "var(--coral)" : "var(--sky)";
        return (
          <div
            key={t.id}
            className="anim-slide-right flex items-start gap-3 px-4 py-3 rounded-lg text-[13px] shadow-[0_12px_32px_-10px_rgba(0,0,0,0.6)]"
            style={{ background: "var(--raised)", border: "1px solid var(--line)", borderLeft: `3px solid ${color}` }}
          >
            <span className="mt-[1px]" style={{ color }}>
              {t.kind === "success" ? <ICheck size={16} /> : t.kind === "error" ? <IAlert size={16} /> : <ICheck size={16} />}
            </span>
            <span className="flex-1 leading-snug">{t.msg}</span>
            <button className="text-[var(--ink-faint)] hover:text-[var(--ink)] transition-colors" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <IX size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
