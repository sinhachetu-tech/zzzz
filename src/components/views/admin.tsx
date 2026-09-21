"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type {
  BankItem, BankProduct, Designation, DocRule, FeeRule, MasterItem, PartnerItem, PartnerKind,
  SlaRule, StageItem, User,
} from "@/lib/types";
import { fmtRate } from "@/lib/format";
import { Avatar, Chip, EmptyState, Modal, Seg } from "@/components/hfmc/ui";
import { ConfirmModal } from "@/components/hfmc/bits";
import { parsePricing, resolveQuote, rateSchedule, type ProductPricing, type RateQuote } from "@/lib/bank-pricing";
import { parseRateTable } from "@/lib/quote-parser";
import { emi, loanForEmi } from "@/lib/calc";
import { BankFees, BankInsurance, parseFees, parseInsurance, extractFromAxes } from "@/lib/bank-fees";
import {
  IBank, ICheck, IPencil, IPlus, IShield, ITrash, ITrophy, IUsers, IX,
} from "@/components/icons";

/* ------------------------------ types ------------------------------ */

type Tab = "users" | "designations" | "banks" | "bankrules" | "partners" | "channels" | "stages" | "masters" | "sla" | "docrules" | "feerules" | "storage" | "portal";
type MasterKind = "whyPending" | "waitingFor";

const TEAMS = ["Management", "Dubai", "Abu Dhabi"];

const TAB_OPTIONS: { value: Tab; label: string }[] = [
  { value: "users", label: "Teammates" },
  { value: "designations", label: "Designations" },
  { value: "banks", label: "Banks & rates" },
  { value: "bankrules", label: "Bank Rules" },
  { value: "partners", label: "Partners" },
  { value: "channels", label: "Channels" },
  { value: "stages", label: "Stages" },
  { value: "masters", label: "Masters" },
  { value: "sla", label: "SLA rules" },
  { value: "docrules", label: "Doc Rules" },
  { value: "feerules", label: "Fee rules" },
  { value: "storage", label: "Storage" },
  { value: "portal", label: "Portal settings" },
];

// Two-level admin navigation: group row on top, tabs for the active group below.
// New sections slot into a group — the top row stays small no matter how much grows.
const GROUPS: { key: string; label: string; tabs: { value: Tab; label: string }[] }[] = [
  { key: "team", label: "Team & Access", tabs: TAB_OPTIONS.filter((t) => ["users", "designations"].includes(t.value)) },
  { key: "market", label: "Marketplace", tabs: TAB_OPTIONS.filter((t) => ["banks", "bankrules", "partners", "channels"].includes(t.value)) },
  { key: "workflow", label: "Workflow", tabs: TAB_OPTIONS.filter((t) => ["stages", "masters", "sla", "portal"].includes(t.value)) },
  { key: "docs", label: "Docs & Fees", tabs: TAB_OPTIONS.filter((t) => ["docrules", "feerules", "storage"].includes(t.value)) },
];

const DOC_CATEGORIES = ["KYC", "Income", "Approval", "Property", "Valuation", "Transfer"];
const FEE_EMIRATES: FeeRule["emirate"][] = ["Dubai", "Abu Dhabi"];
const FEE_TXN_TYPES: FeeRule["txnType"][] = ["Primary", "Resale", "Buyout"];
const FEE_AMOUNT_TYPES: FeeRule["amountType"][] = ["pct_property", "pct_loan", "fixed"];

/* ------------------------------ admin api helpers ------------------------------ */

interface ApiResult { ok: boolean; error?: string }

async function adminPost(body: Record<string, unknown>): Promise<ApiResult> {
  try {
    const res = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: e.error ?? "create failed" };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "network error" };
  }
}

async function adminPatch(body: Record<string, unknown>): Promise<ApiResult> {
  try {
    const res = await fetch("/api/admin", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: e.error ?? "update failed" };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "network error" };
  }
}

async function adminDelete(kind: string, id: number): Promise<ApiResult> {
  try {
    const res = await fetch(`/api/admin?kind=${encodeURIComponent(kind)}&id=${id}`, { method: "DELETE" });
    if (!res.ok) {
      const e = await res.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: e.error ?? "delete failed" };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "network error" };
  }
}

/* ------------------------------ shared bits ------------------------------ */

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="text-[10.5px] text-[var(--ink-faint)] m-0 mt-1">{hint}</p>}
    </div>
  );
}

function Toggle({ on, onClick, label, locked }: { on: boolean; onClick: () => void; label: string; locked?: boolean }) {
  return (
    <button
      type="button"
      title={locked ? "Locked for this designation" : undefined}
      className="chip transition-all"
      style={
        on
          ? { background: "rgba(67,214,155,0.12)", borderColor: "rgba(67,214,155,0.5)", color: "var(--mint)" }
          : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }
      }
      onClick={() => !locked && onClick()}
    >
      {label}
    </button>
  );
}

function ActiveDot({ active }: { active: boolean }) {
  return (
    <span
      className="inline-block rounded-full"
      style={{
        width: 8, height: 8,
        background: active ? "var(--mint)" : "var(--ink-faint)",
      }}
      title={active ? "Active" : "Inactive"}
    />
  );
}

