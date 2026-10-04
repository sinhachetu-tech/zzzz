"use client";

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useHfmcStore } from "@/lib/client-store";
import { useClientStore } from "./client-store";
import { fmtMoney, fmtDate, relTime, todayISO } from "@/lib/format";
import { LogoMark, ICheck, IWhatsapp, IDownload, IUpload, ILogout, IUsers, IHome, IMenu } from "@/components/icons";
import { ThemeToggle, Tabs, Modal } from "@/components/hfmc/ui";
import { parseCaseProfile, ageFromDob, type CaseProfile } from "@/lib/case-profile";
import { PersonDataSheet } from "@/components/person/PersonDataSheet";
import { seedPersonSheet } from "@/lib/person-sheet";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { PwaInstallBanner } from "@/components/pwa/PwaInstallBanner";

/* ============================================================
   Client portal — app shell. Tabs: Journey / Documents / My
   Details / More. Mobile: bottom tab bar. Desktop: top pills
   + wider canvas. One login shows every parallel bank journey.
   ============================================================ */

type Tab = "journey" | "docs" | "details" | "more";

const TABS: { id: Tab; label: string; Icon: (p: { size?: number }) => ReactElement }[] = [
  { id: "journey", label: "Journey", Icon: IHome },
  { id: "docs", label: "Docs", Icon: IDownload },
  { id: "details", label: "My Details", Icon: IUsers },
  { id: "more", label: "More", Icon: IMenu },
];

export function ClientDashboard() {
  const { me, engagements, case: c, stages, stageTransitions, documents, advisor, advisorWhatsapp, profile, profileClientVerifiedAt, logout, switchCase, hydrate, vaultDocuments } = useClientStore();
  const [tab, setTabRaw] = useState<Tab>("journey");

  // UNSAVED-CHANGES GUARD. The bank-application sheet holds a draft until Save is
  // pressed, so switching the bottom tab away — or reloading — would drop it. A
  // ref, because the guard only READS the flag at the moment of navigation.
  const sheetDirtyRef = useRef(false);
  const [pendingTab, setPendingTab] = useState<Tab | null>(null);

  const setTab = (t: Tab) => {
    if (sheetDirtyRef.current && t !== "details") { setPendingTab(t); return; }
    setTabRaw(t);
  };

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (!sheetDirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  const activeStages = useMemo(() => stages.filter((s) => s.active).sort((a, b) => a.sortOrder - b.sortOrder), [stages]);
  // Legacy labels (Bank Submission, Final Approval, …) resolve to the current
  // 5-stage journey via the registry map, so old cases keep progressing the bar.
  const currentIdx = activeStages.findIndex((s) => s.label === c?.stage);
  const folLabel = activeStages.find((s) => s.label === "FOL + Loan Booking")?.label ?? "FOL + Loan Booking";
  const showPreApproval = currentIdx >= activeStages.findIndex((s) => s.label === "Pre-Approval");
  const showFOL = currentIdx >= activeStages.findIndex((s) => s.label === folLabel);
  const progressPct = activeStages.length > 1 && currentIdx >= 0 ? Math.round((currentIdx / (activeStages.length - 1)) * 100) : 0;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  if (!c) return null;

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <div className="app-bg" />
      <style>{`@keyframes cpulse { 0%,100%{box-shadow:0 0 0 0 rgba(242,176,76,0.5)} 50%{box-shadow:0 0 0 8px rgba(242,176,76,0)} }`}</style>

      {/* top bar */}
      <header className="sticky top-0 z-40 border-b" style={{ borderColor: "var(--line-soft)", background: "color-mix(in srgb, var(--bg) 92%, transparent)", backdropFilter: "blur(8px)" }}>
        <div className="max-w-[860px] mx-auto px-4 py-2.5 flex items-center gap-2.5">
          <LogoMark size={26} />
          <div className="flex-1">
            <div className="font-disp font-bold text-[13px] leading-none">HFMC</div>
            <div className="text-[8px] uppercase tracking-[0.16em] text-[var(--ink-faint)] mt-0.5">Client Portal</div>
          </div>
          <span className="mono text-[11px] text-[var(--ink-faint)] hidden sm:inline">{c.caseNumber}</span>
          <ThemeToggle compact />
          <button className="text-[var(--ink-faint)] hover:text-[var(--coral)] transition-colors" onClick={logout} title="Sign out">
            <ILogout size={16} />
          </button>
        </div>
        {/* desktop pills */}
        <div className="hidden md:flex max-w-[860px] mx-auto px-4 pb-2.5">
          <Tabs
            scroll
            value={tab}
            onChange={setTab}
            options={TABS.map(({ id, label, Icon }) => ({
              value: id, label, icon: <Icon size={14} />,
            }))}
          />
        </div>
      </header>

      {/* Unsaved-changes guard: a hard block, never a silent auto-save. */}
      {pendingTab && (
        <Modal title="Save before you leave?" onClose={() => setPendingTab(null)} width={420}>
          <p className="text-[12.5px] text-[var(--ink-dim)] m-0 mb-3">
            You have unsaved changes on your bank application details. Leaving now will <strong>discard them</strong>.
          </p>
          <div className="flex gap-2 justify-end">
            <button className="btn btn-ghost" onClick={() => setPendingTab(null)}>Go back and save</button>
            <button
              className="btn btn-primary"
              onClick={() => {
                const t = pendingTab;
                setPendingTab(null);
                sheetDirtyRef.current = false;
                setTabRaw(t);
              }}
            >
              Discard and leave
            </button>
          </div>
        </Modal>
      )}

      <main className="max-w-[860px] mx-auto px-4 py-5 space-y-4 pb-28 md:pb-10">
        {tab === "journey" && (
          <JourneyTab
            c={c} greeting={greeting} progressPct={progressPct}
            engagements={engagements} switchCase={switchCase} advisor={advisor} advisorWhatsapp={advisorWhatsapp}
            activeStages={activeStages} currentIdx={currentIdx}
            showPreApproval={showPreApproval} showFOL={showFOL}
            stageTransitions={stageTransitions} verified={profileClientVerifiedAt}
          />
        )}

        {tab === "docs" && (
          <DocUploadCards caseId={c.id} vaultDocuments={vaultDocuments} legacyDocuments={documents} />
        )}

        {tab === "details" && (
          <DetailsTab
            caseId={c.id} caseNumber={c.caseNumber}
            profile={profile} verified={profileClientVerifiedAt} hydrate={hydrate} sheetDirtyRef={sheetDirtyRef}
          />
        )}

        {tab === "more" && (
          <MoreTab c={c} advisor={advisor} me={me} logout={logout} verified={profileClientVerifiedAt} />
        )}
      </main>

      {/* mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex border-t"
        style={{ borderColor: "var(--line-soft)", background: "color-mix(in srgb, var(--bg) 94%, transparent)", backdropFilter: "blur(10px)" }}>
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className="flex-1 flex flex-col items-center gap-0.5 py-2.5"
            style={{ color: tab === id ? "var(--amber)" : "var(--ink-faint)" }}>
            <Icon size={19} />
            <span className="text-[10.5px] font-disp font-semibold leading-tight">{label.split(" ")[0]}</span>
          </button>
        ))}
      </nav>

      {/* Floating live chat with mortgage team */}
      <ChatBubble
        userRole="CLIENT"
        pinnedCaseId={c.id}
        pinnedCaseNumber={c.caseNumber}
        pinnedCustomer={c.customer}
      />
      <PwaInstallBanner portal="client" />
    </div>
  );
}

