"use client";

import { create } from "zustand";
import type {
  Activity, BankItem, BankProduct, BulletinItem, CaseDocument, CasePartner, CaseSource, ChannelItem, Designation, DocRule,
  CaseUpdate, FeeRule, Instruction, LoanCase, MasterItem, PartnerItem, SlaRule, StageItem, StageTransitionDto, Task, User,
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
  channels: ChannelItem[];
  slaRules: SlaRule[];
  instructions: Instruction[];
  bulletin: BulletinItem[];
  escalations: number;
  docRules: DocRule[];
  feeRules: FeeRule[];
  eibor: { tenor: string; ratePct: number; updatedOn: string; note: string }[];
  stageTransitions: StageTransitionDto[];
  caseDocuments: CaseDocument[];
  bankProducts: BankProduct[];
  caseUpdates: CaseUpdate[];
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
  newCaseOpen: boolean;
  openNewCase: () => void;
  closeNewCase: () => void;
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
    submissionType?: "direct" | "channel"; channelId?: number | null; channelName?: string | null; channelRatePct?: number;
    transactionType?: string; propertyLocation?: string | null; coApplicantName?: string | null; bankRm?: string | null; statusNote?: string;
    employmentProfile?: string; propertyType?: string; residency?: string;
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

  // daily MIS
  addCaseUpdate: (caseId: number, note: string, onHold: boolean, holdReason: string) => Promise<void>;

  // bank rules
  uploadBankLogo: (bankId: number, file: File) => Promise<void>;
  saveBankProduct: (id: number, patch: Record<string, unknown>) => Promise<void>;

  // document vault
  addAdhocDoc: (caseId: number, input: { title: string; category: string; mandatory: boolean; visibleToClient: boolean; clientCanUpload: boolean; notes?: string }) => Promise<void>;
  saveDoc: (id: number, patch: Record<string, unknown>) => Promise<void>;
  deleteDoc: (id: number) => Promise<void>;
  uploadDoc: (id: number, file: File) => Promise<void>;

  // email review queue
  linkEmail: (unmatchedId: number, caseId: number) => Promise<void>;
  ignoreEmail: (unmatchedId: number) => Promise<void>;

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
  partners: [], channels: [], slaRules: [], instructions: [], bulletin: [], caseUpdates: [],
  escalations: 0, docRules: [], feeRules: [], eibor: [], stageTransitions: [], caseDocuments: [], bankProducts: [],
};

let toastSeq = 1;

export const useHfmcStore = create<HfmcState>((set, get) => ({
  ...empty,
  loaded: false,
  loading: false,
  toasts: [],
  route: { name: "dashboard" },
  newCaseOpen: false,
  openNewCase: () => set({ newCaseOpen: true }),
  closeNewCase: () => set({ newCaseOpen: false }),
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
    // No loading guard — login needs to re-hydrate even if a mount-time hydrate
    // is still in flight. Multiple concurrent hydrates are safe: 401s never
    // clobber data/me, and 200s always win.
    set({ loading: true });
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (res.status === 401) {
        // Do NOT touch `me` or the workspace data. A 401 here almost always
        // means the request was dispatched before the session cookie settled
        // (the mount-time hydrate, or a retry fired milliseconds after login).
        // If we cleared data, a late-resolving 401 would wipe a 200 that had
        // just loaded the workspace. `me` stays as the caller set it; data
        // stays as it was (empty on first load, populated after a 200).
        set((s) => ({ loaded: true, loading: false, me: s.me }));
        return;
      }
      const data = await res.json();
      set({ ...data, loaded: true, loading: false });
    } catch {
      set((s) => ({ loaded: true, loading: false, me: s.me }));
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

  addCaseUpdate: async (caseId, note, onHold, holdReason) => {
    const res = await fetch(`/api/case-updates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caseId, note, onHold, holdReason }) });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      get().toast("error", e.error || "Could not save the update.");
      return;
    }
    get().toast("success", "Daily update saved.");
    await get().hydrate();
  },
  uploadBankLogo: async (bankId, file) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/banks/${bankId}/logo`, { method: "POST", body: fd });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      get().toast("error", e.error || "Logo upload failed.");
      return;
    }
    get().toast("success", "Logo uploaded.");
    await get().hydrate();
  },
  saveBankProduct: async (id, patch) => {
    const res = await fetch("/api/admin", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "bankproduct", id, ...patch }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      get().toast("error", e.error || "Could not save product rules.");
      return;
    }
    get().toast("success", "Bank product rules saved.");
    await get().hydrate();
  },
  addAdhocDoc: async (caseId, input) => {
    const res = await fetch("/api/documents", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caseId, ...input }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      get().toast("error", e.error || "Could not add document.");
      return;
    }
    await get().hydrate();
  },
  saveDoc: async (id, patch) => {
    const res = await fetch(`/api/documents/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      get().toast("error", e.error || "Could not update document.");
      return;
    }
    await get().hydrate();
  },
  deleteDoc: async (id) => {
    await fetch(`/api/documents/${id}`, { method: "DELETE" });
    await get().hydrate();
  },
  uploadDoc: async (id, file) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/documents/${id}/upload`, { method: "POST", body: fd });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      get().toast("error", e.error || "Upload failed.");
      return;
    }
    get().toast("success", "Document uploaded — pending review.");
    await get().hydrate();
  },

  linkEmail: async (unmatchedId, caseId) => {
    await fetch(`/api/email/unmatched/${unmatchedId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "link", caseId }),
    });
    await get().hydrate();
  },
  ignoreEmail: async (unmatchedId) => {
    await fetch(`/api/email/unmatched/${unmatchedId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ignore" }),
    });
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
