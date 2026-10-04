"use client";

import { useState, useCallback } from "react";
import type { User } from "@/lib/types";

interface Props {
  onCreated: (roomId: number, roomName: string) => void;
  onClose: () => void;
  users: Pick<User, "id" | "name">[];
  myId: number;
}

export function CreateGroupModal({ onCreated, onClose, users, myId }: Props) {
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const filtered = users.filter(
    (u) =>
      u.id !== myId &&
      u.name.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const create = useCallback(async () => {
    const trimName = name.trim();
    if (!trimName) { setError("Room name is required"); return; }
    if (selected.size === 0) { setError("Select at least one other member"); return; }

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/staff-chat/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimName, memberIds: [...selected] }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to create room");
      }
      const d = await res.json();
      onCreated(d.item.id, d.item.name);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [name, selected, onCreated]);

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ background: "var(--card)", maxHeight: "80vh" }}
      >
        {/* Modal header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: "var(--line-soft)" }}
        >
          <span className="font-semibold text-[14px] text-[var(--ink)]">New group</span>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--ink-faint)] hover:text-[var(--ink)] transition-colors p-1 rounded-lg hover:bg-[var(--hover)]"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3 overflow-y-auto">
          {/* Room name */}
          <div>
            <label className="text-[11.5px] font-medium text-[var(--ink-faint)] mb-1 block">Room name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Dubai Team, Mortgage Desk…"
              maxLength={60}
              className="w-full px-3 py-2 rounded-xl text-[13px] outline-none"
              style={{
                background: "var(--raised)",
                border: "1px solid var(--line-soft)",
                color: "var(--ink)",
              }}
            />
          </div>

          {/* Member search */}
          <div>
            <label className="text-[11.5px] font-medium text-[var(--ink-faint)] mb-1 block">
              Add members
              {selected.size > 0 && (
                <span className="ml-2 text-[var(--mint)]">{selected.size} selected</span>
              )}
            </label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search staff…"
              className="w-full px-3 py-2 rounded-xl text-[13px] outline-none mb-2"
              style={{
                background: "var(--raised)",
                border: "1px solid var(--line-soft)",
                color: "var(--ink)",
              }}
            />
            <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
              {filtered.map((u) => (
                <label
                  key={u.id}
                  className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors hover:bg-[var(--hover)]"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(u.id)}
                    onChange={() => toggle(u.id)}
                    className="accent-indigo-500"
                  />
                  {/* Avatar */}
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                    style={{ background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)" }}
                  >
                    {u.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="text-[12.5px] text-[var(--ink)]">{u.name}</span>
                </label>
              ))}
              {filtered.length === 0 && (
                <div className="text-[12px] text-[var(--ink-faint)] text-center py-4">No staff found</div>
              )}
            </div>
          </div>

          {error && <div className="text-[12px] text-[var(--coral,#f43f5e)]">{error}</div>}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t flex gap-2 justify-end" style={{ borderColor: "var(--line-soft)" }}>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-[12.5px] text-[var(--ink-faint)] hover:bg-[var(--hover)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={create}
            disabled={loading}
            className="px-4 py-1.5 rounded-lg text-[12.5px] font-semibold text-white transition-opacity disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)" }}
          >
            {loading ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
