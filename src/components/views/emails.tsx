"use client";

import { useMemo, useState } from "react";
import { useHfmcStore } from "@/lib/client-store";
import { fmtDateTime, relTime } from "@/lib/format";
import { Avatar, Chip, EmptyState, Modal } from "@/components/hfmc/ui";
import { IBank, ICheck, IInbox, ISearch, IX } from "@/components/icons";

/**
 * Emails view — two surfaces:
 *   1. The review queue: unmatched inbound emails needing a human glance.
 *      Each shows subject/sender/received + best-guess case (if any) with
 *      Link / Pick another case / Not relevant buttons.
 *   2. The recent email log: emails already linked to cases, with the case
 *      number + direction badge. Clickable to open the case.
 */
export default function Emails() {
  const { unmatchedEmails, emails, cases, caseById, nav, linkEmail, ignoreEmail, toast } = useHfmcStore();
  const [search, setSearch] = useState("");
  const [pickTarget, setPickTarget] = useState<number | null>(null);

  const sortedUnmatched = useMemo(
    () => [...unmatchedEmails].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
    [unmatchedEmails]
  );

  const sortedEmails = useMemo(
    () => [...emails].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, 60),
    [emails]
  );

  const filteredLog = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedEmails;
    return sortedEmails.filter((e) => {
      const c = caseById(e.caseId);
      return (
        e.subject.toLowerCase().includes(q) ||
        e.sender.toLowerCase().includes(q) ||
        c?.customer.toLowerCase().includes(q) ||
        c?.caseNumber.toLowerCase().includes(q)
      );
    });
  }, [sortedEmails, search, caseById]);

  const confirmLink = async (unmatchedId: number, caseId: number) => {
    try {
      await linkEmail(unmatchedId, caseId);
      const c = caseById(caseId);
      toast("success", `Email linked to ${c?.caseNumber ?? "case"}.`);
    } catch {
      toast("error", "Could not link email.");
    }
  };

  const confirmIgnore = async (unmatchedId: number) => {
    try {
      await ignoreEmail(unmatchedId);
      toast("info", "Email marked not relevant.");
    } catch {
      toast("error", "Could not ignore email.");
    }
  };

  const [polling, setPolling] = useState(false);
  const pollNow = async () => {
    setPolling(true);
    try {
      const res = await fetch("/api/email/poll", { cache: "no-store" });
      const data = await res.json();
      if (data.ok) {
        toast(
          "success",
          `Polled Outlook — ${data.processed} new, ${data.linked} linked, ${data.queued} queued.`
        );
      } else {
        toast("error", data.error || "Poll failed.");
      }
    } catch {
      toast("error", "Poll request failed.");
    } finally {
      setPolling(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-disp font-bold text-[24px] tracking-tight m-0">Emails</h1>
          <p className="text-[13px] text-[var(--ink-dim)] mt-0.5 mb-0">
            Inbound bank/client emails, auto-matched to cases. {unmatchedEmails.length} need a glance.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {unmatchedEmails.length > 0 && (
            <Chip tone="amber" dot>{unmatchedEmails.length} to review</Chip>
          )}
          <button className="btn btn-ghost sm:btn-sm" onClick={pollNow} disabled={polling} title="Read unread emails from the Outlook shared mailbox now">
            {polling ? "Polling…" : "Poll Outlook now"}
          </button>
        </div>
      </div>

      {/* review queue */}
      {sortedUnmatched.length > 0 && (
        <div className="card anim-fade-up" style={{ borderLeft: "3px solid var(--amber)" }}>
          <div className="flex items-center gap-2 p-4 border-b" style={{ borderColor: "var(--line-soft)" }}>
            <IInbox size={15} className="text-[var(--amber)]" />
            <h3 className="font-disp font-semibold text-[14px] m-0">Needs review</h3>
            <span className="text-[11.5px] text-[var(--ink-faint)] ml-auto">
              Auto-match wasn&apos;t confident enough — confirm or correct the suggested case.
            </span>
          </div>
          <div className="divide-y" style={{ borderColor: "var(--line-soft)" }}>
            {sortedUnmatched.map((u) => {
              const guess = u.bestGuessCaseId ? caseById(u.bestGuessCaseId) : null;
              return (
                <div key={u.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-[13.5px] m-0 leading-snug">{u.subject}</p>
                      <p className="text-[11.5px] text-[var(--ink-faint)] m-0 mt-1">
                        from <span className="mono text-[var(--ink-dim)]">{u.sender}</span> · {relTime(u.receivedAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    {guess ? (
                      <>
                        <span className="text-[11.5px] text-[var(--ink-faint)]">Best guess:</span>
                        <button
                          className="rowlink rounded-lg px-2.5 py-1 flex items-center gap-2"
                          style={{ background: "var(--amber-tint)", border: "1px solid var(--amber-line)" }}
                          onClick={() => nav({ name: "case", id: guess.id })}
                          title="Open the case"
                        >
                          <span className="mono text-[11.5px]" style={{ color: "var(--amber)" }}>{guess.caseNumber}</span>
                          <span className="text-[12px] text-[var(--ink-dim)]">{guess.customer}</span>
                        </button>
                        <button className="btn btn-mint sm:btn-sm" onClick={() => confirmLink(u.id, guess.id)}>
                          <ICheck size={13} /> Link to this case
                        </button>
                        <button className="btn btn-ghost sm:btn-sm" onClick={() => setPickTarget(u.id)}>
                          Pick another
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="text-[11.5px] text-[var(--ink-faint)] w-full sm:w-auto">No confident match.</span>
                        <button className="btn btn-ghost sm:btn-sm" onClick={() => setPickTarget(u.id)}>
                          Pick a case
                        </button>
                      </>
                    )}
                    <button className="btn btn-ghost sm:btn-sm sm:ml-auto" onClick={() => confirmIgnore(u.id)}>
                      Not relevant
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* recent email log */}
      <div className="card anim-fade-up">
        <div className="flex flex-wrap items-center gap-2 p-3 border-b" style={{ borderColor: "var(--line-soft)" }}>
          <IBank size={14} className="text-[var(--ink-faint)]" />
          <h3 className="font-disp font-semibold text-[14px] m-0">Recent email log</h3>
          <div className="ml-auto relative w-full sm:w-auto">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-faint)]"><ISearch size={14} /></span>
            <input
              className="input !pl-8 !py-[6.5px] w-full sm:w-[200px]"
              placeholder="Search subject / sender / case…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        {filteredLog.length === 0 ? (
          <EmptyState
            icon={<IInbox size={22} />}
            title={search ? "No emails match" : "No emails logged yet"}
            body={search ? "Try a different search." : "Inbound emails from banks and clients will appear here once the Outlook → Postmark → webhook pipeline is live."}
          />
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-280px)]">
            <table className="tbl min-w-[760px]">
              <thead>
                <tr>
                  <th>Subject</th><th>From</th><th>Direction</th><th>Case</th><th>Received</th>
                </tr>
              </thead>
              <tbody>
                {filteredLog.map((e) => {
                  const c = caseById(e.caseId);
                  const tone = e.direction === "from_bank" ? "amber" : e.direction === "from_client" ? "sky" : "slate";
                  return (
                    <tr key={e.id} onClick={() => c && nav({ name: "case", id: c.id })}>
                      <td className="max-w-[320px]">
                        <p className="font-medium text-[13px] m-0 leading-snug truncate">{e.subject}</p>
                        {e.outlookLink && (
                          <a href={e.outlookLink} target="_blank" rel="noreferrer" className="text-[10.5px] text-[var(--sky)] hover:underline" onClick={(ev) => ev.stopPropagation()}>
                            open in Outlook ↗
                          </a>
                        )}
                      </td>
                      <td className="mono text-[11.5px] text-[var(--ink-dim)]">{e.sender}</td>
                      <td><Chip tone={tone as "amber" | "sky" | "slate"}>{e.direction === "from_bank" ? "Bank" : e.direction === "from_client" ? "Client" : "Internal"}</Chip></td>
                      <td>
                        <span className="mono text-[12px]" style={{ color: "var(--amber)" }}>{c?.caseNumber ?? "—"}</span>
                        <span className="block text-[11px] text-[var(--ink-faint)]">{c?.customer ?? ""}</span>
                      </td>
                      <td className="mono text-[11.5px] text-[var(--ink-dim)] whitespace-nowrap">{fmtDateTime(e.receivedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pickTarget !== null && (
        <PickCaseModal
          unmatchedId={pickTarget}
          cases={cases.filter((c) => c.caseStatus === "Active")}
          onClose={() => setPickTarget(null)}
          onPick={(caseId) => { confirmLink(pickTarget, caseId); setPickTarget(null); }}
        />
      )}
    </div>
  );
}

function PickCaseModal({
  unmatchedId, cases, onClose, onPick,
}: {
  unmatchedId: number; cases: { id: number; caseNumber: string; customer: string; stage: string }[];
  onClose: () => void; onPick: (caseId: number) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return cases.slice(0, 40);
    return cases.filter((c) => c.customer.toLowerCase().includes(query) || c.caseNumber.toLowerCase().includes(query)).slice(0, 40);
  }, [q, cases]);
  return (
    <Modal title="Pick a case" sub={`Linking email #${unmatchedId}`} onClose={onClose} width={560}
      footer={<button className="btn btn-ghost" onClick={onClose}>Cancel</button>}>
      <input className="input mb-3" placeholder="Search customer or case number…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
        {filtered.length === 0 && <p className="text-[12.5px] text-[var(--ink-faint)] m-0 py-4 text-center">No matching cases.</p>}
        {filtered.map((c) => (
          <button
            key={c.id}
            className="rowlink w-full text-left flex items-center gap-3 rounded-lg px-3 py-2.5"
            onClick={() => onPick(c.id)}
            style={{ border: "1px solid var(--line-soft)" }}
          >
            <span className="mono text-[12px]" style={{ color: "var(--amber)" }}>{c.caseNumber}</span>
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] font-medium truncate">{c.customer}</span>
              <span className="block text-[11px] text-[var(--ink-faint)]">{c.stage}</span>
            </span>
            <ICheck size={14} className="text-[var(--mint)]" />
          </button>
        ))}
      </div>
    </Modal>
  );
}
