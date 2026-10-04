"use client";

import { useState, useEffect, useCallback } from "react";
import type { StaffRoomDto } from "@/lib/types";
import { useHfmcStore } from "@/lib/client-store";
import { StaffChatPanel } from "./StaffChatPanel";
import { CreateGroupModal } from "./CreateGroupModal";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onUnreadChange?: (total: number) => void;
}

type View = { type: "list" } | { type: "room"; room: StaffRoomDto };
type DmTarget = { id: number; name: string } | null;

export function StaffChatDrawer({ isOpen, onClose, onUnreadChange }: Props) {
  const { me, users } = useHfmcStore();

  const [rooms, setRooms] = useState<StaffRoomDto[]>([]);
  const [view, setView] = useState<View>({ type: "list" });
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showDmPicker, setShowDmPicker] = useState(false);
  const [dmSearch, setDmSearch] = useState("");
  const [dmLoading, setDmLoading] = useState<number | null>(null);

  // Fetch rooms whenever the drawer opens
  const loadRooms = useCallback(async () => {
    if (!me) return;
    try {
      const res = await fetch("/api/staff-chat/rooms");
      if (res.ok) {
        const d = await res.json();
        if (Array.isArray(d.items)) {
          setRooms(d.items);
          const total = (d.items as StaffRoomDto[]).reduce((s, r) => s + r.unreadCount, 0);
          onUnreadChange?.(total);
        }
      }
    } catch {}
  }, [me, onUnreadChange]);

  useEffect(() => {
    if (isOpen) {
      loadRooms();
      setView({ type: "list" });
    }
  }, [isOpen, loadRooms]);

  // Refresh rooms every 15s while drawer is open
  useEffect(() => {
    if (!isOpen) return;
    const id = setInterval(loadRooms, 15_000);
    return () => clearInterval(id);
  }, [isOpen, loadRooms]);

  const openRoom = (room: StaffRoomDto) => {
    // Optimistically zero the unread count
    setRooms((prev) =>
      prev.map((r) => (r.id === room.id ? { ...r, unreadCount: 0 } : r))
    );
    setView({ type: "room", room });
  };

  const handleGroupCreated = (roomId: number, roomName: string) => {
    setShowCreateGroup(false);
    loadRooms().then(() => {
      setView({ type: "room", room: { id: roomId, name: roomName, isDirect: false, createdAt: new Date().toISOString(), createdById: me?.id ?? 0, unreadCount: 0, lastReadAt: null, lastMessage: null, lastMessageAt: null, lastMessageSender: null, members: [] } });
    });
  };

  const startDm = async (target: DmTarget) => {
    if (!target) return;
    setDmLoading(target.id);
    setShowDmPicker(false);
    setDmSearch("");
    try {
      const res = await fetch("/api/staff-chat/rooms/dm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: target.id }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.item) {
          await loadRooms();
          setView({ type: "room", room: d.item });
        }
      }
    } catch {} finally {
      setDmLoading(null);
    }
  };

  const drawerStyle: React.CSSProperties = {
    position: "fixed",
    bottom: "96px",
    right: "16px",
    width: "340px",
    height: "520px",
    zIndex: 100,
    background: "var(--card)",
    border: "1px solid var(--line-soft)",
    borderRadius: "20px",
    boxShadow: "0 24px 64px -12px rgba(0,0,0,0.4)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    transition: "opacity 0.18s ease, transform 0.18s ease",
    opacity: isOpen ? 1 : 0,
    transform: isOpen ? "translateY(0) scale(1)" : "translateY(12px) scale(0.97)",
    pointerEvents: isOpen ? "auto" : "none",
  };

  const staffUsers = (users ?? []).filter((u) => u.id !== me?.id);
  const dmFiltered = staffUsers.filter((u) =>
    u.name.toLowerCase().includes(dmSearch.toLowerCase())
  );

  const totalUnread = rooms.reduce((s, r) => s + r.unreadCount, 0);

  return (
    <>
      <div style={drawerStyle}>
        {view.type === "list" ? (
          <div className="flex flex-col h-full">
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-3 border-b shrink-0"
              style={{ borderColor: "var(--line-soft)" }}
            >
              <div>
                <span className="font-bold text-[14px] text-[var(--ink)]">Staff Chat</span>
                {totalUnread > 0 && (
                  <span
                    className="ml-2 text-[10.5px] font-bold px-1.5 py-0.5 rounded-full text-white"
                    style={{ background: "var(--coral, #f43f5e)" }}
                  >
                    {totalUnread}
                  </span>
                )}
              </div>
              <div className="flex gap-1">
                {/* DM button */}
                <button
                  type="button"
                  title="Direct message"
                  onClick={() => setShowDmPicker((v) => !v)}
                  className="p-1.5 rounded-lg text-[var(--ink-faint)] hover:text-[var(--ink)] hover:bg-[var(--hover)] transition-colors relative"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </button>
                {/* New group */}
                <button
                  type="button"
                  title="New group"
                  onClick={() => setShowCreateGroup(true)}
                  className="p-1.5 rounded-lg text-[var(--ink-faint)] hover:text-[var(--ink)] hover:bg-[var(--hover)] transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
                {/* Close */}
                <button
                  type="button"
                  title="Close"
                  onClick={onClose}
                  className="p-1.5 rounded-lg text-[var(--ink-faint)] hover:text-[var(--ink)] hover:bg-[var(--hover)] transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* DM Picker popover */}
            {showDmPicker && (
              <div
                className="absolute top-[52px] right-3 w-56 rounded-xl shadow-xl overflow-hidden z-10 border"
                style={{ background: "var(--card)", borderColor: "var(--line-soft)" }}
              >
                <div className="p-2">
                  <input
                    autoFocus
                    value={dmSearch}
                    onChange={(e) => setDmSearch(e.target.value)}
                    placeholder="Search staff…"
                    className="w-full px-2.5 py-1.5 rounded-lg text-[12.5px] outline-none"
                    style={{
                      background: "var(--raised)",
                      border: "1px solid var(--line-soft)",
                      color: "var(--ink)",
                    }}
                  />
                </div>
                <div className="max-h-48 overflow-y-auto pb-1">
                  {dmFiltered.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => startDm(u)}
                      disabled={dmLoading === u.id}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12.5px] text-[var(--ink)] hover:bg-[var(--hover)] transition-colors disabled:opacity-50"
                    >
                      <span
                        className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                        style={{ background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)" }}
                      >
                        {u.name.charAt(0).toUpperCase()}
                      </span>
                      {u.name}
                    </button>
                  ))}
                  {dmFiltered.length === 0 && (
                    <div className="text-[12px] text-[var(--ink-faint)] text-center py-3">No staff found</div>
                  )}
                </div>
              </div>
            )}

            {/* Room list */}
            <div className="flex-1 overflow-y-auto">
              {rooms.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--ink-faint)]">
                  <svg className="w-10 h-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
                  </svg>
                  <div className="text-[12.5px] text-center px-8">
                    No chats yet. Click the group icon to create a room, or the person icon for a DM.
                  </div>
                </div>
              )}
              {rooms.map((room) => (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => openRoom(room)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--hover)] border-b"
                  style={{ borderColor: "var(--line-soft)" }}
                >
                  {/* Avatar / icon */}
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-white text-[13px] font-bold"
                    style={{ background: room.isDirect ? "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)" : "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)" }}
                  >
                    {room.isDirect
                      ? room.name.charAt(0).toUpperCase()
                      : <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" /></svg>
                    }
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-[var(--ink)] truncate">{room.name}</span>
                      {room.lastMessageAt && (
                        <span className="text-[10px] text-[var(--ink-faint)] shrink-0 ml-1">
                          {new Date(room.lastMessageAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11.5px] text-[var(--ink-faint)] truncate">
                        {room.lastMessage
                          ? (room.lastMessageSender && !room.isDirect
                            ? `${room.lastMessageSender}: ${room.lastMessage}`
                            : room.lastMessage)
                          : "No messages yet"}
                      </span>
                      {room.unreadCount > 0 && (
                        <span
                          className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white"
                          style={{ background: "var(--coral, #f43f5e)" }}
                        >
                          {room.unreadCount > 9 ? "9+" : room.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <StaffChatPanel
            room={view.room}
            onBack={() => { setView({ type: "list" }); loadRooms(); }}
          />
        )}
      </div>

      {showCreateGroup && me && (
        <CreateGroupModal
          onCreated={handleGroupCreated}
          onClose={() => setShowCreateGroup(false)}
          users={staffUsers.map((u) => ({ id: u.id, name: u.name }))}
          myId={me.id}
        />
      )}
    </>
  );
}
