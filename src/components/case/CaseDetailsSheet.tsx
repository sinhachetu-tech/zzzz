"use client";

/* CaseDetailsSheet — the slide-over that replaced the permanent 340px inspector.
 *
 * WHY IT MOVED: the rail was open by default, permanently ate 340px of the
 * workspace at xl, held seven cards, and had THREE separate toggle buttons
 * (sticky bar, tab bar, and its own header) plus a localStorage flag — so the
 * layout you saw depended on a setting nobody remembered choosing. Seven cards
 * in a column is also just a second, worse tab bar: the same "which of these do
 * I open" problem the tab bar exists to solve.
 *
 * So it becomes an overlay, on the reasoning that a detail surface you have to
 * ASK for is one you can afford to make complete, while a rail you always have
 * is a rail you learn to ignore. One button opens it, Escape / scrim / ✕ closes
 * it, and its groups are internal tabs rather than one long scroll.
 *
 * WHAT STAYED HERE vs WHAT MOVED TO THE Money TAB:
 *   people + client file + copilot → here. They are context about WHO.
 *   pre-approval, FOL, commission, bank tracking → the Money tab. Those are
 *   numbers about the deal; they were the panels nobody opened because they were
 *   buried behind a toggle, and hiding them again would undo that fix.
 */

import { useEffect, useState, type ReactNode } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { LoanCase } from "@/lib/types";
import { Avatar, Chip, SectionLabel } from "@/components/hfmc/ui";
import { ContactLine, KycChip, resolveContact } from "@/components/case/ContactBits";
import { IUsers, IBriefcase, IRobot, IX } from "@/components/icons";

export type DetailsGroup = "people" | "client" | "assistant";

