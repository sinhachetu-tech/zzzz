"use client";

import { create } from "zustand";
import type {
  Activity, BankItem, BankProduct, BulletinItem, CaseDocument, CasePartner, CaseParty, CaseSource, ChannelItem, ClientDto, CommTemplate, Designation, DocRule,
  CaseUpdate, EmailLog, FeeRule, Proposal, Instruction, Lead, LoanCase, MasterItem, PartnerItem, PartyRole, ServiceLineDto, SlaRule, StageItem, StageTransitionDto, Task, UnmatchedEmail, User,
} from "./types";
import type { RoleFlags } from "./domain";
import { confirmDiscard, setUnsavedChanges } from "./leave-guard";

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
  milestoneDates: MasterItem[];
  banks: BankItem[];
  /** Lines of business + their products (Phase 1). Populated by /api/state. */
  serviceLines: ServiceLineDto[];
  /**
   * Leads (Phase 4) — the funnel's own entity. Deliberately separate from
   * `cases`: a lead is cheap to create and cheap to kill, a case is not.
   */
  leads: Lead[];
  partners: PartnerItem[];
  channels: ChannelItem[];
  slaRules: SlaRule[];
  commTemplates: CommTemplate[];
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
  /**
   * Case parties (Phase A) — everyone on a case in a role. Already filtered to
   * the cases this user may see, so the UI never has to re-check visibility.
   */
  caseParties: CaseParty[];
  promotions: import("./types").Promotion[]; // Tier-4 promo overlay — applied on top of base pricing
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
  | { name: "clients"; clientId?: number }
  | { name: "case"; id: number }
  | { name: "tasks" }
  | { name: "bulletin" }
  | { name: "calculator" }
  | { name: "reports" }
  | { name: "products" }
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
    advisorId?: number | null; // client-facing advisor (senior) — pairs name + number on the client's Ask card
    backup1Id?: number | null; // first backup staffer — covers the file while the owner is on leave
    backup2Id?: number | null; // second backup staffer — covers the file while the owner is on leave
    source: CaseSource; partner: CasePartner | null; whatsapp: string; waGroup: string | null;
    task?: { description: string; dueDate: string; waitingFor: string; whyPending: string; ownerId: number };
    submissionType?: "direct" | "channel"; channelId?: number | null; channelName?: string | null; channelRatePct?: number;
    transactionType?: string; propertyLocation?: string | null; coApplicantName?: string | null; bankRm?: string | null; statusNote?: string;
    bankRms?: Record<string, string>; partnerRm?: string | null;
    employmentProfile?: string; propertyType?: string; residency?: string;
  }) => Promise<LoanCase>;
  updateCase: (id: number, patch: Record<string, unknown>) => Promise<void>;

  /* ── LEADS (Phase 4) ─────────────────────────────────────────────────────
   * A lead is NOT a case. It is cheap to create, cheap to kill, and carries no
   * stage, no documents and no commission. Everything service-specific lives on
   * the case it becomes — see the Placement Rule in MIGRATION-NOTES.md. */
  createLead: (input: {
    fullName: string; phone?: string; email?: string;
    /** Required. A lead without a service line cannot be counted in any funnel. */
    serviceLineId: number; productId?: number | null; intendedAmount?: number | null;
    source?: string; sourceDetail?: string; ownerId?: number | null;
  }) => Promise<Lead>;
  updateLead: (id: number, patch: Record<string, unknown>) => Promise<void>;
  deleteLead: (id: number) => Promise<void>;
  /** Turn a qualified lead into a live case. Returns the new case number so the
   *  toast can say where the lead went. Idempotent server-side. */
  convertLead: (id: number, input?: { loanAmount?: number; propertyValue?: number; statusNote?: string }) => Promise<{ id: number; caseNumber: string }>;
  /** Shop an existing case to another bank — creates a SIBLING case for that
   *  bank (own case number, own document rules), not a second name on one row.
   *  POSTs to /api/cases/:id/add-bank. */
  addBankToCase: (id: number, input: { bank: string; bankRef?: string; bankRm?: string; startStage?: string; note?: string }) => Promise<{ id: number; caseNumber: string; banks: string[] }>;
  /**
   * Save a slice of a person's bank-form answer sheet (Client.personJson).
   * MERGES per key — it is filled in over months by two parties, so replacing
   * the whole object would let one stale tab wipe what the other just did.
   * Pass `remove: [path]` to clear a single field.
   */
  savePersonData: (clientId: number, patch: Record<string, unknown>, remove?: string[]) => Promise<void>;
  /**
   * Pull a document this client already supplied on ANOTHER case into this one.
   * The new row shares the same R2 key (no bytes copied) and is stamped
   * "Uploaded" — never "Verified", because the other bank saw it, this one has
   * not. Replaces the existing row for the same rule rather than duplicating.
   */
  borrowDocument: (caseId: number, sourceDocId: number, templateId?: number | null) => Promise<void>;
  addTask: (caseId: number, input: { description: string; ownerId: number; waitingFor: string; whyPending: string; dueDate: string }) => Promise<void>;
  completeTask: (id: number, remarks?: string) => Promise<void>;
  reopenTask: (id: number) => Promise<void>;
  /** Re-read one task's server truth. Used to roll back an optimistic write the
   *  server rejected, without refetching the whole workspace. */
  reconcileTask: (id: number) => Promise<void>;
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
  // build a compressed copy (original untouched); force=true rebuilds an existing one
  compressDoc: (id: number, force?: boolean) => Promise<void>;
  // pick which stored version downloads/previews use
  selectDocVersion: (id: number, version: "original" | "compressed") => Promise<void>;
  // merge multiple documents into a single PDF
  mergeDocs: (docIds: number[], outputName?: string) => Promise<{ id: number; fileName: string; fileSize: number } | null>;
  // convert image document to PDF with optional crop
  convertToPdf: (id: number, crop?: { x: number; y: number; width: number; height: number }, outputName?: string) => Promise<void>;
  // create a ZIP of selected documents for email attachment
  downloadZip: (docIds: number[], zipName?: string, useCompressed?: boolean) => Promise<{ downloadUrl: string; zipName: string } | null>;
  // Microsoft Graph (Outlook) integration
  graphConnect: () => Promise<string>; // returns auth URL
  graphDisconnect: () => Promise<void>;
  graphStatus: () => Promise<{ connected: boolean; email?: string }>;
  graphSendMail: (input: { to: string[]; cc?: string[]; bcc?: string[]; subject: string; bodyHtml: string; bodyText?: string; docIds?: number[]; caseId?: number; saveToSentItems?: boolean }) => Promise<{ success: boolean; attachmentsSent: number }>;

  // email review queue
  linkEmail: (unmatchedId: number, caseId: number) => Promise<void>;
  ignoreEmail: (unmatchedId: number) => Promise<void>;

  // selectors
  userById: (id: number) => User | undefined;
  caseById: (id: number) => LoanCase | undefined;
  visibleCases: () => LoanCase[];
  visibleTasks: () => Task[];
  canInstruct: () => boolean;
  /** Everyone on a case, in display order (Phase A). */
  partiesOfCase: (caseId: number) => CaseParty[];
  /** Every case a person is a party on, in any role (Phase A). This is what makes a
   *  co-borrower's OWN view show the case — `secondPartyCases` only covers the one
   *  legacy slot, so a second co-applicant would be invisible to themselves. */
  partiesOfClient: (clientId: number) => CaseParty[];
  /** The role this person holds on a case, or null if they are not a party.
   *  Falls back to the legacy secondPartyClientId column so a co-borrower still
   *  reads correctly on any case written before the backfill ran. */
  roleOnCase: (clientId: number, caseId: number) => PartyRole | null;
  /**
   * Add / re-role / remove a party on a case (Phase B). Each re-hydrates, because
   * the legacy secondPartyClientId slot moves with the list and several views read
   * it — patching one row locally would leave them disagreeing.
   */
  addParty: (caseId: number, input: { clientId?: number; role?: PartyRole; fullName?: string; phone?: string; eidNo?: string; email?: string }) => Promise<{ createdClient: boolean; matchedBy: string | null }>;
  updateParty: (caseId: number, partyId: number, role: PartyRole) => Promise<void>;
  removeParty: (caseId: number, partyId: number) => Promise<void>;
}

