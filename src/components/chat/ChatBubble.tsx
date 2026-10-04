"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { ChatDrawer } from "./ChatDrawer";

/* ---- "Ask us" label ------------------------------------------------------
   The label exists to make the chat DISCOVERABLE, so it must not be a
   one-way door. It hides only while the client is actively using chat
   (recently opened) — and comes BACK after 14 days, or immediately when
   there are unread messages, because that is exactly when they need it.

   Earlier this stored a boolean and hid the label forever after one click.
   That defeated the purpose: a client who asked something in March and needed
   help again in September had no label and no idea the bubble was there. */
const LABEL_KEY = "hfmc.chatLabelHiddenAt";
const LABEL_TTL = 14 * 24 * 3600 * 1000; // re-surface after two weeks
const labelListeners = new Set<() => void>();

function emitLabelChange() {
  labelListeners.forEach((l) => l());
}
function subscribeLabelDismissed(cb: () => void) {
  labelListeners.add(cb);
  window.addEventListener("storage", cb); // another tab used the chat
  return () => {
    labelListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
// one-time cleanup, run at module scope (client only). The first version of
// this label stored a boolean under an older key and hid the label FOREVER;
// clear it so those clients aren't stuck permanently without the label.
// Deliberately outside getSnapshot — that must stay pure.
if (typeof window !== "undefined") {
  try { window.localStorage.removeItem("hfmc.chatLabelHidden"); } catch { /* private mode */ }
}

function getLabelDismissed() {
  try {
    const at = Number(localStorage.getItem(LABEL_KEY));
    if (!at) return false;                    // never used — always show
    return Date.now() - at < LABEL_TTL;       // hide only if used recently
  } catch { return false; }
}

interface ChatBubbleProps {
  userRole: "STAFF" | "CLIENT";
  pinnedCaseId?: number | null;
  pinnedCaseNumber?: string;
  pinnedCustomer?: string;
}

export function ChatBubble({
  userRole,
  pinnedCaseId,
  pinnedCaseNumber,
  pinnedCustomer,
}: ChatBubbleProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // An icon-only floating button is a convention, not a label — plenty of
  // clients never map a green speech-bubble glyph to "ask someone a question".
  // So the client bubble carries a persistent text pill (see showAskLabel below
  // for when it hides).
  //
  // Read via useSyncExternalStore, NOT a useEffect + setState: that pattern
  // trips react-hooks/set-state-in-effect and, worse, renders the pill on the
  // server then hides it on the client — a visible flash on every load. This
  // gives the server a "shown" snapshot and the client its real value with no
  // extra render pass.
  const askLabelDismissed = useSyncExternalStore(
    subscribeLabelDismissed,
    getLabelDismissed,
    () => false, // server snapshot: always show the label
  );

  const dismissAskLabel = () => {
    try { localStorage.setItem(LABEL_KEY, String(Date.now())); } catch { /* private mode */ }
    emitLabelChange(); // storage events don't fire in the tab that wrote them
  };

  // Re-surface the label whenever the client is NOT actively using chat: never
  // opened it, hasn't opened it in a fortnight, OR the advisor just replied
  // (an unread message is the exact moment they most need to find the bubble).
  const showAskLabel =
    userRole === "CLIENT" && !isOpen && (!askLabelDismissed || unreadCount > 0);

  // Poll for unread count
  useEffect(() => {
    let cancelled = false;

    async function checkUnread() {
      try {
        if (userRole === "STAFF") {
          const res = await fetch("/api/chat/inbox");
          if (!cancelled && res.ok) {
            const data = await res.json();
            if (pinnedCaseId) {
              const thread = data.threads?.find((t: { caseId: number }) => t.caseId === pinnedCaseId);
              setUnreadCount(thread?.unreadCount || 0);
            } else {
              setUnreadCount(data.totalUnread || 0);
            }
          }
        } else if (pinnedCaseId) {
          const res = await fetch(`/api/chat/${pinnedCaseId}/messages?limit=20`);
          if (!cancelled && res.ok) {
            const data = await res.json();
            const unread = (data.items || []).filter(
              (m: { readByExternal: boolean }) => !m.readByExternal
            ).length;
            setUnreadCount(unread);
          }
        }
      } catch {}
    }

    checkUnread();
    const interval = setInterval(checkUnread, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [userRole, pinnedCaseId, isOpen]);

  return (
    <>
      <div className="fixed z-50 bottom-[92px] right-4 md:bottom-5 md:right-5 flex items-center gap-2">
        {/* persistent "Ask us" pill — the whole point: the affordance is named,
            not just drawn. Sits to the LEFT of the bubble so it reads as a
            label for it, and is hidden the moment the drawer opens. */}
        {showAskLabel && (
          <span
            className="anim-fade-in flex items-center gap-1.5 pl-3 pr-2.5 py-2 rounded-full font-disp font-semibold text-[12.5px] whitespace-nowrap"
            style={{
              background: "var(--raised)",
              color: "var(--ink)",
              border: "1px solid var(--line)",
              boxShadow: "0 6px 20px -6px rgba(0,0,0,0.3)",
            }}
          >
            Ask us
            <span className="w-1 h-1 rounded-full" style={{ background: "var(--mint)" }} />
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            setIsOpen((prev) => !prev);
            if (!isOpen) {
              setUnreadCount(0);
              // first time a client actually uses the chat, retire the label
              if (userRole === "CLIENT") dismissAskLabel();
            }
          }}
          className="relative w-13 h-13 sm:w-14 sm:h-14 rounded-full flex items-center justify-center shadow-xl transition-transform hover:scale-105 active:scale-95 cursor-pointer text-white"
          style={{
            background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
            boxShadow: "0 6px 20px rgba(16, 185, 129, 0.45)",
          }}
          title={isOpen ? "Close chat" : "Open live chat"}
        >
          {isOpen ? (
            <span className="text-xl font-bold">✕</span>
          ) : (
            <svg
              className="w-6 h-6 fill-current"
              viewBox="0 0 24 24"
            >
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
            </svg>
          )}

          {/* Unread Badge */}
          {unreadCount > 0 && !isOpen && (
            <span
              className="absolute -top-1 -right-1 min-w-[20px] h-[20px] px-1 rounded-full text-[11px] font-bold flex items-center justify-center border-2 border-white animate-pulse"
              style={{ background: "var(--coral, #f43f5e)", color: "#fff" }}
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </div>

      <ChatDrawer
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        userRole={userRole}
        pinnedCaseId={pinnedCaseId}
        pinnedCaseNumber={pinnedCaseNumber}
        pinnedCustomer={pinnedCustomer}
      />
    </>
  );
}
