"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useHfmcStore } from "@/lib/client-store";
import type { BulletinItem, Reply, Tone } from "@/lib/types";
import {
  daysBetween,
  downloadCSV,
  fmtDate,
  parseDate,
  relTime,
  toISODate,
  todayISO,
} from "@/lib/format";
import { Avatar, Chip, EmptyState, Modal, SectionLabel } from "@/components/hfmc/ui";
import { ConfirmModal } from "@/components/hfmc/bits";
import {
  IArrowR,
  ICalendar,
  ICheck,
  IDownload,
  IFlag,
  IHistory,
  IInbox,
  IPlus,
  ITrash,
  IX,
  IChevronL,
  IChevronR,
} from "@/components/icons";

/* ---------------- helpers ---------------- */

function shiftDay(iso: string, delta: number): string {
  const d = parseDate(iso);
  d.setDate(d.getDate() + delta);
  return toISODate(d);
}

function fmtLong(iso: string): string {
  return parseDate(iso).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function fmtShort(iso: string): string {
  return parseDate(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

function statusOf(b: BulletinItem, today: string): { tone: Tone; label: string } {
  if (b.dropped) return { tone: "slate", label: "dropped" };
  if (b.status === "Done") return { tone: "mint", label: "done" };
  if (b.date < today) return { tone: "coral", label: "missed" };
  return { tone: "amber", label: "open" };
}

function edgeOf(b: BulletinItem, today: string): string {
  if (b.dropped) return "var(--slate)";
  if (b.status === "Done") return "var(--mint)";
  if (b.date < today) return "var(--coral)";
  return "var(--amber)";
}

function firstName(name: string | undefined): string {
  if (!name) return "?";
  return name.split(" ")[0];
}

function relativeDayLabel(iso: string, today: string): string | null {
  const gap = daysBetween(today, iso);
  if (gap === 0) return "Today";
  if (gap === 1) return "Tomorrow";
  if (gap === -1) return "Yesterday";
  return null;
}

/* ---------------- reply thread ---------------- */

function ReplyThread({ replies, onSend }: { replies: Reply[]; onSend: (text: string) => void }) {
  const { userById } = useHfmcStore();
  const [draft, setDraft] = useState("");
  const send = () => {
    const v = draft.trim();
    if (!v) return;
    onSend(v);
    setDraft("");
  };
  return (
    <div className="mt-3 space-y-2">
      {replies.map((r) => {
        const u = userById(r.userId);
        return (
          <div key={r.id} className="flex items-start gap-2 anim-fade-in">
            <Avatar name={u?.name ?? "?"} size={22} />
            <div
              className="min-w-0 flex-1 rounded-lg px-3 py-2"
              style={{ background: "var(--tint)", border: "1px solid var(--line-soft)" }}
            >
              <div className="flex items-baseline gap-2">
                <span className="text-[12px] font-semibold">{u?.name ?? "—"}</span>
                <span className="mono text-[10.5px] text-[var(--ink-faint)]">{relTime(r.at)}</span>
              </div>
              <p className="text-[12.5px] text-[var(--ink-dim)] m-0 mt-0.5 leading-snug">{r.text}</p>
            </div>
          </div>
        );
      })}
      <div className="flex items-center gap-2">
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="Reply… (press Enter)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
        />
        <button className="btn btn-ghost btn-sm shrink-0" onClick={send} disabled={!draft.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}

/* ---------------- status pill ---------------- */

function StatusPill({ b }: { b: BulletinItem }) {
  const today = todayISO();
  const s = statusOf(b, today);
  return (
    <Chip tone={s.tone} dot={s.label === "open"}>
      {s.label}
    </Chip>
  );
}

/* ---------------- directive card ---------------- */

function DirectiveCard({ b }: { b: BulletinItem }) {
  const {
    me,
    flags,
    cases,
    userById,
    nav,
    completeBulletin,
    carryBulletin,
    dropBulletin,
    replyBulletin,
    toast,
    canInstruct,
  } = useHfmcStore();
  const [showThread, setShowThread] = useState(b.replies.length > 0);
  const [confirmDrop, setConfirmDrop] = useState(false);

  if (!me) return null;

  const today = todayISO();
  const issuer = userById(b.issuedBy);
  const doneBy = b.completedBy != null ? userById(b.completedBy) : null;
  const linkedCase = b.caseId != null ? cases.find((c) => c.id === b.caseId) : null;

  const isTarget = b.targets.includes(me.id);
  const isSuper = !!flags?.super;
  const isOpen = b.status === "Open" && !b.dropped;

  // Mark done: target or super
  const canAct = isOpen && (isTarget || isSuper);
  // Carry / Drop: manager (canInstruct), super, or issuer
  const canManage = isOpen && (canInstruct() || isSuper || b.issuedBy === me.id);

  const edge = edgeOf(b, today);
  const dimmed = b.status === "Done" || b.dropped;

  return (
    <div
      className="card card-hover p-4 anim-fade-up"
      style={{ borderLeft: `3px solid ${edge}`, opacity: dimmed ? 0.72 : 1 }}
    >
      <div className="flex items-start gap-3">
        <Avatar name={issuer?.name ?? "?"} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-disp font-semibold text-[13.5px]">{issuer?.name ?? "—"}</span>
            {issuer?.role && <span className="text-[11px] text-[var(--ink-faint)]">{issuer.role}</span>}
            <span className="mono text-[10.5px] text-[var(--ink-faint)]">
              · {fmtDate(b.date)} · {relTime(b.createdAt)}
            </span>
          </div>

          <p
            className={`text-[14px] leading-relaxed mt-1 mb-1.5 ${
              dimmed ? "line-through text-[var(--ink-faint)]" : ""
            }`}
          >
            {b.task}
          </p>

          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill b={b} />
            {b.carriedFrom && (
              <Chip tone="slate">
                <span className="inline-flex items-center gap-1">
                  <IChevronL size={11} /> carried from {fmtDate(b.carriedFrom)}
                </span>
              </Chip>
            )}
            {linkedCase && (
              <button
                className="chip transition-colors hover:opacity-80"
                style={{
                  background: "var(--tint)",
                  borderColor: "var(--line)",
                  color: "var(--ink-dim)",
                  cursor: "pointer",
                }}
                title={`Open ${linkedCase.caseNumber} · ${linkedCase.customer}`}
                onClick={() => nav({ name: "case", id: linkedCase.id })}
              >
                <span className="mono" style={{ color: "var(--amber)" }}>
                  {linkedCase.caseNumber}
                </span>
                <span className="truncate max-w-[160px]">{linkedCase.customer}</span>
                {linkedCase.caseStatus !== "Active" && (
                  <span className="text-[10.5px] text-[var(--ink-faint)]">
                    · {linkedCase.caseStatus === "Closed" ? "booked" : "lost"}
                  </span>
                )}
              </button>
            )}
            <span className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--ink-faint)] font-disp font-semibold ml-1">
              to
            </span>
            {b.targets.map((t) => (
              <Chip key={t} tone="sky">
                {firstName(userById(t)?.name)}
              </Chip>
            ))}
          </div>

          {b.status === "Done" && b.completedAt && (
            <p
              className="text-[11px] mt-1.5 mb-0 flex items-center gap-1"
              style={{ color: "var(--mint)" }}
            >
              <ICheck size={12} />
              {doneBy ? `done by ${doneBy.name}` : "resolved automatically"} · {relTime(b.completedAt)}
            </p>
          )}
          {b.dropped && (
            <p className="text-[11px] mt-1.5 mb-0 text-[var(--ink-faint)]">
              Dropped from the active loop.
            </p>
          )}
        </div>

        {/* actions */}
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {canAct && (
            <button
              className="btn btn-mint sm:btn-sm"
              onClick={async () => {
                await completeBulletin(b.id);
                toast("success", "Directive marked done.");
              }}
            >
              <ICheck size={13} /> Done
            </button>
          )}
          {canManage && (
            <>
              <button
                className="btn btn-ghost btn-sm"
                title="Carry forward to today's bulletin"
                onClick={async () => {
                  await carryBulletin(b.id);
                  toast("info", "Carried forward to today's bulletin.");
                }}
              >
                <IArrowR size={13} /> Carry forward
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDrop(true)}>
                <IX size={13} /> Drop
              </button>
            </>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => setShowThread((s) => !s)}>
            Reply{b.replies.length > 0 && <span className="mono"> ({b.replies.length})</span>}
          </button>
        </div>
      </div>

      {showThread && (
        <div className="pl-[44px]">
          <ReplyThread replies={b.replies} onSend={(t) => replyBulletin(b.id, t)} />
        </div>
      )}

      <ConfirmModal
        open={confirmDrop}
        onClose={() => setConfirmDrop(false)}
        title="Drop this directive?"
        body={
          <span>
            It will be closed as <strong>dropped</strong> — kept in the record, but it won&apos;t
            appear in the active loop or count as missed any more.
          </span>
        }
        confirmLabel="Drop it"
        onConfirm={async () => {
          await dropBulletin(b.id);
          toast("info", "Directive dropped.");
        }}
      />
    </div>
  );
}

/* ---------------- new directive modal ---------------- */

function NewDirectiveModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me, flags, users, visibleCases, createBulletin, toast } = useHfmcStore();
  const [text, setText] = useState("");
  const [caseId, setCaseId] = useState<number | null>(null);
  const [targets, setTargets] = useState<number[]>([]);
  const [date, setDate] = useState<string>(todayISO());
  const [err, setErr] = useState("");

  if (!open || !me) return null;

  // Reset draft targets once when modal opens for the first time
  const teamUsers = users.filter(
    (u) =>
      u.active &&
      u.id !== me.id &&
      (!!flags?.super || flags?.scope === "all" || u.team === me.team)
  );

  const toggle = (id: number) =>
    setTargets((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));

  const activeCases = visibleCases().filter((c) => c.caseStatus === "Active");

  const submit = async () => {
    if (!text.trim()) {
      setErr("Write the directive first.");
      return;
    }
    if (targets.length === 0) {
      setErr("Pick at least one teammate.");
      return;
    }
    try {
      await createBulletin({ task: text.trim(), caseId, targets, date });
      toast("success", "Directive issued.");
      setText("");
      setCaseId(null);
      setTargets([]);
      setDate(todayISO());
      setErr("");
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not issue directive.");
    }
  };

  const footer: ReactNode = (
    <>
      <button className="btn btn-ghost" onClick={onClose}>
        Cancel
      </button>
      <button className="btn btn-primary" onClick={submit}>
        <IPlus size={13} /> Issue directive
      </button>
    </>
  );

  return (
    <Modal
      title="Issue a directive"
      sub="Lands on the team's morning bulletin — they answer with Done or a reply."
      onClose={onClose}
      width={540}
      footer={footer}
    >
      <div className="space-y-4">
        <div>
          <SectionLabel>Task</SectionLabel>
          <textarea
            className="textarea"
            rows={3}
            autoFocus
            placeholder="e.g. Every file stuck in Pre-Approval more than 5 days gets an RM call before noon — report back here."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <SectionLabel>Pin to case (optional)</SectionLabel>
            <select
              className="select w-full"
              value={caseId ?? ""}
              onChange={(e) => setCaseId(e.target.value ? parseInt(e.target.value, 10) : null)}
            >
              <option value="">General — no case link</option>
              {activeCases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.caseNumber} · {c.customer}
                </option>
              ))}
            </select>
          </div>
          <div>
            <SectionLabel>Date</SectionLabel>
            <input
              className="input mono w-full"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value || todayISO())}
            />
          </div>
        </div>

        <div>
          <SectionLabel>Target teammates</SectionLabel>
          {teamUsers.length === 0 ? (
            <p className="text-[12px] text-[var(--ink-faint)] m-0">No teammates available.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  setTargets(
                    targets.length === teamUsers.length ? [] : teamUsers.map((u) => u.id)
                  )
                }
              >
                {targets.length === teamUsers.length ? "Clear all" : "Select all"}
              </button>
              {teamUsers.map((u) => {
                const on = targets.includes(u.id);
                return (
                  <button
                    key={u.id}
                    className="chip transition-all"
                    style={
                      on
                        ? {
                            background: "var(--amber-tint)",
                            borderColor: "var(--amber)",
                            color: "var(--amber)",
                          }
                        : {
                            background: "var(--bg2)",
                            borderColor: "var(--line)",
                            color: "var(--ink-faint)",
                          }
                    }
                    onClick={() => toggle(u.id)}
                  >
                    {u.name.split(" ")[0]}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {err && (
          <p className="text-[12.5px] m-0" style={{ color: "var(--coral)" }}>
            {err}
          </p>
        )}
      </div>
    </Modal>
  );
}

/* ---------------- main view ---------------- */

export default function BulletinView() {
  const {
    me,
    bulletin,
    cases,
    userById,
    canInstruct,
    toast,
  } = useHfmcStore();

  const today = todayISO();
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [showNew, setShowNew] = useState(false);

  const manager = canInstruct();

  // Directives for the selected date, sorted: Open first (oldest first), then Done/Dropped.
  const dayItems = useMemo(() => {
    return bulletin
      .filter((b) => b.date === selectedDate && !b.isTemplate)
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "Open" ? -1 : 1;
        if (a.dropped !== b.dropped) return a.dropped ? 1 : -1;
        return a.createdAt.localeCompare(b.createdAt);
      });
  }, [bulletin, selectedDate]);

  const openCount = useMemo(
    () =>
      bulletin.filter(
        (b) => b.date === selectedDate && b.status === "Open" && !b.dropped && !b.isTemplate
      ).length,
    [bulletin, selectedDate]
  );

  // For the header: today's open count across the whole feed
  const todayOpenCount = useMemo(
    () =>
      bulletin.filter(
        (b) => b.date === today && b.status === "Open" && !b.dropped && !b.isTemplate
      ).length,
    [bulletin, today]
  );

  const relLabel = relativeDayLabel(selectedDate, today);

  const goPrev = () => setSelectedDate((d) => shiftDay(d, -1));
  const goNext = () => setSelectedDate((d) => shiftDay(d, 1));
  const goToday = () => setSelectedDate(today);

  const exportCSV = () => {
    const rows = dayItems.map((b) => [
      b.date,
      b.task,
      userById(b.issuedBy)?.name ?? "",
      userById(b.issuedBy)?.role ?? "",
      b.targets.map((t) => userById(t)?.name ?? "").join("; "),
      b.caseId != null
        ? cases.find((c) => c.id === b.caseId)?.caseNumber ?? ""
        : "",
      b.dropped ? "Dropped" : b.status,
      b.completedAt ? relTime(b.completedAt) : "",
    ]);
    downloadCSV(
      `bulletin-${selectedDate}.csv`,
      ["Date", "Task", "Issued by", "Role", "Targets", "Case", "Status", "Completed"],
      rows
    );
    toast("success", "Day exported to CSV.");
  };

  if (!me) return null;

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-disp font-bold text-[24px] tracking-tight m-0 flex items-center gap-2.5">
            <IFlag size={22} className="text-[var(--amber)]" /> Morning Bulletin
          </h1>
          <p className="text-[13px] text-[var(--ink-dim)] mt-0.5 mb-0">
            {fmtLong(today)} ·{" "}
            <span className="mono" style={{ color: todayOpenCount > 0 ? "var(--amber)" : "var(--mint)" }}>
              {todayOpenCount} open
            </span>{" "}
            today — issue once, the team answers with Done or a reply.
          </p>
        </div>
        {manager && (
          <button className="btn btn-primary sm:btn-sm" onClick={() => setShowNew(true)}>
            <IPlus size={14} /> New directive
          </button>
        )}
      </div>

      {/* date selector */}
      <div className="card p-3 flex flex-wrap items-center gap-2.5">
        <button
          className="btn btn-ghost btn-sm !px-2"
          onClick={goPrev}
          title="Previous day"
          aria-label="Previous day"
        >
          <IChevronL size={16} />
        </button>
        <div className="flex items-baseline gap-2 min-w-0 flex-1">
          <ICalendar size={15} className="text-[var(--amber)] shrink-0" />
          <span className="font-disp font-semibold text-[14px] truncate">
            {fmtLong(selectedDate)}
          </span>
          {relLabel && (
            <Chip tone={relLabel === "Today" ? "mint" : relLabel === "Tomorrow" ? "amber" : "slate"}>
              {relLabel}
            </Chip>
          )}
          {openCount > 0 && (
            <span className="mono text-[11px] text-[var(--ink-faint)]">
              · {openCount} open
            </span>
          )}
        </div>
        {selectedDate !== today && (
          <button className="btn btn-ghost btn-sm" onClick={goToday} title="Jump to today">
            Jump to today
          </button>
        )}
        <button
          className="btn btn-ghost btn-sm !px-2"
          onClick={goNext}
          title="Next day"
          aria-label="Next day"
        >
          <IChevronR size={16} />
        </button>
        <div className="h-[18px] w-px" style={{ background: "var(--line)" }} />
        <button
          className="btn btn-ghost btn-sm"
          onClick={exportCSV}
          disabled={dayItems.length === 0}
          title="Download the day's directives as CSV"
        >
          <IDownload size={13} /> Export CSV
        </button>
      </div>

      {/* list */}
      {dayItems.length === 0 ? (
        <div className="card p-8">
          <EmptyState
            icon={<IInbox size={26} />}
            title={
              relLabel === "Today"
                ? "Nothing on today's bulletin"
                : `No directives on ${fmtShort(selectedDate)}`
            }
            body={
              manager
                ? "Issue the first directive of the day — it lands on your team's feed instantly."
                : "No directives addressed to you on this day. Enjoy the calm."
            }
          />
        </div>
      ) : (
        <div className="space-y-3">
          {dayItems.map((b) => (
            <DirectiveCard key={b.id} b={b} />
          ))}
          {/* day progress — the "run of show" bar: done share of the day's real work */}
          <div className="flex items-center gap-2.5 px-1 pt-1 text-[11px] text-[var(--ink-faint)]">
            <IHistory size={12} className="shrink-0" />
            <div className="h-[5px] rounded-full overflow-hidden flex-1 max-w-[220px]" style={{ background: "var(--track)" }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(() => {
                    const real = dayItems.filter((b) => !b.dropped);
                    const done = real.filter((b) => b.status === "Done").length;
                    return real.length ? Math.round((done / real.length) * 100) : 0;
                })()}%`,
                  background: "var(--mint)",
                  transition: "width 0.5s cubic-bezier(0.22,1,0.36,1)",
                }}
              />
            </div>
            <span className="whitespace-nowrap">
              {dayItems.filter((b) => b.status === "Done" && !b.dropped).length} done ·{" "}
              {dayItems.filter((b) => b.dropped).length} dropped ·{" "}
              {dayItems.filter((b) => b.status === "Open" && !b.dropped).length} open
            </span>
          </div>
        </div>
      )}

      <NewDirectiveModal open={showNew} onClose={() => setShowNew(false)} />
    </div>
  );
}