/* ================= JOURNEY tab ================= */

function JourneyTab({ c, greeting, progressPct, engagements, switchCase, advisor, advisorWhatsapp, activeStages, currentIdx, showPreApproval, showFOL, stageTransitions, verified }: {
  c: NonNullable<ReturnType<typeof useClientStore.getState>["case"]>;
  greeting: string; progressPct: number;
  engagements: { id: number; caseNumber: string; banks: string[]; stage: string; caseStatus: string; loanAmount: number; wonBank: string | null; serviceLine: string | null; serviceLineId: number | null; legStatus: string }[];
  switchCase: (id: number) => Promise<void>;
  advisor: { name: string; role: string } | null;
  advisorWhatsapp: string | null;
  activeStages: { id: number; label: string; sortOrder: number; active: boolean }[];
  currentIdx: number;
  showPreApproval: boolean; showFOL: boolean;
  stageTransitions: { id: number; fromStage: string; toStage: string; comment: string; userName: string; at: string }[];
  verified: string | null;
}) {
  // Milestone = the newest stage transition, and only when it's genuinely
  // recent (48h). Older than that it isn't news, so the banner stays out of
  // the way instead of shouting about something from last week.
  const latestMilestone = useMemo(() => {
    if (stageTransitions.length === 0) return null;
    const t = [...stageTransitions].sort((a, b) => b.at.localeCompare(a.at))[0];
    if (!t?.toStage) return null;
    const age = Date.now() - new Date(t.at).getTime();
    if (!Number.isFinite(age) || age < 0 || age > 48 * 3600 * 1000) return null;
    return t;
  }, [stageTransitions]);

  return (
    <>
      {/* hero */}
      <div className="anim-fade-up rounded-2xl p-5 relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--amber) 16%, var(--raised)), var(--raised))", border: "1px solid color-mix(in srgb, var(--amber) 35%, var(--line))" }}>
        <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full" style={{ background: "radial-gradient(circle, rgba(242,176,76,0.14), transparent 70%)" }} />
        <p className="text-[12px] text-[var(--ink-dim)] m-0">{greeting},</p>
        <h1 className="font-disp font-bold text-[24px] tracking-tight m-0 mt-0.5">{c.customer}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[12px]">
          <span className="mono" style={{ color: "var(--amber)" }}>{fmtMoney(c.loanAmount)}</span>
          <span className="text-[var(--ink-faint)]">{c.transactionType || "Mortgage"} · {c.propertyLocation || "UAE"}</span>
          {c.onHold && <span className="chip !py-0.5" style={{ background: "rgba(242,176,76,0.14)", borderColor: "var(--amber)", color: "var(--amber)" }}>ON HOLD</span>}
          {verified && <span className="chip !py-0.5" style={{ background: "rgba(67,214,155,0.12)", borderColor: "var(--mint)", color: "var(--mint)" }}>DATA VERIFIED ✓</span>}
        </div>
        <div className="mt-4">
          <div className="flex justify-between text-[10.5px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)] mb-1">
            <span>{currentIdx >= 0 ? activeStages[currentIdx]?.label : "Starting"}</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--track)" }}>
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(4, progressPct)}%`, background: "linear-gradient(90deg, var(--amber), #f2b04c)" }} />
          </div>
        </div>
      </div>

      {/* Milestone acknowledgement (#6) — a quiet, one-shot nod to the newest
          meaningful stage. Deliberately NOT confetti: this is a regulated
          broker's client portal and the house reserves that for a real deal
          close in the calculator. Soft glow + seal, and it never replays as a
          nag because it's derived from the latest transition, not a flag. */}
      {latestMilestone && (
        <div className="card anim-fade-up p-4 rounded-2xl milestone">
          <div className="flex items-center gap-3">
            <span className="milestone-seal w-9 h-9 rounded-full flex items-center justify-center shrink-0"
              style={{ background: "rgba(67,214,155,0.14)", color: "var(--mint)" }}>
              <ICheck size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[10.5px] uppercase tracking-[0.1em] font-disp font-semibold" style={{ color: "var(--mint)" }}>
                Milestone reached
              </div>
              <div className="text-[14px] font-medium leading-tight">{latestMilestone.toStage}</div>
            </div>
          </div>
        </div>
      )}

      {/* Your journeys with us — across EVERY service line, not just banks (Phase 3).
          The old heading said "N banks in parallel", which was true when a
          mortgage was the only thing we sold. It is wrong now: several of these may
          be one mortgage shopped to several banks, and the rest are different
          products entirely. A leg beaten by another bank is shown dimmed and
          marked "lost race" — still reachable, because the client may be looking
          for that bank's valuation later. */}
      {engagements.length > 1 && (
        <div className="anim-fade-up">
          <div className="text-[10.5px] uppercase tracking-[0.12em] font-disp font-semibold text-[var(--ink-faint)] mb-2">
            Your journeys with us · {engagements.length} in progress
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1.5">
            {engagements.map((e) => {
              const on = e.id === c.id;
              const beaten = e.legStatus === "LostRace" || e.legStatus === "Declined" || e.legStatus === "Withdrawn";
              // Service line leads when the firm sells more than one thing; the
              // bank is the sub-label. A golden-visa journey has no bank at all,
              // so showing "Bank TBC" for it would be actively misleading.
              const title = e.serviceLine ?? (e.banks?.length ? e.banks.join(" + ") : null);
              return (
                <button key={e.id}
                  onClick={() => switchCase(e.id)}
                  className="shrink-0 rounded-xl px-3.5 py-2.5 text-left transition-all"
                  style={{
                    ...(on
                      ? { background: "linear-gradient(135deg, color-mix(in srgb, var(--amber) 18%, var(--raised)), var(--raised))", border: "1.5px solid var(--amber)", boxShadow: "0 4px 14px -6px rgba(242,176,76,0.4)" }
                      : { background: "var(--raised)", border: "1px solid var(--line)" }),
                    // A beaten leg stays clickable — history matters — but never
                    // reads as something still happening.
                    opacity: beaten && !on ? 0.55 : 1,
                  }}>
                  <div className="font-disp text-[12.5px] font-semibold" style={{ color: on ? "var(--amber)" : "var(--ink-dim)" }}>
                    {title ?? "Service TBC"}
                  </div>
                  {e.serviceLine && e.banks?.length > 0 && (
                    <div className="text-[10.5px] text-[var(--ink-faint)]">{e.banks.join(" + ")}</div>
                  )}
                  <div className="text-[10.5px] text-[var(--ink-faint)] mono">{e.caseNumber}</div>
                  <div className="text-[10.5px] mt-0.5 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: e.caseStatus === "Active" ? "var(--mint)" : "var(--ink-faint)" }} />
                    <span style={{ color: on ? "var(--ink-dim)" : "var(--ink-faint)" }}>
                      {e.legStatus === "LostRace" ? "Lost race — another bank won" : e.stage}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* advisor */}
      {advisor && (
        <div className="card anim-fade-up p-4 flex items-center gap-3.5 rounded-2xl" style={{ borderColor: "color-mix(in srgb, var(--mint) 30%, var(--line))" }}>
          <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 font-disp font-bold text-[14px]"
            style={{ background: "linear-gradient(135deg, var(--mint), #2aa77a)", color: "#06251a" }}>
            {advisor.name.split(" ").map((w: string) => w[0]).slice(0, 2).join("")}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10.5px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)]">Your dedicated advisor</div>
            <div className="text-[14.5px] font-medium leading-tight">{advisor.name}</div>
            <div className="text-[11px] text-[var(--ink-faint)]">{advisor.role} · replies within hours</div>
          </div>
          {(advisorWhatsapp || c.whatsapp) && (
            <a className="btn btn-mint btn-sm shrink-0"
              href={`https://wa.me/${(advisorWhatsapp || c.whatsapp).replace(/\D/g, "")}?text=${encodeURIComponent(`Hello, I have a question about my case ${c.caseNumber}.`)}`}
              target="_blank" rel="noreferrer">
              <IWhatsapp size={14} /> Ask
            </a>
          )}
        </div>
      )}

      {/* latest update */}
      {c.statusNote && (
        <div className="card anim-fade-up p-4 rounded-2xl" style={{ borderLeft: "3px solid var(--amber)" }}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--amber)", animation: "cpulse 2s infinite" }} />
            <h3 className="font-disp font-semibold text-[11px] uppercase tracking-[0.1em] m-0" style={{ color: "var(--amber)" }}>Latest update from your advisor</h3>
          </div>
          <p className="text-[13.5px] text-[var(--ink-dim)] m-0 leading-relaxed whitespace-pre-wrap">{c.statusNote}</p>
        </div>
      )}

      {c.onHold && c.holdReason && (
        <div className="card anim-fade-up p-4 rounded-2xl" style={{ borderLeft: "3px solid var(--coral)" }}>
          <h3 className="font-disp font-semibold text-[12.5px] m-0 mb-1" style={{ color: "var(--coral)" }}>ON HOLD</h3>
          <p className="text-[13px] text-[var(--ink-dim)] m-0">{c.holdReason}</p>
          {c.holdUntil && <p className="text-[11px] text-[var(--ink-faint)] m-0 mt-1">Expected to resume: {fmtDate(c.holdUntil)}</p>}
        </div>
      )}

      {/* journey tracker */}
      <div className="card anim-fade-up p-5 rounded-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-disp font-semibold text-[13px] m-0">Your journey to keys in hand</h3>
          <span className="mono text-[10.5px] text-[var(--ink-faint)]">step {Math.min(currentIdx + 1, activeStages.length)} of {activeStages.length}</span>
        </div>
        <div className="relative pl-1">
          {activeStages.map((s, i) => {
            const done = i < currentIdx;
            const current = i === currentIdx;
            return (
              <div key={s.id} className="flex items-stretch gap-3.5 relative">
                <div className="flex flex-col items-center shrink-0">
                  <span className="w-8 h-8 rounded-full flex items-center justify-center z-10 transition-all"
                    style={current ? { background: "var(--amber)", color: "#fff", animation: "cpulse 2s infinite" }
                      : { background: done ? "var(--mint)" : "var(--track)", color: done ? "#fff" : "var(--ink-faint)" }}>
                    {done ? <ICheck size={14} /> : <span className="mono text-[11px] font-semibold">{i + 1}</span>}
                  </span>
                  {i < activeStages.length - 1 && (
                    <div className="w-[2.5px] flex-1 my-1 rounded-full" style={{ minHeight: 26, background: done ? "var(--mint)" : "var(--line)" }} />
                  )}
                </div>
                <div className={"pb-5 pt-1 " + (i === activeStages.length - 1 ? "pb-0" : "")}>
                  <div className="text-[13.5px] font-disp" style={{ color: current ? "var(--ink)" : done ? "var(--ink-dim)" : "var(--ink-faint)", fontWeight: current ? 600 : 400 }}>
                    {s.label}
                  </div>
                  {current && <div className="text-[11px] mt-0.5" style={{ color: "var(--amber)" }}>{c.statusNote ? "in progress now" : "we are on this step"}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showPreApproval && (c.preApprovalAmount || c.preApprovalDate) && (
        <div className="card anim-fade-up p-4 rounded-2xl">
          <h3 className="font-disp font-semibold text-[13px] m-0 mb-3">Pre-approval</h3>
          <div className="grid grid-cols-2 gap-3">
            {c.preApprovalDate && <Field label="Date" value={fmtDate(c.preApprovalDate)} />}
            {c.preApprovalAmount != null && <Field label="Approved amount" value={fmtMoney(c.preApprovalAmount)} highlight />}
            {c.preApprovalTenure != null && <Field label="Tenure" value={`${c.preApprovalTenure} months`} />}
            {c.preApprovalRoi != null && <Field label="Rate of interest" value={`${c.preApprovalRoi}%`} />}
          </div>
        </div>
      )}

      {showFOL && (c.folAmount || c.folDate) && (
        <div className="card anim-fade-up p-4 rounded-2xl" style={{ borderColor: "var(--mint)" }}>
          <h3 className="font-disp font-semibold text-[13px] m-0 mb-3">Final offer letter</h3>
          <div className="grid grid-cols-2 gap-3">
            {c.folDate && <Field label="Date" value={fmtDate(c.folDate)} />}
            {c.folAmount != null && <Field label="Loan amount" value={fmtMoney(c.folAmount)} highlight />}
            {c.folTenure != null && <Field label="Tenure" value={`${c.folTenure} months`} />}
            {c.folRoi != null && <Field label="Rate of interest" value={`${c.folRoi}%`} />}
          </div>
        </div>
      )}

      {stageTransitions.length > 0 && (
        <div className="card anim-fade-up p-4 rounded-2xl">
          <h3 className="font-disp font-semibold text-[13px] m-0 mb-3">Journey log</h3>
          <div className="space-y-3">
            {stageTransitions.slice(0, 10).map((t) => (
              <div key={t.id} className="flex items-start gap-3">
                <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: "var(--amber)" }} />
                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] m-0 leading-snug"><strong className="font-medium">{t.fromStage} → {t.toStage}</strong></p>
                  {t.comment && <p className="text-[11.5px] text-[var(--ink-dim)] m-0 mt-0.5">{t.comment}</p>}
                  <p className="text-[10.5px] text-[var(--ink-faint)] m-0 mt-0.5">{relTime(t.at)} · by {t.userName}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[10.5px] text-[var(--ink-faint)] text-center m-0">
        HFMC Mortgage · UAE · Live status — for urgent matters, message your advisor above.
      </p>
    </>
  );
}

/* ================= MY DETAILS tab ================= */

function DetailsTab({ caseId, caseNumber, profile, verified, hydrate, sheetDirtyRef }: {
  caseId: number; caseNumber: string;
  profile: unknown; verified: string | null; hydrate: (caseId?: number) => Promise<void>;
  /** Shared with the parent so a tab switch can be blocked while dirty. */
  sheetDirtyRef: React.MutableRefObject<boolean>;
}) {
  const prof: CaseProfile | null = profile ? (() => { try { return parseCaseProfile(JSON.stringify(profile)); } catch { return null; } })() : null;
  const p0 = prof?.primary;
  const [form, setForm] = useState(() => ({
    fullName: p0?.fullName ?? "",
    dob: p0?.dob ?? "",
    eidNo: p0?.eidNo ?? "",
    passportNo: p0?.passportNo ?? "",
    nationality: p0?.nationality ?? "",
    residency: (p0?.residency ?? "Resident Expatriate") as CaseProfile["primary"]["residency"],
    phone: p0?.phone ?? "",
    email: p0?.email ?? "",
    emirate: p0?.emirate ?? "Dubai",
    employmentProfile: (p0?.employmentProfile ?? "Salaried") as CaseProfile["primary"]["employmentProfile"],
    companyName: p0?.companyName ?? "",
    monthlySalary: p0?.monthlySalary ?? 0,
    variableIncome: p0?.variableIncome ?? 0,
    rentalIncome: p0?.rentalIncome ?? 0,
    existingEmis: p0?.existingEmis ?? 0,
    creditCardLimits: p0?.creditCardLimits ?? 0,
  }));
  const [saving, setSaving] = useState(false);
  const { toast } = useHfmcStore();

  // The bank application answer sheet. Seeded from whatever is already on file,
  // so the client confirms rather than re-types. Saved on every change — and
  // because the sheet renders ANSWERED fields read-only, an edit only fires on a
  // deliberate change to an empty box, not per keystroke.
  const [sheet, setSheet] = useState<Record<string, unknown>>({});
  const [savingSheet, setSavingSheet] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/client/person", { cache: "no-store" });
        if (!res.ok) return;
        const j = await res.json();
        if (!cancelled && j && j.personData) {
          // Seed from the typed profile columns too, so the client sees their OWN
          // name, Emirates ID and salary already filled in rather than re-typing
          // facts the file has held for months.
          const pk = p0 as unknown as Record<string, unknown>;
          setSheet(
            seedPersonSheet(j.personData as Record<string, unknown>, {
              fullName: p0?.fullName,
              firstName: pk.firstName as string,
              middleName: pk.middleName as string,
              lastName: pk.lastName as string,
              eidNo: p0?.eidNo,
              passportNo: p0?.passportNo,
              dob: p0?.dob,
              nationality: p0?.nationality,
              phone: p0?.phone,
              email: p0?.email,
              employmentProfile: p0?.employmentProfile,
              companyName: p0?.companyName,
              monthlySalary: p0?.monthlySalary,
              variableIncome: p0?.variableIncome,
              rentalIncome: p0?.rentalIncome,
              existingEmis: p0?.existingEmis,
              creditCardLimits: p0?.creditCardLimits,
            }),
          );
        }
      } catch { /* unauthenticated or offline — the sheet just starts empty */ }
    })();
    return () => { cancelled = true; };
  }, [caseId]);

  const saveSheet = async (next: Record<string, unknown>) => {
    setSavingSheet(true);
    try {
      const res = await fetch("/api/client/person", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        // Send only this sheet's own keys, so the client's edit can never write
        // something they were not shown.
        body: JSON.stringify({ personData: next }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Save failed");
      const j = await res.json().catch(() => null);
      // Adopt the SAVED value as the new baseline. Without this the sheet keeps
      // diffing its draft against the pre-save prop forever, so "Unsaved
      // changes" would stay lit and the leave-prompt would keep firing AFTER a
      // successful save. The staff side gets this for free because its save
      // triggers a store hydrate; the portal writes straight to the API, so it
      // has to refresh its own baseline.
      setSheet((j && j.personData ? j.personData : next) as Record<string, unknown>);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not save that section.");
    }
    setSavingSheet(false);
  };

  const up = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    if (!form.fullName.trim()) { toast("error", "Full name is required."); return; }
    setSaving(true);
    try {
      const next: Record<string, unknown> = { ...(prof as unknown as Record<string, unknown> ?? {}) };
      next.primary = {
        ...(prof?.primary ?? {}),
        ...form,
        age: form.dob ? ageFromDob(form.dob) : undefined,
      };
      const res = await fetch("/api/client/profile", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileJson: JSON.stringify(next) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Save failed");
      toast("success", "Details saved — your advisor has been updated. Thank you!");
      await hydrate(caseId);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Save failed");
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <div className="card p-4 rounded-2xl anim-fade-up">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h3 className="font-disp font-semibold text-[14px] m-0">My details</h3>
            <p className="text-[11.5px] text-[var(--ink-faint)] m-0 mt-0.5">
              Keep this sheet current — your advisor uses it to prepare bank applications for {caseNumber}.
            </p>
          </div>
          {verified && (
            <span className="chip !py-0.5" style={{ background: "rgba(67,214,155,0.12)", borderColor: "var(--mint)", color: "var(--mint)" }}>
              verified {fmtDate(verified)}
            </span>
          )}
        </div>
      </div>

      <SectionCard title="Identity">
        <Grid>
          <F label="Full name" v={form.fullName} on={(v) => up({ fullName: v })} />
          <F label="Date of birth" type="date" v={form.dob} on={(v) => up({ dob: v })} />
          <F label="Emirates ID no." v={form.eidNo} on={(v) => up({ eidNo: v })} ph="784-…" />
          <F label="Passport no." v={form.passportNo} on={(v) => up({ passportNo: v })} />
          <F label="Nationality" v={form.nationality} on={(v) => up({ nationality: v })} ph="e.g. Indian" />
          <Sel label="Residency" v={form.residency} on={(v) => up({ residency: v as CaseProfile["primary"]["residency"] })}
            opts={["UAE National", "Resident Expatriate", "Non-Resident"]} />
        </Grid>
      </SectionCard>

      <SectionCard title="Contact">
        <Grid>
          <F label="Mobile / WhatsApp" v={form.phone} on={(v) => up({ phone: v })} ph="+971 50 …" />
          <F label="Email" v={form.email ?? ""} on={(v) => up({ email: v })} ph="you@email.com" />
          <Sel label="Emirate" v={form.emirate} on={(v) => up({ emirate: v })}
            opts={["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "RAK", "Fujairah", "UAQ"]} />
        </Grid>
      </SectionCard>

      <SectionCard title="Employment & income">
        <Grid>
          <Sel label="Employment" v={form.employmentProfile} on={(v) => up({ employmentProfile: v as CaseProfile["primary"]["employmentProfile"] })}
            opts={["Salaried", "Self-Employed"]} />
          <F label="Company / employer" v={form.companyName ?? ""} on={(v) => up({ companyName: v })} ph="e.g. Emirates NBD" />
          <F label="Monthly salary (AED)" type="number" v={String(form.monthlySalary || "")} on={(v) => up({ monthlySalary: Number(v) || 0 })} />
          <F label="Bonus / variable (AED/mo)" type="number" v={String(form.variableIncome || "")} on={(v) => up({ variableIncome: Number(v) || 0 })} />
          <F label="Rental income (AED/mo)" type="number" v={String(form.rentalIncome || "")} on={(v) => up({ rentalIncome: Number(v) || 0 })} />
        </Grid>
      </SectionCard>

      <SectionCard title="Existing liabilities">
        <Grid>
          <F label="Loan EMIs (AED/mo)" type="number" v={String(form.existingEmis || "")} on={(v) => up({ existingEmis: Number(v) || 0 })} />
          <F label="Credit-card limits total (AED)" type="number" v={String(form.creditCardLimits || "")} on={(v) => up({ creditCardLimits: Number(v) || 0 })} />
        </Grid>
      </SectionCard>

      <button className="btn btn-primary w-full justify-center" onClick={save} disabled={saving}>
        <ICheck size={15} /> {saving ? "Saving…" : verified ? "Update & re-verify my details" : "Save & verify my details"}
      </button>
      <p className="text-[10.5px] text-[var(--ink-faint)] text-center m-0 -mt-2">
        Saved straight to case file {caseNumber} — your advisor is notified automatically.
      </p>

      {/* THE BANK APPLICATION DATA SHEET. This is the part only the CLIENT can
          complete — mother's maiden name, home-country address, a reference's
          mobile number — and it is why staff "Request N from client" instead of
          keying it in. It saves to the PERSON, not to this case, so it carries
          over to the next application instead of being asked again. */}
      <div className="mt-5 pt-4" style={{ borderTop: "1px dashed var(--line)" }}>
        <div className="mb-2.5">
          <h3 className="font-disp font-semibold text-[14px] m-0">Bank application details</h3>
          <p className="text-[11.5px] text-[var(--ink-faint)] m-0 mt-0.5">
            Fill this once and it is used on every bank form, every time — you will never be asked for it again.
          </p>
        </div>
        <PersonDataSheet
          data={sheet}
          selfEmployed={sheet.employmentType === "Self-Employed"}
          onChange={saveSheet}
          onDirtyChange={(d) => { sheetDirtyRef.current = d; }}
          // Lock the fields while the save is in flight, so a double-tap cannot
          // fire two writes.
          readOnly={savingSheet}
        />
        {/* No "Saved ✓" line here on purpose: the sheet's own sticky bar is the
            single source of truth for save state, and two indicators disagreeing
            about the same state is how a user ends up trusting neither. */}
      </div>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4 rounded-2xl anim-fade-up">
      <h4 className="text-[10.5px] uppercase tracking-[0.12em] font-disp font-semibold text-[var(--ink-faint)] m-0 mb-2.5">{title}</h4>
      {children}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>;
}

function F({ label, v, on, type = "text", ph }: { label: string; v: string; on: (v: string) => void; type?: string; ph?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" type={type} value={v} placeholder={ph} onChange={(e) => on(e.target.value)} />
    </div>
  );
}

function Sel({ label, v, on, opts }: { label: string; v: string; on: (v: string) => void; opts: string[] }) {
  return (
    <div>
      <label className="label">{label}</label>
      <select className="select" value={v} onChange={(e) => on(e.target.value)}>
        {opts.map((o) => <option key={o}>{o}</option>)}
      </select>
    </div>
  );
}

/* ================= MORE tab ================= */

function MoreTab({ c, advisor, me, logout, verified }: {
  c: NonNullable<ReturnType<typeof useClientStore.getState>["case"]>;
  advisor: { name: string; role: string } | null;
  me: { caseId: number; phone: string; caseNumber: string; customer: string } | null;
  logout: () => Promise<void>;
  verified: string | null;
}) {
  const services = [
    { icon: "🏠", name: "Mortgage", desc: "Active — this journey", live: true },
    { icon: "📜", name: "Wills", desc: "Coming soon", live: false },
    { icon: "🛡", name: "Insurance", desc: "Coming soon", live: false },
    { icon: "🏙", name: "Property management", desc: "Coming soon", live: false },
  ];
  return (
    <div className="space-y-4">
      <div className="card p-4 rounded-2xl anim-fade-up">
        <h3 className="font-disp font-semibold text-[14px] m-0 mb-3">Account</h3>
        <div className="space-y-2 text-[13px]">
          <div className="flex justify-between"><span className="text-[var(--ink-faint)]">Name</span><span className="font-medium">{c.customer}</span></div>
          <div className="flex justify-between"><span className="text-[var(--ink-faint)]">Case number</span><span className="mono">{c.caseNumber}</span></div>
          <div className="flex justify-between"><span className="text-[var(--ink-faint)]">Mobile on file</span><span className="mono">{c.whatsapp || me?.phone || "—"}</span></div>
          {advisor && <div className="flex justify-between"><span className="text-[var(--ink-faint)]">Advisor</span><span className="font-medium">{advisor.name}</span></div>}
          {verified && <div className="flex justify-between"><span className="text-[var(--ink-faint)]">Details verified</span><span style={{ color: "var(--mint)" }}>{fmtDate(verified)}</span></div>}
        </div>
      </div>

      <div className="card p-4 rounded-2xl anim-fade-up">
        <h3 className="font-disp font-semibold text-[14px] m-0 mb-1">HFMC services</h3>
        <p className="text-[11.5px] text-[var(--ink-faint)] m-0 mb-3">One relationship — every service you need.</p>
        <div className="space-y-2">
          {services.map((s) => (
            <div key={s.name} className="flex items-center gap-3 rounded-xl px-3.5 py-3" style={{ background: "var(--tint)", border: "1px solid var(--line-soft)" }}>
              <span className="text-[20px]">{s.icon}</span>
              <div className="flex-1">
                <div className="text-[13px] font-medium">{s.name}</div>
                <div className="text-[11px] text-[var(--ink-faint)]">{s.desc}</div>
              </div>
              {!s.live && <span className="chip !py-0.5 text-[10.5px]" style={{ background: "var(--bg2)", color: "var(--ink-faint)" }}>notify me</span>}
            </div>
          ))}
        </div>
      </div>

      <button className="btn btn-ghost w-full justify-center" style={{ color: "var(--coral)" }} onClick={logout}>
        <ILogout size={15} /> Sign out
      </button>
      <p className="text-[10.5px] text-[var(--ink-faint)] text-center m-0">HFMC Mortgage · UAE · {todayISO()}</p>
    </div>
  );
}

function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)]">{label}</div>
      <div className="mono text-[14px] mt-0.5" style={{ color: highlight ? "var(--mint)" : "var(--ink)", fontWeight: highlight ? 700 : 500 }}>{value}</div>
    </div>
  );
}

/* Document upload cards — client-visible vault items with drag-free upload,
   live status, and clear rejection feedback for re-upload. */

type VaultDoc = {
  id: number; title: string; category: string; status: string;
  clientCanUpload: boolean; rejectionReason: string; notes: string;
  fileName: string | null; fileSize: number | null; uploadedAt: string | null;
};

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  "Verified": { bg: "rgba(67,214,155,0.12)", color: "var(--mint)" },
  "Uploaded": { bg: "rgba(87,194,234,0.14)", color: "var(--sky)" },
  "Rejected": { bg: "rgba(242,115,99,0.12)", color: "var(--coral)" },
  "Waived": { bg: "rgba(140,166,176,0.14)", color: "var(--ink-faint)" },
  "Pending upload": { bg: "rgba(242,176,76,0.14)", color: "var(--amber)" },
};