function CardHeader({ title, sub, action, children }: { title: string; sub?: string; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
        <div className="min-w-0 flex-1">
          <h3 className="font-disp font-semibold text-[14px] m-0">{title}</h3>
          {sub && <p className="text-[11.5px] text-[var(--ink-faint)] mt-0.5 mb-0">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </>
  );
}

function roleTone(role: string): "amber" | "sky" | "slate" {
  if (role === "Head of Company" || role === "Mortgage Head" || role === "Super Admin") return "amber";
  if (role === "PA to HoC" || role.startsWith("Team Leader")) return "sky";
  return "slate";
}

/* ------------------------------ main ------------------------------ */

export default function Admin() {
  const { flags, me } = useHfmcStore();
  const [tab, setTab] = useState<Tab>("users");

  const allowed = !!(flags?.admin || flags?.super);

  if (!allowed) {
    return (
      <div className="card p-10 text-center anim-fade-up">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl mb-3" style={{ background: "rgba(242,176,76,0.1)", border: "1px solid rgba(242,176,76,0.3)", color: "var(--amber)" }}>
          <IShield size={22} />
        </div>
        <h2 className="font-disp font-semibold text-[18px] mb-2 m-0">Admin is for designations with admin rights</h2>
        <p className="text-[13px] text-[var(--ink-dim)] m-0 max-w-[460px] mx-auto">
          Your designation is <span className="font-medium">{me?.role ?? "—"}</span>. If you need a list changed,
          ask the Head of Company or Mortgage Head — every change lands in the activity trail.
        </p>
      </div>
    );
  }

  const group = GROUPS.find((g) => g.tabs.some((t) => t.value === tab)) ?? GROUPS[0];

  return (
    <div className="space-y-4 anim-fade-up">
      <div className="card p-3 space-y-2.5">
        <div className="flex items-center gap-2 pl-1 pr-2">
          <IShield size={16} className="text-[var(--amber)]" />
          <span className="font-disp font-semibold text-[13px] whitespace-nowrap">Admin</span>
          <span className="text-[11px] text-[var(--ink-faint)] ml-2 hidden sm:inline">every change lands in the activity trail</span>
        </div>
        {/* level 1 — groups */}
        <div className="overflow-x-auto pb-0.5">
          <Seg<string>
            value={group.key}
            onChange={(k) => setTab(GROUPS.find((g) => g.key === k)!.tabs[0].value)}
            options={GROUPS.map((g) => ({ value: g.key, label: g.label }))}
          />
        </div>
        {/* level 2 — tabs within the group */}
        <div className="overflow-x-auto -mb-1 pb-1">
          <Seg<Tab>
            value={tab}
            onChange={setTab}
            options={group.tabs}
          />
        </div>
      </div>

      {tab === "users" && <UsersTab />}
      {tab === "designations" && <DesignationsTab />}
        {tab === "storage" && <StorageTab />}
      {tab === "banks" && <BanksTab />}
      {tab === "bankrules" && <BankRulesTab />}
      {tab === "partners" && <PartnersTab />}
      {tab === "channels" && <ChannelsTab />}
      {tab === "stages" && <StagesTab />}
      {tab === "masters" && <MastersTab />}
      {tab === "sla" && <SlaTab />}
      {tab === "docrules" && <DocRulesTab />}
      {tab === "feerules" && <FeeRulesTab />}
      {tab === "portal" && <PortalTab />}
    </div>
  );
}

/* ------------------------------ users ------------------------------ */

interface UserDraft {
  id: number;
  name: string;
  email: string;
  password: string;
  role: string;
  team: string;
  active: boolean;
  phone: string;
}

function blankUser(): UserDraft {
  return { id: 0, name: "", email: "", password: "demo123", role: "SPO", team: "Dubai", active: true, phone: "" };
}

function UsersTab() {
  const { users, designations, me, flags, hydrate, toast } = useHfmcStore();
  const [editing, setEditing] = useState<UserDraft | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);

  const isSuper = !!flags?.super;

  const sorted = useMemo(() => {
    const idx = (r: string) => {
      const i = designations.findIndex((d) => d.name === r);
      return i === -1 ? 99 : i;
    };
    return [...users].sort((a, b) => idx(a.role) - idx(b.role) || a.name.localeCompare(b.name));
  }, [users, designations]);

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.email.trim()) {
      toast("error", "Name and email are required.");
      return;
    }
    if (users.some((x) => x.id !== editing.id && x.email.toLowerCase() === editing.email.toLowerCase())) {
      toast("error", "That email is already taken.");
      return;
    }
    setBusy(true);
    const body: Record<string, unknown> = {
      kind: "user",
      name: editing.name.trim(),
      email: editing.email.trim(),
      role: editing.role,
      team: editing.team,
      active: editing.active,
      phone: editing.phone.trim(),
    };
    if (editing.password.trim()) body.password = editing.password.trim();
    const res = creating
      ? await adminPost(body)
      : await adminPatch({ ...body, id: editing.id });
    setBusy(false);
    if (!res.ok) {
      toast("error", res.error ?? "Could not save teammate.");
      return;
    }
    await hydrate();
    toast("success", creating ? `${editing.name} added to the team.` : "Teammate updated.");
    setEditing(null);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    const res = await adminDelete("user", deleting.id);
    setBusy(false);
    if (!res.ok) {
      toast("error", res.error ?? "Could not remove teammate.");
      return;
    }
    await hydrate();
    toast("success", `${deleting.name} removed.`);
  };

  return (
    <div className="card anim-fade-up">
      <CardHeader
        title={`Teammates · ${users.length}`}
        sub="Sign-in accounts. Inactive users keep their cases but cannot log in."
        action={
          <button className="btn btn-primary sm:btn-sm" onClick={() => { setEditing(blankUser()); setCreating(true); }}>
            <IPlus size={14} /> Add teammate
          </button>
        }
      />
      {sorted.length === 0 ? (
        <EmptyState icon={<IUsers size={20} />} title="No teammates yet" body="Add your first account to start assigning cases." />
      ) : (
        <div className="overflow-x-auto">
          <table className="tbl min-w-[760px]">
            <thead>
              <tr>
                <th>Teammate</th>
                <th>Role</th>
                <th>Team</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((u) => (
                <tr key={u.id} style={{ opacity: u.active ? 1 : 0.55 }}>
                  <td>
                    <span className="flex items-center gap-2.5">
                      <Avatar name={u.name} size={28} />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium leading-tight">
                          {u.name}
                          {u.id === me?.id && <span className="ml-2"><Chip tone="mint">you</Chip></span>}
                        </span>
                        <span className="block text-[11.5px] text-[var(--ink-faint)] mono truncate">{u.email}</span>
                      </span>
                    </span>
                  </td>
                  <td><Chip tone={roleTone(u.role)}>{u.role}</Chip></td>
                  <td className="text-[12.5px] text-[var(--ink-dim)]">{u.team}</td>
                  <td>
                    {u.active
                      ? <Chip tone="mint" dot>active</Chip>
                      : <Chip tone="coral">inactive</Chip>}
                  </td>
                  <td className="text-right">
                    <div className="inline-flex gap-1.5">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => { setEditing({ ...u, password: "", phone: u.phone ?? "" }); setCreating(false); }}
                      >
                        <IPencil size={13} /> Edit
                      </button>
                      {isSuper && u.id !== me?.id && u.role !== "Head of Company" && (
                        <button className="btn btn-danger btn-sm !px-2" onClick={() => setDeleting(u)} title="Remove">
                          <ITrash size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal
          title={creating ? "Add teammate" : `Edit · ${editing.name}`}
          onClose={() => setEditing(null)}
          width={480}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={busy}>
                <ICheck size={15} /> Save
              </button>
            </>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <Field label="Full name">
                <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
              </Field>
            </div>
            <Field label="Email">
              <input className="input mono" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
            </Field>
            <Field label={creating ? "Password" : "New password"}>
              <input
                className="input mono"
                value={editing.password}
                placeholder={creating ? "" : "leave blank to keep"}
                onChange={(e) => setEditing({ ...editing, password: e.target.value })}
              />
            </Field>
            <Field label="Role">
              <select className="select" value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value })}>
                {designations.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="Team">
              <input className="input" list="hfmc-teams" value={editing.team} onChange={(e) => setEditing({ ...editing, team: e.target.value })} />
              <datalist id="hfmc-teams">
                {TEAMS.map((t) => <option key={t} value={t} />)}
              </datalist>
            </Field>
            <Field label="WhatsApp / phone" hint="with country code — pairs with the name on client & agent portal cards">
              <input className="input mono" placeholder="e.g. 971563675369" value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
            </Field>
            <div className="sm:col-span-2 flex items-center gap-2 mt-1">
              <input
                type="checkbox"
                id="user-active"
                checked={editing.active}
                onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
              />
              <label htmlFor="user-active" className="text-[12.5px] text-[var(--ink-dim)] m-0">
                Active — can sign in and own cases
              </label>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={`Remove ${deleting?.name ?? ""}?`}
        body="They'll be removed from the team. This is blocked if they still own cases or open tasks."
        confirmLabel="Remove"
      />
    </div>
  );
}

/* ------------------------------ designations ------------------------------ */

interface DesigDraft {
  id: number;
  name: string;
  scope: Designation["scope"];
  issueTasks: boolean;
  admin: boolean;
  super: boolean;
  viewRevenue: boolean;
  manageDocs: boolean;
  builtIn: boolean;
}

function blankDesig(): DesigDraft {
  return { id: 0, name: "", scope: "own", issueTasks: false, admin: false, super: false, viewRevenue: false, manageDocs: true, builtIn: false };
}

function DesignationsTab() {
  const { designations, users, hydrate, toast } = useHfmcStore();
  const [editing, setEditing] = useState<DesigDraft | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Designation | null>(null);
  const [busy, setBusy] = useState(false);

  const sorted = useMemo(
    () => [...designations].sort((a, b) => (b.super ? 1 : 0) - (a.super ? 1 : 0) || a.id - b.id),
    [designations],
  );

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      toast("error", "Designation name is required.");
      return;
    }
    setBusy(true);
    const body: Record<string, unknown> = {
      kind: "designation",
      name: editing.name.trim(),
      scope: editing.scope,
      issueTasks: editing.issueTasks,
      admin: editing.admin,
      super: editing.super,
      viewRevenue: editing.viewRevenue,
      manageDocs: editing.manageDocs,
    };
    const res = creating
      ? await adminPost(body)
      : await adminPatch({ ...body, id: editing.id });
    setBusy(false);
    if (!res.ok) {
      toast("error", res.error ?? "Could not save designation.");
      return;
    }
    await hydrate();
    toast("success", creating ? `Designation "${editing.name}" created.` : "Designation updated.");
    setEditing(null);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    const res = await adminDelete("designation", deleting.id);
    setBusy(false);
    if (!res.ok) {
      toast("error", res.error ?? "Could not delete designation.");
      return;
    }
    await hydrate();
    toast("info", `Designation "${deleting.name}" deleted.`);
  };

  return (
    <div className="card anim-fade-up">
      <CardHeader
        title={`Designations · ${designations.length}`}
        sub="Scope decides what each holder sees: all cases, their team's, or only their own book."
        action={
          <button className="btn btn-primary sm:btn-sm" onClick={() => { setEditing(blankDesig()); setCreating(true); }}>
            <IPlus size={14} /> Add designation
          </button>
        }
      />
      <div className="overflow-x-auto">
        <table className="tbl min-w-[760px]">
          <thead>
            <tr>
              <th>Designation</th>
              <th>Scope</th>
              <th>Permissions</th>
              <th>Holders</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((d) => {
              const holders = users.filter((u) => u.role === d.name).length;
              return (
                <tr key={d.id}>
                  <td>
                    <span className="flex items-center gap-2">
                      <span className="text-[13px] font-medium">{d.name}</span>
                      {d.super && <Chip tone="amber">supreme</Chip>}
                      {d.builtIn && <Chip tone="slate">built-in</Chip>}
                    </span>
                  </td>
                  <td>
                    <Chip tone={d.scope === "all" ? "amber" : d.scope === "team" ? "sky" : "slate"}>
                      {d.scope === "all" ? "sees all" : d.scope === "team" ? "sees team" : "own book"}
                    </Chip>
                  </td>
                  <td>
                    <span className="flex flex-wrap gap-1.5">
                      <Chip tone={d.issueTasks ? "mint" : "slate"}>{d.issueTasks ? "issues tasks" : "no tasks"}</Chip>
                      <Chip tone={d.admin ? "mint" : "slate"}>{d.admin ? "admin" : "no admin"}</Chip>
                      <Chip tone={d.viewRevenue ? "amber" : "slate"}>{d.viewRevenue ? "sees revenue" : "no revenue"}</Chip>
                      <Chip tone={d.manageDocs ? "mint" : "slate"}>{d.manageDocs ? "manages docs" : "no docs"}</Chip>
                    </span>
                  </td>
                  <td className="text-[12.5px] text-[var(--ink-dim)] mono">{holders}</td>
                  <td className="text-right">
                    <div className="inline-flex gap-1.5">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => { setEditing({ ...d }); setCreating(false); }}
                      >
                        <IPencil size={13} /> Edit
                      </button>
                      {!d.builtIn && (
                        <button className="btn btn-danger btn-sm !px-2" onClick={() => setDeleting(d)} title="Delete">
                          <ITrash size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal
          title={creating ? "Add designation" : `Edit · ${editing.name}`}
          sub="Permission scope applies to cases, tasks, and reports."
          onClose={() => setEditing(null)}
          width={460}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={busy}>
                <ICheck size={15} /> Save
              </button>
            </>
          }
        >
          <div className="space-y-3.5">
            <Field label="Designation name">
              <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
            </Field>
            <Field label="Visibility scope">
              <select
                className="select"
                value={editing.scope}
                disabled={editing.super}
                onChange={(e) => setEditing({ ...editing, scope: e.target.value as Designation["scope"] })}
              >
                <option value="all">sees all cases</option>
                <option value="team">sees team cases</option>
                <option value="own">own book only</option>
              </select>
            </Field>
            <div>
              <label className="label">Permissions</label>
              <div className="flex flex-wrap gap-1.5">
                <Toggle
                  on={editing.issueTasks}
                  onClick={() => setEditing({ ...editing, issueTasks: !editing.issueTasks })}
                  label="can issue tasks"
                  locked={editing.super}
                />
                <Toggle
                  on={editing.admin}
                  onClick={() => setEditing({ ...editing, admin: !editing.admin })}
                  label="admin console"
                  locked={editing.super}
                />
                <Toggle
                  on={editing.super}
                  onClick={() => setEditing({ ...editing, super: !editing.super })}
                  label="supreme"
                  locked={editing.builtIn && editing.super}
                />
                <Toggle
                  on={editing.viewRevenue}
                  onClick={() => setEditing({ ...editing, viewRevenue: !editing.viewRevenue })}
                  label="sees revenue"
                />
                <Toggle
                  on={editing.manageDocs}
                  onClick={() => setEditing({ ...editing, manageDocs: !editing.manageDocs })}
                  label="manages documents"
                />
              </div>
              {editing.super && (
                <p className="text-[11.5px] text-[var(--ink-faint)] mt-1.5 mb-0">
                  Supreme designations always see all cases and can issue tasks. Scope is locked.
                </p>
              )}
              {!editing.viewRevenue && (
                <p className="text-[11.5px] text-[var(--ink-faint)] mt-1.5 mb-0">
                  Without revenue permission, commission rates, partner shares, and every earnings figure are hidden for this designation.
                </p>
              )}
            </div>
          </div>
        </Modal>
      )}

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={`Delete "${deleting?.name ?? ""}"?`}
        body="Only designations with no holders can be deleted."
        confirmLabel="Delete"
      />
    </div>
  );
}

/* ------------------------------ storage ------------------------------ */

interface StorageStatus {
  r2: {
    configured: boolean; accountId: boolean; accessKeyId: boolean;
    secretAccessKey: boolean; bucket: boolean; bucketName: string; endpoint: string;
  };
  drive: { configured: boolean; clientEmail: boolean; privateKey: boolean; folderId: boolean };
  stats: {
    totalDocuments: number; filesOnR2: number; compressedCopies: number;
    legacyInDatabase: number; originalBytes: number; compressedBytes: number;
    archivedOnDrive: number;
  };
}

function sizeLabel(n: number): string {
  if (!n) return "0 KB";
  return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** One credential line: green tick when present, faint dash when missing. */
function KeyRow({ label, envName, present }: { label: string; envName: string; present: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 py-1.5" style={{ borderBottom: "1px solid var(--line-soft)" }}>
      <span className="text-[12.5px]" style={{ color: present ? "var(--mint)" : "var(--ink-faint)" }}>{present ? "✓" : "—"}</span>
      <span className="text-[12.5px] font-medium min-w-[150px]">{label}</span>
      <code className="mono text-[11px] text-[var(--ink-dim)]">{envName}</code>
      <span className="ml-auto text-[11px]" style={{ color: present ? "var(--mint)" : "var(--ink-faint)" }}>
        {present ? "set" : "missing"}
      </span>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg px-3 py-2.5" style={{ background: "var(--tint)" }}>
      <div className="text-[10.5px] uppercase tracking-[0.1em] text-[var(--ink-faint)] font-disp font-semibold">{label}</div>
      <div className="mono text-[15px] mt-0.5">{value}</div>
      {hint && <div className="text-[10.5px] text-[var(--ink-faint)] mt-0.5">{hint}</div>}
    </div>
  );
}

function StorageTab() {
  const { toast } = useHfmcStore();
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState<string | null>(null);
  const [driveProbe, setDriveProbe] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/storage", { cache: "no-store" });
    if (res.ok) setStatus(await res.json());
  }, []);

  // fetch on mount — setState happens after the await, never during render
  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch("/api/admin/storage", { cache: "no-store" });
      if (!alive || !res.ok) return;
      setStatus(await res.json());
    })();
    return () => { alive = false; };
  }, []);

  const copyEnv = async () => {
    const block = ["R2_ACCOUNT_ID=", "R2_ACCESS_KEY_ID=", "R2_SECRET_ACCESS_KEY=", "R2_BUCKET="].join("\n");
    try {
      await navigator.clipboard.writeText(block);
      toast("success", "Copied — paste into .env and fill in the four values.");
    } catch {
      toast("error", "Clipboard blocked by the browser — copy them from .env.example instead.");
    }
  };

  const test = async () => {
    setBusy(true); setProbe(null);
    const res = await fetch("/api/admin/storage", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    const steps = data.steps
      ? `write ${data.steps.write ? "✓" : "✗"} · read ${data.steps.read ? "✓" : "✗"} · delete ${data.steps.delete ? "✓" : "✗"}`
      : "";
    if (res.ok && data.ok) {
      setProbe(`Connected — probe passed (${steps})`);
      toast("success", "Cloud storage is connected and working.");
    } else {
      setProbe(`${data.error ?? "Test failed"} ${steps}`.trim());
      toast("error", "Storage test failed — see the details on the card.");
    }
    load();
  };

  const copyDriveEnv = async () => {
    const block = ["GOOGLE_DRIVE_CLIENT_EMAIL=", "GOOGLE_DRIVE_PRIVATE_KEY=", "GOOGLE_DRIVE_FOLDER_ID="].join("\n");
    try {
      await navigator.clipboard.writeText(block);
      toast("success", "Copied — paste into .env and fill in the three values.");
    } catch {
      toast("error", "Clipboard blocked by the browser — copy them from .env.example instead.");
    }
  };

  const testDrive = async () => {
    setBusy(true); setDriveProbe(null);
    const res = await fetch("/api/admin/storage", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "drive" }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    const steps = data.steps
      ? `create ${data.steps.write ? "✓" : "✗"} · read ${data.steps.read ? "✓" : "✗"} · delete ${data.steps.delete ? "✓" : "✗"}`
      : "";
    if (res.ok && data.ok) {
      setDriveProbe(`Connected — probe passed (${steps})`);
      toast("success", "Google Drive is connected and working.");
    } else {
      setDriveProbe(`${data.error ?? "Test failed"} ${steps}`.trim());
      toast("error", "Drive test failed — see the details on the card.");
    }
    load();
  };

  const r2 = status?.r2;
  const drive = status?.drive;
  const stats = status?.stats;

  return (
    <div className="space-y-4 anim-fade-up">
      <div className="card">
        <CardHeader
          title="Document storage · Cloudflare R2"
          sub="Where every uploaded client file lives. Files sit in a private bucket and reach the browser through short-lived signed links — a leaked URL expires in 15 minutes."
          action={
            <span className="flex gap-1.5">
              <button className="btn btn-ghost sm:btn-sm" onClick={copyEnv}><IPlus size={13} /> Copy .env block</button>
              <button className="btn btn-primary sm:btn-sm" onClick={test} disabled={busy || !r2?.configured}>
                <ICheck size={14} /> {busy ? "Testing…" : "Test connection"}
              </button>
            </span>
          }
        />
        <div className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={r2?.configured ? "mint" : "amber"}>
              {r2?.configured ? "connected" : "not configured — running on the database fallback"}
            </Chip>
            {r2?.bucketName && <span className="mono text-[11.5px] text-[var(--ink-dim)]">bucket: {r2.bucketName}</span>}
            {r2?.endpoint && <span className="mono text-[11.5px] text-[var(--ink-faint)]">{r2.endpoint}</span>}
          </div>

          <div>
            <KeyRow label="Account ID" envName="R2_ACCOUNT_ID" present={!!r2?.accountId} />
            <KeyRow label="Access Key ID" envName="R2_ACCESS_KEY_ID" present={!!r2?.accessKeyId} />
            <KeyRow label="Secret Access Key" envName="R2_SECRET_ACCESS_KEY" present={!!r2?.secretAccessKey} />
            <KeyRow label="Bucket name" envName="R2_BUCKET" present={!!r2?.bucket} />
          </div>

          {probe && (
            <p className="text-[12px] m-0 mono" style={{ color: probe.startsWith("Connected") ? "var(--mint)" : "var(--coral)" }}>{probe}</p>
          )}

          <p className="text-[11.5px] text-[var(--ink-faint)] m-0">
            Paste the four values into <code className="mono">.env</code> — Cloudflare dashboard → R2 → your bucket →
            <span className="font-medium"> Manage R2 API Tokens</span> → create a token with <span className="font-medium">Object Read &amp; Write</span> —
            then <span className="font-medium">restart the server</span>; environment values are read once at start-up. The secret key is shown only once.
          </p>
        </div>
      </div>
      <div className="card">
        <CardHeader title="Vault contents" sub="What is on Cloudflare versus still in the database — and what compression has saved." />
        <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
          <Stat label="Documents" value={String(stats?.totalDocuments ?? 0)} />
          <Stat label="Files on R2" value={String(stats?.filesOnR2 ?? 0)} />
          <Stat label="Legacy in database" value={String(stats?.legacyInDatabase ?? 0)} hint="re-upload to move them across" />
          <Stat label="Originals stored" value={sizeLabel(stats?.originalBytes ?? 0)} />
          <Stat label="Compressed copies" value={String(stats?.compressedCopies ?? 0)} hint={sizeLabel(stats?.compressedBytes ?? 0)} />
          <Stat label="Archived on Drive" value={String(stats?.archivedOnDrive ?? 0)} hint="independent archive" />
          <Stat label="Free tier" value="10 GB" hint="$0 egress — downloads cost nothing" />
        </div>
      </div>

      <div className="card">
        <CardHeader
          title="Google Drive archive · independent"
          sub="A separate dump, not a mirror: uploads are copied into Drive's own folder tree and live their own life — nothing here touches the R2 bucket."
          action={
            <span className="flex gap-1.5">
              <button className="btn btn-ghost sm:btn-sm" onClick={copyDriveEnv}><IPlus size={13} /> Copy .env block</button>
              <button className="btn btn-primary sm:btn-sm" onClick={testDrive} disabled={busy || !drive?.configured}>
                <ICheck size={14} /> {busy ? "Testing…" : "Test connection"}
              </button>
            </span>
          }
        />
        <div className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={drive?.configured ? "mint" : "slate"}>{drive?.configured ? "connected" : "not configured — optional archive"}</Chip>
            <span className="text-[12px] text-[var(--ink-dim)]">Archived files: <span className="mono">{stats?.archivedOnDrive ?? 0}</span></span>
          </div>
          <p className="text-[12px] text-[var(--ink-dim)] m-0">
            When configured, every upload (staff <span className="font-medium">or client</span>) is <span className="font-medium">also</span> copied to
            Drive under <code className="mono">{"{CASE-NO} — {Customer}"}/{"{Category}"}</code> — both folder levels are created automatically.
            It is <span className="font-medium">independent</span>: deleting a document here never deletes the Drive copy, R2 objects are untouched,
            and you can drop extra files into those folders by hand anytime. Client-portal serving stays on R2 — Drive links never expire, so
            nothing is ever served to clients from Drive.
          </p>
          <div>
            <KeyRow label="Service-account email" envName="GOOGLE_DRIVE_CLIENT_EMAIL" present={!!drive?.clientEmail} />
            <KeyRow label="Service-account private key" envName="GOOGLE_DRIVE_PRIVATE_KEY" present={!!drive?.privateKey} />
            <KeyRow label="Shared archive folder ID" envName="GOOGLE_DRIVE_FOLDER_ID" present={!!drive?.folderId} />
          </div>
          {driveProbe && (
            <p className="text-[12px] m-0 mono" style={{ color: driveProbe.startsWith("Connected") ? "var(--mint)" : "var(--coral)" }}>{driveProbe}</p>
          )}
          <p className="text-[11.5px] text-[var(--ink-faint)] m-0">
            Setup: Google Cloud Console → <span className="font-medium">APIs &amp; Services</span> → enable <span className="font-medium">Google Drive API</span> →
            <span className="font-medium"> IAM &amp; Admin → Service Accounts</span> → create one → <span className="font-medium">Keys → Add key → JSON</span>
            (copy <code className="mono">client_email</code> and <code className="mono">private_key</code>, keep the <code className="mono">\n</code> escapes) →
            create a folder in Drive, share it with the service-account email as <span className="font-medium">Editor</span>, paste its ID from the URL.
            Fill all three in <code className="mono">.env</code> and <span className="font-medium">restart the server</span>.
          </p>
        </div>
      </div>
    </div>
  );
}

/* STORAGE_TAB_HERE */

/* ------------------------------ banks ------------------------------ */

interface BankDraft {
  id: number;
  name: string;
  ratePct: number;
  active: boolean;
  contacts: { name: string; phone?: string; email?: string; role?: string }[];
}

function blankBank(): BankDraft {
  return { id: 0, name: "", ratePct: 0.8, active: true, contacts: [] };
}

