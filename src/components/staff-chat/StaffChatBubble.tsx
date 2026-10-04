"use client";

import { useState, useEffect } from "react";
import { StaffChatDrawer } from "./StaffChatDrawer";

export function StaffChatBubble() {
  const [isOpen, setIsOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  // Poll total unread every 30s when drawer is closed
  useEffect(() => {
    if (isOpen) return; // drawer handles its own refresh while open
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/staff-chat/rooms");
        if (!cancelled && res.ok) {
          const d = await res.json();
          if (Array.isArray(d.items)) {
            const total = d.items.reduce(
              (s: number, r: { unreadCount: number }) => s + r.unreadCount,
              0
            );
            setUnread(total);
          }
        }
      } catch {}
    }

    poll();
    const id = setInterval(poll, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [isOpen]);

  return (
    <>
      {/* Bubble — sits ~72px above the client ChatBubble */}
      <div className="fixed z-50 bottom-[92px] right-4 md:bottom-[96px] md:right-5" style={{ marginBottom: "64px" }}>
        <button
          type="button"
          onClick={() => {
            setIsOpen((v) => !v);
            if (!isOpen) setUnread(0); // optimistic clear
          }}
          className="relative w-12 h-12 rounded-full flex items-center justify-center shadow-xl transition-transform hover:scale-105 active:scale-95 cursor-pointer text-white"
          style={{
            background: isOpen
              ? "linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)"
              : "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
            boxShadow: "0 6px 20px rgba(99, 102, 241, 0.5)",
          }}
          title={isOpen ? "Close staff chat" : "Staff chat"}
        >
          {isOpen ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            /* Team / people icon — distinct from the client chat bubble icon */
            <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
              <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
            </svg>
          )}

          {/* Unread badge */}
          {unread > 0 && !isOpen && (
            <span
              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center border-2 border-white animate-pulse"
              style={{ background: "var(--coral, #f43f5e)", color: "#fff" }}
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </div>

      <StaffChatDrawer
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onUnreadChange={(total) => { if (!isOpen) setUnread(total); }}
      />
    </>
  );
}
