"use client";

import { create } from "zustand";

interface ClientUser {
  caseId: number;
  phone: string;
  caseNumber: string;
  customer: string;
}

interface ClientState {
  me: ClientUser | null;
  case: import("@/lib/types").LoanCase | null;
  stages: { id: number; label: string; sortOrder: number; active: boolean }[];
  stageTransitions: { id: number; fromStage: string; toStage: string; comment: string; userName: string; at: string }[];
  documents: { id: number; fileName: string; fileType: string; fileSize: number; uploadedAt: string }[];
  vaultDocuments: { id: number; title: string; category: string; status: string; clientCanUpload: boolean; rejectionReason: string; notes: string; fileName: string | null; fileSize: number | null; uploadedAt: string | null }[];
  advisor: { name: string; role: string } | null;
  loaded: boolean;
  hydrate: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useClientStore = create<ClientState>((set, get) => ({
  me: null, case: null, stages: [], stageTransitions: [], documents: [], vaultDocuments: [], advisor: null, loaded: false,
  hydrate: async () => {
    try {
      const res = await fetch("/api/client/state", { cache: "no-store" });
      if (res.status === 401) { set({ me: null, loaded: true }); return; }
      const data = await res.json();
      set({ ...data, loaded: true });
    } catch { set({ me: null, loaded: true }); }
  },
  logout: async () => {
    await fetch("/api/client/logout", { method: "POST" }).catch(() => {});
    set({ me: null, case: null, loaded: true });
    window.location.reload();
  },
}));