/* Bank RM / partner contact editor — rows of {name, phone, email, role}. */
function ContactsEditor({ contacts, onChange }: { contacts: { name: string; phone?: string; email?: string; role?: string }[]; onChange: (c: { name: string; phone?: string; email?: string; role?: string }[]) => void }) {
  const upd = (i: number, patch: Partial<{ name: string; phone?: string; email?: string; role?: string }>) =>
    onChange(contacts.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  return (
    <div className="space-y-1.5">
      {contacts.length === 0 && <p className="text-[11.5px] text-[var(--ink-faint)] m-0">No contact yet — add the relationship manager&apos;s name, phone and email. Add more than one if the desk has several RMs.</p>}
      {contacts.map((c, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5">
          <input className="input !py-1 text-[11.5px]" style={{ width: 150 }} placeholder="RM name" value={c.name} onChange={(e) => upd(i, { name: e.target.value })} />
          <input className="input mono !py-1 text-[11.5px]" style={{ width: 130 }} placeholder="+971…" value={c.phone ?? ""} onChange={(e) => upd(i, { phone: e.target.value })} />
          <input className="input !py-1 text-[11.5px]" style={{ width: 170 }} placeholder="email" value={c.email ?? ""} onChange={(e) => upd(i, { email: e.target.value })} />
          <input className="input !py-1 text-[11.5px]" style={{ width: 120 }} placeholder="role/desk" value={c.role ?? ""} onChange={(e) => upd(i, { role: e.target.value })} />
          <button className="btn btn-ghost btn-sm !px-2" style={{ color: "var(--coral)" }} onClick={() => onChange(contacts.filter((_, idx) => idx !== i))} title="Remove contact">✕</button>
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" onClick={() => onChange([...contacts, { name: "" }])}>+ Add contact</button>
    </div>
  );
}

function BanksTab() {
  const { banks, hydrate, toast } = useHfmcStore();
  const [editing, setEditing] = useState<BankDraft | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<BankItem | null>(null);
  const [busy, setBusy] = useState(false);

  const sorted = useMemo(() => [...banks].sort((a, b) => b.ratePct - a.ratePct || a.name.localeCompare(b.name)), [banks]);

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      toast("error", "Bank name is required.");
      return;
    }
    if (Number.isNaN(editing.ratePct) || editing.ratePct < 0) {
      toast("error", "Rate must be a positive number.");
      return;
    }
    setBusy(true);
    const body: Record<string, unknown> = {
      kind: "bank",
      name: editing.name.trim(),
      ratePct: editing.ratePct,
      active: editing.active,
      contacts: editing.contacts.filter((c) => c.name.trim()),
    };
    const res = creating
      ? await adminPost(body)
      : await adminPatch({ ...body, id: editing.id });
    setBusy(false);
    if (!res.ok) {
      toast("error", res.error ?? "Could not save bank.");
      return;
    }
    await hydrate();
    toast("success", creating ? `${editing.name} added at ${fmtRate(editing.ratePct)}.` : "Bank updated.");
    setEditing(null);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    const res = await adminDelete("bank", deleting.id);
    setBusy(false);
    if (!res.ok) {
      toast("error", res.error ?? "Could not delete bank.");
      return;
    }
    await hydrate();
    toast("success", `${deleting.name} removed.`);
  };

  return (
    <div className="card anim-fade-up">
      <CardHeader
        title={`Banks & commission rates · ${banks.length}`}
        sub="Our commission as % of loan amount. Every change re-computes earnings reports instantly."
        action={
          <button className="btn btn-primary sm:btn-sm" onClick={() => { setEditing(blankBank()); setCreating(true); }}>
            <IPlus size={14} /> Add bank
          </button>
        }
      />
      {sorted.length === 0 ? (
        <EmptyState icon={<IBank size={20} />} title="No banks yet" body="Add the lenders you submit to with their commission rates." />
      ) : (
        <div className="overflow-x-auto">
          <table className="tbl min-w-[640px]">
            <thead>
              <tr>
                <th>Bank</th>
                <th>Rate</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((b) => (
                <tr key={b.id} style={{ opacity: b.active ? 1 : 0.5 }}>
                  <td>
                    <span className="flex items-center gap-2.5">
                      <span className="w-8 h-8 rounded-lg inline-flex items-center justify-center" style={{ background: "var(--tint)", border: "1px solid var(--line-soft)", color: "var(--amber)" }}>
                        <IBank size={16} />
                      </span>
                      <span className="text-[13px] font-medium">{b.name}</span>
                    </span>
                  </td>
                  <td>
                    <span className="mono text-[13px] font-semibold" style={{ color: b.ratePct >= 0.9 ? "var(--mint)" : "var(--ink)" }}>
                      {fmtRate(b.ratePct)}
                    </span>
                    <span className="text-[11px] text-[var(--ink-faint)] ml-1">of loan</span>
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      <ActiveDot active={b.active} />
                      <span className="text-[12px] text-[var(--ink-dim)]">{b.active ? "active" : "inactive"}</span>
                    </span>
                  </td>
                  <td className="text-right">
                    <div className="inline-flex gap-1.5">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => { setEditing({ ...b, contacts: b.contacts ?? [] }); setCreating(false); }}
                      >
                        <IPencil size={13} /> Edit
                      </button>
                      <LogoUpload bankId={b.id} hasLogo={b.hasLogo} />
                      <button className="btn btn-danger btn-sm !px-2" onClick={() => setDeleting(b)} title="Delete">
                        <ITrash size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal
          title={creating ? "Add bank" : `Edit · ${editing.name}`}
          onClose={() => setEditing(null)}
          width={420}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={busy}>
                <ICheck size={15} /> Save
              </button>
            </>
          }
        >
          <div className="space-y-3.5">
            <Field label="Bank name">
              <input className="input" placeholder="e.g. RAKBANK" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
            </Field>
            <Field label="Commission rate (%)">
              <input
                className="input mono"
                type="number"
                step={0.025}
                min={0}
                max={10}
                value={editing.ratePct}
                onChange={(e) => setEditing({ ...editing, ratePct: Number(e.target.value) || 0 })}
              />
            </Field>
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-faint)]">Bank RM contacts</span>
              <div className="mt-1.5">
                <ContactsEditor contacts={editing.contacts} onChange={(contacts) => setEditing({ ...editing, contacts })} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="bank-active"
                checked={editing.active}
                onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
              />
              <label htmlFor="bank-active" className="text-[12.5px] text-[var(--ink-dim)] m-0">
                Active — appears in case pickers
              </label>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={`Delete ${deleting?.name ?? ""}?`}
        body="Existing cases referencing this bank will keep their text label, but the rate will no longer update."
        confirmLabel="Delete"
      />
    </div>
  );
}

/* ------------------------------ partners ------------------------------ */

interface PartnerDraft {
  id: number;
  kind: PartnerKind;
  name: string;
  defaultSharePct: number;
  password: string;
  active: boolean;
  contacts: { name: string; phone?: string; email?: string; role?: string }[];
}

function blankPartner(): PartnerDraft {
  return { id: 0, kind: "Agent", name: "", defaultSharePct: 20, password: "agent123", active: true, contacts: [] };
}

function partnerKindTone(k: PartnerKind): "amber" | "sky" | "coral" {
  return k === "Agent" ? "amber" : k === "Broker" ? "sky" : "coral";
}

function PartnersTab() {
  const { partners, cases, hydrate, toast } = useHfmcStore();
  const [editing, setEditing] = useState<PartnerDraft | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<PartnerItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"All" | PartnerKind>("All");

  const list = useMemo(
    () => partners.filter((p) => filter === "All" || p.kind === filter),
    [partners, filter],
  );

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      toast("error", "Partner name is required.");
      return;
    }
    if (editing.defaultSharePct < 1 || editing.defaultSharePct > 100) {
      toast("error", "Default share must be between 1 and 100.");
      return;
    }
    setBusy(true);
    const body: Record<string, unknown> = {
      kind: "partner",
      partnerKind: editing.kind,
      name: editing.name.trim(),
      defaultSharePct: editing.defaultSharePct,
      active: editing.active,
      contacts: editing.contacts.filter((c) => c.name.trim()),
    };
    // blank password on edit = keep the existing one
    if (creating || editing.password.trim()) body.password = editing.password.trim() || "agent123";
    const res = creating
      ? await adminPost(body)
      : await adminPatch({ ...body, id: editing.id });
    setBusy(false);
    if (!res.ok) {
      toast("error", res.error ?? "Could not save partner.");
      return;
    }
    await hydrate();
    toast("success", creating ? `${editing.name} added as ${editing.kind}.` : "Partner updated.");
    setEditing(null);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    const res = await adminDelete("partner", deleting.id);
    setBusy(false);
    if (!res.ok) {
      toast("error", res.error ?? "Could not delete partner.");
      return;
    }
    await hydrate();
    toast("success", `${deleting.name} removed.`);
  };

  return (
    <div className="card anim-fade-up">
      <CardHeader
        title={`Partners · ${partners.length}`}
        sub="Agents, brokers & referrers. Their payout = share × our bank commission."
        action={
          <button className="btn btn-primary sm:btn-sm" onClick={() => { setEditing(blankPartner()); setCreating(true); }}>
            <IPlus size={14} /> Add partner
          </button>
        }
      />
      <div className="px-4 pt-3 pb-1 flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-[var(--ink-faint)] mr-1 font-disp font-semibold uppercase tracking-[0.1em]">Filter</span>
        <Seg<"All" | PartnerKind>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "All", label: "All" },
            { value: "Agent", label: "Agents" },
            { value: "Broker", label: "Brokers" },
            { value: "Referral", label: "Referrals" },
          ]}
        />
      </div>
      {list.length === 0 ? (
        <EmptyState icon={<IUsers size={20} />} title="No partners yet" body="Add agents, brokers, or referrers to attribute sourcing on cases." />
      ) : (
        <div className="overflow-x-auto">
          <table className="tbl min-w-[680px]">
            <thead>
              <tr>
                <th>Partner</th>
                <th>Kind</th>
                <th>Default share</th>
                <th>Cases</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const casesWith = cases.filter((c) => c.partner?.name === p.name).length;
                return (
                  <tr key={p.id} style={{ opacity: p.active ? 1 : 0.55 }}>
                    <td>
                      <span className="flex items-center gap-2.5">
                        <Avatar name={p.name} size={26} />
                        <span className="text-[13px] font-medium">{p.name}</span>
                      </span>
                    </td>
                    <td><Chip tone={partnerKindTone(p.kind)}>{p.kind}</Chip></td>
                    <td className="mono text-[13px]">{p.defaultSharePct}%</td>
                    <td className="text-[12.5px] text-[var(--ink-dim)] mono">{casesWith}</td>
                    <td>
                      <span className="inline-flex items-center gap-1.5">
                        <ActiveDot active={p.active} />
                        <span className="text-[12px] text-[var(--ink-dim)]">{p.active ? "active" : "inactive"}</span>
                      </span>
                    </td>
                    <td className="text-right">
                      <div className="inline-flex gap-1.5">
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => { setEditing({ ...p, password: "", contacts: p.contacts ?? [] }); setCreating(false); }}
                        >
                          <IPencil size={13} /> Edit
                        </button>
                        <button className="btn btn-danger btn-sm !px-2" onClick={() => setDeleting(p)} title="Delete">
                          <ITrash size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal
          title={creating ? "Add partner" : `Edit · ${editing.name}`}
          onClose={() => setEditing(null)}
          width={440}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={busy}>
                <ICheck size={15} /> Save
              </button>
            </>
          }
        >
          <div className="space-y-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Kind">
                <select
                  className="select"
                  value={editing.kind}
                  onChange={(e) => setEditing({ ...editing, kind: e.target.value as PartnerKind })}
                >
                  <option value="Agent">Agent</option>
                  <option value="Broker">Broker</option>
                  <option value="Referral">Referral</option>
                </select>
              </Field>
              <Field label="Default share (%)">
                <input
                  className="input mono"
                  type="number"
                  min={1}
                  max={100}
                  value={editing.defaultSharePct}
                  onChange={(e) => setEditing({ ...editing, defaultSharePct: Number(e.target.value) || 1 })}
                />
              </Field>
            </div>
            <Field label={`${editing.kind} name`}>
              <input
                className="input"
                placeholder={editing.kind === "Referral" ? "e.g. Nasser Al Mansoori" : `e.g. ${editing.kind} name`}
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                autoFocus
              />
            </Field>
            <Field label="Agent portal password">
              <input
                className="input mono"
                type="text"
                placeholder={creating ? "agent123" : "leave blank to keep current"}
                value={editing.password}
                onChange={(e) => setEditing({ ...editing, password: e.target.value })}
              />
              <p className="text-[11px] text-[var(--ink-faint)] mt-1.5 mb-0">
                Used to sign in at the Agent portal ({editing.name ? editing.name : "partner name"} + this password).
              </p>
            </Field>
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-faint)]">Partner RM / coordinator contacts</span>
              <div className="mt-1.5">
                <ContactsEditor contacts={editing.contacts} onChange={(contacts) => setEditing({ ...editing, contacts })} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="partner-active"
                checked={editing.active}
                onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
              />
              <label htmlFor="partner-active" className="text-[12.5px] text-[var(--ink-dim)] m-0">
                Active — appears in case pickers
              </label>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={`Delete ${deleting?.name ?? ""}?`}
        body="Existing cases keep their partner label, but the partner will no longer appear in pickers."
        confirmLabel="Delete"
      />
    </div>
  );
}

/* ------------------------------ stages ------------------------------ */

interface StageDraft {
  id: number;
  label: string;
  active: boolean;
  sortOrder: number;
}

function blankStage(nextOrder: number): StageDraft {
  return { id: 0, label: "", active: true, sortOrder: nextOrder };
}

function ChannelsTab() {
  const { channels, hydrate, toast } = useHfmcStore();
  const [draft, setDraft] = useState({ name: "", commissionPct: 0.4 });
  const [edit, setEdit] = useState<{ id: number; name: string; commissionPct: number; active: boolean; contacts: { name: string; phone?: string; email?: string; role?: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!draft.name.trim()) return toast("error", "Name is required.");
    setBusy(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "channel", name: draft.name.trim(), commissionPct: draft.commissionPct }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Create failed");
      toast("success", `Channel ${draft.name} added.`);
      setDraft({ name: "", commissionPct: 0.4 });
      await hydrate();
    } catch (e) { toast("error", e instanceof Error ? e.message : "Create failed"); }
    setBusy(false);
  };

  const saveEdit = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "channel", id: edit.id, name: edit.name, commissionPct: edit.commissionPct, active: edit.active, contacts: edit.contacts.filter((c) => c.name.trim()) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Update failed");
      toast("success", "Channel updated.");
      setEdit(null);
      await hydrate();
    } catch (e) { toast("error", e instanceof Error ? e.message : "Update failed"); }
    setBusy(false);
  };

  const del = async (id: number, name: string) => {
    if (!confirm(`Delete channel "${name}"?`)) return;
    try {
      await fetch(`/api/admin?kind=channel&id=${id}`, { method: "DELETE" });
      toast("success", "Channel deleted.");
      await hydrate();
    } catch { toast("error", "Delete failed."); }
  };

  return (
    <CardHeader title="Channels" sub="Platforms (Huspy, Prypco, etc.) that submit deals and take a cut of the loan amount">
      <div className="flex flex-wrap gap-2 mb-4">
        <input className="input !w-auto" style={{ minWidth: 200 }} placeholder="Channel name (e.g. Huspy)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <input className="input mono !w-24" type="number" step={0.05} min={0} max={2} placeholder="0.40" value={draft.commissionPct} onChange={(e) => setDraft({ ...draft, commissionPct: Number(e.target.value) || 0 })} />
        <span className="text-[11px] text-[var(--ink-faint)] self-center">% of loan amount</span>
        <button className="btn btn-primary" onClick={submit} disabled={busy}>Add channel</button>
      </div>
      <div className="overflow-x-auto">
        <table className="tbl min-w-[500px]">
          <thead><tr><th>Name</th><th>Commission %</th><th>Active</th><th className="text-right">Actions</th></tr></thead>
          <tbody>
            {channels.map((ch) => (
              <tr key={ch.id}>
                <td className="font-medium">{ch.name}</td>
                <td className="mono">{ch.commissionPct}%</td>
                <td>{ch.active ? <span style={{ color: "var(--mint)" }}>●</span> : <span style={{ color: "var(--ink-faint)" }}>○</span>}</td>
                <td className="text-right">
                  <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ id: ch.id, name: ch.name, commissionPct: ch.commissionPct, active: ch.active, contacts: ch.contacts ?? [] })}>Edit</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => del(ch.id, ch.name)}>Delete</button>
                </td>
              </tr>
            ))}
            {channels.length === 0 && <tr><td colSpan={4} className="text-center text-[var(--ink-faint)] py-4">No channels yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal title="Edit channel" onClose={() => setEdit(null)} footer={<><button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-primary" onClick={saveEdit} disabled={busy}>Save</button></>}>
          <div className="space-y-3">
            <div><label className="label">Name</label><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
            <div><label className="label">Commission % (of loan amount)</label><input className="input mono" type="number" step={0.05} min={0} max={2} value={edit.commissionPct} onChange={(e) => setEdit({ ...edit, commissionPct: Number(e.target.value) || 0 })} /></div>
            <div><label className="label">Active</label><button className="btn btn-ghost btn-sm" onClick={() => setEdit({ ...edit, active: !edit.active })}>{edit.active ? "● Active" : "○ Inactive"}</button></div>
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-faint)]">Channel RM / coordinator contacts</span>
              <div className="mt-1.5">
                <ContactsEditor contacts={edit.contacts} onChange={(contacts) => setEdit({ ...edit, contacts })} />
              </div>
            </div>
          </div>
        </Modal>
      )}
    </CardHeader>
  );
}

