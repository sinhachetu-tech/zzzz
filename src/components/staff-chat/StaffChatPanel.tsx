"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { StaffMessageDto, StaffRoomDto } from "@/lib/types";
import { useHfmcStore } from "@/lib/client-store";

interface Props {
  room: StaffRoomDto;
  onBack: () => void;
}

export function StaffChatPanel({ room, onBack }: Props) {
  const me = useHfmcStore((s) => s.me);
  const [messages, setMessages] = useState<StaffMessageDto[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch initial messages
  useEffect(() => {
    fetch(`/api/staff-chat/rooms/${room.id}/messages?limit=80`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.items)) setMessages(d.items);
      })
      .catch(() => {});

    // Mark as read
    fetch(`/api/staff-chat/rooms/${room.id}/read`, { method: "POST" }).catch(() => {});
  }, [room.id]);

  // SSE subscription
  useEffect(() => {
    const es = new EventSource(`/api/staff-chat/rooms/${room.id}/messages?stream=true`);
    esRef.current = es;

    es.addEventListener("message", (e) => {
      try {
        const msg: StaffMessageDto = JSON.parse(e.data);
        setMessages((prev) => {
          if (prev.find((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        // Auto-mark read when panel is open
        fetch(`/api/staff-chat/rooms/${room.id}/read`, { method: "POST" }).catch(() => {});
      } catch {}
    });

    return () => { es.close(); };
  }, [room.id]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput("");
    try {
      const res = await fetch(`/api/staff-chat/rooms/${room.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.item) {
          setMessages((prev) =>
            prev.find((m) => m.id === d.item.id) ? prev : [...prev, d.item]
          );
        }
      }
    } catch {} finally {
      setSending(false);
    }
  }, [input, room.id, sending]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploading(true);
    setUploadPct(2);
    setUploadError(null);

    try {
      const item: StaffMessageDto = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/staff-chat/rooms/${room.id}/upload`);
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            setUploadPct(Math.max(2, Math.round((ev.loaded / ev.total) * 96)));
          }
        };
        xhr.onload = () => {
          setUploadPct(100);
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText).item as StaffMessageDto);
            } catch {
              reject(new Error("Upload finished but response was unreadable."));
            }
          } else {
            try {
              reject(new Error(JSON.parse(xhr.responseText).error || `Upload failed (${xhr.status})`));
            } catch {
              reject(new Error(`Upload failed (${xhr.status})`));
            }
          }
        };
        xhr.onerror = () => reject(new Error("Upload failed — check your network connection."));

        const fd = new FormData();
        fd.append("file", file);
        if (input.trim()) {
          fd.append("text", input.trim());
          setInput("");
        }
        xhr.send(fd);
      });

      setMessages((prev) => (prev.find((m) => m.id === item.id) ? prev : [...prev, item]));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed — try again.");
    } finally {
      setUploading(false);
      setUploadPct(0);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // Group consecutive messages by same sender
  function groupMessages() {
    const groups: { senderId: number; senderName: string; msgs: StaffMessageDto[] }[] = [];
    for (const m of messages) {
      const last = groups[groups.length - 1];
      if (last && last.senderId === m.senderId) {
        last.msgs.push(m);
      } else {
        groups.push({ senderId: m.senderId, senderName: m.senderName, msgs: [m] });
      }
    }
    return groups;
  }

  const isMe = (senderId: number) => me?.id === senderId;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 border-b shrink-0"
        style={{ borderColor: "var(--line-soft)" }}
      >
        <button
          type="button"
          onClick={onBack}
          className="p-1.5 rounded-lg transition-colors hover:bg-[var(--hover)] text-[var(--ink-faint)]"
          title="Back to rooms"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[13px] text-[var(--ink)] truncate">{room.name}</div>
          {!room.isDirect && (
            <div className="text-[10.5px] text-[var(--ink-faint)]">
              {room.members.length} member{room.members.length !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3" style={{ overscrollBehavior: "contain" }}>
        {messages.length === 0 && (
          <div className="text-center text-[12px] text-[var(--ink-faint)] pt-8">
            No messages yet. Say hello 👋
          </div>
        )}

        {groupMessages().map((group, gi) => {
          const mine = isMe(group.senderId);
          return (
            <div key={gi} className={`flex flex-col gap-0.5 ${mine ? "items-end" : "items-start"}`}>
              {/* Sender name — group rooms only, not DMs, not for "me" */}
              {!room.isDirect && !mine && (
                <span className="text-[10.5px] font-medium text-[var(--ink-faint)] px-1">
                  {group.senderName}
                </span>
              )}
              {group.msgs.map((m) => {
                const isImage = m.mimeType?.startsWith("image/");
                return (
                  <div
                    key={m.id}
                    className={`max-w-[85%] px-3 py-2 rounded-2xl text-[12.5px] leading-relaxed flex flex-col gap-1.5 ${
                      mine
                        ? "rounded-br-sm text-white"
                        : "rounded-bl-sm text-[var(--ink)]"
                    }`}
                    style={{
                      background: mine
                        ? "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)"
                        : "var(--raised)",
                      border: mine ? "none" : "1px solid var(--line-soft)",
                      wordBreak: "break-word",
                    }}
                  >
                    {/* Attachment card */}
                    {m.attachmentName && (
                      <div className="flex flex-col gap-1 w-full">
                        {isImage && (
                          <a
                            href={`/api/staff-chat/messages/${m.id}/file`}
                            target="_blank"
                            rel="noreferrer"
                            className="block rounded-lg overflow-hidden border border-black/10 hover:opacity-95 transition-opacity"
                          >
                            <img
                              src={`/api/staff-chat/messages/${m.id}/file`}
                              alt={m.attachmentName}
                              className="max-h-52 w-full object-cover rounded-lg"
                              loading="lazy"
                            />
                          </a>
                        )}
                        <div
                          className={`p-2 rounded-xl flex items-center gap-2.5 ${
                            mine ? "bg-black/15 text-white" : "bg-[var(--tint)] text-[var(--ink)]"
                          }`}
                        >
                          <span className="text-base select-none shrink-0">📎</span>
                          <div className="min-w-0 flex-1">
                            <p className="m-0 text-[12px] font-medium truncate leading-tight">{m.attachmentName}</p>
                            {m.attachmentSize ? (
                              <span className="text-[10px] opacity-75 mono block mt-0.5">
                                {m.attachmentSize > 1048576
                                  ? `${(m.attachmentSize / 1048576).toFixed(1)} MB`
                                  : `${Math.round(m.attachmentSize / 1024)} KB`}
                              </span>
                            ) : null}
                          </div>
                          <a
                            href={`/api/staff-chat/messages/${m.id}/file`}
                            target="_blank"
                            rel="noreferrer"
                            className={`p-1 px-2.5 rounded-md text-[11px] font-medium transition-colors shrink-0 ${
                              mine
                                ? "bg-white/20 hover:bg-white/30 text-white"
                                : "bg-[var(--raised)] hover:bg-[var(--hover)] text-[var(--ink)] border border-[var(--line-soft)]"
                            }`}
                          >
                            View
                          </a>
                        </div>
                      </div>
                    )}

                    {/* Text */}
                    {m.text && <div>{m.text}</div>}
                  </div>
                );
              })}
              {/* Timestamp of last bubble in group */}
              <span className="text-[10px] text-[var(--ink-faint)] px-1">
                {new Date(group.msgs[group.msgs.length - 1].sentAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Upload progress */}
      {uploading && (
        <div className="px-3 pt-2 shrink-0">
          <div className="rounded-lg px-2.5 py-1.5" style={{ background: "var(--tint)" }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium truncate">📎 Uploading attachment…</span>
              <span className="text-[10.5px] mono text-[var(--ink-faint)] shrink-0">{uploadPct}%</span>
            </div>
            <div className="h-1 rounded-full mt-1 overflow-hidden" style={{ background: "var(--line-soft)" }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${uploadPct}%`, background: "#6366f1" }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Upload error banner */}
      {uploadError && (
        <div className="px-3 pt-2 shrink-0">
          <div
            className="rounded-lg px-2.5 py-1.5 text-[11.5px] flex items-center justify-between gap-2"
            style={{ background: "rgba(244,63,94,0.1)", color: "var(--coral, #f43f5e)" }}
          >
            <span>{uploadError}</span>
            <button
              type="button"
              onClick={() => setUploadError(null)}
              className="text-xs hover:opacity-80 p-1"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <div
        className="px-3 py-2.5 border-t flex gap-2 items-end shrink-0"
        style={{ borderColor: "var(--line-soft)" }}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileUpload}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-colors hover:bg-[var(--hover)] text-[var(--ink-faint)] disabled:opacity-40"
          title="Attach a file"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        </button>
        <textarea
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="Message…"
          className="flex-1 resize-none rounded-xl px-3 py-2 text-[13px] outline-none"
          style={{
            background: "var(--raised)",
            border: "1px solid var(--line-soft)",
            color: "var(--ink)",
            minHeight: "36px",
            maxHeight: "96px",
          }}
        />
        <button
          type="button"
          onClick={send}
          disabled={!input.trim() || sending}
          className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all disabled:opacity-40"
          style={{
            background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
            color: "#fff",
          }}
          title="Send"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
