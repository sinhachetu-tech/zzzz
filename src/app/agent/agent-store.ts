"use client";
import { create } from "zustand";

interface AgentUser { partnerId: number; name: string; kind: string; email: string; }
interface AgentCase {
  id: number; caseNumber: string; customer: string; stage: string; caseStatus: string;
  loanAmount: number; banks: string[]; wonBank: string | null; source: string;
  partner: { kind: string; name: string; sharePct: number } | null;
  commission: { gross: number; channelCut: number; partnerCut: number; net: number; bank: string | null; ratePct: number };
  statusNote: string; createdAt: string; updatedAt: string;
}
interface AgentState {
  me: AgentUser | null;
  cases: AgentCase[];
  stages: { id: number; label: string; sortOrder: number }[];
  stats: { activeCount: number; bookedCount: number; lostCount: number; totalPipelineValue: number; totalCommissionEarned: number; projectedCommission: number; };
  loaded: boolean;
  hydrate: () => Promise<void>;
  logout: () => Promise<void>;
}
export const useAgentStore = create<AgentState>((set) => ({
  me: null, cases: [], stages: [], stats: { activeCount: 0, bookedCount: 0, lostCount: 0, totalPipelineValue: 0, totalCommissionEarned: 0, projectedCommission: 0 }, loaded: false,
  hydrate: async () => {
    try {
      const res = await fetch("/api/agent/state", { cache: "no-store" });
      if (res.status === 401) { set({ me: null, loaded: true }); return; }
      const data = await res.json();
      set({ ...data, loaded: true });
    } catch { set({ me: null, loaded: true }); }
  },
  logout: async () => {
    document.cookie = "hfmc_agent_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    set({ me: null, loaded: true });
    window.location.reload();
  },
}));