const empty: StateSnapshot = {
  me: null, flags: null, users: [], designations: [], cases: [], visibleCaseIds: [], tasks: [],
  visibleTaskIds: [], activities: [], stages: [], whyPending: [], waitingFor: [], milestoneDates: [], banks: [], serviceLines: [], leads: [],
  partners: [], channels: [], slaRules: [], commTemplates: [], instructions: [], bulletin: [], caseUpdates: [], caseProposals: [],
  escalations: 0, docRules: [], feeRules: [], eibor: [], stageTransitions: [], caseDocuments: [], bankProducts: [], unmatchedEmails: [], emails: [], clients: [], promotions: [], caseParties: [],
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
  // Every in-app navigation funnels through here — the sidebar, the dashboard
  // links, "back to pipeline", the case rows. Guarding it is what makes the
  // unsaved-changes warning actually fire: beforeunload alone never triggers for
  // a client-side route swap, which is why the warning appeared to do nothing.
  nav: (r) => {
    // Navigating to the place you are already on is not leaving — don't nag.
    const cur = get().route;
    const same = cur.name === r.name && ("id" in r ? ("id" in cur && cur.id === r.id) : true);
    if (same) return;
    if (!confirmDiscard("changes on this form")) return;
    // Leaving deliberately abandons the draft; clear the flag so the next form
    // does not inherit it and block an unrelated screen.
    setUnsavedChanges(false);
    set({ route: r });
  },
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
    const res = await fetch(`/api/cases/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || "Save failed — check your connection and try again.");
    }
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
  },
  /* ── LEADS (Phase 4) ─────────────────────────────────────────────────────── */
  createLead: async (input) => {
    const res = await fetch("/api/leads", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || "Could not save the lead");
    }
    const data = await res.json();
    get().hydrate().catch(() => {});
    return data.lead as Lead;
  },
  updateLead: async (id, patch) => {
    const res = await fetch("/api/leads", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...patch }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || "Save failed — check your connection and try again.");
    }
    get().hydrate().catch(() => {});
  },
  deleteLead: async (id) => {
    const res = await fetch(`/api/leads?id=${id}`, { method: "DELETE" });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || "Could not delete the lead.");
    }
    get().hydrate().catch(() => {});
  },
  convertLead: async (id, input) => {
    const res = await fetch(`/api/leads/${id}/convert`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input ?? {}),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || "Could not convert the lead.");
    }
    const data = await res.json();
    get().hydrate().catch(() => {});
    return { id: data.caseId, caseNumber: data.caseNumber };
  },
  addBankToCase: async (id, input) => {
    const res = await fetch(`/api/cases/${id}/add-bank`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || "Could not add that bank.");
    }
    const data = await res.json();
    // Say how much paperwork travelled with the new leg — otherwise the broker
    // sees a pre-filled vault and has no idea whether the client was re-asked
    // for their EID or not.
    get().toast(
      "success",
      data.copiedDocuments
        ? `Opened ${data.case.caseNumber} for ${input.bank} — ${data.copiedDocuments} document${data.copiedDocuments > 1 ? "s" : ""} carried over from the other bank leg, so the client was not re-asked.`
        : `Opened ${data.case.caseNumber} for ${input.bank}.`,
    );
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
    return data.case;
  },
  savePersonData: async (clientId, patch, remove) => {
    const res = await fetch(`/api/clients/${clientId}/person`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patch, remove }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || "Could not save the data sheet.");
    }
    get().toast("success", "Data sheet updated.");
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
  },
  borrowDocument: async (caseId, sourceDocId, templateId) => {
    const res = await fetch(`/api/cases/${caseId}/borrow-document`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceDocId, templateId }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || "Could not copy that document.");
    }
    get().toast("success", "Document copied — same file, no re-upload needed. Mark it verified once you have checked it.");
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
  },
  addTask: async (caseId, input) => {
    await fetch(`/api/cases/${caseId}/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
  },
  /* TASKS — the only mutations in the store that patch LOCAL STATE instead of
   * re-hydrating the whole workspace.
   *
   * WHY THIS IS DIFFERENT FROM EVERY ACTION ABOVE: `/api/state` returns every
   * case, document, chat message, product and user in the book. Ticking one task
   * box used to fire that full refetch, so the row did not move until the
   * network round-trip for the ENTIRE workspace finished — a visible multi-second
   * freeze on the single most frequent action in the app, and the reason "mark
   * done" felt slow.
   *
   * The task PATCH already returns the updated row (`serTask(updated)`), and
   * `completeTask`/`reopenTask` only change columns that live on the task itself
   * — so we can reconcile exactly, for one row, with certainty. `deleteTask` is
   * a pure local splice.
   *
   * `reconcileTask` still re-hydrates afterwards, but OFF the critical path: the
   * UI has already moved, and the refetch quietly repairs anything a side effect
   * changed elsewhere (the activity row the PATCH writes, dashboard counters).
   * A failure there is invisible and harmless because the local state is right. */

  completeTask: async (id, remarks) => {
    // optimistic first — the row must move on click, not on network
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id
          ? { ...t, status: "Done", completedAt: new Date().toISOString(), remarks: remarks ?? t.remarks }
          : t
      ),
    }));
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "Done", remarks }),
    });
    if (!res.ok) {
      // roll back so the UI never claims a save that did not happen
      get().reconcileTask(id);
      throw new Error("Could not mark that task done.");
    }
    const data = await res.json().catch(() => null);
    if (data?.task) {
      const authoritative = data.task as Task;
      set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? authoritative : t)) }));
    }
    get().hydrate().catch(() => {});
  },
  reopenTask: async (id) => {
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, status: "Open", completedAt: null } : t)),
    }));
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "Open" }),
    });
    if (!res.ok) {
      get().reconcileTask(id);
      throw new Error("Could not reopen that task.");
    }
    const data = await res.json().catch(() => null);
    if (data?.task) {
      const authoritative = data.task as Task;
      set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? authoritative : t)) }));
    }
    get().hydrate().catch(() => {});
  },
  /** Pull the truth for ONE task without refetching the workspace. Used to undo
   *  an optimistic write that the server rejected. */
  reconcileTask: async (id) => {
    try {
      const res = await fetch(`/api/state`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const fresh = (data.tasks as Task[]).find((t) => t.id === id);
      if (fresh) set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? fresh : t)) }));
    } catch {
      /* offline — leave the optimistic value; the next hydrate will correct it */
    }
  },
  deleteTask: async (id) => {
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
    const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    if (!res.ok) {
      get().reconcileTask(id);
      throw new Error("Could not delete that task.");
    }
    get().hydrate().catch(() => {});
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
  compressDoc: async (id, force) => {
    const res = await fetch(`/api/documents/${id}/compress${force ? "?force=1" : ""}`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      get().toast("error", data.error || "Could not compress this document.");
      return;
    }
    if (data.sameSize) {
      get().toast("info", data.error || "No saving available — original left as is.");
      return;
    }
    get().toast("success", `Compressed — ${data.savedPct}% smaller. Original kept for the bank.`);
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
  },
  selectDocVersion: async (id, version) => {
    const res = await fetch(`/api/documents/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selectedVersion: version }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      get().toast("error", e.error || "Could not switch the version.");
      return;
    }
    get().toast("success", version === "compressed" ? "Downloads now use the compressed copy." : "Downloads now use the original.");
    get().hydrate().catch(() => {}); // fire-and-forget — UI must not wait on the full-state reload
  },
  mergeDocs: async (docIds, outputName) => {
    const res = await fetch("/api/documents/merge", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docIds, outputName }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      get().toast("error", data.error || "Could not merge documents.");
      return null;
    }
    get().toast("success", data.message || `Merged ${docIds.length} documents.`);
    get().hydrate().catch(() => {});
    return { id: data.id, fileName: data.fileName, fileSize: data.fileSize };
  },
  convertToPdf: async (id, crop, outputName) => {
    const res = await fetch(`/api/documents/${id}/convert-to-pdf`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ crop, outputName }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      get().toast("error", data.error || "Could not convert to PDF.");
      return;
    }
    get().toast("success", `Converted to PDF${data.savedPct ? ` — ${data.savedPct}% smaller` : ""}.`);
    get().hydrate().catch(() => {});
  },
  downloadZip: async (docIds, zipName, useCompressed) => {
    const res = await fetch("/api/documents/download-zip", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docIds, zipName, useCompressed }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      get().toast("error", data.error || "Could not create ZIP.");
      return null;
    }
    get().toast("success", `ZIP ready — ${data.fileCount} files.`);
    return { downloadUrl: data.downloadUrl, zipName: data.zipName };
  },
  graphConnect: async () => {
    const res = await fetch("/api/graph/auth/connect");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed to start Outlook connection");
    return data.authUrl;
  },
  graphDisconnect: async () => {
    const res = await fetch("/api/graph/auth/disconnect", { method: "POST" });
    if (!res.ok) throw new Error("Failed to disconnect Outlook");
    get().hydrate().catch(() => {});
  },
  graphStatus: async () => {
    const res = await fetch("/api/graph/auth/status");
    const data = await res.json().catch(() => ({ connected: false }));
    return { connected: data.connected, email: data.email };
  },
  graphSendMail: async (input) => {
    const res = await fetch("/api/graph/send", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed to send email");
    get().toast("success", `Email sent${data.attachmentsSent ? ` with ${data.attachmentsSent} attachments` : ""}`);
    return { success: true, attachmentsSent: data.attachmentsSent };
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
  partiesOfCase: (caseId) =>
    get().caseParties
      .filter((p) => p.caseId === caseId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
  partiesOfClient: (clientId) => get().caseParties.filter((p) => p.clientId === clientId),
  roleOnCase: (clientId, caseId) => {
    const hit = get().caseParties.find((p) => p.caseId === caseId && p.clientId === clientId);
    if (hit) return hit.role;
    // Legacy fallback. Only reached for a case whose secondPartyClientId was never
    // backfilled, so it can be removed once phase5-backfill has run everywhere.
    const c = get().cases.find((k) => k.id === caseId);
    return c && c.secondPartyClientId === clientId ? "CoBorrower" : null;
  },
  addParty: async (caseId, input) => {
    const res = await fetch(`/api/cases/${caseId}/parties`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || "Could not add this person to the case");
    }
    const data = await res.json();
    get().hydrate().catch(() => {});
    return { createdClient: !!data.createdClient, matchedBy: data.matchedBy ?? null };
  },
  updateParty: async (caseId, partyId, role) => {
    const res = await fetch(`/api/cases/${caseId}/parties`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ partyId, role }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || "Could not change their role");
    }
    get().hydrate().catch(() => {});
  },
  removeParty: async (caseId, partyId) => {
    const res = await fetch(`/api/cases/${caseId}/parties?partyId=${partyId}`, { method: "DELETE" });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || "Could not remove this person from the case");
    }
    get().hydrate().catch(() => {});
  },
  canInstruct: () => {
    const f = get().flags;
    if (!f) return false;
    return f.issueTasks || f.super;
  },
}));
