"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { ChatMessageDto } from "@/lib/types";
import { playNotificationChime } from "@/lib/chime";
import { ICheck, IUpload, IX } from "@/components/icons";

interface ChatPanelProps {
  caseId: number;
  caseNumber?: string;
  customerName?: string;
  userRole: "STAFF" | "CLIENT";
  onClose?: () => void;
  onBack?: () => void;
}

function tickFor(m: ChatMessageDto, isMe: boolean): { label: string; tone: string } {
  if (!isMe) return { label: "", tone: "" };
  if (m.senderType === "STAFF") {
    if (m.readByExternal) return { label: "seen", tone: "#60a5fa" };
    return { label: "sent", tone: "currentColor" };
  }
  if (m.readByStaff) return { label: "seen", tone: "#60a5fa" };
  return { label: "received", tone: "currentColor" };
}

export function ChatPanel({
  caseId,
  caseNumber,
  customerName,
  userRole,
  onClose,
  onBack,
}: ChatPanelProps) {
  // threadType is always CLIENT — the AGENT thread has been removed.
  const threadType = "CLIENT" as const;
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<{ name: string; pct: number }[]>([]);
  const [presence, setPresence] = useState<{ online: boolean; lastSeen?: string | null }>({ online: false });
  const [saveState, setSaveState] = useState<Record<number, "idle" | "saving" | "saved" | "error">>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        const [msgRes, presRes] = await Promise.all([
          fetch(`/api/chat/${caseId}/messages?limit=60`),
          fetch(`/api/chat/${caseId}/heartbeat`),
        ]);

        if (!cancelled && msgRes.ok) {
          const data = await msgRes.json();
          setMessages(data.items || []);
          setTimeout(() => scrollToBottom(false), 50);
        }
        if (!cancelled && presRes.ok) {
          const presData = await presRes.json();
          const isOnline = userRole === "STAFF" ? presData.clientLive : presData.staffLive;
          setPresence({ online: isOnline, lastSeen: presData.clientLastSeen });
        }
      } catch {}
    }

    loadData();

    // Heartbeat every 30s & mark read
    const sendHeartbeat = () => {
      fetch(`/api/chat/${caseId}/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markRead: true }),
      }).catch(() => {});
    };

    sendHeartbeat();
    const heartbeatTimer = setInterval(sendHeartbeat, 30000);

    // Setup SSE connection + polling fallback.
    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource(`/api/chat/${caseId}/messages?stream=true`);

      eventSource.addEventListener("message", (e) => {
        try {
          const newMsg: ChatMessageDto = JSON.parse(e.data);
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev.map((m) => (m.id === newMsg.id ? newMsg : m));
            // Play notification sound if message is from the other side
            const isMe =
              (userRole === "STAFF" && newMsg.senderType === "STAFF") ||
              (userRole === "CLIENT" && newMsg.senderType === "CLIENT");
            if (!isMe) {
              playNotificationChime();
            }
            return [...prev, newMsg];
          });
          setTimeout(() => scrollToBottom(true), 50);
        } catch {}
      });
    } catch {}

    const pollTimer = setInterval(async () => {
      try {
        const res = await fetch(`/api/chat/${caseId}/messages?limit=60`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const items: ChatMessageDto[] = data.items || [];
        setMessages((prev) => {
          const prevIds = new Set(prev.map((m) => m.id));
          const incoming = items.filter((m) => !prevIds.has(m.id));
          if (incoming.length > 0) {
            const otherSide = incoming.some(
              (m) =>
                !(
                  (userRole === "STAFF" && m.senderType === "STAFF") ||
                  (userRole === "CLIENT" && m.senderType === "CLIENT")
                )
            );
            if (otherSide) playNotificationChime();
            setTimeout(() => scrollToBottom(true), 80);
          }
          const merged = new Map(prev.map((m) => [m.id, m] as const));
          for (const m of items) merged.set(m.id, m);
          const next = Array.from(merged.values()).sort((a, b) => a.id - b.id);
          return next.length === prev.length && next.every((m, i) => m === prev[i]) ? prev : next;
        });
      } catch {}
    }, 8000);

    return () => {
      cancelled = true;
      clearInterval(heartbeatTimer);
      clearInterval(pollTimer);
      if (eventSource) eventSource.close();
    };
  }, [caseId, userRole, scrollToBottom]);

  // Send message — never swallow failures (a 403 means "no chat
  // permission" and must surface, not look like "not reaching").
  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!text.trim() || sending) return;

    const messageText = text.trim();
    setText("");
    setSending(true);
    setSendError(null);

    try {
      const res = await fetch(`/api/chat/${caseId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: messageText,
          threadType,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Send failed (${res.status})`);
      }
      const data = await res.json();
      setMessages((prev) => {
        if (prev.some((m) => m.id === data.item.id)) return prev;
        return [...prev, data.item];
      });
      setTimeout(() => scrollToBottom(true), 50);
      if (data.document) window.dispatchEvent(new CustomEvent("hfmc:vault-changed", { detail: { caseId } }));
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Send failed — try again.");
      setText(messageText); // restore text on failure
    } finally {
      setSending(false);
    }
  };

  // Upload attachment with visible progress (XHR reports upload %;
  // fetch can't). Shows filename + bar while sending, then the real row.
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setPendingFiles((prev) => [...prev, { name: file.name, pct: 2 }]);
    const bump = (pct: number) =>
      setPendingFiles((prev) => prev.map((p) => (p.name === file.name ? { ...p, pct } : p)));
    const drop = () => setPendingFiles((prev) => prev.filter((p) => p.name !== file.name));

    try {
      const item: ChatMessageDto = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/chat/${caseId}/upload`);
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) bump(Math.max(2, Math.round((ev.loaded / ev.total) * 96)));
        };
        xhr.onload = () => {
          bump(100);
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText).item as ChatMessageDto);
            } catch {
              reject(new Error("Upload finished but the reply was unreadable."));
            }
          } else {
            try {
              reject(new Error(JSON.parse(xhr.responseText).error || `Upload failed (${xhr.status})`));
            } catch {
              reject(new Error(`Upload failed (${xhr.status})`));
            }
          }
        };
        xhr.onerror = () => reject(new Error("Upload failed — check your connection."));
        const fd = new FormData();
        fd.append("file", file);
        fd.append("threadType", threadType);
        xhr.send(fd);
      });
      drop();
      setMessages((prev) => [...prev, item]);
      setTimeout(() => scrollToBottom(true), 50);
      window.dispatchEvent(new CustomEvent("hfmc:vault-changed", { detail: { caseId } }));
    } catch (err) {
      drop();
      setSendError(err instanceof Error ? err.message : "Upload failed — try again.");
    }
  };

  // One-click "save to vault" for staff receiving a chat attachment.
  const handleSaveToVault = async (docId: number) => {
    setSaveState((s) => ({ ...s, [docId]: "saving" }));
    try {
      const res = await fetch(`/api/chat/${caseId}/attachments/${docId}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "Client Uploads" }),
      });
      if (!res.ok) throw new Error("save failed");
      setSaveState((s) => ({ ...s, [docId]: "saved" }));
      window.dispatchEvent(new CustomEvent("hfmc:vault-changed", { detail: { caseId } }));
      setTimeout(() => setSaveState((s) => ({ ...s, [docId]: "idle" })), 2500);
    } catch {
      setSaveState((s) => ({ ...s, [docId]: "error" }));
      setTimeout(() => setSaveState((s) => ({ ...s, [docId]: "idle" })), 2500);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg)] text-[var(--ink)] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between gap-3 shrink-0" style={{ borderColor: "var(--line-soft)", background: "var(--bg2)" }}>
        <div className="flex items-center gap-2.5 min-w-0">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="btn btn-ghost !p-1.5 text-[12px] text-[var(--ink-faint)] hover:text-[var(--ink)]"
              title="Back to inbox"
            >
              ←
            </button>
          )}
          <div className="w-9 h-9 rounded-full flex items-center justify-center font-disp font-semibold text-[13px] shrink-0" style={{ background: "var(--brand-mint, #10b981)", color: "#fff" }}>
            {customerName ? customerName.slice(0, 2).toUpperCase() : "HF"}
          </div>
          <div className="min-w-0">
            <h4 className="font-disp font-semibold text-[13.5px] m-0 truncate">
              {customerName || "HFMC Mortgage Support"}
            </h4>
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--ink-faint)]">
              {caseNumber && <span className="mono">{caseNumber} · </span>}
              <span className="flex items-center gap-1">
                <span
                  className="w-2 h-2 rounded-full inline-block"
                  style={{ background: presence.online ? "var(--mint, #10b981)" : "var(--ink-faint)" }}
                />
                {presence.online ? "Online" : "Away"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost !p-1.5 text-[var(--ink-faint)] hover:text-[var(--ink)]"
              title="Close chat"
            >
              <IX size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Staff sub-tabs (Client / Agent) were removed — only the CLIENT thread
          exists now. Staff always chat with the client on this panel. */}

      {/* Messages Scroll Area */}
      <div className="flex-1 p-3.5 overflow-y-auto space-y-2.5">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-[var(--ink-faint)]">
            <span className="text-3xl mb-2">💬</span>
            <p className="text-[13px] font-medium m-0 text-[var(--ink)]">No messages yet</p>
            <p className="text-[11.5px] m-0 mt-1 max-w-[240px]">
              {userRole === "CLIENT"
                ? "Send a message or document directly to your dedicated mortgage advisory team."
                : "Send a message or upload files for this case."}
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const isMe =
              (userRole === "STAFF" && m.senderType === "STAFF") ||
              (userRole === "CLIENT" && m.senderType === "CLIENT");

            const timeStr = new Date(m.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

            return (
              <div
                key={m.id}
                className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
              >
                {!isMe && (
                  <span className="text-[10.5px] text-[var(--ink-faint)] font-medium mb-0.5 ml-1">
                    {m.senderName}
                  </span>
                )}
                <div
                  className="max-w-[82%] rounded-2xl px-3.5 py-2 text-[13px] shadow-sm leading-relaxed"
                  style={
                    isMe
                      ? { background: "var(--brand-mint, #10b981)", color: "#fff", borderBottomRightRadius: "4px" }
                      : { background: "var(--bg2)", color: "var(--ink)", borderBottomLeftRadius: "4px", border: "1px solid var(--line-soft)" }
                  }
                >
                  {/* Text content */}
                  {m.text && <p className="m-0 whitespace-pre-wrap break-words">{m.text}</p>}

                  {/* Attachment card — View opens the vault file; staff get a
                  one-click Save to Vault that re-files it properly. */}
                  {m.attachmentName && (
                    <div
                      className={`mt-1.5 p-2 rounded-lg flex items-center gap-2 ${
                        isMe ? "bg-black/15 text-white" : "bg-[var(--tint)] text-[var(--ink)]"
                      }`}
                    >
                      <span className="text-lg">📎</span>
                      <div className="min-w-0 flex-1">
                        <p className="m-0 text-[11.5px] font-medium truncate">{m.attachmentName}</p>
                        {m.attachmentSize && (
                          <span className="text-[10.5px] opacity-75 mono">
                            {Math.round(m.attachmentSize / 1024)} KB · Saved in Vault
                          </span>
                        )}
                      </div>
                      {m.documentId && (
                        <a
                          href={`/api/documents/${m.documentId}/file`}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-ghost !p-1 text-[11px] underline opacity-90 hover:opacity-100"
                        >
                          View
                        </a>
                      )}
                      {userRole === "STAFF" && m.documentId && !isMe && (
                        <button
                          type="button"
                          onClick={() => handleSaveToVault(m.documentId as number)}
                          disabled={saveState[m.documentId] === "saving"}
                          className="btn btn-ghost !p-1 text-[11px] underline opacity-90 hover:opacity-100"
                          title="File it into the Document Vault"
                        >
                          {saveState[m.documentId] === "saving"
                            ? "Saving…"
                            : saveState[m.documentId] === "saved"
                              ? "Saved ✓"
                              : saveState[m.documentId] === "error"
                                ? "Retry"
                                : "Save to Vault"}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Message meta — WhatsApp-style ticks: sent / received / seen */}
                  <div
                    className={`flex items-center justify-end gap-1 mt-1 text-[10.5px] mono ${
                      isMe ? "text-white/80" : "text-[var(--ink-faint)]"
                    }`}
                  >
                    <span>{timeStr}</span>
                    {isMe &&
                      (() => {
                        const t = tickFor(m, isMe);
                        return (
                          <span className="flex items-center gap-0.5" style={{ color: t.tone }} title={t.label}>
                            <ICheck size={11} />
                            {t.label === "seen" && <ICheck size={11} />}
                            <span className="ml-0.5 lowercase">{t.label}</span>
                          </span>
                        );
                      })()}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Upload progress rows — filename + bar while sending */}
      {pendingFiles.length > 0 && (
        <div className="px-3.5 pt-2 space-y-1.5 shrink-0">
          {pendingFiles.map((p) => (
            <div key={p.name} className="rounded-lg px-2.5 py-1.5" style={{ background: "var(--tint)" }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium truncate">📎 {p.name}</span>
                <span className="text-[10.5px] mono text-[var(--ink-faint)] shrink-0">{p.pct}%</span>
              </div>
              <div className="h-1 rounded-full mt-1 overflow-hidden" style={{ background: "var(--line-soft)" }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${p.pct}%`, background: "var(--brand-mint, #10b981)" }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Send / upload errors surface inline — never silent */}
      {sendError && (
        <div className="px-3.5 pt-2 shrink-0">
          <div
            className="rounded-lg px-2.5 py-1.5 text-[11.5px] flex items-center justify-between gap-2"
            style={{ background: "rgba(244,63,94,0.1)", color: "var(--coral, #f43f5e)" }}
          >
            <span className="truncate">⚠ {sendError}</span>
            <button type="button" onClick={() => setSendError(null)} className="shrink-0 underline text-[11px]">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Input Row */}
      <form
        onSubmit={handleSend}
        className="p-2.5 border-t flex items-center gap-2 bg-[var(--bg2)] shrink-0"
        style={{ borderColor: "var(--line-soft)" }}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileUpload}
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={pendingFiles.length > 0}
          className="btn btn-ghost !p-2 text-[var(--ink-faint)] hover:text-[var(--ink)] shrink-0"
          title="Attach document or image"
        >
          {pendingFiles.length > 0 ? "…" : <IUpload size={17} />}
        </button>

        <input
          type="text"
          className="input flex-1 !py-1.5 !px-3 text-[13px] rounded-full"
          placeholder="Type a message..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={sending || pendingFiles.length > 0}
        />

        <button
          type="submit"
          disabled={!text.trim() || sending}
          className="btn btn-primary !rounded-full !px-3.5 !py-1.5 text-[12.5px] font-semibold shrink-0"
        >
          {sending ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