function StagesTab() {
  const { stages, hydrate, toast } = useHfmcStore();
  const [editing, setEditing] = useState<StageDraft | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<StageItem | null>(null);
  const [busy, setBusy] = useState(false);

  const sorted = useMemo(() => [...stages].sort((a, b) => a.sortOrder - b.sortOrder), [stages]);

  const save = async () => {
    if (!editing) return;
    if (!editing.label.trim()) {
      toast("error", "Stage label is required.");
      return;
    }
    setBusy(true);
    const body: Record<string, unknown> = {
      kind: "stage",
      label: editing.label.trim(),
      active: editing.active,
      sortOrder: editing.sortOrder,
    };
    const res = creating
      ? await adminPost(body)
      : await adminPatch({ ...body, id: editing.id });
    setBusy(false);
    if (!res.ok) {
      toast("error", res.error ?? "Could not save stage.");
      return;
    }
    await hydrate();
    toast("success", creating ? `Stage "${editing.label}" added.` : "Stage updated.");
    setEditing(null);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    const res = await adminDelete("stage", deleting.id);
    setBusy(false);
    if (!res.ok) {
      toast("error", res.error ?? "Could not delete stage.");
      return;
    }
    await hydrate();
    toast("success", `"${deleting.label}" deleted.`);
  };

  const nextOrder = sorted.length ? sorted[sorted.length - 1].sortOrder + 1 : 1;

  return (
    <div className="card anim-fade-up">
      <CardHeader
        title={`Workflow stages · ${stages.length}`}
        sub="Ordered left-to-right on every Case 360. Deactivated stages disappear from pickers."
        action={
          <button className="btn btn-primary sm:btn-sm" onClick={() => { setEditing(blankStage(nextOrder)); setCreating(true); }}>
            <IPlus size={14} /> Add stage
          </button>
        }
      />
      {sorted.length === 0 ? (
        <EmptyState icon={<ITrophy size={20} />} title="No pipeline stages" body="Define the steps a case moves through, in order." />
      ) : (
        <div className="overflow-x-auto">
          <table className="tbl min-w-[640px]">
            <thead>
              <tr>
                <th className="w-[60px]">Order</th>
                <th>Stage</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr key={s.id} style={{ opacity: s.active ? 1 : 0.5 }}>
                  <td className="mono text-[12px] text-[var(--ink-faint)]">{s.sortOrder}</td>
                  <td className="text-[13px] font-medium">{s.label}</td>
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      <ActiveDot active={s.active} />
                      <span className="text-[12px] text-[var(--ink-dim)]">{s.active ? "active" : "inactive"}</span>
                    </span>
                  </td>
                  <td className="text-right">
                    <div className="inline-flex gap-1.5">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => { setEditing({ ...s }); setCreating(false); }}
                      >
                        <IPencil size={13} /> Edit
                      </button>
                      <button className="btn btn-danger btn-sm !px-2" onClick={() => setDeleting(s)} title="Delete">
                        <ITrash size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal
          title={creating ? "Add stage" : `Edit · ${editing.label}`}
          onClose={() => setEditing(null)}
          width={420}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={busy}>
                <ICheck size={15} /> Save
              </button>
            </>
          }
        >
          <div className="space-y-3.5">
            <Field label="Stage label">
              <input className="input" placeholder="e.g. Awaiting NOC" value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} autoFocus />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Sort order">
                <input
                  className="input mono"
                  type="number"
                  min={0}
                  value={editing.sortOrder}
                  onChange={(e) => setEditing({ ...editing, sortOrder: Number(e.target.value) || 0 })}
                />
              </Field>
              <div className="flex items-end pb-2">
                <span className="text-[11.5px] text-[var(--ink-faint)]">Lower numbers appear first on the pipeline.</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="stage-active"
                checked={editing.active}
                onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
              />
              <label htmlFor="stage-active" className="text-[12.5px] text-[var(--ink-dim)] m-0">
                Active — available in stage pickers
              </label>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={`Delete "${deleting?.label ?? ""}"?`}
        body="Cases already in this stage keep their label but it will no longer appear as an option."
        confirmLabel="Delete"
      />
    </div>
  );
}

/* ------------------------------ masters (whyPending + waitingFor) ------------------------------ */

interface MasterDraft {
  id: number;
  label: string;
  active: boolean;
}

function blankMaster(): MasterDraft {
  return { id: 0, label: "", active: true };
}

function MastersTab() {
  const { whyPending, waitingFor, hydrate, toast } = useHfmcStore();
  const [kind, setKind] = useState<MasterKind>("whyPending");
  const [editing, setEditing] = useState<MasterDraft | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<MasterItem | null>(null);
  const [busy, setBusy] = useState(false);

  const items = kind === "whyPending" ? whyPending : waitingFor;

  const save = async () => {
    if (!editing) return;
    if (!editing.label.trim()) {
      toast("error", "Label is required.");
      return;
    }
    setBusy(true);
    const body: Record<string, unknown> = {
      kind: "master",
      masterKind: kind,
      label: editing.label.trim(),
      active: editing.active,
    };
    const res = creating
      ? await adminPost(body)
      : await adminPatch({ ...body, id: editing.id });
    setBusy(false);
    if (!res.ok) {
      toast("error", res.error ?? "Could not save item.");
      return;
    }
    await hydrate();
    toast("success", creating ? `"${editing.label}" added.` : "Item updated.");
    setEditing(null);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    const res = await adminDelete("master", deleting.id);
    setBusy(false);
    if (!res.ok) {
      toast("error", res.error ?? "Could not delete item.");
      return;
    }
    await hydrate();
    toast("success", `"${deleting.label}" deleted.`);
  };

  const titleMap: Record<MasterKind, string> = {
    whyPending: "Why pending reasons",
    waitingFor: "Waiting-for types",
  };
  const subMap: Record<MasterKind, string> = {
    whyPending: "Tags used in the task engine and reports to explain why a task is stuck.",
    waitingFor: "Who the task is waiting on — drives chips and escalation routing.",
  };

  return (
    <div className="card anim-fade-up">
      <CardHeader
        title={titleMap[kind]}
        sub={subMap[kind]}
        action={
          <button className="btn btn-primary sm:btn-sm" onClick={() => { setEditing(blankMaster()); setCreating(true); }}>
            <IPlus size={14} /> Add
          </button>
        }
      />
      <div className="px-4 pt-3 pb-1">
        <Seg<MasterKind>
          value={kind}
          onChange={setKind}
          options={[
            { value: "whyPending", label: "Why pending", count: whyPending.length },
            { value: "waitingFor", label: "Waiting for", count: waitingFor.length },
          ]}
        />
      </div>
      {items.length === 0 ? (
        <EmptyState icon={<IX size={20} />} title="Nothing here yet" body="Add labels so the team can categorise why tasks are stuck." />
      ) : (
        <div className="overflow-x-auto">
          <table className="tbl min-w-[520px]">
            <thead>
              <tr>
                <th>Label</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id} style={{ opacity: m.active ? 1 : 0.5 }}>
                  <td className="text-[13px] font-medium">{m.label}</td>
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      <ActiveDot active={m.active} />
                      <span className="text-[12px] text-[var(--ink-dim)]">{m.active ? "active" : "inactive"}</span>
                    </span>
                  </td>
                  <td className="text-right">
                    <div className="inline-flex gap-1.5">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => { setEditing({ ...m }); setCreating(false); }}
                      >
                        <IPencil size={13} /> Edit
                      </button>
                      <button className="btn btn-danger btn-sm !px-2" onClick={() => setDeleting(m)} title="Delete">
                        <ITrash size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal
          title={creating ? `Add · ${titleMap[kind]}` : `Edit · ${editing.label}`}
          onClose={() => setEditing(null)}
          width={400}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={busy}>
                <ICheck size={15} /> Save
              </button>
            </>
          }
        >
          <div className="space-y-3.5">
            <Field label="Label">
              <input
                className="input"
                placeholder="e.g. Awaiting NOC from developer"
                value={editing.label}
                onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                autoFocus
              />
            </Field>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="master-active"
                checked={editing.active}
                onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
              />
              <label htmlFor="master-active" className="text-[12.5px] text-[var(--ink-dim)] m-0">
                Active — appears in dropdowns
              </label>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={`Delete "${deleting?.label ?? ""}"?`}
        body="Past tasks keep their label, but it stops appearing in new dropdowns."
        confirmLabel="Delete"
      />
    </div>
  );
}

/* ------------------------------ SLA rules ------------------------------ */

interface SlaDraft {
  id: number;
  stage: string;
  bank: string | null;
  maxDays: number;
  active: boolean;
}

function blankSla(stage: string): SlaDraft {
  return { id: 0, stage, bank: null, maxDays: 5, active: true };
}

function SlaTab() {
  const { slaRules, stages, banks, hydrate, toast } = useHfmcStore();
  const [editing, setEditing] = useState<SlaDraft | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<SlaRule | null>(null);
  const [busy, setBusy] = useState(false);

  const stageLabels = useMemo(
    () => [...stages].sort((a, b) => a.sortOrder - b.sortOrder).map((s) => s.label),
    [stages],
  );

  const sorted = useMemo(
    () => [...slaRules].sort((a, b) => a.stage.localeCompare(b.stage) || (a.bank ?? "").localeCompare(b.bank ?? "")),
    [slaRules],
  );

  const save = async () => {
    if (!editing) return;
    if (!editing.stage) {
      toast("error", "Pick a stage.");
      return;
    }
    if (!editing.maxDays || editing.maxDays < 1) {
      toast("error", "Max days must be at least 1.");
      return;
    }
    setBusy(true);
    const body: Record<string, unknown> = {
      kind: "sla",
      stage: editing.stage,
      bank: editing.bank ?? null,
      maxDays: editing.maxDays,
      active: editing.active,
    };
    const res = creating
      ? await adminPost(body)
      : await adminPatch({ ...body, id: editing.id });
    setBusy(false);
    if (!res.ok) {
      toast("error", res.error ?? "Could not save SLA rule.");
      return;
    }
    await hydrate();
    toast("success", creating ? `SLA rule added: ${editing.stage} · ${editing.bank ?? "all banks"} · ${editing.maxDays}d.` : "SLA rule updated.");
    setEditing(null);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    const res = await adminDelete("sla", deleting.id);
    setBusy(false);
    if (!res.ok) {
      toast("error", res.error ?? "Could not delete SLA rule.");
      return;
    }
    await hydrate();
    toast("info", "SLA rule removed.");
  };

  return (
    <div className="card anim-fade-up">
      <CardHeader
        title={`SLA rules · ${slaRules.length}`}
        sub="Max days a case may sit in a stage before it escalates. Bank-specific rules override the default."
        action={
          <button
            className="btn btn-primary sm:btn-sm"
            onClick={() => { setEditing(blankSla(stageLabels[0] ?? "")); setCreating(true); }}
          >
            <IPlus size={14} /> Add rule
          </button>
        }
      />
      {sorted.length === 0 ? (
        <EmptyState icon={<ICheck size={20} />} title="No SLA rules" body="Without rules, nothing will escalate. Add one per stage." />
      ) : (
        <div className="overflow-x-auto">
          <table className="tbl min-w-[680px]">
            <thead>
              <tr>
                <th>Stage</th>
                <th>Bank</th>
                <th>Max days</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} style={{ opacity: r.active ? 1 : 0.5 }}>
                  <td><Chip tone="slate">{r.stage}</Chip></td>
                  <td>
                    {r.bank ? <Chip tone="sky">{r.bank}</Chip> : <span className="text-[12px] text-[var(--ink-faint)]">all banks</span>}
                  </td>
                  <td className="mono text-[13px] font-semibold">{r.maxDays}d</td>
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      <ActiveDot active={r.active} />
                      <span className="text-[12px] text-[var(--ink-dim)]">{r.active ? "active" : "inactive"}</span>
                    </span>
                  </td>
                  <td className="text-right">
                    <div className="inline-flex gap-1.5">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => { setEditing({ ...r }); setCreating(false); }}
                      >
                        <IPencil size={13} /> Edit
                      </button>
                      <button className="btn btn-danger btn-sm !px-2" onClick={() => setDeleting(r)} title="Delete">
                        <ITrash size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal
          title={creating ? "Add SLA rule" : "Edit SLA rule"}
          onClose={() => setEditing(null)}
          width={440}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={busy}>
                <ICheck size={15} /> Save
              </button>
            </>
          }
        >
          <div className="space-y-3.5">
            <Field label="Stage">
              <select
                className="select"
                value={editing.stage}
                onChange={(e) => setEditing({ ...editing, stage: e.target.value })}
              >
                {stageLabels.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Bank override">
              <select
                className="select"
                value={editing.bank ?? ""}
                onChange={(e) => setEditing({ ...editing, bank: e.target.value || null })}
              >
                <option value="">All banks (default)</option>
                {banks.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="Max days in stage">
              <input
                className="input mono"
                type="number"
                min={1}
                value={editing.maxDays}
                onChange={(e) => setEditing({ ...editing, maxDays: Number(e.target.value) || 1 })}
              />
            </Field>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="sla-active"
                checked={editing.active}
                onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
              />
              <label htmlFor="sla-active" className="text-[12.5px] text-[var(--ink-dim)] m-0">
                Active — escalates cases that breach
              </label>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title="Delete SLA rule?"
        body={`Stage "${deleting?.stage ?? ""}" · ${deleting?.bank ?? "all banks"} · ${deleting?.maxDays ?? 0}d will stop escalating.`}
        confirmLabel="Delete"
      />
    </div>
  );
}

/* ------------------------------ doc rules — conditional vault master (SOP §8.2 + §3.3) ------------------------------ */

const DOC_CONDITION_SETS = {
  employment: ["all", "Salaried", "Self-Employed"],
  property: ["any", "Ready", "Off-Plan"],
  transaction: ["any", "New Purchase", "Buyout / Equity Release"],
  residency: ["all", "UAE National", "Resident Expatriate", "Non-Resident"],
};

interface DocRuleDraft {
  id: number;
  code: string;
  name: string;
  category: string;
  validityDays: number;
  warnDays: number;
  verifyNotes: string;
  applicableEmployment: string[];
  applicablePropertyType: string[];
  applicableTransaction: string[];
  applicableResidency: string[];
  mandatory: boolean;
  visibleToClient: boolean;
  clientCanUpload: boolean;
  active: boolean;
}

function blankDocRule(): DocRuleDraft {
  return {
    id: 0, code: "", name: "", category: "KYC", validityDays: 30, warnDays: 7, verifyNotes: "",
    applicableEmployment: ["all"], applicablePropertyType: ["any"], applicableTransaction: ["any"],
    applicableResidency: ["all"], mandatory: true, visibleToClient: true, clientCanUpload: true, active: true,
  };
}

function ConditionRow({ label, options, selected, onToggle, exclusive }: {
  label: string; options: string[]; selected: string[]; onToggle: (v: string) => void; exclusive: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = selected.includes(o);
          return (
            <button key={o} type="button" className="chip transition-all" onClick={() => onToggle(o)}
              style={on
                ? { background: "rgba(242,176,76,0.14)", borderColor: "var(--amber)", color: "var(--amber)" }
                : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}>
              {o}
            </button>
          );
        })}
      </div>
      <p className="text-[10.5px] text-[var(--ink-faint)] mt-1 mb-0">pick {exclusive} — or any mix of specific values</p>
    </div>
  );
}

function toggleValue(selected: string[], value: string, exclusive: string): string[] {
  const others = selected.filter((v) => v !== exclusive);
  // toggling a specific value clears the exclusive, and vice versa
  if (value === exclusive) return selected.includes(value) ? [] : [value];
  const next = others.includes(value) ? others.filter((v) => v !== value) : [...others, value];
  return next.length ? next : [exclusive];
}

