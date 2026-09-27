"use client";

import { useEffect, useRef, useState } from "react";
import { ChatPanel } from "./ChatPanel";
import { IX } from "@/components/icons";

interface InboxThread {
  caseId: number;
  caseNumber: string;
  customer: string;
  threadType: "CLIENT" | "AGENT";
  unreadCount: number;
  lastMessage: {
    text: string | null;
    attachmentName: string | null;
    senderName: string;
    senderType: string;
    sentAt: string;
  };
}

interface ChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  userRole: "STAFF" | "CLIENT" | "AGENT";
  pinnedCaseId?: number | null;
  pinnedCaseNumber?: string;
  pinnedCustomer?: string;
}

export function ChatDrawer({
  isOpen,
  onClose,
  userRole,
  pinnedCaseId,
  pinnedCaseNumber,
  pinnedCustomer,
}: ChatDrawerProps) {
  const [activeCaseId, setActiveCaseId] = useState<number | null>(pinnedCaseId ?? null);
  const [activeCaseNumber, setActiveCaseNumber] = useState<string | undefined>(pinnedCaseNumber);
  const [activeCustomer, setActiveCustomer] = useState<string | undefined>(pinnedCustomer);
  // FIX: inbox rows carry threadType (CLIENT vs AGENT) — remember it so the
  // panel opens on the thread the user actually clicked.
  const [activeThread, setActiveThread] = useState<"CLIENT" | "AGENT">("CLIENT");

  // For Staff Global Mini-Inbox
  const [inboxThreads, setInboxThreads] = useState<InboxThread[]>([]);
  const [search, setSearch] = useState("");

  // Sync pinned case from props if on Case 360.
  // When pinned (Case 360 / bubble on a case), the effective case is derived
  // directly from props — no sync effect needed. active* state is only for
  // the staff global inbox (picking a thread from the list).
  const [prevPinned, setPrevPinned] = useState(pinnedCaseId ?? null);
  if (prevPinned !== (pinnedCaseId ?? null)) {
    setPrevPinned(pinnedCaseId ?? null);
    if (!pinnedCaseId) setActiveCaseId(null);
  }
  const effectiveCaseId = pinnedCaseId ?? activeCaseId;
  const effectiveCaseNumber = pinnedCaseId ? pinnedCaseNumber : activeCaseNumber;
  const effectiveCustomer = pinnedCaseId ? pinnedCustomer : activeCustomer;
  const effectiveThread: "CLIENT" | "AGENT" = pinnedCaseId ? "CLIENT" : activeThread;

  // Load inbox threads if staff is on global view.
  // `inboxLoaded` flips only inside async callbacks (never synchronously in
  // the effect body) and the "loading" UI is derived — so the effect never
  // calls setState synchronously (react-hooks/set-state-in-effect clean).
  const [inboxLoaded, setInboxLoaded] = useState(false);
  const inboxReq = useRef(0);
  useEffect(() => {
    if (!(isOpen && userRole === "STAFF" && !pinnedCaseId)) return;
    const id = ++inboxReq.current;
    fetch("/api/chat/inbox")
      .then((r) => r.json())
      .then((data) => {
        if (inboxReq.current !== id) return;
        setInboxThreads(data.threads || []);
        setInboxLoaded(true);
      })
      .catch(() => {
        if (inboxReq.current !== id) return;
        setInboxLoaded(true);
      });
  }, [isOpen, userRole, pinnedCaseId, activeCaseId]);
  const loadingInbox = isOpen && userRole === "STAFF" && !pinnedCaseId && !inboxLoaded;

  if (!isOpen) return null;

  const filteredThreads = inboxThreads.filter(
    (t) =>
      t.customer.toLowerCase().includes(search.toLowerCase()) ||
      t.caseNumber.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div
      className="fixed bottom-20 right-4 sm:right-6 w-[380px] max-w-[calc(100vw-32px)] h-[540px] max-h-[calc(100vh-120px)] rounded-2xl shadow-2xl z-50 overflow-hidden flex flex-col border anim-fade-up"
      style={{
        background: "var(--bg)",
        borderColor: "var(--line)",
        boxShadow: "0 12px 40px rgba(0,0,0,0.22)",
      }}
    >
      {effectiveCaseId ? (
        <ChatPanel
          key={`${effectiveCaseId}_${effectiveThread}`}
          caseId={effectiveCaseId}
          caseNumber={effectiveCaseNumber}
          customerName={effectiveCustomer}
          userRole={userRole}
          initialThread={effectiveThread}
          allowThreadSwitch={userRole === "STAFF"}
          onClose={onClose}
          onBack={!pinnedCaseId ? () => setActiveCaseId(null) : undefined}
        />
      ) : (
        /* Staff Global Mini-Inbox */
        <div className="flex flex-col h-full bg-[var(--bg)] text-[var(--ink)]">
          {/* Header */}
          <div
            className="px-4 py-3 border-b flex items-center justify-between gap-3 shrink-0"
            style={{ borderColor: "var(--line-soft)", background: "var(--bg2)" }}
          >
            <div>
              <h3 className="font-disp font-semibold text-[14px] m-0">Live Messages</h3>
              <p className="text-[11px] text-[var(--ink-faint)] m-0 mt-0.5">
                Active client and agent conversations
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost !p-1.5 text-[var(--ink-faint)] hover:text-[var(--ink)]"
            >
              <IX size={16} />
            </button>
          </div>

          {/* Search bar */}
          <div className="p-2 border-b bg-[var(--bg)]" style={{ borderColor: "var(--line-soft)" }}>
            <input
              className="input !py-1 !px-2.5 text-[12px] w-full"
              placeholder="Filter by client or case #..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Thread List */}
          <div className="flex-1 overflow-y-auto divide-y" style={{ borderColor: "var(--line-soft)" }}>
            {loadingInbox ? (
              <div className="p-6 text-center text-[12px] text-[var(--ink-faint)]">
                Loading conversations...
              </div>
            ) : filteredThreads.length === 0 ? (
              <div className="p-8 text-center text-[var(--ink-faint)]">
                <span className="text-2xl mb-1 block">💬</span>
                <p className="text-[12.5px] font-medium m-0">No active conversations</p>
                <p className="text-[11px] m-0 mt-1">
                  When a client or partner sends a message, it will show up here.
                </p>
              </div>
            ) : (
              filteredThreads.map((thread) => (
                <button
                  key={`${thread.caseId}_${thread.threadType}`}
                  type="button"
                  onClick={() => {
                    setActiveCaseId(thread.caseId);
                    setActiveCaseNumber(thread.caseNumber);
                    setActiveCustomer(thread.customer);
                    setActiveThread(thread.threadType);
                  }}
                  className="w-full text-left p-3 hover:bg-[var(--tint)] transition-colors flex items-center gap-2.5"
                >
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center font-disp font-semibold text-[12px] shrink-0"
                    style={{ background: thread.threadType === "AGENT" ? "var(--amber, #f2b04c)" : "var(--brand-mint, #10b981)", color: "#fff" }}
                  >
                    {thread.customer.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold text-[13px] truncate">
                        {thread.customer}
                        <span
                          className="ml-1.5 text-[10.5px] font-bold uppercase tracking-wide px-1 py-px rounded"
                          style={{
                            background: thread.threadType === "AGENT" ? "rgba(242,176,76,0.16)" : "rgba(16,185,129,0.12)",
                            color: thread.threadType === "AGENT" ? "var(--amber)" : "var(--mint, #10b981)",
                          }}
                        >
                          {thread.threadType === "AGENT" ? "partner" : "client"}
                        </span>
                      </span>
                      <span className="text-[10.5px] text-[var(--ink-faint)] mono shrink-0">
                        {new Date(thread.lastMessage.sentAt).toLocaleDateString([], {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-1 mt-0.5">
                      <p className="text-[11.5px] text-[var(--ink-dim)] m-0 truncate">
                        {thread.lastMessage.attachmentName
                          ? `📎 ${thread.lastMessage.attachmentName}`
                          : thread.lastMessage.text}
                      </p>
                      {thread.unreadCount > 0 && (
                        <span
                          className="mono text-[10.5px] font-bold px-1.5 py-0.2 rounded-full shrink-0"
                          style={{ background: "var(--coral, #f43f5e)", color: "#fff" }}
                        >
                          {thread.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
