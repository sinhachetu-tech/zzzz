"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { CasePartner, CaseSource } from "@/lib/types";
import type { Route } from "@/lib/client-store";
import { EMPLOYMENT_PROFILES, PARTNER_SHARES, PROPERTY_LOCATIONS, PROPERTY_TYPES, RESIDENCIES, SOURCES, TRANSACTION_TYPES } from "@/lib/types";
import { useHfmcStore } from "@/lib/client-store";
import { computeEscalations } from "@/lib/domain";
import { fmtMoney, inDaysISO, todayISO } from "@/lib/format";
import { Avatar, Chip, Modal, ThemeToggle } from "@/components/hfmc/ui";
import { Toaster } from "@/components/hfmc/toaster";
import {
  IBank, IBriefcase, ICalc, IChart, IFlag, IGrid, IInbox, ILogout, IMenu, IPlus, IShield, ITasks, LogoMark,
} from "@/components/icons";

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <span className="mono text-[12px] text-[var(--ink-faint)] hidden md:inline-block">
      {now.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })}
      {" · "}
      {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
    </span>
  );
}

const TENOR_ORDER = ["ON", "1W", "1M", "3M", "6M", "1Y"];

/** "01 September 2026" / "1 Sep 2026" / "2026-09-01" → ISO, else null. */
function parseRateDate(s: string): string | null {
  const t = s.trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return iso[0];
  const dmy = t.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/);
  if (dmy) {
    const mo = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(dmy[2].slice(0, 3).toLowerCase());
    if (mo >= 0) {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${dmy[3]}-${pad(mo + 1)}-${pad(Number(dmy[1]))}`;
    }
  }
  return null;
}

/* EiborModal — the daily rate ritual. Whoever the admin granted editEibor to
   opens the ticker, types/pastes the published rates, stamps the effective
   date, saves — and every calculation in the app reprices immediately
   (match engine + proposals read this table live). */
function EiborModal({ onClose }: { onClose: () => void }) {
  const { eibor, saveEibor, toast } = useHfmcStore();
  const sorted = [...eibor].sort((a, b) => TENOR_ORDER.indexOf(a.tenor) - TENOR_ORDER.indexOf(b.tenor));
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(eibor.map((e) => [e.tenor, e.ratePct.toFixed(6)])));
  const [effFrom, setEffFrom] = useState(todayISO());
  const [pubDate, setPubDate] = useState<string>(sorted[0]?.updatedOn || todayISO());
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const last = sorted[0];
  const updatedBy = last?.updatedBy || "—";
  const updatedOn = last?.updatedOn || "—";
  // true edit instant, rendered in the viewer's own timezone (IST for you, GST for the UAE team)
  const lastEditAt = last?.updatedAt
    ? new Date(last.updatedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";

  const parsePaste = () => {
    // Accepts the CBUAE publication row verbatim -
    //   01 September 2026  3.477640  3.814850  3.764300  3.986280  4.056520  4.394360  03 September 2026
    // (tabs, commas, pipes or wide spacing all work; a header row is ignored)
    // - mapping O/N 1W 1M 3M 6M 1Y positionally, the first date to "published on"
    // and the last to the value date. Loose "TENOR rate" pairs also work.
    const cells = paste.split(/[\t\n,|]+/).map((c) => c.trim()).filter(Boolean);
    const dates = cells.map(parseRateDate).filter((d): d is string => !!d);
    const nums = cells.filter((c) => /^v?\d+(?:\.\d+)?$/.test(c) && parseRateDate(c) == null);
    const next = { ...values };
    let hits = 0;
    if (nums.length >= TENOR_ORDER.length) {
      TENOR_ORDER.forEach((t, i) => { next[t] = nums[i]; hits++; });
    } else {
      for (const seg of cells) {
        const m = seg.match(/(O\/N|ON|1W|1M|3M|6M|1Y|overnight|1\s*month|3\s*months?|6\s*months?|1\s*year)[\s:=-]*v?(\d+(?:\.\d+)?)/i);
        if (!m) continue;
        const token = m[1].toUpperCase().replace(/\s+/g, "").replace(/MONTHS?/, "M").replace(/YEAR/, "Y").replace("OVERNIGHT", "ON").replace("O/N", "ON");
        if (!TENOR_ORDER.includes(token)) continue;
        next[token] = m[2];
        hits++;
      }
    }
    if (dates.length >= 1) setPubDate(dates[0]);
    if (dates.length >= 2) setEffFrom(dates[dates.length - 1]);
    setValues(next);
    const withDates = dates.length >= 1 ? ` Publish date ${dates[0]}${dates.length >= 2 ? `, value date ${dates[dates.length - 1]}` : ""}.` : "";
    toast(hits ? "success" : "error", hits ? `${hits} rate${hits === 1 ? "" : "s"} filled.${withDates} Check, then save.` : "Could not read any rates - paste the CBUAE row (date + six rates + value date) or pairs like: 3M 4.45");
    if (hits) setPaste("");
  };


  const save = async () => {
    setBusy(true);
    try {
      for (const t of TENOR_ORDER) {
        if (values[t] === undefined) continue;
        const v = Number(values[t]);
        const orig = eibor.find((e) => e.tenor === t);
        if (!v || v <= 0 || v > 25) continue;
        if (orig && Math.abs(orig.ratePct - v) < 0.00001) continue; // unchanged
        await saveEibor(t, v, effFrom, undefined, pubDate);
      }
      toast("success", "EIBOR table updated — all calculations now use the new rates.");
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not save.");
    }
    setBusy(false);
  };

  return (
    <Modal title="EIBOR benchmark rates" sub={`Last edited ${lastEditAt} by ${updatedBy} · rates as on ${updatedOn} — saving reprices every calculation.`} onClose={onClose} width={480}>
      <div className="space-y-3">
        <div className="grid grid-cols-[70px_1fr] gap-2 items-center">
          {TENOR_ORDER.map((t) => (
            <div key={t} className="contents">
              <label className="label !mb-0 mono">{t}</label>
              <input className="input mono !py-1.5" type="number" step={0.001} min={0} max={25} value={values[t] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [t]: e.target.value }))} />
            </div>
          ))}
        </div>
        <div>
          <div className="grid grid-cols-2 gap-2">
          <div>
          <label className="label">Published on <span className="normal-case tracking-normal" style={{ color: "var(--ink-faint)" }}>— shown “as on”</span></label>
          <input className="input mono" type="date" value={pubDate} onChange={(e) => setPubDate(e.target.value)} />
          </div>
          <div>
          <label className="label">Value date <span className="normal-case tracking-normal" style={{ color: "var(--ink-faint)" }}>— rate takes effect</span></label>
          <input className="input mono" type="date" value={effFrom} onChange={(e) => setEffFrom(e.target.value)} />
          </div>
          </div>
        </div>
        <div className="rounded-lg p-3" style={{ background: "var(--tint)", border: "1px solid var(--line-soft)" }}>
          <label className="label">Paste the CBUAE row verbatim <span className="normal-case tracking-normal" style={{ color: "var(--ink-faint)" }}>— publish date, six rates, value date; dates are picked up automatically</span></label>
          <div className="flex gap-2">
            <input className="input mono !py-1.5" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="01 September 2026  3.477640  3.814850  3.764300  3.986280  4.056520  4.394360  03 September 2026" />
            <button className="btn btn-ghost btn-sm shrink-0" onClick={parsePaste}>Fill</button>
          </div>
        </div>
        <p className="text-[11px] text-[var(--ink-faint)] m-0">Unchanged tenors are skipped. CBUAE publishes daily (effective same/next day) — no auto-feed exists, so this stays a manual ritual by design.</p>
      </div>
      <div className="flex justify-end gap-2 mt-4 pt-3" style={{ borderTop: "1px solid var(--line-soft)" }}>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save rates"}</button>
      </div>
    </Modal>
  );
}

function NewCaseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { stages, banks, partners, channels, users, me, flags, createCase, toast, nav, clients, cases } = useHfmcStore();
  const activeStages = [...stages].filter((s) => s.active).sort((a, b) => a.sortOrder - b.sortOrder);
  const [customer, setCustomer] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [waGroup, setWaGroup] = useState("");
  const [bankList, setBankList] = useState<string[]>([]);
  const [submissionType, setSubmissionType] = useState<"direct" | "channel">("direct");
  const [channelId, setChannelId] = useState<number | null>(null);
  const [amount, setAmount] = useState("1500000");
  const [stage, setStage] = useState(activeStages[0]?.label ?? "WhatsApp Group Creation");
  const [ownerId, setOwnerId] = useState(me?.id ?? 0);
  const [source, setSource] = useState<CaseSource>("Direct");
  const [partnerName, setPartnerName] = useState("");
  const [share, setShare] = useState(20);
  const [customShare, setCustomShare] = useState("");
  const [taskDesc, setTaskDesc] = useState("");
  const [taskDue, setTaskDue] = useState(inDaysISO(3));
  const [busy, setBusy] = useState(false); // blocks double-submit — the create+rehydrate round-trip takes a beat
  // --- MIS operational (optional, fill later on Case 360) ---
  const [transactionType, setTransactionType] = useState("");
  const [propertyLocation, setPropertyLocation] = useState("");
  const [coApplicantName, setCoApplicantName] = useState("");
  const [bankRm, setBankRm] = useState("");
  const [employmentProfile, setEmploymentProfile] = useState<(typeof EMPLOYMENT_PROFILES)[number]>("Salaried");
  const [propertyType, setPropertyType] = useState<(typeof PROPERTY_TYPES)[number]>("Ready");
  const [residency, setResidency] = useState<(typeof RESIDENCIES)[number]>("Resident Expatriate");
  const [err, setErr] = useState("");

  if (!open) return null;

  const needsPartner = source === "Agent" || source === "Broker" || source === "Referral";
  const partnerOptions = partners.filter((p) => p.active && p.kind === source);

  // Repeat-client detection — surface the person's file while typing.
  // Phone-digit match is confident enough to show; name match too (the
  // backend dedupe is stricter: EID > phone+name, phone alone never merges).
  const ph = whatsapp.replace(/\D/g, "");
  const nm = customer.trim().toLowerCase();
  const knownClient = open && (ph.length >= 7 || nm.length >= 4)
    ? clients.find((cl) =>
        (ph.length >= 7 && cl.phone === ph) ||
        (nm.length >= 4 && cl.fullName.trim().toLowerCase() === nm))
    : undefined;
  const knownClientCases = knownClient
    ? cases.filter((c) => c.clientId === knownClient.id || c.secondPartyClientId === knownClient.id)
    : [];

  const toggleBank = (name: string) =>
    setBankList((prev) => (prev.includes(name) ? prev.filter((b) => b !== name) : [...prev, name]));

  const submit = async () => {
    if (busy) return; // second click while in flight — ignore
    if (!customer.trim()) return setErr("Customer name is required.");
    const amt = Number(amount);
    if (!amt || amt <= 0) return setErr("Enter a valid loan amount in AED.");
    if (needsPartner && !partnerName) return setErr(`Pick the ${source.toLowerCase()} who sourced this case.`);
    const sharePct = share === 0 ? Number(customShare) : share;
    if (needsPartner && (!sharePct || sharePct <= 0 || sharePct > 100)) return setErr("Enter a valid partner share %.");
    if (submissionType === "channel" && !channelId) return setErr("Pick a channel partner.");
    setBusy(true);
    const partner: CasePartner | null = needsPartner
      ? { kind: source as "Agent" | "Broker" | "Referral", name: partnerName, sharePct }
      : null;
    const selectedChannel = submissionType === "channel" ? channels.find((ch) => ch.id === channelId) : null;
    try {
      const c = await createCase({
        customer, banks: bankList, loanAmount: amt, stage, ownerId,
        source, partner, whatsapp, waGroup: waGroup.trim() || null,
        task: taskDesc.trim()
          ? { description: taskDesc, dueDate: taskDue, waitingFor: "Internal", whyPending: "Internal review", ownerId }
          : undefined,
        submissionType,
        channelId: selectedChannel?.id ?? null,
        channelName: selectedChannel?.name ?? null,
        channelRatePct: selectedChannel?.commissionPct ?? 0,
        transactionType: transactionType || undefined,
        propertyLocation: propertyLocation || null,
        coApplicantName: coApplicantName.trim() || null,
        employmentProfile, propertyType, residency,
        bankRm: bankRm.trim() || null,
      });
      toast("success", stage === "Lead"
        ? `Lead ${c.caseNumber} created for ${c.customer} — qualify it in Leads.`
        : `${c.caseNumber} created for ${c.customer}.`);
      setCustomer(""); setWhatsapp(""); setWaGroup(""); setBankList([]); setTaskDesc("");
      setTransactionType(""); setPropertyLocation(""); setCoApplicantName(""); setBankRm("");
      setErr("");
      onClose();
      if (stage === "Lead") nav({ name: "leads" }); else nav({ name: "case", id: c.id });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not open case.");
    }
    setBusy(false);
  };

  return (
    <Modal onClose={onClose} title="Add lead" sub="A new inquiry — qualify it in Leads, then convert it into a case." width={580}>
      <div className="space-y-3.5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Customer name</label>
            <input className="input" autoFocus value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="e.g. Mohammed Al Mansoori" />
          </div>
          <div>
            <label className="label">Loan amount (AED)</label>
            <input className="input mono" type="number" min={0} step={10000} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <label className="label">Client WhatsApp</label>
            <input className="input mono" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+971 50 123 4567" />
          </div>
          <div>
            <label className="label">WhatsApp group link <span className="normal-case tracking-normal" style={{ color: "var(--ink-faint)" }}>— optional, paste the invite</span></label>
            <input className="input mono" value={waGroup} onChange={(e) => setWaGroup(e.target.value)} placeholder="https://chat.whatsapp.com/…" />
          </div>
        </div>

        {knownClient && (
          <div className="rounded-lg p-3 anim-fade-up" style={{ background: "rgba(242,176,76,0.06)", border: "1px solid rgba(242,176,76,0.35)" }}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-disp font-semibold text-[12.5px]" style={{ color: "var(--amber)" }}>Existing client file</span>
              <span className="text-[12.5px] font-medium">{knownClient.fullName}</span>
              {knownClient.eidNo && <span className="mono text-[10.5px] text-[var(--ink-faint)]">EID on record</span>}
              <Chip tone={knownClientCases.length ? "amber" : "slate"}>
                {knownClientCases.length} prior engagement{knownClientCases.length === 1 ? "" : "s"}
              </Chip>
            </div>
            {knownClientCases.length > 0 && (
              <div className="mt-2 space-y-1">
                {knownClientCases.slice(0, 4).map((kc) => (
                  <button key={kc.id} type="button" className="text-[11.5px] block text-left hover:underline" style={{ color: "var(--ink-dim)" }}
                    onClick={() => { onClose(); nav({ name: "case", id: kc.id }); }}>
                    {kc.caseNumber} · {kc.customer} · {kc.stage} · {kc.caseStatus}
                  </button>
                ))}
                <p className="text-[10.5px] text-[var(--ink-faint)] m-0">This new file will be linked to the same client record.</p>
              </div>
            )}
          </div>
        )}

        <div>
          <label className="label">Banks submitted to <span className="normal-case tracking-normal" style={{ color: "var(--ink-faint)" }}>— leave none for “bank not yet decided”</span></label>
          <div className="flex flex-wrap gap-1.5">
            {banks.filter((b) => b.active).map((b) => {
              const on = bankList.includes(b.name);
              return (
                <button key={b.id} type="button" onClick={() => toggleBank(b.name)} className="chip transition-all"
                  style={on ? { background: "rgba(242,176,76,0.14)", borderColor: "var(--amber)", color: "var(--amber)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}>
                  {b.name} {flags?.viewRevenue && <span className="opacity-70">{b.ratePct}%</span>}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-[var(--ink-faint)] mt-1.5 mb-0">
            Multiple banks can be in play — the winning bank is recorded when the case books. Percentages shown are our commission rate.
          </p>
        </div>

        <div>
          <label className="label">Submission type</label>
          <div className="flex gap-1.5">
            <button type="button" className="chip transition-all flex-1 justify-center"
              style={submissionType === "direct" ? { background: "rgba(67,214,155,0.12)", borderColor: "var(--mint)", color: "var(--mint)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}
              onClick={() => { setSubmissionType("direct"); setChannelId(null); }}>
              Direct to bank
            </button>
            <button type="button" className="chip transition-all flex-1 justify-center"
              style={submissionType === "channel" ? { background: "rgba(242,176,76,0.14)", borderColor: "var(--amber)", color: "var(--amber)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}
              onClick={() => setSubmissionType("channel")}>
              Through channel
            </button>
          </div>
          {submissionType === "channel" && (
            <select className="select mt-2" value={channelId ?? ""} onChange={(e) => setChannelId(e.target.value ? parseInt(e.target.value, 10) : null)}>
              <option value="">Select channel…</option>
              {channels.filter((ch) => ch.active).map((ch) => (
                <option key={ch.id} value={ch.id}>{ch.name}{flags?.viewRevenue ? ` — ${ch.commissionPct}% of loan` : ""}</option>
              ))}
            </select>
          )}
          {submissionType === "channel" && channelId && flags?.viewRevenue && (
            <p className="text-[10.5px] text-[var(--ink-faint)] mt-1 mb-0">
              Channel takes {channels.find((ch) => ch.id === channelId)?.commissionPct}% of the loan amount from the gross commission.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="label">Stage</label>
            <select className="select" value={stage} onChange={(e) => setStage(e.target.value)}>
              {activeStages.map((s) => <option key={s.id} value={s.label}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Case owner</label>
            <select className="select" value={ownerId} onChange={(e) => setOwnerId(parseInt(e.target.value, 10))}>
              {users.filter((u) => u.active && u.role !== "Head of Company" && u.role !== "PA to HoC").map((u) => (
                <option key={u.id} value={u.id}>{u.name} · {u.role}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Where did it come from?</label>
            <select className="select" value={source} onChange={(e) => { setSource(e.target.value as CaseSource); setPartnerName(""); }}>
              {SOURCES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* --- MIS operational (collapsible — keeps modal compact on mobile) --- */}
        <details className="rounded-lg" style={{ background: "var(--tint)", border: "1px solid var(--line-soft)" }}>
          <summary className="px-3 py-2 cursor-pointer font-disp text-[12px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.08em]">
            More details (optional) — profile, transaction, location, co-applicant, bank RM
          </summary>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 pt-0">
            <div>
              <label className="label">Employment profile · <span style={{ color: "var(--amber)" }}>drives document checklist</span></label>
              <select className="select" value={employmentProfile} onChange={(e) => setEmploymentProfile(e.target.value as (typeof EMPLOYMENT_PROFILES)[number])}>
                {EMPLOYMENT_PROFILES.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Residency</label>
              <select className="select" value={residency} onChange={(e) => setResidency(e.target.value as (typeof RESIDENCIES)[number])}>
                {RESIDENCIES.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Property type · <span style={{ color: "var(--amber)" }}>drives document checklist</span></label>
              <select className="select" value={propertyType} onChange={(e) => setPropertyType(e.target.value as (typeof PROPERTY_TYPES)[number])}>
                {PROPERTY_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Transaction type</label>
              <select className="select" value={transactionType} onChange={(e) => setTransactionType(e.target.value)}>
                <option value="">— select —</option>
                {TRANSACTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Property location</label>
              <select className="select" value={propertyLocation} onChange={(e) => setPropertyLocation(e.target.value)}>
                <option value="">— select —</option>
                {PROPERTY_LOCATIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Co-applicant</label>
              <input className="input" value={coApplicantName} onChange={(e) => setCoApplicantName(e.target.value)} placeholder="e.g. Fatima Al Mansoori" />
            </div>
            <div>
              <label className="label">Bank RM</label>
              <input className="input" value={bankRm} onChange={(e) => setBankRm(e.target.value)} placeholder="e.g. Ahmed (ENBD)" />
            </div>
          </div>
        </details>

        {needsPartner && (
          <div className="rounded-lg p-3 anim-fade-up" style={{ background: "rgba(242,176,76,0.05)", border: "1px solid rgba(242,176,76,0.2)" }}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">{source} name</label>
                {partnerOptions.length === 0 ? (
                  <p className="text-[12px] text-[var(--ink-faint)] m-0 py-2">No {source.toLowerCase()}s registered yet — add them in Admin → Partners.</p>
                ) : (
                  <select className="select" value={partnerName} onChange={(e) => setPartnerName(e.target.value)}>
                    <option value="">Select…</option>
                    {partnerOptions.map((p) => <option key={p.id} value={p.name}>{p.name}{flags?.viewRevenue ? ` (default ${p.defaultSharePct}%)` : ""}</option>)}
                  </select>
                )}
              </div>
              <div>
                <label className="label">Their share of our commission</label>
                <div className="flex flex-wrap gap-1.5">
                  {PARTNER_SHARES.map((s) => (
                    <button key={s} type="button" className="chip transition-all" onClick={() => setShare(s)}
                      style={share === s ? { background: "rgba(242,176,76,0.14)", borderColor: "var(--amber)", color: "var(--amber)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}>
                      {s}%
                    </button>
                  ))}
                  <button type="button" className="chip transition-all" onClick={() => setShare(0)}
                    style={share === 0 ? { background: "rgba(242,176,76,0.14)", borderColor: "var(--amber)", color: "var(--amber)" } : { background: "var(--bg2)", borderColor: "var(--line)", color: "var(--ink-faint)" }}>
                    Custom
                  </button>
                  {share === 0 && <input className="input mono" style={{ width: 84 }} type="number" min={1} max={100} placeholder="%" value={customShare} onChange={(e) => setCustomShare(e.target.value)} />}
                </div>
              </div>
            </div>
          </div>
        )}

        <div>
          <label className="label">First task (optional)</label>
          <div className="grid grid-cols-[1fr_140px] gap-2">
            <input className="input" value={taskDesc} onChange={(e) => setTaskDesc(e.target.value)} placeholder="e.g. Collect KYC & income documents" />
            <input className="input mono" type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} />
          </div>
        </div>
      </div>

      {err && <p className="text-[12.5px] mt-2.5 mb-0" style={{ color: "var(--coral)" }}>{err}</p>}

      <div className="flex items-center justify-between gap-2 mt-5 pt-4" style={{ borderTop: "1px solid var(--line-soft)" }}>
        <span className="text-[11.5px] text-[var(--ink-faint)]">
          {bankList.length === 0 ? "Bank TBC" : `${bankList.length} bank${bankList.length > 1 ? "s" : ""} in play`}
        </span>
        <div className="flex gap-2">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? "Creating…" : stage === "Lead" ? "Create lead" : "Create case"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const { me, route, nav, logout, escalations, instructions, bulletin, visibleCases, newCaseOpen, openNewCase, closeNewCase, eibor, flags } = useHfmcStore();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [eiborOpen, setEiborOpen] = useState(false);

  // Close the mobile drawer + FAB dial when route changes
  // eslint-disable-next-line react-hooks/set-state-in-effect -- drawer must close on every navigation
  useEffect(() => { setDrawerOpen(false); setFabOpen(false); }, [route]);

  const openInstr = instructions.filter((i) => i.status === "Open").length;
  const pipeline = visibleCases().filter((c) => c.caseStatus === "Active").reduce((s, c) => s + c.loanAmount, 0);
  const isAdmin = flags?.admin || flags?.super;
  const canInstruct = !!(flags?.issueTasks || flags?.super);

  const myOpenDirectives = me
    ? bulletin.filter((b) => !b.isTemplate && !b.dropped && b.date === todayISO() && b.status === "Open" && b.targets.includes(me.id)).length
    : 0;

  const navItems: { label: string; route: Route; icon: (p: { size?: number; className?: string }) => ReactNode; badge?: number }[] = [
    { label: "Dashboard", route: { name: "dashboard" }, icon: IGrid },
    { label: "Morning Bulletin", route: { name: "bulletin" }, icon: IFlag, badge: myOpenDirectives },
    { label: "Leads", route: { name: "leads" }, icon: IInbox },
    { label: "Cases", route: { name: "cases" }, icon: IBriefcase },
    { label: "Task Queue", route: { name: "tasks" }, icon: ITasks },
    { label: "Calculator", route: { name: "calculator" }, icon: ICalc },
    { label: "Reports", route: { name: "reports" }, icon: IChart },
    ...(isAdmin ? [{ label: "Admin", route: { name: "admin" as const }, icon: IShield }] : []),
  ];

  const title =
    route.name === "dashboard" ? "Dashboard" :
    route.name === "cases" ? "Cases" :
    route.name === "leads" ? "Leads" :
    route.name === "case" ? "Case 360" :
    route.name === "tasks" ? "Task Queue" :
    route.name === "bulletin" ? "Morning Bulletin" :
    route.name === "calculator" ? "Calculator" :
    route.name === "reports" ? "Reports" :
    "Admin";

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="app-bg" />

      {/* Desktop sidebar — hidden on mobile */}
      <aside className="side-dark w-[228px] shrink-0 border-r hidden md:flex flex-col" style={{ borderColor: "#18313b", background: "rgba(11,23,29,0.88)", backdropFilter: "blur(6px)" }}>
        <SidebarContent
          navItems={navItems} route={route} nav={nav}
          escalations={escalations} pipeline={pipeline}
          me={me} logout={logout}
          openInstr={openInstr} canInstruct={canInstruct}
        />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[90] md:hidden anim-fade-in" style={{ background: "rgba(4,12,15,0.7)", backdropFilter: "blur(3px)" }} onClick={() => setDrawerOpen(false)}>
          <aside className="side-dark w-[260px] max-w-[80vw] h-full border-r flex flex-col anim-slide-right" style={{ borderColor: "#18313b", background: "rgba(11,23,29,0.96)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-4">
              <div className="flex items-center gap-2.5">
                <LogoMark size={30} />
                <div>
                  <div className="font-disp font-bold text-[15px] tracking-[0.04em] leading-none">HFMC</div>
                  <div className="text-[9.5px] uppercase tracking-[0.18em] text-[var(--ink-faint)] mt-1">Mortgage · UAE</div>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm !px-2" onClick={() => setDrawerOpen(false)} aria-label="Close menu">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <SidebarContent
                navItems={navItems} route={route} nav={nav}
                escalations={escalations} pipeline={pipeline}
                me={me} logout={logout}
                openInstr={openInstr} canInstruct={canInstruct}
                hideBranding
              />
            </div>
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-[54px] shrink-0 border-b flex items-center gap-3 px-4 md:px-5" style={{ borderColor: "var(--line-soft)", background: "color-mix(in srgb, var(--bg) 78%, transparent)", backdropFilter: "blur(6px)" }}>
          <button className="btn btn-ghost btn-sm !px-2 md:!hidden" onClick={() => setDrawerOpen(true)} aria-label="Open menu">
            <IMenu size={18} />
          </button>
          <h1 className="font-disp font-semibold text-[16px] m-0 truncate">{title}</h1>
          {route.name === "case" && <span className="text-[12px] text-[var(--ink-faint)] hidden lg:inline">the full story of one file</span>}
          {/* EIBOR ticker — live benchmark, drives every calculation; click to edit if permitted */}
          {eibor.length > 0 && (() => {
            const canEdit = !!(flags?.editEibor || flags?.admin || flags?.super);
            const ordered = [...eibor].sort((a, b) => TENOR_ORDER.indexOf(a.tenor) - TENOR_ORDER.indexOf(b.tenor));
            const last = ordered[0];
            return (
              <button
                onClick={() => canEdit && setEiborOpen(true)}
                title={canEdit
                  ? `Last edited ${last?.updatedOn || "—"} by ${last?.updatedBy || "—"} — click to update`
                  : `EIBOR benchmark — last updated ${last?.updatedOn || "—"} by ${last?.updatedBy || "—"}`}
                className="hidden xl:flex items-center gap-1.5 ml-3 px-2.5 py-1 rounded-lg mono text-[11px] transition-colors"
                style={{ background: "var(--tint)", border: "1px solid var(--line-soft)", color: "var(--ink-dim)", cursor: canEdit ? "pointer" : "default" }}
              >
                <span className="dot-live shrink-0" style={{ animation: "pulse 2s infinite" }} />
                <span className="font-disp font-semibold text-[10px] tracking-[0.1em]" style={{ color: "var(--ink-faint)" }}>EIBOR</span>
                {last?.updatedOn && (
                  <span className="whitespace-nowrap" style={{ color: "var(--ink-faint)" }}>
                    as on {new Date(last.updatedOn + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                  </span>
                )}
                {ordered.map((e) => (
                  <span key={e.tenor} className="whitespace-nowrap">
                    <span style={{ color: "var(--ink-faint)" }}>{e.tenor}</span> <span style={{ color: "var(--amber)" }}>{e.ratePct.toFixed(6)}</span>
                  </span>
                ))}
                {canEdit && <span style={{ color: "var(--ink-faint)" }}>✎</span>}
              </button>
            );
          })()}
          <div className="ml-auto flex items-center gap-2 md:gap-3">
            <Clock />
            <ThemeToggle compact />
            {/* desktop-only: on mobile the floating action button is the single Add-lead entry */}
            <button className="btn btn-primary !hidden md:!inline-flex" onClick={openNewCase}>
              <IPlus size={16} /> Add lead
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto pb-20 md:pb-0">
          <div key={JSON.stringify(route)} className="max-w-[1240px] mx-auto px-4 md:px-5 py-4 md:py-5 anim-fade-in">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile bottom nav — Cases/Leads/Tasks lead; the rest lives in the drawer */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden flex items-stretch border-t" style={{ borderColor: "var(--line)", background: "color-mix(in srgb, var(--raised) 92%, transparent)", backdropFilter: "blur(10px)" }}>
        {(["dashboard", "leads", "cases", "tasks", "calculator"] as const).map((name) => {
          const n = navItems.find((x) => x.route.name === name)!;
          const active = route.name === n.route.name || (route.name === "case" && n.route.name === "cases");
          return (
            <button
              key={n.label}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 relative"
              onClick={() => nav(n.route)}
              style={{ color: active ? "var(--amber)" : "var(--ink-faint)" }}
            >
              <span className="relative">
                <n.icon size={20} />
                {!!n.badge && n.badge > 0 && (
                  <span className="absolute -top-1.5 -right-2 mono text-[9px] px-1 py-px rounded-full" style={{ background: "var(--amber)", color: "#231a08", minWidth: 14, textAlign: "center" }}>
                    {n.badge > 9 ? "9+" : n.badge}
                  </span>
                )}
              </span>
              <span className="text-[9.5px] font-disp font-medium">{n.label.split(" ")[0]}</span>
              {active && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full" style={{ background: "var(--amber)" }} />}
            </button>
          );
        })}
      </nav>

      {/* Mobile floating action button — role-aware: designated staff get a
          speed dial (Add lead / New directive), everyone else taps straight
          through to Add lead. Case-level Add task lives inside Case 360. */}
      <div className="fixed bottom-[72px] right-4 z-40 md:hidden flex flex-col items-end gap-2">
        {fabOpen && canInstruct && (
          <>
            <button className="flex items-center gap-2 anim-fade-up" onClick={() => { setFabOpen(false); nav({ name: "bulletin" }); }}>
              <span className="text-[12px] font-disp font-semibold px-2.5 py-1.5 rounded-lg shadow-lg" style={{ background: "var(--raised)", color: "var(--ink)", border: "1px solid var(--line)" }}>New directive</span>
              <span className="w-10 h-10 rounded-full flex items-center justify-center shadow-lg" style={{ background: "var(--raised)", color: "var(--amber)", border: "1px solid var(--line)" }}><IFlag size={18} /></span>
            </button>
            <button className="flex items-center gap-2 anim-fade-up" onClick={() => { setFabOpen(false); openNewCase(); }}>
              <span className="text-[12px] font-disp font-semibold px-2.5 py-1.5 rounded-lg shadow-lg" style={{ background: "var(--raised)", color: "var(--ink)", border: "1px solid var(--line)" }}>Add lead</span>
              <span className="w-10 h-10 rounded-full flex items-center justify-center shadow-lg" style={{ background: "var(--amber)", color: "#fff8ec" }}><IPlus size={18} /></span>
            </button>
          </>
        )}
        <button
          className="w-14 h-14 rounded-full flex items-center justify-center anim-fade-up"
          aria-label={canInstruct ? "Quick actions" : "Add lead"}
          onClick={() => (canInstruct ? setFabOpen((v) => !v) : openNewCase())}
          style={{
            background: "var(--amber)", color: "#fff8ec",
            boxShadow: "0 8px 24px -6px rgba(180,83,9,0.5), 0 2px 8px rgba(0,0,0,0.15)",
          }}
        >
          {fabOpen && canInstruct ? <span className="font-disp text-[22px] leading-none">✕</span> : <IPlus size={26} />}
        </button>
      </div>

      <NewCaseModal open={newCaseOpen} onClose={closeNewCase} />
      {eiborOpen && <EiborModal onClose={() => setEiborOpen(false)} />}
      <Toaster />
    </div>
  );
}

function SidebarContent({
  navItems, route, nav, escalations, pipeline, me, logout, openInstr, canInstruct, hideBranding,
}: {
  navItems: { label: string; route: Route; icon: (p: { size?: number; className?: string }) => ReactNode; badge?: number }[];
  route: Route;
  nav: (r: Route) => void;
  escalations: number;
  pipeline: number;
  me: { name: string; role: string } | null;
  logout: () => void;
  openInstr: number;
  canInstruct: boolean;
  hideBranding?: boolean;
}) {
  return (
    <>
      {!hideBranding && (
        <div className="flex items-center gap-2.5 px-4 py-4">
          <LogoMark size={30} />
          <div>
            <div className="font-disp font-bold text-[15px] tracking-[0.04em] leading-none">HFMC</div>
            <div className="text-[9.5px] uppercase tracking-[0.18em] text-[var(--ink-faint)] mt-1">Mortgage · UAE</div>
          </div>
        </div>
      )}

      <nav className="px-3 mt-2 space-y-1 flex-1">
        {navItems.map((n) => {
            const active = route.name === n.route.name || (route.name === "case" && n.route.name === "cases");
            return (
              <button key={n.label} className={`nav-item w-full text-left ${active ? "active" : ""}`} onClick={() => nav(n.route)}>
              <n.icon size={17} />
              <span>{n.label}</span>
              {!!n.badge && n.badge > 0 && (
                <span className="ml-auto mono text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(242,176,76,0.18)", color: "var(--amber)", border: "1px solid rgba(242,176,76,0.4)" }}>
                  {n.badge}
                </span>
              )}
              {n.label === "Task Queue" && openInstr > 0 && canInstruct && (
                <span className="ml-auto mono text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(87,194,234,0.15)", color: "var(--sky)" }}>{openInstr}</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto p-3">
        <div className="card p-3 mb-2">
          <div className="text-[10.5px] uppercase tracking-[0.12em] text-[var(--ink-faint)] font-disp font-semibold mb-1.5">SLA breaches</div>
          <div className="flex items-center gap-2">
            {escalations > 0 ? <span className="dot-overdue" /> : <span className="dot-live" />}
            <span className="font-disp font-bold text-[20px]" style={{ color: escalations > 0 ? "var(--coral)" : "var(--mint)" }}>{escalations}</span>
            <span className="text-[11px] text-[var(--ink-faint)]">stage{escalations === 1 ? "" : "s"} past SLA</span>
          </div>
          <div className="mt-2 pt-2 text-[11px] text-[var(--ink-faint)]" style={{ borderTop: "1px dashed var(--line)" }}>
            Active pipeline <span className="mono text-[var(--ink-dim)]">{fmtMoney(pipeline)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg" style={{ background: "var(--tint)" }}>
          <Avatar name={me?.name ?? "?"} size={32} />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-medium truncate">{me?.name}</div>
            <div className="text-[10.5px] text-[var(--ink-faint)] truncate">{me?.role}</div>
          </div>
          <button className="text-[var(--ink-faint)] hover:text-[var(--coral)] transition-colors" onClick={logout} title="Sign out">
            <ILogout size={16} />
          </button>
        </div>
      </div>
    </>
  );
}
