"use client";

import { useMemo, useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type {
  BankItem, BankProduct, Designation, DocRule, FeeRule, MasterItem, PartnerItem, PartnerKind,
  SlaRule, StageItem, User,
} from "@/lib/types";
import { fmtRate } from "@/lib/format";
import { Avatar, Chip, EmptyState, Modal, Seg } from "@/components/hfmc/ui";
import { ConfirmModal } from "@/components/hfmc/bits";
import { parsePricing, resolveQuote, rateSchedule, type ProductPricing } from "@/lib/bank-pricing";
import { emi, loanForEmi } from "@/lib/calc";
import {
  IBank, ICheck, IPencil, IPlus, IShield, ITrash, ITrophy, IUsers, IX,
} from "@/components/icons";

/* ------------------------------ types ------------------------------ */

type Tab = "users" | "designations" | "banks" | "bankrules" | "partners" | "channels" | "stages" | "masters" | "sla" | "docrules" | "feerules";
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
];

// Two-level admin navigation: group row on top, tabs for the active group below.
// New sections slot into a group — the top row stays small no matter how much grows.
const GROUPS: { key: string; label: string; tabs: { value: Tab; label: string }[] }[] = [
  { key: "team", label: "Team & Access", tabs: TAB_OPTIONS.filter((t) => ["users", "designations"].includes(t.value)) },
  { key: "market", label: "Marketplace", tabs: TAB_OPTIONS.filter((t) => ["banks", "bankrules", "partners", "channels"].includes(t.value)) },
  { key: "workflow", label: "Workflow", tabs: TAB_OPTIONS.filter((t) => ["stages", "masters", "sla"].includes(t.value)) },
  { key: "docs", label: "Docs & Fees", tabs: TAB_OPTIONS.filter((t) => ["docrules", "feerules"].includes(t.value)) },
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
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
      {tab === "banks" && <BanksTab />}
      {tab === "bankrules" && <BankRulesTab />}
      {tab === "partners" && <PartnersTab />}
      {tab === "channels" && <ChannelsTab />}
      {tab === "stages" && <StagesTab />}
      {tab === "masters" && <MastersTab />}
      {tab === "sla" && <SlaTab />}
      {tab === "docrules" && <DocRulesTab />}
      {tab === "feerules" && <FeeRulesTab />}
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
}

function blankUser(): UserDraft {
  return { id: 0, name: "", email: "", password: "demo123", role: "SPO", team: "Dubai", active: true };
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
                        onClick={() => { setEditing({ ...u, password: "" }); setCreating(false); }}
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
  builtIn: boolean;
}

function blankDesig(): DesigDraft {
  return { id: 0, name: "", scope: "own", issueTasks: false, admin: false, super: false, viewRevenue: false, builtIn: false };
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

/* ------------------------------ banks ------------------------------ */

interface BankDraft {
  id: number;
  name: string;
  ratePct: number;
  active: boolean;
}

function blankBank(): BankDraft {
  return { id: 0, name: "", ratePct: 0.8, active: true };
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
                        onClick={() => { setEditing({ ...b }); setCreating(false); }}
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
}

function blankPartner(): PartnerDraft {
  return { id: 0, kind: "Agent", name: "", defaultSharePct: 20, password: "agent123", active: true };
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
                          onClick={() => { setEditing({ ...p, password: "" }); setCreating(false); }}
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
  const [edit, setEdit] = useState<{ id: number; name: string; commissionPct: number; active: boolean } | null>(null);
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
        body: JSON.stringify({ kind: "channel", id: edit.id, name: edit.name, commissionPct: edit.commissionPct, active: edit.active }),
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
                  <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ id: ch.id, name: ch.name, commissionPct: ch.commissionPct, active: ch.active })}>Edit</button>
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
  employment: ["all", "Salaried", "Self-Employed", "Non-Resident"],
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
  const { bankProducts, banks, saveBankProduct, toast } = useHfmcStore();
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
          title={`Edit rules · ${editing.bankName} · ${editing.name}`}
          sub="Changes apply immediately to the rule engine when status is approved."
          onClose={() => setEditing(null)}
          width={640}
          footer={
            <>
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
            <FieldRowBadge role="engine" text="Green fields feed Bank Match and the final proposal. Amber fields are displayed but not calculated yet." />
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
