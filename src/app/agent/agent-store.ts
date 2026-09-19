"use client";
import { create } from "zustand";

export type AgentRoute = "home" | "addlead" | "leads" | "tools" | "profile";

export interface AgentUser { partnerId: number; name: string; kind: string; email: string; }
export interface AgentCase {
  id: number; caseNumber: string; customer: string; stage: string; caseStatus: string;
  loanAmount: number; banks: string[]; wonBank: string | null; source: string;
  partner: { kind: string; name: string; sharePct: number } | null;
  commission: { gross: number; channelCut: number; partnerCut: number; net: number; bank: string | null; ratePct: number };
  statusNote: string; createdAt: string; updatedAt: string;
}
export interface AgentProfile {
  sharePct: number;
  email: string; phone: string; about: string; expertise: string;
  iban: string; ibanVerified: boolean;
  licenseNo: string; licenseVerified: boolean;
  avatarData: string;
}
interface AgentState {
  me: AgentUser | null;
  route: AgentRoute;
  cases: AgentCase[];
  stages: { id: number; label: string; sortOrder: number }[];
  profile: AgentProfile | null;
  banks: { name: string; ratePct: number }[];
  desk: { name: string; phone: string } | null;
  stats: { activeCount: number; bookedCount: number; lostCount: number; totalPipelineValue: number; totalCommissionEarned: number; projectedCommission: number; };
  loaded: boolean;
  setRoute: (r: AgentRoute) => void;
  hydrate: () => Promise<void>;
  createLead: (input: { name: string; phone: string; email?: string; description?: string }) => Promise<{ ok: boolean; error?: string }>;
  saveProfile: (patch: Partial<AgentProfile>) => Promise<{ ok: boolean; error?: string }>;
  changePassword: (current: string, next: string) => Promise<{ ok: boolean; error?: string }>;
  deleteAccount: (password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
}
export const useAgentStore = create<AgentState>((set, get) => ({
  me: null, route: "home", cases: [], stages: [], profile: null, banks: [], desk: null,
  stats: { activeCount: 0, bookedCount: 0, lostCount: 0, totalPipelineValue: 0, totalCommissionEarned: 0, projectedCommission: 0 }, loaded: false,
  setRoute: (r) => set({ route: r }),
  hydrate: async () => {
    try {
      const res = await fetch("/api/agent/state", { cache: "no-store" });
      if (res.status === 401) { set({ me: null, loaded: true }); return; }
      const data = await res.json();
      set({ ...data, loaded: true });
    } catch { set({ me: null, loaded: true }); }
  },
  createLead: async (input) => {
    try {
      const res = await fetch("/api/agent/lead", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        return { ok: false, error: e.error || "Could not create lead." };
      }
      get().hydrate().catch(() => {});
      return { ok: true };
    } catch { return { ok: false, error: "Network error." }; }
  },
  saveProfile: async (patch) => {
    try {
      const res = await fetch("/api/agent/profile", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        return { ok: false, error: e.error || "Save failed." };
      }
      const data = await res.json();
      set({ profile: data.profile });
      return { ok: true };
    } catch { return { ok: false, error: "Network error." }; }
  },
  changePassword: async (current, next) => {
    try {
      const res = await fetch("/api/agent/password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, next }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        return { ok: false, error: e.error || "Could not change password." };
      }
      return { ok: true };
    } catch { return { ok: false, error: "Network error." }; }
  },
  deleteAccount: async (password) => {
    try {
      const res = await fetch("/api/agent/account", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        return { ok: false, error: e.error || "Could not delete account." };
      }
      return { ok: true };
    } catch { return { ok: false, error: "Network error." }; }
  },
  logout: async () => {
    document.cookie = "hfmc_agent_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    set({ me: null, loaded: true });
    window.location.reload();
  },
}));