export function CaseDetailsSheet({
  c,
  onClose,
  people,
  clientFile,
  assistant,
}: {
  c: LoanCase;
  onClose: () => void;
  people: ReactNode;
  clientFile: ReactNode;
  assistant: ReactNode;
}) {
  const [group, setGroup] = useState<DetailsGroup>("people");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    // the sheet is modal: stop the page behind it scrolling under the overlay
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const groups: { key: DetailsGroup; label: string; icon: ReactNode }[] = [
    { key: "people", label: "People", icon: <IUsers size={14} /> },
    { key: "client", label: "Client", icon: <IBriefcase size={14} /> },
    { key: "assistant", label: "Assistant", icon: <IRobot size={14} /> },
  ];

  return (
    <div className="fixed inset-0 z-[70] flex justify-end anim-fade-in"
      style={{ background: "rgba(0,0,0,0.42)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog" aria-modal="true" aria-label={`Case details — ${c.caseNumber}`}>
      <div className="h-full w-full sm:w-[400px] flex flex-col"
        style={{ background: "var(--bg)", borderLeft: "1px solid var(--line)", boxShadow: "var(--shadow)" }}>
        <div className="flex items-start justify-between gap-2 px-4 pt-4 pb-3 border-b shrink-0" style={{ borderColor: "var(--line-soft)" }}>
          <div className="min-w-0">
            <SectionLabel>Case details</SectionLabel>
            <h2 className="font-disp font-semibold text-[15px] m-0 truncate">{c.caseNumber} · {c.customer}</h2>
            <div className="flex items-center gap-1.5 mt-1"><Chip tone="amber">{c.stage}</Chip></div>
          </div>
          <button className="btn btn-ghost btn-sm !px-2 -mr-1" onClick={onClose} aria-label="Close case details">
            <IX size={15} />
          </button>
        </div>

        <div className="px-4 py-2.5 border-b shrink-0" style={{ borderColor: "var(--line-soft)" }}>
          <div className="flex items-center gap-1.5">
            {groups.map((g) => {
              const on = group === g.key;
              return (
                <button key={g.key} type="button" onClick={() => setGroup(g.key)}
                  className="btn btn-sm flex items-center gap-1.5"
                  style={{
                    background: on ? "rgba(242,176,76,0.12)" : "transparent",
                    color: on ? "var(--amber)" : "var(--ink-dim)",
                    borderColor: on ? "rgba(242,176,76,0.35)" : "var(--line-soft)",
                  }}
                  aria-pressed={on}>
                  {g.icon}{g.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {group === "people" && people}
          {group === "client" && clientFile}
          {group === "assistant" && assistant}
        </div>
      </div>
    </div>
  );
}
/** The people list. Lives here rather than in case-detail.tsx because the sheet
 *  owns the layout and this owns the inline assignment controls — keeping them
 *  together means the VRM / advisor / backup selects cannot drift out of the
 *  panel that labels them. */
export function PeoplePanel({ c }: { c: LoanCase }) {
  const { users, me, userById, updateCase, flags, toast, clients } = useHfmcStore();
  const owner = userById(c.ownerId);
  const canAssign = !!flags?.super || !!flags?.admin || c.ownerId === me?.id;
  const client = clients.find((cl) => cl.id === c.clientId) ?? null;
  const contact = resolveContact(c, client);

  return (
    <>
      <div className="card p-4">
        <SectionLabel>Direct line</SectionLabel>
        <div className="flex items-center gap-2.5">
          <Avatar name={contact.name || c.customer} size={32} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium truncate">{contact.name || c.customer}</div>
            <div className="mt-0.5"><ContactLine contact={contact} size={11} /></div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
          <KycChip contact={contact} />
          {c.coApplicantName && <Chip tone="slate">co-applicant</Chip>}
        </div>
      </div>

      <div className="card p-4">
        <SectionLabel>Who is on this file</SectionLabel>
        <div className="space-y-2.5">
          <div className="flex items-center gap-2.5">
            <Avatar name={owner?.name ?? "?"} size={28} />
            <div>
              <div className="text-[12.5px] font-medium">{owner?.name ?? "—"}</div>
              <div className="text-[11px] text-[var(--ink-faint)]">{c.ownerId === me?.id ? "you" : "case owner"} · {owner?.role}</div>
            </div>
          </div>

          {/* VRM — display and assignment in one place */}
          <div className="flex items-center gap-2.5">
            <span style={{ opacity: c.vrmId ? 1 : 0.4 }}><Avatar name={c.vrmId ? (userById(c.vrmId)?.name ?? "?") : "?"} size={28} /></span>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium">{c.vrmId ? (userById(c.vrmId)?.name ?? "—") : "—"}</div>
              <div className="text-[11px] text-[var(--ink-faint)]">VRM{c.vrmId ? ` · ${userById(c.vrmId)?.role ?? ""}` : " · unassigned"}</div>
            </div>
            {canAssign && (
              <select className="select !w-auto !py-1 text-[11px]" value={c.vrmId ? String(c.vrmId) : ""}
                title="Assign VRM"
                onChange={async (e) => {
                  await updateCase(c.id, { vrmId: e.target.value ? parseInt(e.target.value, 10) : null });
                  toast("success", e.target.value ? "VRM assigned." : "VRM removed.");
                }}>
                <option value="">— none —</option>
                {users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            )}
          </div>

          {c.bankRm && (
            <div className="flex items-center gap-2.5">
              <Avatar name={c.bankRm} size={28} />
              <div>
                <div className="text-[12.5px] font-medium">{c.bankRm}</div>
                <div className="text-[11px] text-[var(--ink-faint)]">bank relationship manager</div>
              </div>
            </div>
          )}

          {c.coApplicantName && (
            <div className="flex items-center gap-2.5">
              <Avatar name={c.coApplicantName} size={28} />
              <div>
                <div className="text-[12.5px] font-medium">{c.coApplicantName}</div>
                <div className="text-[11px] text-[var(--ink-faint)]">co-applicant</div>
              </div>
            </div>
          )}

{/* advisor — the client-facing person, who may differ from the owner who runs
              the file */}
          {(() => {
            const advId = c.advisorId ?? c.ownerId;
            const adv = userById(advId);
            return (
              <div className="flex items-center gap-2.5">
                <Avatar name={adv?.name ?? "?"} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium">{adv?.name ?? "—"}</div>
                  <div className="text-[11px] text-[var(--ink-faint)]">advisor · {adv?.role}</div>
                </div>
                {canAssign && (
                  <select className="select !w-auto !py-1 text-[11px]" value={String(advId)}
                    title="Appoint the client-facing advisor"
                    onChange={async (e) => {
                      await updateCase(c.id, { advisorId: Number(e.target.value) });
                      toast("success", "Advisor appointed.");
                    }}>
                    {users.filter((u) => u.active && u.role !== "Head of Company" && u.role !== "PA to HoC").map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                )}
              </div>
            );
          })()}

          {/* Backups are standing authorisation to work this file, which is why
              they read "covering" rather than "assistant". */}
          {([1, 2] as const).map((n) => {
            const bid = n === 1 ? c.backup1Id : c.backup2Id;
            const bUser = bid ? userById(bid) : undefined;
            return (
              <div key={n} className="flex items-center gap-2.5" style={{ opacity: bid ? 1 : 0.6 }}>
                <span className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[10.5px] font-disp font-bold"
                  style={{ background: bid ? "var(--amber-tint)" : "var(--tint)", color: bid ? "var(--amber)" : "var(--ink-faint)" }}>
                  {n}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium">{bUser?.name ?? "—"}</div>
                  <div className="text-[11px] text-[var(--ink-faint)]">{bid ? `Backup ${n} · covering · ${bUser?.role ?? ""}` : `Backup ${n} — not set`}</div>
                </div>
                {canAssign && (
                  <select className="select !w-auto !py-1 text-[11px]" value={bid ? String(bid) : ""}
                    title={`Appoint backup ${n}`}
                    onChange={async (e) => {
                      const val = e.target.value ? Number(e.target.value) : null;
                      await updateCase(c.id, n === 1 ? { backup1Id: val } : { backup2Id: val });
                      toast("success", val ? `Backup ${n} appointed — they can now open and work this file.` : `Backup ${n} removed.`);
                    }}>
                    <option value="">— none —</option>
                    {users.filter((u) => u.active && u.id !== c.ownerId && (n === 1 ? u.id !== c.backup2Id : u.id !== c.backup1Id)).map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}

          {c.partner && (
            <div className="flex items-center gap-2.5">
              <Avatar name={c.partner.name} size={28} />
              <div>
                <div className="text-[12.5px] font-medium">{c.partner.name}</div>
                <div className="text-[11px] text-[var(--ink-faint)]">{c.partner.kind}{flags?.viewRevenue ? ` · ${c.partner.sharePct}% of our commission` : ""}</div>
                {c.partnerRm && <div className="text-[11px] text-[var(--ink-dim)]">RM: {c.partnerRm}</div>}
              </div>
            </div>
          )}
        </div>

        {/* Client channel overrides — the 3-tier hierarchy (global → segment →
            case) collapsed to its final tier, the only one editable from inside
            the file. */}
        <div className="card p-4">
          <SectionLabel>Client channel overrides</SectionLabel>
          <div className="flex items-center gap-1.5 flex-wrap">
            {(["push", "whatsapp", "email"] as const).map((ch) => {
              const overrides = (c.notificationOverrides as Record<string, boolean> | null) || {};
              const isOn = ch === "email" ? overrides[ch] === true : overrides[ch] !== false;
              return (
                <button
                  key={ch}
                  type="button"
                  className="chip text-[10.5px] px-2 py-0.5"
                  style={isOn
                    ? { background: "rgba(16,185,129,0.12)", color: "var(--mint)", borderColor: "rgba(16,185,129,0.4)" }
                    : { background: "rgba(244,63,94,0.1)", color: "var(--coral)", borderColor: "rgba(244,63,94,0.3)" }}
                  title={`Click to toggle ${ch} notifications for this client`}
                  onClick={async () => {
                    await updateCase(c.id, { notificationOverrides: { ...overrides, [ch]: !isOn } });
                    toast("info", `${ch.toUpperCase()} notification for this client set to ${!isOn ? "ON" : "OFF"}`);
                  }}
                >
                  {ch === "whatsapp" ? "WhatsApp" : ch === "push" ? "Push" : "Email"}: {isOn ? "ON ✓" : "OFF ✕"}
                </button>
              );
            })}
          </div>
        </div>

        {c.profileClientVerifiedAt && (
          <p className="text-[11px] m-0" style={{ color: "var(--mint)" }}>
            Client verified their own data sheet.
          </p>
        )}
      </div>
    </>
  );
}

