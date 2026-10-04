// Client-facing "what you actually pay" panel.
//
// THE FIX FOR THE MOST IMPORTANT GAP: a proposal that shows a 3-year fixed rate and
// one monthly figure, over an 8-year loan, tells the client their payment stays put
// — it doesn't. The engine already computes followOnEmi and stressEmi; this renders
// them, so the client sees the step-up before they sign rather than in month 37.
//
// It also shows WHY the offer qualifies, naming the binding cap, instead of a bare
// "eligible" — the data was already in MatchResult, it was just never displayed.
"use client";

import { fmtMoney } from "@/lib/format";

export interface OfferExplain {
  bankName: string;
  productName: string;
  // widened from the engine's union: the proposal page carries the API's
  // serialised shape, and a stricter type here would reject valid payloads
  verdict: "eligible" | "conditions" | "not_eligible" | string;
  reasons: string[];
  quote: {
    rateType: string;
    ratePct?: number | null;
    marginPct?: number | null;
    termYears?: number | null;
    floorPct?: number | null;
    variableAfter?: { basis: string; marginPct: number; floorPct?: number | null } | null;
  } | null;
  schedule: { introRatePct: number | null; introTermYears: number | null; followOnRatePct: number | null; stressRatePct: number | null;
    stressSource?: string; stressNote?: string } | null;
  introEmi: number | null;
  followOnEmi: number | null;
  stressEmi: number | null;
  eligibleLoan: number | null;
  capTrace?: { boundBy: string | null; boundNote: string | null; caps: { name: string; value: number | null }[] } | null;
  verifyNeeded?: string[];
  stressBufferSource?: "bank" | "norm" | "none";
  dataGaps?: string[];
}

export function pct(v: number | null | undefined): string {
  return v == null ? "—" : `${Math.round(v * 100) / 100}%`;
}

/** The single most important number pair on a mortgage document. */
export function PaymentReveal({ o, compact }: { o: OfferExplain; compact?: boolean }) {
  const intro = o.introEmi;
  const followOn = o.followOnEmi;
  const stepUp = intro != null && followOn != null && followOn > intro
    ? Math.round(((followOn - intro) / intro) * 1000) / 10
    : null;
  const introYears = o.schedule?.introTermYears ?? o.quote?.termYears ?? null;
  if (intro == null) return null;

  return (
    <div className="space-y-2">
      {!compact && (
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <div>
            <div className="kpi-label">Monthly, years 1–{introYears ?? "…"}</div>
            <div className="kpi-value" style={{ fontSize: 22 }}>{fmtMoney(intro)}</div>
          </div>
          {followOn != null && introYears != null && (
            <div>
              <div className="kpi-label">Monthly from year {introYears + 1}</div>
              <div className="kpi-value" style={{ fontSize: 22, color: "var(--amber)" }}>≈ {fmtMoney(followOn)}</div>
            </div>
          )}
        </div>
      )}

      {stepUp != null && stepUp > 0 && (
        <p className="text-[11.5px] m-0" style={{ color: "var(--ink-dim)" }}>
          <strong style={{ color: "var(--amber)" }}>Your payment rises about {stepUp}%</strong> once the fixed period ends, when the rate moves to{" "}
          {o.quote?.variableAfter
            ? `${o.quote.variableAfter.basis.replace("_EIBOR", " EIBOR")} + ${o.quote.variableAfter.marginPct}%${o.quote.variableAfter.floorPct ? ` (minimum ${o.quote.variableAfter.floorPct}%)` : ""}`
            : "a variable rate linked to EIBOR"}.
          EIBOR moves with the market, so this figure can rise or fall.
          {o.stressBufferSource !== "bank" ? " We also qualify you on a stressed rate, which is why the affordable amount is set below this figure." : ""}
        </p>
      )}
    </div>
  );
}

/** The rate story: intro, follow-on, floor, and the rate we actually qualify on —
 *  the three numbers a client is never shown and always needs. */
