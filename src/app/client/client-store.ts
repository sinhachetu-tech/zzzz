"use client";

import { create } from "zustand";
import { confirmDiscard, setUnsavedChanges } from "@/lib/leave-guard";

interface ClientUser {
  caseId: number;
  phone: string;
  caseNumber: string;
  customer: string;
}

interface Engagement {
  id: number; caseNumber: string; banks: string[]; stage: string; caseStatus: string; loanAmount: number; wonBank: string | null;
}

interface ClientState {
  me: ClientUser | null;
  engagements: Engagement[];
  case: import("@/lib/types").LoanCase | null;
  stages: { id: number; label: string; sortOrder: number; active: boolean }[];
  stageTransitions: { id: number; fromStage: string; toStage: string; comment: string; userName: string; at: string }[];
  documents: { id: number; fileName: string; fileType: string; fileSize: number; uploadedAt: string }[];
  vaultDocuments: { id: number; title: string; category: string; status: string; clientCanUpload: boolean; rejectionReason: string; notes: string; fileName: string | null; fileSize: number | null; uploadedAt: string | null }[];
  advisor: { name: string; role: string } | null;
  advisorWhatsapp: string | null;
  profile: unknown;
  profileClientVerifiedAt: string | null;
  loaded: boolean;
  hydrate: (caseId?: number) => Promise<void>;
  switchCase: (caseId: number) => Promise<void>;
  logout: () => Promise<void>;
}

export const useClientStore = create<ClientState>((set, get) => ({
  me: null, engagements: [], case: null, profile: null, profileClientVerifiedAt: null, stages: [], stageTransitions: [], documents: [], vaultDocuments: [], advisor: null, advisorWhatsapp: null, loaded: false,
  hydrate: async (caseId) => {
    try {
      const res = await fetch("/api/client/state" + (caseId ? `?caseId=${caseId}` : ""), { cache: "no-store" });
      if (res.status === 401) { set({ me: null, loaded: true }); return; }
      const data = await res.json();
      set({ ...data, loaded: true });
    } catch { set({ me: null, loaded: true }); }
  },
  // Switching to the client's OTHER bank journey re-hydrates the whole portal, so
  // an unsaved draft on the current one would vanish. Same guard as the staff
  // store's `nav`.
  switchCase: async (caseId) => {
    if (!confirmDiscard("changes on this form")) return;
    setUnsavedChanges(false);
    await get().hydrate(caseId);
  },
  logout: async () => {
    await fetch("/api/client/logout", { method: "POST" }).catch(() => {});
    set({ me: null, case: null, loaded: true });
    window.location.reload();
  },
}));
