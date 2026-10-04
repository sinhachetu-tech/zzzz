"use client";

import { useMemo, useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { Designation, User } from "@/lib/types";
import { Chip, EmptyState } from "@/components/hfmc/ui";

/* Admin → Departments. WHO may touch WHAT, and who runs what.
 *
 * THREE SEPARATE THINGS, on one screen because they are chosen together when a firm
 * hires or re-organises — but never conflated in the data:
 *
 *   1. OFFICE     (User.team)          — where someone sits. Dubai / Abu Dhabi / Mgmt.
 *   2. DEPARTMENT (User.serviceLineId) — what they SELL. A roster only ("who do I ask
 *      about wills"). It grants NO access.
 *   3. ACCESS  (Designation.serviceLineIds) — what a ROLE may touch. The only one that
 *      opens or locks a file.
 *
 * READ-ACROSS IS NOT WRITING: a restricted role still sees any case belonging to a
 * client it already touches — that is how a will accounts for the debts on someone's
 * mortgage — while the server refuses the edit. That rule lives in src/lib/domain.ts
 * (visibleCases / canEditCase) and is enforced there, not here.
 */

export default function DepartmentsAdmin() {
  const { serviceLines, users, designations, cases, hydrate, toast } = useHfmcStore();
  const [busy, setBusy] = useState<string | null>(null);

  const activeLines = useMemo(() => serviceLines.filter((l) => l.active), [serviceLines]);

  // People per department, for the roster column.
  const byDept = useMemo(() => {
    const m = new Map<number, User[]>();
    for (const u of users) {
      if (u.serviceLineId == null) continue;
      const list = m.get(u.serviceLineId) ?? [];
      list.push(u);
      m.set(u.serviceLineId, list);
    }
    return m;
  }, [users]);

  // Open cases per department — a live number is what makes this screen worth opening.
  const openByDept = useMemo(() => {
    const m = new Map<number, number>();
    for (const c of cases) {
      if (c.caseStatus !== "Active" || c.serviceLineId == null) continue;
      m.set(c.serviceLineId, (m.get(c.serviceLineId) ?? 0) + 1);
    }
    return m;
  }, [cases]);

  const unassigned = useMemo(() => users.filter((u) => u.serviceLineId == null), [users]);
  const offices = useMemo(() => Array.from(new Set(users.map((u) => u.team))).filter(Boolean), [users]);

  const lineName = (id: number | null) => serviceLines.find((l) => l.id === id)?.shortName || "";

  const patch = async (label: string, url: string, body: Record<string, unknown>, successMsg: string) => {
    setBusy(label);
    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Save failed");
      toast("success", successMsg);
      await hydrate().catch(() => {});
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  };

  const saveUserDepartment = (u: User, serviceLineId: number | null) =>
    patch(`u${u.id}`, `/api/admin/${u.id}`, {
      kind: "user", name: u.name, email: u.email, role: u.role, team: u.team,
      active: u.active, serviceLineId,
    }, serviceLineId ? `${u.name} → ${lineName(serviceLineId)}` : `${u.name} left unassigned`);

  const saveHead = (lineId: number, headUserId: number | null) =>
    patch(`h${lineId}`, "/api/service-lines", { serviceLine: { id: lineId, headUserId } }, "Department head updated.");

  const saveScope = (d: Designation, serviceLineIds: string[]) =>
    patch(`d${d.id}`, `/api/admin/${d.id}`, {
      kind: "designation", name: d.name, scope: d.scope,
      issueTasks: d.issueTasks, admin: d.admin, super: d.super, viewRevenue: d.viewRevenue,
      manageDocs: d.manageDocs, clientChat: d.clientChat,
      serviceLineIds,
    }, serviceLineIds.length === 0 ? `${d.name} → all departments` : `${d.name} → ${serviceLineIds.length} department(s)`);

  return (
    <div>
      <div className="mb-4">
        <h3 className="font-disp font-semibold text-[15px] m-0">Departments</h3>
        <p className="text-[12px] text-[var(--ink-faint)] m-0 mt-0.5">
          Three separate things: <strong>office</strong> is where someone sits, <strong>department</strong> is what
          they sell, and <strong>role access</strong> is what they may open and change. Only the last is a permission.
        </p>
      </div>

      {/* ---------- 1. who runs what, and who is in each department ---------- */}
      <div className="card mb-4">
        <div className="card-h">
          <span className="font-semibold text-[13px]">Departments &amp; heads</span>
          <span className="text-[11px] text-[var(--ink-faint)]">Heads are informational — they grant no access.</span>
        </div>
        {/* `.tbl` on a div set `border-collapse` and nothing else, so this table's four
            columns never lined up. `.tbl-grid` is the grid it was assumed to
            have; `--cols` is set per table and collapses to 2 on a phone. */}
        <div className="tbl-grid" style={{ ["--cols" as string]: 4 }}>
          <div className="tr th">
            <span>Department</span><span>Head</span><span>Staff</span><span>Open cases</span>
          </div>
          {serviceLines.map((l) => {
            const staff = byDept.get(l.id) ?? [];
            return (
              <div className="tr" key={l.id}>
                <span>
                  {l.name}
                  {!l.active && <span className="text-[var(--ink-faint)]"> · inactive</span>}
                </span>
                <span>
                  <select
                    className="select select-sm"
                    value={l.headUserId ?? ""}
                    disabled={busy === `h${l.id}`}
                    onChange={(e) => saveHead(l.id, e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">— none —</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </span>
                <span>
                  {staff.length === 0
                    ? <span className="text-[var(--ink-faint)]">—</span>
                    : staff.map((u) => <Chip key={u.id} tone="slate">{u.name}</Chip>)}
                </span>
                <span className="text-[var(--ink-faint)]">{openByDept.get(l.id) ?? 0}</span>
              </div>
            );
          })}
        </div>
      </div>
      {/* ---------- 2. per-person department (informational) ---------- */}
      <div className="card mb-4">
        <div className="card-h">
          <span className="font-semibold text-[13px]">Who works in which department</span>
          <span className="text-[11px] text-[var(--ink-faint)]">
            A roster. Office ({offices.join(" / ") || "—"}) is a separate field and is untouched here.
          </span>
        </div>
        <div className="tbl-grid" style={{ ["--cols" as string]: 3 }}>
          <div className="tr th"><span>Person</span><span>Office</span><span>Department</span></div>
          {users.map((u) => (
            <div className="tr" key={u.id}>
              <span>{u.name}{!u.active && <span className="text-[var(--ink-faint)]"> · inactive</span>}</span>
              <span className="text-[var(--ink-faint)]">{u.team}</span>
              <span>
                <select
                  className="select select-sm"
                  value={u.serviceLineId ?? ""}
                  disabled={busy === `u${u.id}`}
                  onChange={(e) => saveUserDepartment(u, e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">— unassigned —</option>
                  {serviceLines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </span>
            </div>
          ))}
        </div>
        {unassigned.length > 0 && (
          <div className="px-3 py-2 text-[11px] text-[var(--ink-faint)]">
            {unassigned.length} unassigned. That is allowed and is <em>not</em> a restriction — their role decides what
            they can open.
          </div>
        )}
      </div>

      {/* ---------- 3. THE ACTUAL PERMISSION ---------- */}
      <div className="card">
        <div className="card-h">
          <span className="font-semibold text-[13px]">Role access · which departments each role may touch</span>
          <span className="text-[11px] text-[var(--ink-faint)]">
            No boxes ticked = <strong>all departments</strong> — the default for every role today.
          </span>
        </div>
        <div className="tbl-grid" style={{ ["--cols" as string]: 3 }}>
          <div className="tr th">
            <span>Role</span><span>Scope</span><span>Departments it may touch</span>
          </div>
          {designations.map((d) => {
            const all = d.serviceLineIds.length === 0;
            return (
              <div className="tr" key={d.id}>
                <span>
                  {d.name}
                  {d.super && <span className="text-[var(--ink-faint)]"> · super</span>}
                </span>
                <span className="text-[var(--ink-faint)]">{d.scope}</span>
                <span>
                  <div className="flex flex-wrap items-center gap-3">
                    {activeLines.map((l) => {
                      const on = !all && d.serviceLineIds.includes(l.code);
                      return (
                        <label key={l.id} className="flex items-center gap-1 text-[12px] cursor-pointer">
                          <input
                            type="checkbox"
                            disabled={busy === `d${d.id}` || all}
                            checked={on}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? Array.from(new Set([...d.serviceLineIds, l.code]))
                                : d.serviceLineIds.filter((c) => c !== l.code);
                              saveScope(d, next);
                            }}
                          />
                          {l.shortName}
                        </label>
                      );
                    })}
                    {all && <Chip tone="mint">all departments</Chip>}
                  </div>
                </span>
              </div>
            );
          })}
        </div>
        <div className="px-3 py-2 text-[11px] text-[var(--ink-faint)]">
          A restricted role can still <strong>read</strong> cases belonging to a client it already touches — that is how
          a will accounts for the debts on someone&rsquo;s mortgage — but the server refuses <strong>edits</strong>{" "}
          outside its departments. Roles marked super ignore all of this.
        </div>
      </div>

      {serviceLines.length === 0 && (
        <EmptyState icon={null} title="No service lines yet" body="Add one under Workflow → Service lines first." />
      )}
    </div>
  );
}