function DocUploadCards({ caseId, vaultDocuments, legacyDocuments }: {
  caseId: number;
  vaultDocuments: VaultDoc[];
  legacyDocuments: { id: number; fileName: string; fileSize: number; uploadedAt: string }[];
}) {
  const [uploading, setUploading] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [justDone, setJustDone] = useState<number | null>(null);

  const upload = async (docId: number, file: File) => {
    setUploading(docId); setErr(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`/api/documents/${docId}/upload`, { method: "POST", body: fd });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setErr(e.error || "Upload failed — try again.");
      } else {
        setJustDone(docId);
        setTimeout(() => setJustDone(null), 2500);
        setTimeout(() => window.location.reload(), 800);
      }
    } catch {
      setErr("Network error — try again.");
    }
    setUploading(null);
  };

  const pending = vaultDocuments.filter((d) => d.status !== "Verified" && d.status !== "Waived");
  const done = vaultDocuments.filter((d) => d.status === "Verified" || d.status === "Waived");

  // A "blocking" doc is one only the client can clear: rejected (needs a
  // re-upload). Those are pulled to the top and outrank the rest, because
  // everything downstream is stalled behind them.
  const blocking = pending.filter((d) => d.status === "Rejected");
  const waitingOnBank = pending.filter((d) => d.status === "Uploaded");
  const toUpload = pending.filter((d) => d.status !== "Rejected" && d.status !== "Uploaded");
  const total = vaultDocuments.length;
  const pct = total > 0 ? Math.round((done.length / total) * 100) : 0;
  const allClear = total > 0 && done.length === total;

  return (
    <div className="card p-4 anim-fade-up rounded-2xl">
      <div className="flex items-center gap-2 mb-1.5">
        <h3 className="font-disp font-semibold text-[13px] m-0 flex-1">Your documents</h3>
        <span className="mono text-[11px]" style={{ color: allClear ? "var(--mint)" : "var(--amber)" }}>
          {done.length}/{total} done
        </span>
      </div>

      {/* progress bar — a bare "4/7" doesn't convey "nearly there" the way a
          filling bar does, and this is the client's measure of their own effort */}
      {total > 0 && (
        <div className="h-1.5 rounded-full overflow-hidden mb-3" style={{ background: "var(--track)" }}
          role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Documents received">
          <div className="h-full rounded-full transition-all duration-700"
            style={{ width: `${Math.max(2, pct)}%`, background: allClear ? "var(--mint)" : "linear-gradient(90deg, var(--amber), #f2b04c)" }} />
        </div>
      )}

      <p className="text-[11.5px] text-[var(--ink-faint)] m-0 mb-3">
        Upload clear photos or PDFs straight from your phone — your advisor reviews each one.
      </p>
      {err && <p className="text-[12px] m-0 mb-2.5" style={{ color: "var(--coral)" }}>{err}</p>}

      {/* BLOCKING — only the client can clear these, and they stall everything
          after them, so they get their own labelled group at the top. */}
      {blocking.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--coral)" }} />
            <span className="text-[10.5px] uppercase tracking-[0.1em] font-disp font-semibold" style={{ color: "var(--coral)" }}>
              Holding up your case
            </span>
          </div>
          <div className="space-y-2">
            {blocking.map((d) => (
              <div key={d.id} className="rounded-lg px-3 py-2.5" style={{ background: "rgba(242,115,99,0.06)", border: "1px solid rgba(242,115,99,0.3)" }}>
                <div className="flex items-center gap-2">
                  <span className="text-[12.5px] font-medium flex-1">{d.title}</span>
                  <span className="mono text-[10.5px] px-1.5 py-0.5 rounded" style={STATUS_STYLE[d.status]}>{d.status}</span>
                </div>
                {d.rejectionReason && (
                  <p className="text-[11.5px] m-0 mt-1 leading-snug" style={{ color: "var(--coral)" }}>
                    Needs attention: {d.rejectionReason}
                  </p>
                )}
                {d.clientCanUpload && (
                  <label className="btn btn-sm w-full justify-center mt-2" style={{ background: "var(--coral)", color: "#fff", cursor: uploading === d.id ? "wait" : "pointer" }}>
                    <IUpload size={13} /> {uploading === d.id ? "Uploading…" : "Upload again"}
                    <input type="file" accept="image/*,application/pdf" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(d.id, f); }} />
                  </label>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* WITH THE BANK — moving, nothing needed from the client */}
      {waitingOnBank.length > 0 && (
        <div className="mb-3">
          <div className="text-[10.5px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)] mb-1.5">
            With the bank — nothing needed from you
          </div>
          <div className="space-y-1.5">
            {waitingOnBank.map((d) => (
              <div key={d.id} className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "var(--tint)", border: "1px solid var(--line-soft)" }}>
                <span className="text-[12.5px] flex-1 truncate">{d.title}</span>
                {d.fileName && <a href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer" className="text-[10.5px] mono" style={{ color: "var(--sky)" }}>view ↗</a>}
                <span className="mono text-[10.5px] px-1.5 py-0.5 rounded" style={STATUS_STYLE[d.status]}>{d.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* STILL TO UPLOAD */}
      {toUpload.length > 0 && (
        <div className="mb-3">
          <div className="text-[10.5px] uppercase tracking-[0.1em] font-disp font-semibold text-[var(--ink-faint)] mb-1.5">
            Still to upload
          </div>
          <div className="space-y-2">
            {toUpload.map((d) => (
              <div key={d.id} className="rounded-lg px-3 py-2.5" style={{ background: "var(--tint)", border: "1px solid var(--line-soft)" }}>
                <div className="flex items-center gap-2">
                  <span className="text-[12.5px] font-medium flex-1">{d.title}</span>
                  <span className="mono text-[10.5px] px-1.5 py-0.5 rounded" style={STATUS_STYLE[d.status] ?? STATUS_STYLE["Pending upload"]}>{d.status}</span>
                </div>
                {d.notes && <p className="text-[11px] text-[var(--ink-dim)] m-0 mt-1">{d.notes}</p>}
                {d.clientCanUpload && (
                  <label className="btn btn-ghost btn-sm w-full justify-center mt-2" style={{ cursor: uploading === d.id ? "wait" : "pointer" }}>
                    <IUpload size={13} /> {uploading === d.id ? "Uploading…" : "Upload photo or PDF"}
                    <input type="file" accept="image/*,application/pdf" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(d.id, f); }} />
                  </label>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {pending.length === 0 && vaultDocuments.length > 0 && (
        <p className="text-[12px] m-0 mb-3" style={{ color: "var(--mint)" }}>
          All documents are in — thank you! Your advisor may still request extras later.
        </p>
      )}

      {done.length > 0 && (
        <div className="space-y-1.5 pt-3" style={{ borderTop: "1px dashed var(--line)" }}>
          {done.map((d) => (
            <div key={d.id} className="flex items-center gap-2 rounded-lg px-3 py-1.5" style={{ background: "var(--tint)" }}>
              <span className="shrink-0" style={{ color: d.status === "Waived" ? "var(--ink-faint)" : "var(--mint)", display: "inline-flex" }}><ICheck size={13} /></span>
              <span className="text-[12px] flex-1 truncate" style={{ color: d.status === "Waived" ? "var(--ink-faint)" : undefined }}>
                {d.title}{d.status === "Waived" ? " (not required)" : ""}
              </span>
              {justDone === d.id && <span className="text-[10.5px] mono" style={{ color: "var(--mint)" }}>received ✓</span>}
              {d.fileName && <a href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer" className="text-[10.5px] mono" style={{ color: "var(--sky)" }}>view ↗</a>}
            </div>
          ))}
        </div>
      )}

      {vaultDocuments.length === 0 && legacyDocuments.length > 0 && (
        <div className="space-y-2 mb-3">
          {legacyDocuments.map((d) => (
            <div key={d.id} className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ background: "var(--tint)" }}>
              <IUpload size={14} className="text-[var(--ink-faint)] shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-medium truncate m-0">{d.fileName}</p>
                <p className="text-[10.5px] text-[var(--ink-faint)] m-0">{relTime(d.uploadedAt)} · {(d.fileSize / 1024).toFixed(0)} KB</p>
              </div>
              <ICheck size={14} className="text-[var(--mint)] shrink-0" />
            </div>
          ))}
        </div>
      )}
      {vaultDocuments.length === 0 && legacyDocuments.length === 0 && (
        <p className="text-[12.5px] text-[var(--ink-faint)] m-0">No documents requested yet — your advisor will list what's needed here.</p>
      )}
    </div>
  );
}
