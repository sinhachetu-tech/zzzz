"use client";

import { useMemo, useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type {
  BankItem, Designation, MasterItem, PartnerItem, PartnerKind,
  SlaRule, StageItem, User,
} from "@/lib/types";
import { fmtRate } from "@/lib/format";
import { Avatar, Chip, EmptyState, Modal, Seg } from "@/components/hfmc/ui";
import { ConfirmModal } from "@/components/hfmc/bits";
import {
  IBank, ICheck, IPencil, IPlus, IShield, ITrash, ITrophy, IUsers, IX,
} from "@/components/icons";

/* ------------------------------ types ------------------------------ */

type Tab = "users" | "designations" | "banks" | "partners" | "stages" | "masters" | "sla";
type MasterKind = "whyPending" | "waitingFor";

const TEAMS = ["Management", "Dubai", "Abu Dhabi"];

const TAB_OPTIONS: { value: Tab; label: string }[] = [
  { value: "users", label: "Teammates" },
  { value: "designations", label: "Designations" },
  { value: "banks", label: "Banks & rates" },
  { value: "partners", label: "Partners" },
  { value: "stages", label: "Stages" },
  { value: "masters", label: "Masters" },
  { value: "sla", label: "SLA rules" },
];

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

function CardHeader({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
      <div className="min-w-0 flex-1">
        <h3 className="font-disp font-semibold text-[14px] m-0">{title}</h3>
        {sub && <p className="text-[11.5px] text-[var(--ink-faint)] mt-0.5 mb-0">{sub}</p>}
      </div>
      {action}
    </div>
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

  return (
    <div className="space-y-4 anim-fade-up">
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 pl-1 pr-2">
          <IShield size={16} className="text-[var(--amber)]" />
          <span className="font-disp font-semibold text-[13px]">Master data</span>
        </div>
        <div className="overflow-x-auto -my-1.5">
          <Seg<Tab>
            value={tab}
            onChange={setTab}
            options={TAB_OPTIONS}
          />
        </div>
      </div>

      {tab === "users" && <UsersTab />}
      {tab === "designations" && <DesignationsTab />}
      {tab === "banks" && <BanksTab />}
      {tab === "partners" && <PartnersTab />}
      {tab === "stages" && <StagesTab />}
      {tab === "masters" && <MastersTab />}
      {tab === "sla" && <SlaTab />}
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
          <button className="btn btn-primary btn-sm" onClick={() => { setEditing(blankUser()); setCreating(true); }}>
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
  builtIn: boolean;
}

function blankDesig(): DesigDraft {
  return { id: 0, name: "", scope: "own", issueTasks: false, admin: false, super: false, builtIn: false };
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
          <button className="btn btn-primary btn-sm" onClick={() => { setEditing(blankDesig()); setCreating(true); }}>
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
              </div>
              {editing.super && (
                <p className="text-[11.5px] text-[var(--ink-faint)] mt-1.5 mb-0">
                  Supreme designations always see all cases and can issue tasks. Scope is locked.
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
          <button className="btn btn-primary btn-sm" onClick={() => { setEditing(blankBank()); setCreating(true); }}>
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
  active: boolean;
}

function blankPartner(): PartnerDraft {
  return { id: 0, kind: "Agent", name: "", defaultSharePct: 20, active: true };
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
          <button className="btn btn-primary btn-sm" onClick={() => { setEditing(blankPartner()); setCreating(true); }}>
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
                          onClick={() => { setEditing({ ...p }); setCreating(false); }}
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
          <button className="btn btn-primary btn-sm" onClick={() => { setEditing(blankStage(nextOrder)); setCreating(true); }}>
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
          <button className="btn btn-primary btn-sm" onClick={() => { setEditing(blankMaster()); setCreating(true); }}>
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
            className="btn btn-primary btn-sm"
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