export function RateStory({ o }: { o: OfferExplain }) {
  const s = o.schedule;
  if (!s) return null;
  const isFixed = o.quote?.rateType === "FIXED";
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px]">
      <div>
        <dt className="kpi-label">{isFixed ? "Fixed rate" : "Margin over EIBOR"}</dt>
        <dd className="mono m-0 font-semibold" style={{ fontSize: 15 }}>{isFixed ? pct(s.introRatePct) : pct(o.quote?.marginPct)}</dd>
        {isFixed && s.introTermYears ? <dd className="m-0 text-[10.5px]" style={{ color: "var(--ink-faint)" }}>for {s.introTermYears} years</dd> : null}
      </div>
      <div>
        <dt className="kpi-label">After that</dt>
        <dd className="mono m-0 font-semibold" style={{ fontSize: 15 }}>
          {o.quote?.variableAfter
            ? `${o.quote.variableAfter.basis.replace("_EIBOR", "")} + ${o.quote.variableAfter.marginPct}%`
            : s.followOnRatePct != null ? pct(s.followOnRatePct) : "—"}
        </dd>
      </div>
      <div>
        <dt className="kpi-label">Minimum rate</dt>
        <dd className="mono m-0 font-semibold" style={{ fontSize: 15 }}>
          {o.quote?.variableAfter?.floorPct != null ? pct(o.quote.variableAfter.floorPct)
            : o.quote?.floorPct != null ? pct(o.quote.floorPct) : "—"}
        </dd>
      </div>
      <div>
        <dt className="kpi-label">Rate we qualify you on</dt>
        <dd className="mono m-0 font-semibold" style={{ fontSize: 15 }}>{pct(s.stressRatePct)}</dd>
        <dd className="m-0 text-[10.5px]" style={{ color: "var(--ink-faint)" }}>
          {stressProvenance(s, o.stressBufferSource)}
        </dd>
      </div>
    </dl>
  );
}

/** How we arrived at the qualifying rate, in words a client can act on.
 *  `follow-on-fallback` is the important one: the bank recorded no stress rule, so
 *  the number shown IS the after-intro rate with no cushion on top. Saying "no
 *  buffer recorded" leaves the client unable to tell whether that is safe. */
function stressProvenance(
  s: { stressSource?: string; stressNote?: string } | null,
  legacySource?: string | null,
): string {
  switch (s?.stressSource) {
    case "rule": return "the bank's own assessment rate";
    case "bank-buffer": return "as the bank assesses it";
    case "follow-on-fallback":
      return "this is your later rate — no bank cushion is recorded, so we will confirm it before you commit";
    case "unknown": return "not yet recorded — confirm with us before you commit";
    default:
      return legacySource === "norm" ? "assumed — confirm with the bank" : "no buffer recorded";
  }
}

/** WHY THIS OFFER QUALIFIES — a plain checklist, plus the honest caveats. We never
 *  invent a rejection, so a "needs verification" line is shown instead of a false ✓. */
export function WhyQualifies({ o }: { o: OfferExplain }) {
  const positives = o.verdict !== "not_eligible";
  return (
    <div className="space-y-1.5">
      {positives && o.eligibleLoan != null && (
        <p className="text-[12px] m-0">
          <span style={{ color: "var(--mint)" }}>✓</span>{" "}
          <strong>{fmtMoney(o.eligibleLoan)}</strong> available
          {o.capTrace?.boundNote ? <> — {o.capTrace.boundNote}</> : null}
        </p>
      )}
      {o.reasons.filter((r) => !r.startsWith("max eligible")).map((r) => (
        <p key={r} className="text-[12px] m-0">
          <span style={{ color: "var(--mint)" }}>✓</span> {r}
        </p>
      ))}
      {o.verifyNeeded?.map((v) => (
        <p key={v} className="text-[12px] m-0" style={{ color: "var(--amber)" }}>
          <span>⚠</span> Needs verification: {v}
        </p>
      ))}
      {o.dataGaps?.map((v) => (
        <p key={v} className="text-[12px] m-0" style={{ color: "var(--amber)" }}>
          <span>⚠</span> {v}
        </p>
      ))}
      {!positives && o.reasons.length > 0 && (
        <p className="text-[12px] m-0" style={{ color: "var(--coral)" }}>
          Not available: {o.reasons.join("; ")}
        </p>
      )}
    </div>
  );
}