function DocRulesTab() {
  const { docRules, hydrate, toast } = useHfmcStore();
  const [editing, setEditing] = useState<DocRuleDraft | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<DocRule | null>(null);
  const [busy, setBusy] = useState(false);

  const sorted = useMemo(
    () => [...docRules].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
    [docRules],
  );

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      toast("error", "Document name is required.");
      return;
    }
    setBusy(true);
    const body: Record<string, unknown> = {
      kind: "docrule",
      name: editing.name.trim(),
      category: editing.category,
      validityDays: Math.max(0, editing.validityDays || 0),
      warnDays: Math.max(0, editing.warnDays || 0),
      verifyNotes: editing.verifyNotes,
      applicableEmployment: editing.applicableEmployment.length ? editing.applicableEmployment : ["all"],
      applicablePropertyType: editing.applicablePropertyType.length ? editing.applicablePropertyType : ["any"],
      applicableTransaction: editing.applicableTransaction.length ? editing.applicableTransaction : ["any"],
      applicableResidency: editing.applicableResidency.length ? editing.applicableResidency : ["all"],
      mandatory: editing.mandatory,
      visibleToClient: editing.visibleToClient,
      clientCanUpload: editing.clientCanUpload,
      active: editing.active,
    };
    const res = creating ? await adminPost(body) : await adminPatch({ ...body, id: editing.id });
    setBusy(false);
    if (!res.ok) {
      toast("error", res.error ?? "Could not save document rule.");
      return;
    }
    await hydrate();
    toast("success", creating ? `Document rule added: ${editing.name}.` : "Document rule updated — checklists re-sync on the next profile change.");
    setEditing(null);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    const res = await adminDelete("docrule", deleting.id);
    setBusy(false);
    if (!res.ok) {
      toast("error", res.error ?? "Could not delete document rule.");
      return;
    }
    await hydrate();
    toast("info", "Document rule removed.");
  };

  const condSummary = (d: DocRule) => {
    const parts: string[] = [];
    if (!d.applicableEmployment.includes("all")) parts.push(d.applicableEmployment.join("/"));
    if (!d.applicableResidency.includes("all")) parts.push(d.applicableResidency.join("/"));
    if (!d.applicablePropertyType.includes("any")) parts.push(d.applicablePropertyType.join("/"));
    if (!d.applicableTransaction.includes("any")) parts.push(d.applicableTransaction.join("/"));
    return parts.length ? parts.join(" · ") : "all cases";
  };

  return (
    <div className="card anim-fade-up">
      <CardHeader
        title={`Document rules · ${docRules.length}`}
        sub="The master catalog behind every case's Document Vault — conditions decide which cases need each document. Edit here, no code needed."
        action={
          <button
            className="btn btn-primary sm:btn-sm"
            onClick={() => { setEditing(blankDocRule()); setCreating(true); }}
          >
            <IPlus size={14} /> Add document
          </button>
        }
      />
      {sorted.length === 0 ? (
        <EmptyState icon={<ICheck size={20} />} title="No document rules" body="Add the documents your process tracks — they auto-appear on matching cases." />
      ) : (
        <div className="overflow-x-auto">
          <table className="tbl min-w-[900px]">
            <thead>
              <tr>
                <th>Document</th>
                <th>Category</th>
                <th>Applies to</th>
                <th>Valid / warn</th>
                <th>Access</th>
                <th>What to verify</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((d) => (
                <tr key={d.id} style={{ opacity: d.active ? 1 : 0.5 }}>
                  <td>
                    <span className="font-medium">{d.name}</span>
                    {d.code && <span className="block mono text-[10px] text-[var(--ink-faint)]">{d.code}</span>}
                  </td>
                  <td><Chip tone="slate">{d.category}</Chip></td>
                  <td className="text-[11.5px] text-[var(--ink-dim)] max-w-[200px]">{condSummary(d)}</td>
                  <td className="mono text-[12.5px]">
                    {d.validityDays > 0 ? `${d.validityDays}d` : "—"}
                    <span className="text-[var(--ink-faint)]"> / {d.warnDays > 0 ? `${d.warnDays}d` : "—"}</span>
                  </td>
                  <td>
                    <span className="flex flex-wrap gap-1">
                      <Chip tone={d.visibleToClient ? "sky" : "coral"}>{d.visibleToClient ? "client" : "internal"}</Chip>
                      {d.visibleToClient && d.clientCanUpload && <Chip tone="mint">upload</Chip>}
                      {d.mandatory && <Chip tone="amber">must</Chip>}
                    </span>
                  </td>
                  <td className="text-[12px] text-[var(--ink-dim)] max-w-[300px]">{d.verifyNotes || "—"}</td>
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      <ActiveDot active={d.active} />
                      <span className="text-[12px] text-[var(--ink-dim)]">{d.active ? "active" : "inactive"}</span>
                    </span>
                  </td>
                  <td className="text-right">
                    <div className="inline-flex gap-1.5">
                      <button className="btn btn-ghost btn-sm" onClick={() => { setEditing({ ...d }); setCreating(false); }}>
                        <IPencil size={13} /> Edit
                      </button>
                      <button className="btn btn-danger btn-sm !px-2" onClick={() => setDeleting(d)} title="Delete">
                        <ITrash size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal
          title={creating ? "Add document rule" : `Edit · ${editing.name}`}
          sub="Conditions decide which cases get this document. Changing conditions only affects new checklist syncs — existing cases keep their vault until a profile change."
          onClose={() => setEditing(null)}
          width={560}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={busy}>
                <ICheck size={15} /> Save
              </button>
            </>
          }
        >
          <div className="space-y-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Document name">
                <input className="input" value={editing.name} placeholder="e.g. Salary Certificate" onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </Field>
              <Field label="Code (optional)">
                <input className="input mono" value={editing.code} placeholder="e.g. DOC-SAL-CERT" onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Category">
                <select className="select" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                  {DOC_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Valid for (days · 0 = none)">
                <input className="input mono" type="number" min={0} value={editing.validityDays} onChange={(e) => setEditing({ ...editing, validityDays: Number(e.target.value) || 0 })} />
              </Field>
              <Field label="Warn before expiry">
                <input className="input mono" type="number" min={0} value={editing.warnDays} onChange={(e) => setEditing({ ...editing, warnDays: Number(e.target.value) || 0 })} />
              </Field>
            </div>

            <div className="rounded-lg p-3 space-y-3" style={{ background: "var(--tint)" }}>
              <ConditionRow
                label="Employment profile"
                options={DOC_CONDITION_SETS.employment}
                selected={editing.applicableEmployment}
                onToggle={(v) => setEditing({ ...editing, applicableEmployment: toggleValue(editing.applicableEmployment, v, "all") })}
                exclusive="all"
              />
              <ConditionRow
                label="Residency"
                options={DOC_CONDITION_SETS.residency}
                selected={editing.applicableResidency}
                onToggle={(v) => setEditing({ ...editing, applicableResidency: toggleValue(editing.applicableResidency, v, "all") })}
                exclusive="all"
              />
              <ConditionRow
                label="Property type"
                options={DOC_CONDITION_SETS.property}
                selected={editing.applicablePropertyType}
                onToggle={(v) => setEditing({ ...editing, applicablePropertyType: toggleValue(editing.applicablePropertyType, v, "any") })}
                exclusive="any"
              />
              <ConditionRow
                label="Transaction"
                options={DOC_CONDITION_SETS.transaction}
                selected={editing.applicableTransaction}
                onToggle={(v) => setEditing({ ...editing, applicableTransaction: toggleValue(editing.applicableTransaction, v, "any") })}
                exclusive="any"
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              <ToggleChip on={editing.mandatory} onClick={() => setEditing({ ...editing, mandatory: !editing.mandatory })} onLabel="mandatory" offLabel="optional" />
              <ToggleChip on={editing.visibleToClient} onClick={() => setEditing({ ...editing, visibleToClient: !editing.visibleToClient, clientCanUpload: !editing.visibleToClient ? false : editing.clientCanUpload })} onLabel="client visible" offLabel="internal only" />
              <ToggleChip on={editing.clientCanUpload} onClick={() => setEditing({ ...editing, clientCanUpload: !editing.clientCanUpload })} onLabel="client can upload" offLabel="staff upload" />
              <ToggleChip on={editing.active} onClick={() => setEditing({ ...editing, active: !editing.active })} onLabel="active" offLabel="inactive" />
            </div>

            <Field label="What to verify / rejection triggers">
              <textarea
                className="input"
                rows={2}
                value={editing.verifyNotes}
                placeholder="e.g. Company stamp + PO Box; issued within 1 month"
                onChange={(e) => setEditing({ ...editing, verifyNotes: e.target.value })}
              />
            </Field>
          </div>
        </Modal>
      )}

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title="Delete document rule?"
        body={`"${deleting?.name ?? ""}" will no longer appear on new checklists. Existing case vaults keep their copies.`}
        confirmLabel="Delete"
      />
    </div>
  );
}

function ToggleChip({ on, onClick, onLabel, offLabel }: { on: boolean; onClick: () => void; onLabel: string; offLabel: string }) {
  return (
    <button type="button" className="chip transition-all" onClick={onClick}
      style={on
        ? { background: "rgba(67,214,155,0.12)", borderColor: "rgba(67,214,155,0.5)", color: "var(--mint)" }
        : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}>
      {on ? onLabel : offLabel}
    </button>
  );
}

/* ------------------------------ fee rules (SOP §6.9) ------------------------------ */

interface FeeRuleDraft {
  id: number;
  emirate: FeeRule["emirate"];
  txnType: FeeRule["txnType"];
  label: string;
  amountType: FeeRule["amountType"];
  amount: number;
  paidBy: string;
  note: string;
  active: boolean;
}

function blankFeeRule(): FeeRuleDraft {
  return { id: 0, emirate: "Dubai", txnType: "Primary", label: "", amountType: "fixed", amount: 0, paidBy: "Client", note: "", active: true };
}

function FeeRulesTab() {
  const { feeRules, hydrate, toast } = useHfmcStore();
  const [editing, setEditing] = useState<FeeRuleDraft | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<FeeRule | null>(null);
  const [busy, setBusy] = useState(false);
  const [filterEmirate, setFilterEmirate] = useState<FeeRule["emirate"]>("Dubai");
  const [filterTxn, setFilterTxn] = useState<FeeRule["txnType"]>("Primary");

  const rows = useMemo(
    () => feeRules
      .filter((f) => f.emirate === filterEmirate && f.txnType === filterTxn)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
    [feeRules, filterEmirate, filterTxn],
  );

  const amountLabel = (f: FeeRule) =>
    f.amountType === "fixed" ? `AED ${f.amount.toLocaleString("en-US")}` : `${f.amount}%`;

  const save = async () => {
    if (!editing) return;
    if (!editing.label.trim()) {
      toast("error", "Fee label is required.");
      return;
    }
    setBusy(true);
    const body: Record<string, unknown> = {
      kind: "feerule",
      emirate: editing.emirate,
      txnType: editing.txnType,
      label: editing.label.trim(),
      amountType: editing.amountType,
      amount: Math.max(0, editing.amount || 0),
      paidBy: editing.paidBy,
      note: editing.note,
      active: editing.active,
    };
    const res = creating ? await adminPost(body) : await adminPatch({ ...body, id: editing.id });
    setBusy(false);
    if (!res.ok) {
      toast("error", res.error ?? "Could not save fee rule.");
      return;
    }
    await hydrate();
    toast("success", creating ? `Fee rule added: ${editing.label}.` : "Fee rule updated.");
    setEditing(null);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    const res = await adminDelete("feerule", deleting.id);
    setBusy(false);
    if (!res.ok) {
      toast("error", res.error ?? "Could not delete fee rule.");
      return;
    }
    await hydrate();
    toast("info", "Fee rule removed.");
  };

  return (
    <div className="card anim-fade-up">
      <CardHeader
        title="Transfer fee rules"
        sub="Government & bank charges per emirate and transaction type — feeds the Calculator's Transfer Fees tab. Edit here, no code needed."
        action={
          <button
            className="btn btn-primary sm:btn-sm"
            onClick={() => { setEditing({ ...blankFeeRule(), emirate: filterEmirate, txnType: filterTxn }); setCreating(true); }}
          >
            <IPlus size={14} /> Add fee
          </button>
        }
      />
      <div className="flex flex-wrap gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
        <Seg<FeeRule["emirate"]> value={filterEmirate} onChange={setFilterEmirate} options={FEE_EMIRATES.map((e) => ({ value: e, label: e }))} />
        <Seg<FeeRule["txnType"]> value={filterTxn} onChange={setFilterTxn} options={FEE_TXN_TYPES.map((t) => ({ value: t, label: t === "Buyout" ? "Buyout / Equity" : t }))} />
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<ICheck size={20} />} title="No fees for this emirate / transaction" body="Add the charges your teams quote clients — DLD transfer, trustee, registration, agency." />
      ) : (
        <div className="overflow-x-auto">
          <table className="tbl min-w-[760px]">
            <thead>
              <tr>
                <th>Fee</th>
                <th>Amount</th>
                <th>Paid by</th>
                <th>Note</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id} style={{ opacity: f.active ? 1 : 0.5 }}>
                  <td className="font-medium">{f.label}</td>
                  <td className="mono text-[13px] font-semibold">
                    {amountLabel(f)}
                    <span className="text-[10.5px] text-[var(--ink-faint)] ml-1.5 normal-case">
                      {f.amountType === "pct_property" ? "of property" : f.amountType === "pct_loan" ? "of finance" : ""}
                    </span>
                  </td>
                  <td>
                    <Chip tone={f.paidBy === "Seller" ? "sky" : "slate"}>{f.paidBy}</Chip>
                  </td>
                  <td className="text-[12px] text-[var(--ink-dim)] max-w-[320px]">{f.note || "—"}</td>
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      <ActiveDot active={f.active} />
                      <span className="text-[12px] text-[var(--ink-dim)]">{f.active ? "active" : "inactive"}</span>
                    </span>
                  </td>
                  <td className="text-right">
                    <div className="inline-flex gap-1.5">
                      <button className="btn btn-ghost btn-sm" onClick={() => { setEditing({ ...f }); setCreating(false); }}>
                        <IPencil size={13} /> Edit
                      </button>
                      <button className="btn btn-danger btn-sm !px-2" onClick={() => setDeleting(f)} title="Delete">
                        <ITrash size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal
          title={creating ? "Add fee rule" : "Edit fee rule"}
          onClose={() => setEditing(null)}
          width={520}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={busy}>
                <ICheck size={15} /> Save
              </button>
            </>
          }
        >
          <div className="space-y-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Emirate">
                <select
                  className="select"
                  value={editing.emirate}
                  onChange={(e) => setEditing({ ...editing, emirate: e.target.value as FeeRule["emirate"] })}
                >
                  {FEE_EMIRATES.map((e2) => <option key={e2} value={e2}>{e2}</option>)}
                </select>
              </Field>
              <Field label="Transaction type">
                <select
                  className="select"
                  value={editing.txnType}
                  onChange={(e) => setEditing({ ...editing, txnType: e.target.value as FeeRule["txnType"] })}
                >
                  {FEE_TXN_TYPES.map((t) => <option key={t} value={t}>{t === "Buyout" ? "Buyout / Equity Release" : t}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Fee label">
              <input
                className="input"
                value={editing.label}
                placeholder="e.g. DLD Transfer Fee"
                onChange={(e) => setEditing({ ...editing, label: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Basis">
                <select
                  className="select"
                  value={editing.amountType}
                  onChange={(e) => setEditing({ ...editing, amountType: e.target.value as FeeRule["amountType"] })}
                >
                  {FEE_AMOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t === "pct_property" ? "% of property" : t === "pct_loan" ? "% of finance" : "Fixed AED"}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={editing.amountType === "fixed" ? "Amount (AED)" : "Percent (%)"}>
                <input
                  className="input mono"
                  type="number"
                  min={0}
                  step={editing.amountType === "fixed" ? 1 : 0.05}
                  value={editing.amount}
                  onChange={(e) => setEditing({ ...editing, amount: Number(e.target.value) || 0 })}
                />
              </Field>
              <Field label="Paid by">
                <select
                  className="select"
                  value={editing.paidBy}
                  onChange={(e) => setEditing({ ...editing, paidBy: e.target.value })}
                >
                  <option value="Client">Client</option>
                  <option value="Seller">Seller</option>
                </select>
              </Field>
            </div>
            <Field label="Note">
              <input
                className="input"
                value={editing.note}
                placeholder="e.g. 4% of property value · incl. VAT"
                onChange={(e) => setEditing({ ...editing, note: e.target.value })}
              />
            </Field>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="feerule-active"
                checked={editing.active}
                onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
              />
              <label htmlFor="feerule-active" className="text-[12.5px] text-[var(--ink-dim)] m-0">
                Active — included in transfer fee quotes
              </label>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title="Delete fee rule?"
        body={`"${deleting?.label ?? ""}" (${deleting?.emirate ?? ""} · ${deleting?.txnType ?? ""}) will no longer appear in transfer quotes.`}
        confirmLabel="Delete"
      />
    </div>
  );
}

/* ------------------------------ bank rules (rule engine phase 0) ------------------------------ */

function LogoUpload({ bankId, hasLogo }: { bankId: number; hasLogo: boolean }) {
  const { uploadBankLogo } = useHfmcStore();
  const [busy, setBusy] = useState(false);
  return (
    <label className="btn btn-ghost btn-sm !px-2" title="Upload logo (PNG/JPG/SVG, ≤1 MB)" style={{ cursor: busy ? "wait" : "pointer" }}>
      {hasLogo ? "Logo ✓" : "Logo"}
      <input
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          await uploadBankLogo(bankId, f);
          setBusy(false);
        }}
      />
    </label>
  );
}

type FieldRole = "engine" | "planned";
const NUM_FIELDS: { key: keyof BankProduct; label: string; suffix?: string; role: FieldRole; help: string }[] = [
  { key: "maxLtvNational", label: "Max LTV · nationals", suffix: "%", role: "engine", help: "Highest finance allowed on the property value for UAE Nationals. The engine caps the loan at this % of the property." },
  { key: "maxLtvExpatriate", label: "Max LTV · expats", suffix: "%", role: "engine", help: "Same cap for expatriate clients — usually the binding limit for them." },
  { key: "tenorYears", label: "Max tenor", suffix: "y", role: "engine", help: "Longest loan duration. A longer tenor means a smaller EMI, so a bigger loan passes the DBR check." },
  { key: "minLoan", label: "Min loan", suffix: " AED", role: "engine", help: "Requests below this are refused by the bank." },
  { key: "maxLoan", label: "Max loan", suffix: " AED", role: "engine", help: "Requests above this need an exception approval." },
  { key: "minSalary", label: "Min salary", suffix: " AED", role: "engine", help: "Below this monthly salary the bank will not consider the client." },
  { key: "totalTatDays", label: "Total TAT", suffix: " wd", role: "planned", help: "Working days from submission to transfer — shown on timelines; not used in math yet." },
  { key: "paTatDays", label: "PA TAT", suffix: " wd", role: "planned", help: "Pre-approval turnaround — shown on timelines; not used in math yet." },
  { key: "paValidityDays", label: "PA validity", suffix: " d", role: "planned", help: "How long the pre-approval letter stays valid." },
  { key: "folValidityDays", label: "FOL validity", suffix: " d", role: "planned", help: "How long the final offer letter stays valid." },
  { key: "valuationValidityDays", label: "Valuation validity", suffix: " d", role: "planned", help: "How long the valuation report stays valid." },
  { key: "cardRulePct", label: "Card rule %", suffix: "%", role: "engine", help: "% of total credit card limits counted as monthly obligation (e.g. 5% standard, DIB 2%)" },
  { key: "dbrPct", label: "DBR ceiling %", suffix: "%", role: "engine", help: "Max allowed DBR for this bank (CBUAE limit is 50%)" },
  { key: "bonusPct", label: "Bonus income %", suffix: "%", role: "engine", help: "% of annual bonus credited toward monthly income" },
  { key: "rentalIncomePct", label: "Rental income %", suffix: "%", role: "engine", help: "% of rental income the bank credits (e.g. 83% DIB, 60% ENBD)" },
  { key: "rentalCapPctOfSalary", label: "Rental cap % of salary", suffix: "%", role: "engine", help: "Rental credit cannot exceed this % of basic salary" },
  { key: "stressBufferPct", label: "Stress buffer %", suffix: "%", role: "engine", help: "Extra cushion on top of follow-on rate for DSR stress testing" },
];

const TEXT_BLOCKS: { key: keyof BankProduct; label: string; hint: string; engineReady: boolean }[] = [
  { key: "rateTable", label: "Pricing — source text", hint: "The verbatim sheet text. Kept for humans to verify; the engine reads the structured quotes above.", engineReady: true },
  { key: "stressTest", label: "Stress test — source text", hint: "Verbatim sheet text. The engine computes stress from the quote formula + the live EIBOR table.", engineReady: true },
  { key: "fees", label: "Fees (processing / settlements)", hint: "Text only today — not part of any calculation. Will become structured fee rows.", engineReady: false },
  { key: "insurance", label: "Insurance", hint: "Text only today — not part of cost-to-close yet.", engineReady: false },
  { key: "eligibility", label: "Eligibility (salary / bonus / rental / restrictions)", hint: "Text only — the structured version lives in the Affordability fields above.", engineReady: false },
  { key: "documents", label: "Documents", hint: "Text only — the Doc Vault is the structured home for document requirements.", engineReady: false },
];

function BankRulesTab() {
  const { bankProducts, banks, saveBankProduct, toast, hydrate } = useHfmcStore();
  const [bankFilter, setBankFilter] = useState<string>("DIB");
  const [editing, setEditing] = useState<BankProduct | null>(null);
  const [busy, setBusy] = useState(false);

  const bankList = useMemo(() => {
    const withProducts = new Set(bankProducts.map((p) => p.bankName));
    return [...banks.map((b) => b.name), ...withProducts].filter((v, i, a) => a.indexOf(v) === i);
  }, [banks, bankProducts]);
  const rows = useMemo(
    () => bankProducts.filter((p) => p.bankName === bankFilter),
    [bankProducts, bankFilter],
  );

  return (
    <div className="card anim-fade-up">
      <CardHeader
        title="Bank rule products"
        sub="Decoded from the rates & policy workbooks. Draft → approve workflow: approved rules feed the eligibility engine. DIB + ENBD are the phase-0 banks."
        action={
          <select className="select !w-auto" value={bankFilter} onChange={(e) => setBankFilter(e.target.value)}>
            {bankList.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        }
      />
      {rows.length === 0 ? (
        <EmptyState icon={<IBank size={20} />} title={`No products decoded for ${bankFilter}`} body="Phase 0 covers DIB and Emirates NBD — more banks follow as their workbooks are decoded." />
      ) : (
        <div className="p-4 space-y-3">
          {rows.map((p) => (
            <div key={p.id} className="rounded-xl border p-4" style={{ borderColor: "var(--line)" }}>
              <div className="flex flex-wrap items-center gap-2 mb-2.5">
                <span className="font-disp font-semibold text-[14px]">{p.name}</span>
                <Chip tone="slate">{p.sheet}</Chip>
                {p.program && <Chip tone="sky">{p.program}</Chip>}
                <Chip tone={p.status === "approved" ? "mint" : "amber"}>{p.status}</Chip>
                <Chip tone="slate">v{p.version ?? 1}</Chip>
                <span className="text-[11px] mono text-[var(--ink-faint)]">
                  {p.effectiveDate ? ("Eff: " + p.effectiveDate.slice(0, 10)) : "Active"} ~ Exp: {p.expiryDate ? p.expiryDate.slice(0, 10) : "2099-12-31"}
                </span>
                {p.approvedBy && <span className="text-[10.5px] text-[var(--ink-faint)]">by {p.approvedBy}</span>}
                <div className="ml-auto flex gap-1.5">
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditing(p)}>
                    <IPencil size={13} /> Edit
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 mono text-[12px]">
                {p.maxLtvNational != null && <span>LTV national: <strong>{p.maxLtvNational}%</strong></span>}
                {p.maxLtvExpatriate != null && <span>LTV expat: <strong>{p.maxLtvExpatriate}%</strong></span>}
                {p.tenorYears != null && <span>Tenor: <strong>{p.tenorYears}y</strong></span>}
                {p.minLoan != null && <span>Min loan: <strong>{p.minLoan.toLocaleString()}</strong></span>}
                {p.maxLoan != null && <span>Max loan: <strong>{p.maxLoan.toLocaleString()}</strong></span>}
                {p.minSalary != null && <span>Min salary: <strong>{p.minSalary.toLocaleString()}</strong></span>}
                {p.totalTatDays != null && <span>Total TAT: <strong>{p.totalTatDays} wd</strong></span>}
                {p.folValidityDays != null && <span>FOL validity: <strong>{p.folValidityDays}d</strong></span>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2.5">
                <DetailBlock label="Pricing" text={p.rateTable} />
                <DetailBlock label="Stress test" text={p.stressTest} />
                <DetailBlock label="Fees" text={p.fees} />
                <DetailBlock label="Eligibility" text={p.eligibility} />
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Modal
          full
          title={`Edit rules · ${editing.bankName} · ${editing.name}`}
          sub="Changes apply immediately to the rule engine when status is approved."
          onClose={() => setEditing(null)}
          width={640}
          footer={
            <>
              <button className="btn btn-ghost mr-auto" onClick={() => setEditing(null)} disabled={busy} title="Return to the pricing list">
                ← Back to pricing
              </button>
              <button className="btn btn-ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
              <button className="btn btn-ghost" disabled={busy} onClick={async () => { setBusy(true); await saveBankProduct(editing.id, { status: "draft" }); setEditing({ ...editing, status: "draft" }); setBusy(false); }}>
                Move to draft
              </button>
              
              <button
                className="btn btn-primary"
                disabled={busy || productIssues(editing).filter((i) => i.blocking).length > 0}
                title={productIssues(editing).filter((i) => i.blocking).map((i) => i.msg).join("; ") || "Approve these rules"}
                onClick={async () => {
                  setBusy(true);
                  const patch: Record<string, unknown> = { ...editing, status: "approved" };
                  delete patch.axes;
                  await saveBankProduct(editing.id, patch);
                  setBusy(false);
                  setEditing(null);
                }}
              >
                <ICheck size={15} /> Approve & save
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div className="p-2.5 rounded-lg border flex flex-wrap items-center gap-3" style={{ background: "var(--tint)", borderColor: "var(--line)" }}>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold text-[var(--ink-faint)] uppercase tracking-wider">Version</span>
                <span className="mono font-bold text-[12.5px] px-2 py-0.5 rounded" style={{ background: "var(--amber-tint)", color: "var(--amber)" }}>
                  v{editing.version ?? 1}
                </span>
              </div>
              
              <span className="text-[10px] text-[var(--ink-faint)] ml-auto">Default: 31-Dec-2099 (active indefinitely)</span>
            </div>
            <div className="flex items-center justify-between pb-1">
              <FieldRowBadge role="engine" text="Green fields feed Bank Match and the final proposal. Amber fields are displayed but not calculated yet." />
              <button
                type="button"
                className="btn btn-ghost btn-xs text-[11px] whitespace-nowrap"
                title="Auto-extract structured fees, insurance, and validity from the product policy axes"
                onClick={() => {
                  const { fees, insurance } = extractFromAxes(JSON.stringify(editing.axes || {}));
                  let paVal = editing.paValidityDays;
                  const axesObj = editing.axes || {};
                  if (!paVal && axesObj["PA Validity"]) {
                    const m = String(axesObj["PA Validity"]).match(/(\d+)\s*days?/i);
                    if (m) paVal = parseInt(m[1], 10);
                  }
                  setEditing({
                    ...editing,
                    feesJson: JSON.stringify(fees),
                    insuranceJson: JSON.stringify(insurance),
                    paValidityDays: paVal ?? editing.paValidityDays,
                  });
                  toast("success", "Extracted structured fees, insurance & validity from policy axes!");
                }}
              >
                Sync from axes
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {NUM_FIELDS.map((f) => (
                <Field key={String(f.key)} label={`${f.label} · ${f.suffix ?? ""}`}>
                  <input
                    className="input mono"
                    type="number"
                    value={(editing[f.key] as number | null) ?? ""}
                    onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                  <p className="text-[10px] text-[var(--ink-faint)] m-0 mt-1 leading-snug">
                    <FieldRoleDot role={f.role} /> {f.help}
                  </p>
                </Field>
              ))}
            </div>
            <div className="rounded-lg p-3" style={{ background: "var(--bg2)" }}>
              <div className="text-[10px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)] mb-1.5">
                Live check — reference client (AED 20k salary, STL, 2.5M property, resale)
              </div>
              <LivePreview editing={editing} />
            </div>

            <QuoteRowsEditor
              productId={editing.id}
              quotes={(() => {
                try { return (JSON.parse(editing.pricingJson as string)?.quotes ?? []) as RateQuote[]; } catch { return []; }
              })()}
              rateTable={String(editing.rateTable ?? "")}
              onChange={(quotes) => setEditing({ ...editing, pricingJson: JSON.stringify({ quotes }) })}
              onFeesDraft={(fees, insurance) =>
                setEditing({
                  ...editing,
                  feesJson: fees ? JSON.stringify(fees) : editing.feesJson,
                  insuranceJson: insurance ? JSON.stringify(insurance) : editing.insuranceJson,
                })
              }
            />

            <FeesEditor
              fees={(() => {
                try { return parseFees(editing.feesJson) || { processing: {} }; } catch { return { processing: {} }; }
              })()}
              onChange={(fees) => setEditing({ ...editing, feesJson: JSON.stringify(fees) })}
            />

            <InsuranceEditor
              insurance={(() => {
                try { return parseInsurance(editing.insuranceJson) || {}; } catch { return {}; }
              })()}
              onChange={(insurance) => setEditing({ ...editing, insuranceJson: JSON.stringify(insurance) })}
            />

            {TEXT_BLOCKS.map((b) => (
              <Field key={String(b.key)} label={`${b.label} · ${b.engineReady ? "engine ✓" : "display only"}`}>
                <textarea
                  className="textarea"
                  rows={4}
                  value={String(editing[b.key] ?? "")}
                  onChange={(e) => setEditing({ ...editing, [b.key]: e.target.value })}
                />
                <p className="text-[10px] text-[var(--ink-faint)] m-0 mt-1 leading-snug">
                  <FieldRoleDot role={b.engineReady ? "engine" : "display"} /> {b.hint}
                </p>
              </Field>
            ))}
            <Field label="Notes">
              <input className="input" value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            </Field>
            <FieldIssues editing={editing} />
          </div>
        </Modal>
      )}
    </div>
  );
}

function DetailBlock({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: "var(--tint)" }}>
      <div className="text-[10px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)]">{label}</div>
      <p className="text-[11.5px] text-[var(--ink-dim)] m-0 mt-1 whitespace-pre-wrap leading-snug">{text.slice(0, 600)}{text.length > 600 ? "…" : ""}</p>
    </div>
  );
}

/* ---------------- rule-editor guardrails (layman-safe editing) ---------------- */

function FieldRoleDot({ role }: { role: FieldRole | "display" | "engine" }) {
  const color = role === "engine" ? "var(--mint)" : role === "planned" ? "var(--amber)" : "var(--ink-faint)";
  return <span className="inline-block rounded-full align-middle" style={{ width: 7, height: 7, background: color, marginRight: 4 }} />;
}

function FieldRowBadge({ role, text }: { role: FieldRole; text: string }) {
  return (
    <p className="text-[11px] text-[var(--ink-dim)] m-0">
      <FieldRoleDot role={role} /> {text}
    </p>
  );
}

interface ProductIssue { msg: string; blocking: boolean }

function productIssues(editing: BankProduct): ProductIssue[] {
  const issues: ProductIssue[] = [];
  if (editing.maxLtvNational != null && (editing.maxLtvNational <= 0 || editing.maxLtvNational > 100))
    issues.push({ msg: `Max LTV (nationals) ${editing.maxLtvNational}% looks wrong — LTV is between 1 and 100.`, blocking: true });
  if (editing.maxLtvExpatriate != null && (editing.maxLtvExpatriate <= 0 || editing.maxLtvExpatriate > 100))
    issues.push({ msg: `Max LTV (expats) ${editing.maxLtvExpatriate}% looks wrong — LTV is between 1 and 100.`, blocking: true });
  if (editing.tenorYears != null && (editing.tenorYears <= 0 || editing.tenorYears > 30))
    issues.push({ msg: `Tenor ${editing.tenorYears}y looks wrong — mortgages run 1 to 30 years.`, blocking: true });
  if (editing.minLoan != null && editing.maxLoan != null && editing.minLoan > editing.maxLoan)
    issues.push({ msg: "Min loan is larger than max loan — swap them.", blocking: true });
  let quotes = 0;
  try {
    const parsed = JSON.parse(editing.pricingJson as string);
    quotes = parsed?.quotes?.length ?? 0;
    for (const q of parsed?.quotes ?? []) {
      if (q.rateType === "FIXED" && (q.ratePct == null || q.ratePct <= 0 || q.ratePct > 20))
        issues.push({ msg: `A quote has rate ${q.ratePct}% — rates are small numbers like 3.95, not 39.5 or 0.0395.`, blocking: true });
      if (q.rateType !== "FIXED" && (q.marginPct == null || q.marginPct < 0 || q.marginPct > 15))
        issues.push({ msg: `A variable quote has margin ${q.marginPct}% — margins are small numbers like 1 or 1.49.`, blocking: true });
    }
  } catch {
    issues.push({ msg: "The pricing JSON is not valid — use the guided quote editor or fix the JSON.", blocking: true });
  }
  if (quotes === 0)
    issues.push({ msg: "No structured quotes yet — without them the engine cannot price this bank at all.", blocking: true });
  if (editing.minSalary != null && editing.minSalary > 0 && editing.minSalary < 1000)
    issues.push({ msg: `Min salary ${editing.minSalary} looks too small — salaries are monthly in AED (e.g. 10000, not 10).`, blocking: true });
  if (!editing.fees) issues.push({ msg: "Fees are text only — they are not part of cost calculations yet.", blocking: false });
  if (!editing.insurance) issues.push({ msg: "Insurance is text only — not part of cost-to-close yet.", blocking: false });
  return issues;
}

function FieldIssues({ editing }: { editing: BankProduct }) {
  const issues = productIssues(editing);
  if (issues.length === 0) return null;
  return (
    <div className="rounded-lg p-3 space-y-1.5" style={{ background: "rgba(242,176,76,0.06)" }}>
      <div className="text-[10px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)]">
        Before approving — {issues.filter((i) => i.blocking).length} blocking, {issues.filter((i) => !i.blocking).length} advisory
      </div>
      {issues.map((i, idx) => (
        <p key={idx} className="text-[11.5px] m-0 leading-snug" style={{ color: i.blocking ? "var(--coral)" : "var(--ink-faint)" }}>
          {i.blocking ? "✕" : "ℹ"} {i.msg}
        </p>
      ))}
    </div>
  );
}

function LivePreview({ editing }: { editing: BankProduct }) {
  const { eibor } = useHfmcStore();
  const curve: Record<string, number> = Object.fromEntries(eibor.map((e) => [e.tenor, e.ratePct]));
  // reference client: 20k salary, 3k EMIs, 100k card limits, STL, 3y, 2.5M property, resale
  const INCOME = 20000, EMIS = 3000, CARDS = 100000, PROPERTY = 2500000;
  let pricing: ProductPricing | null = null;
  try {
    const parsed = JSON.parse(editing.pricingJson);
    pricing = parsed?.quotes ? parsed : null;
  } catch { pricing = null; }
  const quote = pricing ? resolveQuote(pricing, { stl: true, termYears: 3, ftv: editing.maxLtvExpatriate ?? 80, txn: "Resale" }) : null;
  const schedule = quote ? rateSchedule(quote, curve) : null;
  const rate = schedule?.stressRatePct ?? null;
  const card = (CARDS * (editing.cardRulePct ?? 5)) / 100;
  const available = Math.round((INCOME * (editing.dbrPct ?? 50)) / 100 - EMIS - card);
  const maxByDbr = rate != null && editing.tenorYears && available > 0 ? Math.round(loanForEmi(available, rate, editing.tenorYears)) : null;
  const maxByLtv = editing.maxLtvExpatriate != null ? Math.round((PROPERTY * editing.maxLtvExpatriate) / 100) : null;
  const eligible = [maxByDbr, maxByLtv].filter((x): x is number => x != null && x > 0);
  const final = eligible.length ? Math.min(...eligible) : null;
  if (!quote || rate == null) {
    return <p className="text-[12px] m-0" style={{ color: "var(--coral)" }}>No matching 3-year quote for the reference client — this bank would be skipped.</p>;
  }
  return (
    <p className="text-[12px] m-0" style={{ color: "var(--ink)" }}>
      The reference client gets <strong style={{ color: "var(--mint)" }}>{final ? "AED " + final.toLocaleString() : "—"}</strong>
      {" "}from this bank at <strong style={{ color: "var(--amber)" }}>{rate.toFixed(2)}% stressed</strong>
      {" "}({quote.rateType === "FIXED" ? `intro ${quote.ratePct}% for ${quote.termYears}y` : "day-1 variable"}), EMI {Math.round(emi(1500000, rate, editing.tenorYears ?? 25)).toLocaleString()}/mo on a 1.5M loan.
      {" "}Card rule {editing.cardRulePct ?? 5}% → {Math.round(card).toLocaleString()}/mo counted.
    </p>
  );
}

/* ---------------- guided quote rows editor (phase 4 human side) ---------------- */

const TXN_OPTIONS = ["any", "Resale", "Primary Handover", "Buyout", "Equity Release", "Buyout + Equity Release", "Land", "Self Construction", "LAP"];

function QuoteRowsEditor({ quotes, rateTable, onChange, productId, onFeesDraft }: {
  quotes: RateQuote[];
  rateTable: string;
  onChange: (quotes: RateQuote[]) => void;
  productId: number;
  onFeesDraft?: (fees: unknown, insurance: unknown) => void;
}) {
  const { toast } = useHfmcStore();
  const [aiDraftBusy, setAiDraftBusy] = useState(false);
  const [aiQuestions, setAiQuestions] = useState<string[]>([]);
  const [aiConfidence, setAiConfidence] = useState<string | null>(null);

  const aiDraft = async () => {
    setAiDraftBusy(true); setAiQuestions([]); setAiConfidence(null);
    try {
      const res = await fetch("/api/ai/rule-draft", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI draft failed");
      const draft = data.draft;
      const cleanQuotes: RateQuote[] = (draft.quotes ?? []).map((q: Record<string, unknown>) => ({
        stl: (q.stl ?? null) as boolean | null,
        termYears: (q.termYears ?? 0) as number,
        rateType: (q.rateType ?? "3M_EIBOR") as RateQuote["rateType"],
        ratePct: (q.ratePct ?? null) as number | null,
        marginPct: (q.marginPct ?? null) as number | null,
        floorPct: (q.floorPct ?? null) as number | null,
        variableAfter: (q.variableAfter ?? undefined) as RateQuote["variableAfter"],
        ftvMax: (q.ftvMax ?? null) as number | null,
        txn: (q.txn ?? null) as string | null,
        segment: (q.segment ?? null) as string | null,
        note: String(q.note ?? ""),
      }));
      onChange(cleanQuotes);
      onFeesDraft?.(draft.fees ?? null, draft.insurance ?? null);
      setAiQuestions(Array.isArray(draft.questions) ? draft.questions : []);
      setAiConfidence(draft.confidence ?? null);
      toast("success", `AI drafted ${cleanQuotes.length} quotes — review every row before approving.`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "AI draft failed");
    }
    setAiDraftBusy(false);
  };
  const update = (i: number, patch: Partial<RateQuote>) =>
    onChange(quotes.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  const remove = (i: number) => onChange(quotes.filter((_, idx) => idx !== i));
  const add = () =>
    onChange([...quotes, { stl: true, termYears: 3, rateType: "FIXED", ratePct: undefined, txn: "any", note: "", effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: null }]);

  const autoDraft = () => {
    const parsed = parseRateTable(rateTable);
    if (parsed.length === 0) return;
    // strip confidence/sourceLine — keep engine fields
    const cleanQuotes: RateQuote[] = parsed.map(({ confidence, sourceLine, ...q }) => ({ ...q, note: sourceLine }));
    onChange(cleanQuotes);
  };

  return (
    <div className="rounded-lg p-3 space-y-2" style={{ background: "var(--tint)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)] flex-1">
          Pricing quotes · {quotes.length} — these are what the engine calculates with
        </span>
        {rateTable && (
          <button className="btn btn-ghost btn-sm" title="Draft quotes from the source text — review each row before approving" onClick={autoDraft}>
            Auto-draft
          </button>
        )}
        <button className="btn btn-primary btn-sm" onClick={aiDraft} disabled={aiDraftBusy}
          title="AI reads the full source text (rates + fees + insurance) and proposes structured drafts — you review and approve">
          {aiDraftBusy ? "AI drafting…" : "AI draft"}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={add}><IPlus size={13} /> Add quote</button>
      </div>
      {quotes.length === 0 && (
        <p className="text-[11.5px] text-[var(--ink-faint)] m-0">
          No quotes yet — use AI draft or Auto-draft to pre-fill from the source text, then review each row.
        </p>
      )}
      {aiConfidence && (
        <p className="text-[11px] m-0" style={{ color: aiConfidence === "high" ? "var(--mint)" : aiConfidence === "low" ? "var(--coral)" : "var(--amber)" }}>
          AI confidence: {aiConfidence}{aiQuestions.length ? " — confirm these:" : ""}
        </p>
      )}
      {aiQuestions.map((q, i) => (
        <p key={i} className="text-[11px] m-0" style={{ color: "var(--coral)" }}>? {q}</p>
      ))}
      {quotes.map((q, i) => (
        <div key={i} className="rounded-lg px-2.5 py-2 space-y-1.5" style={{ background: "var(--surface)", border: "1px solid var(--line)" }}>
          <div className="flex flex-wrap items-center gap-1.5">
            <select className="select !w-auto !py-1 text-[11.5px]" value={q.stl == null ? "" : q.stl ? "stl" : "nstl"}
              onChange={(e) => update(i, { stl: e.target.value === "" ? null : e.target.value === "stl" })}>
              <option value="stl">STL</option>
              <option value="nstl">NSTL</option>
              <option value="">Both</option>
            </select>
            <select className="select !w-auto !py-1 text-[11.5px]" value={String(q.termYears ?? 0)}
              onChange={(e) => update(i, { termYears: Number(e.target.value) })}>
              <option value="0">Day-1 variable</option>
              <option value="1">1y fixed</option>
              <option value="2">2y fixed</option>
              <option value="3">3y fixed</option>
              <option value="4">4y fixed</option>
              <option value="5">5y fixed</option>
            </select>
            <select className="select !w-auto !py-1 text-[11.5px]" value={q.rateType}
              onChange={(e) => update(i, { rateType: e.target.value as RateQuote["rateType"] })}>
              <option value="FIXED">FIXED %</option>
              <option value="1M_EIBOR">1M EIBOR + margin</option>
              <option value="3M_EIBOR">3M EIBOR + margin</option>
              <option value="6M_EIBOR">6M EIBOR + margin</option>
              <option value="1Y_EIBOR">1Y EIBOR + margin</option>
            </select>
            {q.rateType === "FIXED" ? (
              <input className="input mono !w-24 !py-1 text-[11.5px]" type="number" step={0.01} placeholder="rate %"
                value={q.ratePct ?? ""} onChange={(e) => update(i, { ratePct: e.target.value === "" ? null : Number(e.target.value) })} />
            ) : (
              <input className="input mono !w-24 !py-1 text-[11.5px]" type="number" step={0.001} placeholder="margin %"
                value={q.marginPct ?? ""} onChange={(e) => update(i, { marginPct: e.target.value === "" ? null : Number(e.target.value) })} />
            )}
            {q.rateType === "FIXED" && (
              <>
                <select className="select !w-auto !py-1 text-[11.5px]"
                  value={q.variableAfter?.basis ?? ""}
                  title="What the rate becomes after the fixed term ends — almost every UAE product reverts to EIBOR + margin"
                  onChange={(e) => update(i, {
                    variableAfter: e.target.value
                      ? { basis: e.target.value as "1M" | "3M" | "6M" | "1Y", marginPct: 0, floorPct: null }
                      : undefined,
                  })}>
                  <option value="">no follow-on</option>
                  <option value="1M">then 1M EIBOR +</option>
                  <option value="3M">then 3M EIBOR +</option>
                  <option value="6M">then 6M EIBOR +</option>
                  <option value="1Y">then 1Y EIBOR +</option>
                </select>
                {q.variableAfter && (
                  <input className="input mono !w-24 !py-1 text-[11.5px]" type="number" step={0.001} placeholder="then margin %"
                    value={q.variableAfter.marginPct}
                    onChange={(e) => update(i, { variableAfter: { ...q.variableAfter!, marginPct: Number(e.target.value) || 0 } })} />
                )}
                {q.variableAfter && (
                  <input className="input mono !w-20 !py-1 text-[11.5px]" type="number" step={0.01} placeholder="then floor %"
                    value={q.variableAfter.floorPct ?? ""}
                    onChange={(e) => update(i, { variableAfter: { ...q.variableAfter!, floorPct: e.target.value === "" ? null : Number(e.target.value) } })} />
                )}
              </>
            )}
            {q.rateType !== "FIXED" && (
              <input className="input mono !w-20 !py-1 text-[11.5px]" type="number" step={0.01} placeholder="floor %"
                value={q.floorPct ?? ""} onChange={(e) => update(i, { floorPct: e.target.value === "" ? null : Number(e.target.value) })} />
            )}
            <input className="input mono !w-20 !py-1 text-[11.5px]" type="number" placeholder="FTV ≤"
              title="FTV band ceiling — blank = any"
              value={q.ftvMax ?? ""} onChange={(e) => update(i, { ftvMax: e.target.value === "" ? null : Number(e.target.value) })} />
            <select className="select !w-auto !py-1 text-[11.5px]" value={q.txn ?? "any"}
              onChange={(e) => update(i, { txn: e.target.value === "any" ? null : e.target.value })}>
              {TXN_OPTIONS.map((o) => <option key={o} value={o}>{o === "any" ? "any txn" : o}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm !px-2 ml-auto" style={{ color: "var(--coral)" }} onClick={() => remove(i)} title="Remove quote">
              <ITrash size={12} />
            </button>
          </div>
          <input className="input !py-1 text-[11px]" placeholder="note (optional)" value={q.note ?? ""}
            onChange={(e) => update(i, { note: e.target.value })} />
          <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-[var(--ink-faint)]">
            <span>valid:</span>
            <input className="input mono !py-0.5 !px-1.5 text-[10.5px] !w-32" type="date" value={q.effectiveFrom ?? ""}
              title="Effective from — blank = always"
              onChange={(e) => update(i, { effectiveFrom: e.target.value || null })} />
            <span>upto</span>
            <input className="input mono !py-0.5 !px-1.5 text-[10.5px] !w-32" type="date" value={q.effectiveTo ?? ""}
              title="Upto — blank/2099 = continues until revised"
              onChange={(e) => update(i, { effectiveTo: e.target.value || null })} />
            <button type="button" className="btn btn-ghost btn-xs no-print"
              title="Rate revision: copies this line with effective-from = today and closes the old line the day before. Change the figure on the copy."
              onClick={() => {
                const today = new Date().toISOString().slice(0, 10);
                const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
                if (q.effectiveTo && q.effectiveTo !== "2099-12-31" && q.effectiveTo < today) {
                  toast("error", "This line already ended on " + q.effectiveTo + " — revise the current line instead.");
                  return;
                }
                update(i, { effectiveTo: yest });
                onChange([...quotes, { ...q, effectiveFrom: today, effectiveTo: null, note: (q.note ? q.note + " — " : "") + "revised " + today } ]);
              }}>↻ Revise rate</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Fees & Insurance Structured Editors ---------------- */

function FeesEditor({ fees, onChange }: { fees: BankFees; onChange: (fees: BankFees) => void }) {
  const [open, setOpen] = useState(true);
  const p = fees.processing || {};
  const pa = fees.preApproval || {};
  const es = fees.earlySettlement || {};
  const ps = fees.partialSettlement || {};
  const v = fees.valuation || {};

  const updateProcessing = (patch: Partial<NonNullable<BankFees["processing"]>>) => {
    onChange({ ...fees, processing: { ...p, ...patch } });
  };
  const updatePreApproval = (patch: Partial<NonNullable<BankFees["preApproval"]>>) => {
    onChange({ ...fees, preApproval: { ...pa, ...patch } });
  };
  const updateEarlySettlement = (patch: Partial<NonNullable<BankFees["earlySettlement"]>>) => {
    onChange({ ...fees, earlySettlement: { ...es, ...patch } });
  };
  const updatePartialSettlement = (patch: Partial<NonNullable<BankFees["partialSettlement"]>>) => {
    onChange({ ...fees, partialSettlement: { ...ps, ...patch } });
  };
  const updateValuation = (patch: Partial<NonNullable<BankFees["valuation"]>>) => {
    onChange({ ...fees, valuation: { ...v, ...patch } });
  };

  return (
    <div className="rounded-lg p-3 space-y-3" style={{ background: "var(--surface)", border: "1px solid var(--line)" }}>
      <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => setOpen(!open)}>
        <div className="flex items-center gap-2">
          <span className="font-disp font-semibold text-[12px] uppercase tracking-[0.08em] text-[var(--ink)]">
            Structured Bank Fees
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--mint-tint)] text-[var(--mint)] font-medium">
            engine ?
          </span>
        </div>
        <button type="button" className="btn btn-ghost btn-xs text-[11px]">{open ? "Collapse" : "Expand"}</button>
      </div>

      {open && (
        <div className="space-y-3 pt-1">
          {/* Processing fee */}
          <div className="p-2.5 rounded-lg bg-[var(--bg2)] space-y-2">
            <div className="text-[11px] font-semibold text-[var(--ink-dim)]">Processing Fee</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <label className="text-[10px] text-[var(--ink-faint)]">Default rate (%)</label>
                <input
                  type="number" step="0.01" className="input input-sm mono" placeholder="1.05"
                  value={p.default ?? ""}
                  onChange={(e) => updateProcessing({ default: e.target.value === "" ? undefined : Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="text-[10px] text-[var(--ink-faint)]">Buyout rate (%)</label>
                <input
                  type="number" step="0.01" className="input input-sm mono" placeholder="0.5"
                  value={p.buyout ?? ""}
                  onChange={(e) => updateProcessing({ buyout: e.target.value === "" ? undefined : Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="text-[10px] text-[var(--ink-faint)]">Min Fee (AED)</label>
                <input
                  type="number" className="input input-sm mono" placeholder="0"
                  value={p.minFee ?? ""}
                  onChange={(e) => updateProcessing({ minFee: e.target.value === "" ? undefined : Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="text-[10px] text-[var(--ink-faint)]">Max Cap (AED)</label>
                <input
                  type="number" className="input input-sm mono" placeholder="No cap"
                  value={p.maxFee ?? ""}
                  onChange={(e) => updateProcessing({ maxFee: e.target.value === "" ? undefined : Number(e.target.value) })}
                />
              </div>
            </div>
            <input
              type="text" className="input input-sm text-[11.5px]" placeholder="Processing fee notes (e.g. + 5% VAT)"
              value={p.note ?? ""}
              onChange={(e) => updateProcessing({ note: e.target.value })}
            />
          </div>

          {/* Pre-approval fee */}
          <div className="p-2.5 rounded-lg bg-[var(--bg2)] space-y-2">
            <div className="text-[11px] font-semibold text-[var(--ink-dim)]">Pre-Approval Fee</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <label className="text-[10px] text-[var(--ink-faint)]">Salaried (AED)</label>
                <input
                  type="number" className="input input-sm mono" placeholder="1575"
                  value={pa.fee ?? ""}
                  onChange={(e) => updatePreApproval({ fee: e.target.value === "" ? undefined : Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="text-[10px] text-[var(--ink-faint)]">STL Fee (AED)</label>
                <input
                  type="number" className="input input-sm mono" placeholder="e.g. 1000"
                  value={pa.feeStl ?? ""}
                  onChange={(e) => updatePreApproval({ feeStl: e.target.value === "" ? undefined : Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="text-[10px] text-[var(--ink-faint)]">NSTL Fee (AED)</label>
                <input
                  type="number" className="input input-sm mono" placeholder="e.g. 1575"
                  value={pa.feeNstl ?? ""}
                  onChange={(e) => updatePreApproval({ feeNstl: e.target.value === "" ? undefined : Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="text-[10px] text-[var(--ink-faint)]">Self-Employed (AED)</label>
                <input
                  type="number" className="input input-sm mono" placeholder="0 = Free"
                  value={pa.feeSelfEmployed ?? ""}
                  onChange={(e) => updatePreApproval({ feeSelfEmployed: e.target.value === "" ? undefined : Number(e.target.value) })}
                />
              </div>
            </div>
            <input
              type="text" className="input input-sm text-[11.5px]" placeholder="Pre-approval notes (e.g. adjusted against processing fee)"
              value={pa.note ?? ""}
              onChange={(e) => updatePreApproval({ note: e.target.value })}
            />
          </div>

          {/* Early & Partial settlement */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="p-2.5 rounded-lg bg-[var(--bg2)] space-y-2">
              <div className="text-[11px] font-semibold text-[var(--ink-dim)]">Early Settlement</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-[var(--ink-faint)]">Penalty (%)</label>
                  <input
                    type="number" step="0.1" className="input input-sm mono" placeholder="1.0"
                    value={es.pct ?? ""}
                    onChange={(e) => updateEarlySettlement({ pct: e.target.value === "" ? undefined : Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--ink-faint)]">Cap (AED)</label>
                  <input
                    type="number" className="input input-sm mono" placeholder="10000"
                    value={es.cap ?? ""}
                    onChange={(e) => updateEarlySettlement({ cap: e.target.value === "" ? undefined : Number(e.target.value) })}
                  />
                </div>
              </div>
              <input
                type="text" className="input input-sm text-[11.5px]" placeholder="Early settlement note (e.g. capped at AED 10k by CBUAE)"
                value={es.note ?? ""}
                onChange={(e) => updateEarlySettlement({ note: e.target.value })}
              />
            </div>

            <div className="p-2.5 rounded-lg bg-[var(--bg2)] space-y-2">
              <div className="text-[11px] font-semibold text-[var(--ink-dim)]">Partial Settlement</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-[var(--ink-faint)]">Free / year (%)</label>
                  <input
                    type="number" step="1" className="input input-sm mono" placeholder="25"
                    value={ps.freeYearlyPct ?? ""}
                    onChange={(e) => updatePartialSettlement({ freeYearlyPct: e.target.value === "" ? undefined : Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--ink-faint)]">Excess fee (%)</label>
                  <input
                    type="number" step="0.1" className="input input-sm mono" placeholder="1.0"
                    value={ps.pct ?? ""}
                    onChange={(e) => updatePartialSettlement({ pct: e.target.value === "" ? undefined : Number(e.target.value) })}
                  />
                </div>
              </div>
              <input
                type="text" className="input input-sm text-[11.5px]" placeholder="Partial settlement note"
                value={ps.note ?? ""}
                onChange={(e) => updatePartialSettlement({ note: e.target.value })}
              />
            </div>
          </div>

          {/* Valuation Note */}
          <div className="p-2.5 rounded-lg bg-[var(--bg2)]">
            <label className="text-[10px] text-[var(--ink-faint)]">Valuation Fee details</label>
            <input
              type="text" className="input input-sm text-[11.5px] mt-1" placeholder="e.g. AED 2,500 - AED 3,500 based on property value tier"
              value={v.note ?? ""}
              onChange={(e) => updateValuation({ note: e.target.value })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function InsuranceEditor({ insurance, onChange }: { insurance: BankInsurance; onChange: (ins: BankInsurance) => void }) {
  const [open, setOpen] = useState(true);
  const life = insurance.life || { basis: "per_million_monthly" as const, rate: 0 };
  const prop = insurance.property || { basis: "pct_pa_of_property" as const, rate: 0 };

  const updateLife = (patch: Partial<NonNullable<BankInsurance["life"]>>) => {
    onChange({ ...insurance, life: { ...life, ...patch } });
  };
  const updateProp = (patch: Partial<NonNullable<BankInsurance["property"]>>) => {
    onChange({ ...insurance, property: { ...prop, ...patch } });
  };

  const previewLifeMonthly = life.rate
    ? life.basis === "per_million_monthly"
      ? ((1500000 * life.rate) / 100).toFixed(0)
      : (((1500000 * life.rate) / 100) / 12).toFixed(0)
    : null;
  const previewPropYearly = prop.rate ? ((2000000 * prop.rate) / 100).toFixed(0) : null;

  return (
    <div className="rounded-lg p-3 space-y-3" style={{ background: "var(--surface)", border: "1px solid var(--line)" }}>
      <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => setOpen(!open)}>
        <div className="flex items-center gap-2">
          <span className="font-disp font-semibold text-[12px] uppercase tracking-[0.08em] text-[var(--ink)]">
            Structured Insurance Rates
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--mint-tint)] text-[var(--mint)] font-medium">
            engine ?
          </span>
        </div>
        <button type="button" className="btn btn-ghost btn-xs text-[11px]">{open ? "Collapse" : "Expand"}</button>
      </div>

      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          {/* Life Insurance */}
          <div className="p-2.5 rounded-lg bg-[var(--bg2)] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-[var(--ink-dim)]">Life Insurance</span>
              {previewLifeMonthly && (
                <span className="text-[10px] text-[var(--mint)] mono">AED {previewLifeMonthly}/mo for 1.5M loan</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-[var(--ink-faint)]">Calculation Basis</label>
                <select
                  className="select select-sm text-[11px]"
                  value={life.basis}
                  onChange={(e) => updateLife({ basis: e.target.value as "per_million_monthly" | "pct_pa_of_loan" })}
                >
                  <option value="per_million_monthly">Monthly (% p.m.)</option>
                  <option value="pct_pa_of_loan">Annual (% p.a.)</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-[var(--ink-faint)]">Rate (%)</label>
                <input
                  type="number" step="0.001" className="input input-sm mono" placeholder="0.03"
                  value={life.rate || ""}
                  onChange={(e) => updateLife({ rate: e.target.value === "" ? 0 : Number(e.target.value) })}
                />
              </div>
            </div>
            <input
              type="text" className="input input-sm text-[11.5px]" placeholder="Life insurance notes / conditions"
              value={life.note ?? ""}
              onChange={(e) => updateLife({ note: e.target.value })}
            />
          </div>

          {/* Property Insurance */}
          <div className="p-2.5 rounded-lg bg-[var(--bg2)] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-[var(--ink-dim)]">Property Insurance</span>
              {previewPropYearly && (
                <span className="text-[10px] text-[var(--mint)] mono">AED {previewPropYearly}/yr for 2.0M prop</span>
              )}
            </div>
            <div>
              <label className="text-[10px] text-[var(--ink-faint)]">Annual Rate (% p.a. of property value)</label>
              <input
                type="number" step="0.001" className="input input-sm mono" placeholder="0.035"
                value={prop.rate || ""}
                onChange={(e) => updateProp({ rate: e.target.value === "" ? 0 : Number(e.target.value) })}
              />
            </div>
            <input
              type="text" className="input input-sm text-[11.5px]" placeholder="Property insurance notes"
              value={prop.note ?? ""}
              onChange={(e) => updateProp({ note: e.target.value })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ portal settings ------------------------------ */

// Admin decides what the two client-facing portals show: the advisor a client
// sees when their case has none assigned, and the HFMC staff representative
// (name + WhatsApp) on every agent's home card.
function PortalTab() {
  const { toast, users } = useHfmcStore();
  const [advisorId, setAdvisorId] = useState<string>("");
  const [clientFacingUserId, setClientFacingUserId] = useState<string>("");
  const [portalWhatsapp, setPortalWhatsapp] = useState("");
  const [agentDeskUserId, setAgentDeskUserId] = useState<string>("");
  const [deskName, setDeskName] = useState("");
  const [deskPhone, setDeskPhone] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((r) => r.json())
      .then((d) => {
        setAdvisorId(d.settings?.clientPortalAdvisorId ? String(d.settings.clientPortalAdvisorId) : "");
        setClientFacingUserId(d.settings?.clientFacingUserId ? String(d.settings.clientFacingUserId) : "");
        setPortalWhatsapp(d.settings?.clientPortalWhatsapp ?? "");
        setAgentDeskUserId(d.settings?.agentDeskUserId ? String(d.settings.agentDeskUserId) : "");
        setDeskName(d.settings?.agentDeskName ?? "");
        setDeskPhone(d.settings?.agentDeskPhone ?? "");
        setLoaded(true);
      })
      .catch(() => { toast("error", "Could not load portal settings."); setLoaded(true); });
  }, [toast]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientPortalAdvisorId: advisorId ? Number(advisorId) : null,
          clientFacingUserId: clientFacingUserId ? Number(clientFacingUserId) : null,
          clientPortalWhatsapp: portalWhatsapp,
          agentDeskUserId: agentDeskUserId ? Number(agentDeskUserId) : null,
          agentDeskName: deskName,
          agentDeskPhone: deskPhone,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(e.error ?? "Save failed");
      }
      toast("success", "Portal settings saved — both portals pick them up on next load.");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Save failed");
    }
    setSaving(false);
  };

  const staff = users.filter((u) => u.active);

  return (
    <div className="space-y-4 max-w-[640px]">
      {!loaded ? (
        <div className="card p-8 flex justify-center"><div className="w-7 h-7 rounded-full border-2 border-[var(--amber)] border-t-transparent animate-spin" /></div>
      ) : (
        <>
          <div className="card p-4 space-y-3">
            <div>
              <h3 className="font-disp font-semibold text-[14px] m-0">Client portal</h3>
              <p className="text-[11.5px] text-[var(--ink-faint)] m-0 mt-0.5">
                The advisor a client sees on their journey. Cases with an advisor assigned in Case 360 → People keep theirs; this is the fallback for everyone else.
              </p>
            </div>
            <div>
              <label className="label">Default advisor (our staff)</label>
              <select className="select" value={advisorId} onChange={(e) => setAdvisorId(e.target.value)}>
                <option value="">— none (falls back to the case owner) —</option>
                {staff.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} · {u.role}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Client-facing contact (our senior staff) <span className="normal-case tracking-normal" style={{ color: "var(--ink-faint)" }}>— name + WhatsApp pair shown on every client&apos;s advisor card</span></label>
              <select className="select" value={clientFacingUserId} onChange={(e) => setClientFacingUserId(e.target.value)}>
                <option value="">— none (uses each case&apos;s advisor / number below) —</option>
                {staff.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} · {u.role}{u.phone ? " · " + u.phone : " · no WhatsApp on file"}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Fallback WhatsApp number <span className="normal-case tracking-normal" style={{ color: "var(--ink-faint)" }}>— used only when no facing staff is picked and the case advisor has no number</span></label>
              <input className="input mono" placeholder="e.g. 971563675369 (with country code)" value={portalWhatsapp} onChange={(e) => setPortalWhatsapp(e.target.value)} />
            </div>
            <p className="text-[10.5px] text-[var(--ink-faint)] m-0">
              Juniors run files day-to-day, but clients see the senior&apos;s name + number here. A case&apos;s own advisor fronts their card only once their WhatsApp is saved in Teammates. Add staff numbers in Admin → Teammates.
            </p>
          </div>

          <div className="card p-4 space-y-3">
            <div>
              <h3 className="font-disp font-semibold text-[14px] m-0">Agent portal</h3>
              <p className="text-[11.5px] text-[var(--ink-faint)] m-0 mt-0.5">
                The HFMC staff representative on every agent&apos;s home card, with the WhatsApp number partners reach.
              </p>
            </div>
            <div>
              <label className="label">Agent-facing contact (our senior staff) <span className="normal-case tracking-normal" style={{ color: "var(--ink-faint)" }}>— name + WhatsApp pair on every agent&apos;s mortgage desk card</span></label>
              <select className="select" value={agentDeskUserId} onChange={(e) => setAgentDeskUserId(e.target.value)}>
                <option value="">— none (uses the free-text name + number below) —</option>
                {staff.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} · {u.role}{u.phone ? " · " + u.phone : " · no WhatsApp on file"}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Fallback representative name</label>
                <input className="input" placeholder="e.g. Ayesha Rahman — Partnerships" value={deskName} onChange={(e) => setDeskName(e.target.value)} />
              </div>
              <div>
                <label className="label">Fallback WhatsApp number (with country code)</label>
                <input className="input mono" placeholder="e.g. 971563675369" value={deskPhone} onChange={(e) => setDeskPhone(e.target.value)} />
              </div>
            </div>
            <p className="text-[10.5px] text-[var(--ink-faint)] m-0">Leave the number empty to hide the WhatsApp button.</p>
          </div>

          <button className="btn btn-primary w-full justify-center sm:w-auto" onClick={save} disabled={saving}>
            <ICheck size={14} /> {saving ? "Saving…" : "Save portal settings"}
          </button>
        </>
      )}
    </div>
  );
}
