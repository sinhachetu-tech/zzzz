"use client";

import { create } from "zustand";
import type {
  Activity, BankItem, BankProduct, BulletinItem, CaseDocument, CasePartner, CaseSource, ChannelItem, ClientDto, Designation, DocRule,
  CaseUpdate, EmailLog, FeeRule, Proposal, Instruction, LoanCase, MasterItem, PartnerItem, SlaRule, StageItem, StageTransitionDto, Task, UnmatchedEmail, User,
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
  eibor: { tenor: string; ratePct: number; updatedOn: string; note: string; effectiveFrom?: string | null; updatedBy?: string; updatedAt?: string }[];
  stageTransitions: StageTransitionDto[];
  caseDocuments: CaseDocument[];
  bankProducts: BankProduct[];
  caseUpdates: CaseUpdate[];
  caseProposals: Proposal[];
  unmatchedEmails: UnmatchedEmail[];
  emails: EmailLog[];
  clients: ClientDto[];
}

interface ToastMsg {
  id: number;
  kind: "success" | "error" | "info";
  msg: string;
}

export type Route =
  | { name: "dashboard" }
  | { name: "cases" }
  | { name: "leads" }
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
    bankRms?: Record<string, string>; partnerRm?: string | null;
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

  // proposals
  saveProposal: (body: { caseId: number; productIds: number[]; inputs: Record<string, unknown>; mode: string }) => Promise<void>;
  setProposalStatus: (id: number, status: string) => Promise<void>;

  // daily MIS
  addCaseUpdate: (caseId: number, note: string, onHold: boolean, holdReason: string) => Promise<void>;
  deleteCase: (id: number) => Promise<void>;
  saveEibor: (tenor: string, ratePct: number, effectiveFrom?: string | null, note?: string, publishedOn?: string) => Promise<void>;

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
  partners: [], channels: [], slaRules: [], instructions: [], bulletin: [], caseUpdates: [], caseProposals: [],
  escalations: 0, docRules: [], feeRules: [], eibor: [], stageTransitions: [], caseDocuments: [], bankProducts: [], unmatchedEmails: [], emails: [], clients: [],
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
    const data = await res.json();
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
    return { ...data.case, __cases: data.cases };
  },
  updateCase: async (id, patch) => {
    await fetch(`/api/cases/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
  },
  addTask: async (caseId, input) => {
    await fetch(`/api/cases/${caseId}/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
  },
  completeTask: async (id, remarks) => {
    await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "Done", remarks }) });
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
  },
  reopenTask: async (id) => {
    await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "Open" }) });
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
  },
  deleteTask: async (id) => {
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
  },
  createBulletin: async (input) => {
    await fetch("/api/bulletin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
  },
  completeBulletin: async (id) => {
    await fetch(`/api/bulletin/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "complete" }) });
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
  },
  dropBulletin: async (id) => {
    await fetch(`/api/bulletin/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "drop" }) });
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
  },
  carryBulletin: async (id) => {
    await fetch(`/api/bulletin/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "carry" }) });
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
  },
  replyBulletin: async (id, text) => {
    await fetch(`/api/bulletin/${id}/replies`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
  },
  issueInstruction: async (input) => {
    await fetch("/api/instructions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
  },
  completeInstruction: async (id) => {
    await fetch(`/api/instructions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "complete" }) });
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
  },
  replyInstruction: async (id, text) => {
    await fetch(`/api/instructions/${id}/replies`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
  },

  saveProposal: async (body) => {
    const res = await fetch(`/api/proposals`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      get().toast("error", e.error || "Could not save proposal.");
      return;
    }
    get().toast("success", "Proposal saved to the case.");
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
  },
  setProposalStatus: async (id, status) => {
    await fetch(`/api/proposals`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
  },
  addCaseUpdate: async (caseId, note, onHold, holdReason) => {
    const res = await fetch(`/api/case-updates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caseId, note, onHold, holdReason }) });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      get().toast("error", e.error || "Could not save the update.");
      return;
    }
    get().toast("success", "Daily update saved.");
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
  },
  deleteCase: async (id) => {
    const res = await fetch(`/api/cases/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      get().toast("error", e.error || "Could not delete.");
      return;
    }
    get().toast("success", "Deleted.");
    const r = get().route;
    if (r.name === "case" && r.id === id) get().nav({ name: "leads" });
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
  },
  saveEibor: async (tenor, ratePct, effectiveFrom, note, publishedOn) => {
    const res = await fetch("/api/eibor", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenor, ratePct, effectiveFrom, note, publishedOn }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || "Could not save the rate.");
    }
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
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
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
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
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
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
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
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
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
  },
  deleteDoc: async (id) => {
    await fetch(`/api/documents/${id}`, { method: "DELETE" });
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
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
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
  },

  linkEmail: async (unmatchedId, caseId) => {
    await fetch(`/api/email/unmatched/${unmatchedId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "link", caseId }),
    });
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
  },
  ignoreEmail: async (unmatchedId) => {
    await fetch(`/api/email/unmatched/${unmatchedId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ignore" }),
    });
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
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
