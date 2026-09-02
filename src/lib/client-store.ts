"use client";

import { create } from "zustand";
import type {
  Activity, BankItem, BulletinItem, CasePartner, CaseSource, Designation, Instruction,
  LoanCase, MasterItem, PartnerItem, SlaRule, StageItem, Task, User,
} from "./types";
import type { RoleFlags } from "./domain";

interface Me {
  id: number;
  name: string;
  email: string;
  role: string;
  team: string;
}

interface StateSnapshot {
  me: Me | null;
  flags: RoleFlags | null;
  users: User[];
  designations: Designation[];
  cases: LoanCase[];
  visibleCaseIds: number[];
  tasks: Task[];
  visibleTaskIds: number[];
  activities: Activity[];
  stages: StageItem[];
  whyPending: MasterItem[];
  waitingFor: MasterItem[];
  banks: BankItem[];
  partners: PartnerItem[];
  slaRules: SlaRule[];
  instructions: Instruction[];
  bulletin: BulletinItem[];
  escalations: number;
}

interface ToastMsg {
  id: number;
  kind: "success" | "error" | "info";
  msg: string;
}

export type Route =
  | { name: "dashboard" }
  | { name: "case"; id: number }
  | { name: "tasks" }
  | { name: "bulletin" }
  | { name: "calculator" }
  | { name: "reports" }
  | { name: "admin" };

interface HfmcState extends StateSnapshot {
  loaded: boolean;
  loading: boolean;
  toasts: ToastMsg[];
  route: Route;
  setRoute: (r: Route) => void;
  nav: (r: Route) => void;
  hydrate: () => Promise<void>;
  toast: (kind: ToastMsg["kind"], msg: string) => void;
  dismissToast: (id: number) => void;
  logout: () => Promise<void>;

  // mutations — call API then patch local state
  createCase: (input: {
    customer: string; banks: string[]; loanAmount: number; stage: string; ownerId: number;
    source: CaseSource; partner: CasePartner | null; whatsapp: string; waGroup: string | null;
    task?: { description: string; dueDate: string; waitingFor: string; whyPending: string; ownerId: number };
  }) => Promise<LoanCase>;
  updateCase: (id: number, patch: Record<string, unknown>) => Promise<void>;
  addTask: (caseId: number, input: { description: string; ownerId: number; waitingFor: string; whyPending: string; dueDate: string }) => Promise<void>;
  completeTask: (id: number, remarks?: string) => Promise<void>;
  reopenTask: (id: number) => Promise<void>;
  deleteTask: (id: number) => Promise<void>;
  createBulletin: (input: { task: string; caseId: number | null; targets: number[]; date?: string }) => Promise<void>;
  completeBulletin: (id: number) => Promise<void>;
  dropBulletin: (id: number) => Promise<void>;
  carryBulletin: (id: number) => Promise<void>;
  replyBulletin: (id: number, text: string) => Promise<void>;
  issueInstruction: (input: { caseId: number; instruction: string; assignedTo: number; dueDate: string }) => Promise<void>;
  completeInstruction: (id: number) => Promise<void>;
  replyInstruction: (id: number, text: string) => Promise<void>;

  // selectors
  userById: (id: number) => User | undefined;
  caseById: (id: number) => LoanCase | undefined;
  visibleCases: () => LoanCase[];
  visibleTasks: () => Task[];
  canInstruct: () => boolean;
}

const empty: StateSnapshot = {
  me: null, flags: null, users: [], designations: [], cases: [], visibleCaseIds: [], tasks: [],
  visibleTaskIds: [], activities: [], stages: [], whyPending: [], waitingFor: [], banks: [],
  partners: [], slaRules: [], instructions: [], bulletin: [], escalations: 0,
};

let toastSeq = 1;

export const useHfmcStore = create<HfmcState>((set, get) => ({
  ...empty,
  loaded: false,
  loading: false,
  toasts: [],
  route: { name: "dashboard" },
  setRoute: (r) => set({ route: r }),
  nav: (r) => set({ route: r }),
  toast: (kind, msg) => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, msg }] }));
    window.setTimeout(() => get().dismissToast(id), 4500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  logout: async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    set({ ...empty, loaded: false });
    window.location.reload();
  },
  hydrate: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (res.status === 401) {
        set({ ...empty, loaded: true, loading: false });
        return;
      }
      const data = await res.json();
      set({ ...data, loaded: true, loading: false });
    } catch {
      set({ ...empty, loaded: true, loading: false });
    }
  },

  createCase: async (input) => {
    const res = await fetch("/api/cases", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || "Could not open case");
    }
    const { case: c } = await res.json();
    await get().hydrate();
    return c;
  },
  updateCase: async (id, patch) => {
    await fetch(`/api/cases/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    await get().hydrate();
  },
  addTask: async (caseId, input) => {
    await fetch(`/api/cases/${caseId}/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    await get().hydrate();
  },
  completeTask: async (id, remarks) => {
    await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "Done", remarks }) });
    await get().hydrate();
  },
  reopenTask: async (id) => {
    await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "Open" }) });
    await get().hydrate();
  },
  deleteTask: async (id) => {
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    await get().hydrate();
  },
  createBulletin: async (input) => {
    await fetch("/api/bulletin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    await get().hydrate();
  },
  completeBulletin: async (id) => {
    await fetch(`/api/bulletin/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "complete" }) });
    await get().hydrate();
  },
  dropBulletin: async (id) => {
    await fetch(`/api/bulletin/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "drop" }) });
    await get().hydrate();
  },
  carryBulletin: async (id) => {
    await fetch(`/api/bulletin/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "carry" }) });
    await get().hydrate();
  },
  replyBulletin: async (id, text) => {
    await fetch(`/api/bulletin/${id}/replies`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    await get().hydrate();
  },
  issueInstruction: async (input) => {
    await fetch("/api/instructions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    await get().hydrate();
  },
  completeInstruction: async (id) => {
    await fetch(`/api/instructions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "complete" }) });
    await get().hydrate();
  },
  replyInstruction: async (id, text) => {
    await fetch(`/api/instructions/${id}/replies`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    await get().hydrate();
  },

  userById: (id) => get().users.find((u) => u.id === id),
  caseById: (id) => get().cases.find((c) => c.id === id),
  visibleCases: () => {
    const { cases, visibleCaseIds } = get();
    const set_ = new Set(visibleCaseIds);
    return cases.filter((c) => set_.has(c.id));
  },
  visibleTasks: () => {
    const { tasks, visibleTaskIds } = get();
    const set_ = new Set(visibleTaskIds);
    return tasks.filter((t) => set_.has(t.id));
  },
  canInstruct: () => {
    const f = get().flags;
    if (!f) return false;
    return f.issueTasks || f.super;
  },
}));
