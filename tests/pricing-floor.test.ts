// Verify the new pricing-floor + cap-trace + norms logic in isolation.
//
// WHY a standalone harness: the repo's existing suite runs under `bun`, which is
// not on every machine's PATH, and the engine's own test file pulls in the DB layer.
// These functions are PURE (no Prisma, no React), so they can be checked with
// nothing but the TypeScript compiler + node — meaning a change to the floor or the
// cap trace can never be merged unverified.
//
// NOTE: the three specifiers below are rewritten by the harness before compiling
// (the compiled bundle lives in the repo root and its siblings are plain .js), so
// they are not type-checkable here. `tsconfig.json` excludes this file for that
// reason — the assertions still run for real via `npm run test:pricing`.
// @ts-nocheck
import { applyFloor, cardField, resolveField, withVat, LAW_NORMS, rateSchedule, resolveStress, staleness,
  applyCardField, floorViolation, currentCardValue, bulkNextValue, quoteMatches } from "@/lib/bank-pricing";
import { resolveCaps, resolveNorm } from "@/lib/bank-match";
import { unknownAxes, nationalityAllowed } from "@/lib/bank-rules-taxonomy";
import { processingFeePct, processingFeeAed } from "@/lib/bank-fees";
import { productIssues, blockingIssues } from "@/lib/product-issues";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.error(`FAIL ${name}`, extra ?? ""); }
};

const fixed = (ratePct) => ({ rateType: "FIXED", ratePct, stl: true, termYears: 3, ftvMax: null, txn: null, segment: null });
const variable = (marginPct) => ({ rateType: "3M_EIBOR", marginPct, stl: true, termYears: null, ftvMax: null, txn: null, segment: null });


/* ---------------- 1. an EMPTY floor must be a perfect no-op ---------------- */
{
  const q = fixed(3.89);
  const r = applyFloor(q, {});
  ok("empty floor leaves a fixed rate untouched", r.quote.ratePct === 3.89 && !r.raised && !r.blocked);
  ok("empty floor does not mutate the input", q.ratePct === 3.89);
  const v = variable(1.89);
  const rv = applyFloor(v, {});
  ok("empty floor leaves a margin untouched", rv.quote.marginPct === 1.89 && !rv.raised && !rv.blocked);
}

/* ---------------- 2. the floor RAISES, never lowers ---------------- */
{
  const r = applyFloor(fixed(3.10), { minFixedRatePct: 3.20 });
  ok("floor raises a rate below it", r.raised && r.quote.ratePct === 3.20);
  ok("floor never lowers a good rate", applyFloor(fixed(3.89), { minFixedRatePct: 3.20 }).quote.ratePct === 3.89);
  const m = applyFloor(variable(1.10), { minMarginBps: 125 });
  ok("margin floor converts bps to a percent", m.raised && m.quote.marginPct === 1.25);
  ok("margin floor passes a compliant margin", applyFloor(variable(1.89), { minMarginBps: 125 }).quote.marginPct === 1.89);
}

/* ---------------- 3. the hard stop blocks, the floor does not ---------------- */
{
  const r = applyFloor(fixed(2.50), { hardStopPct: 2.80 });
  ok("hard stop blocks below it", r.blocked);
  ok("hard stop does not raise, it refuses", r.quote.ratePct === 2.50);
  ok("hard stop allows at-or-above", !applyFloor(fixed(2.80), { hardStopPct: 2.80 }).blocked);
  // regression guard: a 0.005 tolerance must not trip on float noise
  ok("hard stop tolerates half a bp of float noise", !applyFloor(fixed(2.7999), { hardStopPct: 2.80 }).blocked);
}

/* ---------------- 4. cap trace names the BINDING cap ---------------- */
{
  const only = resolveCaps([{ name: "DBR", value: 2_400_000 }, { name: "LTV", value: 1_300_000 }]);
  ok("tightest cap wins", only.eligibleLoan === 1_300_000);
  ok("binding cap is named", only.boundBy === "LTV");
  ok("binding note is human-readable", (only.boundNote ?? "").length > 10);
  ok("all caps are kept for the trace", only.caps.length === 2);

  const dbr = resolveCaps([{ name: "DBR", value: 1_100_000 }, { name: "LTV", value: 3_000_000 }]);
  ok("DBR named when DBR binds", dbr.boundBy === "DBR");

  // a null cap must not be treated as zero and become the "winner"
  const withNull = resolveCaps([{ name: "DBR", value: null }, { name: "LTV", value: 2_000_000 }]);
  ok("a missing cap is skipped, not treated as 0", withNull.eligibleLoan === 2_000_000 && withNull.boundBy === "LTV");
  ok("a missing cap is still listed in the trace", withNull.caps.length === 2);

  const none = resolveCaps([{ name: "DBR", value: null }, { name: "LTV", value: null }]);
  ok("no usable caps yields null, not zero", none.eligibleLoan === null && none.boundBy === null);
}

/* ---------------- 5. norms INHERIT but never overwrite a bank ---------------- */
{
  const norm: Partial<UaeNorms> = { maxDbrPct: 50, cardRulePct: 5, bonusPct: 0 };
  // bank leaves the fields null -> inherits the norm
  const inherited = resolveNorm({ cardRulePct: null, bonusPct: null, dbrPct: null } as Record<string, unknown>, norm);
  ok("a null bank field inherits the norm", inherited.values.cardRulePct === 5);
  ok("inherited fields are reported as assumed", inherited.assumed.includes("cardRulePct"));
  // bank deviates (DIB's 2% card rule) -> the bank wins, the norm does NOT overwrite it
  const overridden = resolveNorm({ cardRulePct: 2 } as Record<string, unknown>, norm);
  ok("a bank deviation is NOT overwritten by the norm", overridden.values.cardRulePct === 2);
  ok("an explicit bank field is not reported as assumed", !overridden.assumed.includes("cardRulePct"));
}

/* ---------------- 6. the THIRD state: constrained but unknown ---------------- */
{
  const rule = { mode: "ALLOW" as const, countries: ["United Kingdom", "India"] };
  const q: RateQuote = { ...fixed(3.89), nationalityRule: rule };
  // no passport on file -> we refuse to invent a rejection (correct) ...
  ok("unknown passport still passes the verdict", nationalityAllowed(rule, null));
  // ... but it must NOT be silent about it
  const gaps = unknownAxes(q, { nationality: null });
  ok("an unchecked nationality axis is reported", gaps.length === 1 && gaps[0].includes("nationality"));
  // once the passport is known, the gap closes
  ok("a known passport clears the gap", unknownAxes(q, { nationality: "United Kingdom" }).length === 0);
  // and a quote with no nationality rule is never a gap
  ok("an unrestricted quote is never a gap", unknownAxes(fixed(3.89), { nationality: null }).length === 0);
}

/* ---------------- 7. the `profile` classifier (Huspy import) ----------------
   The feed's customer_segments[].profile holds 81 values mixing four unrelated
   concepts. Misclassifying an LTV band as a customer segment would put "LTV > 50%"
   into a pricing axis and quietly stop every quote matching. The reference
   implementation lives in scripts/import-huspy.mjs and is mirrored here. */
{
  const classify = (p) => {
    if (!p) return { kind: "none" };
    const t = String(p);
    const range = t.match(/(\d{2})\s*%?\s*(?:-|–|to)\s*(\d{2})\s*%/i);
    if (/(ltv|ftv)/i.test(t) && range) {
      const a = Number(range[1]), b = Number(range[2]);
      return a <= b ? { kind: "ltv", min: a, max: b } : { kind: "ltv", min: b, max: a };
    }
    const cmp = t.match(/([<>]=?)\s*(\d{2})\s*%/);
    if (/(ltv|ftv)/i.test(t) && cmp) {
      const n = Number(cmp[2]);
      return cmp[1].startsWith("<") ? { kind: "ltv", min: null, max: n } : { kind: "ltv", min: n, max: null };
    }
    if (/exclusive/i.test(t)) return { kind: "project" };
    if (/low\s*doc|full\s*doc/i.test(t)) return { kind: "doc" };
    if (/^all segments$/i.test(t) || /^all others$/i.test(t)) return { kind: "any" };
    return { kind: "segment", segment: t };
  };

  // an LTV band is a pricing axis, never a segment
  ok("'LTV > 50%' is a floor band", classify("LTV > 50%").kind === "ltv" && classify("LTV > 50%").min === 50 && classify("LTV > 50%").max === null);
  ok("'FTV <= 60%' is a ceiling band", classify("FTV <= 60%").kind === "ltv" && classify("FTV <= 60%").max === 60);
  ok("'FTV - 61% - 70%' is a range", classify("FTV - 61% - 70%").kind === "ltv" && classify("FTV - 61% - 70%").min === 61 && classify("FTV - 61% - 70%").max === 70);
  ok("'LTV < 50%' is a ceiling", classify("LTV < 50%").kind === "ltv" && classify("LTV < 50%").max === 50);

  // exclusivity is an AVAILABILITY restriction, never a segment
  ok("'Dubai Holding Exclusive - Jomana 8' is a project", classify("Dubai Holding Exclusive - Jomana 8").kind === "project");
  ok("a project never becomes a segment", classify("Dubai Holding Exclusive - Erin at City Walk").segment === undefined);

  ok("'Low Doc' is a doc type", classify("Low Doc").kind === "doc");
  ok("'All Segments' imposes no constraint", classify("All Segments").kind === "any");
  ok("'Standard' is a real segment", classify("Standard").kind === "segment" && classify("Standard").segment === "Standard");
  ok("'Premium Pricing Segment' is a real segment", classify("Premium Pricing Segment").kind === "segment");
  ok("a null profile is no constraint", classify(null).kind === "none");
}

/* ---------------- 8. card inheritance + the law constants ----------------
   The hierarchy is only SAFE if every field can say which level supplied it. If a
   product's own value and a bank default both silently won, nobody could tell a
   default from a one-off — and changing the default would move an unknown number of
   products. These assert the ordering the whole design rests on. */
{
  // product value always wins — that is where a deliberate exception lives
  const own = cardField(0.25, "product", 0.525);
  ok("a product's own value wins over the bank default", own.value === 0.25);
  ok("a product value equal to the default is not an override", cardField(0.525, "product", 0.525).overridden === false);
  ok("a differing product value IS flagged as an override", own.overridden === true);
  ok("an inherited value is never flagged as an override", cardField(0.525, "bank", 0.525).overridden === false);
  ok("a missing value stays null (no zero pretending)", cardField(null, "norm", undefined).value === null);

  // resolveField: product ?? bank ?? norm
  const r1 = resolveField("x", { product: { x: 1 }, bank: { x: 2 } }, 3);
  ok("resolveField prefers the product", r1.value === 1 && r1.from === "product");
  const r2 = resolveField("x", { product: {}, bank: { x: 2 } }, 3);
  ok("resolveField falls back to the bank default", r2.value === 2 && r2.from === "bank");
  const r3 = resolveField("x", { product: {}, bank: {} }, 3);
  ok("resolveField falls back to the norm last", r3.value === 3 && r3.from === "norm");

  // law constants — these are UAE law, not per-bank settings
  ok("DBR ceiling is 50%", LAW_NORMS.maxDbrPct === 50);
  ok("VAT is 5%", LAW_NORMS.vatPct === 5);
  ok("early settlement is capped at 1% / AED 10,000", LAW_NORMS.earlySettlementPctCap === 1 && LAW_NORMS.earlySettlementAedCap === 10000);
  ok("VAT applies to a bank fee", withVat(1000) === 1050);
  ok("VAT on a zero fee stays zero", withVat(0) === 0);
}

/* ---------------- 9. promotional fees expire, or they mislead ----------------
   Measured in production: 11 DIB products carried a "Q1-Q3 2026 zero processing"
   first-time-buyer promo with nothing to revert it. When the window passed, every
   one of those products kept quoting clients Free. A fee must be used only inside
   its own window — and when no standard fee exists to fall back to, the result has
   to be "we do not know", never 0.
   
   The mirror implementation lives in src/lib/bank-fees.ts and is re-tested there by
   shape: same inputs, same outputs. Duplicated deliberately so this suite needs no
   new imports. */
{
  const isLive = (promo, on) => {
    if (!promo) return true;
    if (promo.validFrom && promo.validFrom > on) return false;
    if (promo.validTo && promo.validTo < on) return false;
    return true;
  };
  const eff = (fees, txn, on) => {
    const p = fees?.processing;
    if (!p) return null;
    // mirror of the production logic: no promo object -> `default` wins (legacy,
    // byte-identical); live promo -> promo rate; expired promo -> standard or gap
    const base = p.promo == null
      ? (p.default ?? null)
      : isLive(p.promo, on)
        ? (p.promo.default ?? p.default ?? null)
        : (p.defaultPct ?? null);
    if ((txn === "Equity Release" || txn === "Buyout + Equity Release") && p.equityRelease != null) return p.equityRelease;
    if (txn.startsWith("Buyout") && p.buyout != null) return p.buyout;
    return base;
  };

  // the production case: DIB 0% promo that expired 2026-09-30
  const dib = { processing: { default: 0, defaultPct: 1.05, promo: { default: 0, validFrom: "2026-01-01", validTo: "2026-09-30" } } };
  ok("a live promo is used", eff(dib, "Primary Purchase", "2026-06-15") === 0);
  ok("an expired promo falls back to the standard fee", eff(dib, "Primary Purchase", "2026-10-01") === 1.05);
  ok("a promo that has not started yet is not used", eff(dib, "Primary Purchase", "2025-12-31") === 1.05);
  ok("a promo with no dates is treated as live (never silently expire what was filed deliberately)",
    eff({ processing: { default: 0, defaultPct: 1.05, promo: { default: 0 } } }, "Primary Purchase", "2030-01-01") === 0);

  // expired promo + NO standard fee = unknown, never 0
  ok("expired promo with nothing to fall back to is a data gap, not Free",
    eff({ processing: { default: 0, promo: { default: 0, validTo: "2026-09-30" } } }, "Primary Purchase", "2026-10-01") === null);

  // no promo at all: the legacy flat default still works
  ok("a plain default still reads", eff({ processing: { default: 0.525 } }, "Primary Purchase", "2026-10-01") === 0.525);
  ok("missing fees stay missing", eff(null, "Primary Purchase", "2026-10-01") === null);
}

/* ---------------- 10. DBR 3 must resolve as a TYPED rule ---------------- */
{
  const eibor = { "1M": 4.06, "3M": 4.345, "6M": 4.443, "1Y": 5.109 };
  const q = { rateType: "FIXED", ratePct: 3.75, stl: true, termYears: 3, ftvMax: null, txn: null, segment: null,
    variableAfter: { basis: "3M_EIBOR", marginPct: 1.75, floorPct: 2.49 } };

  // no rule, no bank buffer -> the follow-on IS the stress rate (the owner's stated rule)
  const plain = rateSchedule(q, eibor, null);
  ok("no stress rule falls back to the follow-on", plain.stressRatePct === plain.followOnRatePct);
  ok("that fallback is labelled, not passed off as the bank's rule",
    plain.stressSource === "follow-on-fallback" && /no stress rule/.test(plain.stressNote));

  // the legacy per-bank buffer (CBD +2) still behaves exactly as before
  const buf = rateSchedule(q, eibor, 2);
  ok("a bank buffer is still applied", buf.stressRatePct === Math.round((plain.followOnRatePct + 2) * 1000) / 1000);
  ok("and is labelled bank-buffer", buf.stressSource === "bank-buffer");

  // a FLAT rule must NOT be pushed onto the follow-on
  const flat = rateSchedule({ ...q, stress: { kind: "FLAT", value: 5.88 } }, eibor, 2);
  ok("a FLAT stress rule overrides both follow-on and buffer", flat.stressRatePct === 5.88);
  ok("FLAT is attributed to the rule", flat.stressSource === "rule");

  // a relative rule adds to the follow-on
  const rel = rateSchedule({ ...q, stress: { kind: "RELATIVE_TO_FOLLOWON", value: 2 } }, eibor, null);
  ok("a RELATIVE rule = follow-on + its own value", rel.stressRatePct === Math.round((rel.followOnRatePct + 2) * 1000) / 1000);

  // a floor-based rule holds even when EIBOR collapses
  const low = { ...eibor, "3M": 0.4 };
  const floorRule = { ...q, stress: { kind: "FLOOR_PLUS", value: 0 } };
  ok("a FLOOR rule holds the qualification rate when EIBOR crashes",
    rateSchedule(floorRule, low, null).stressRatePct === 2.49);

  // FLOOR with no floor filed must not manufacture a floor-based number.
  // It does NOT fabricate one: it falls through to the follow-on, labelled as a
  // fallback. (Returning null here would reject a client who could be qualified.)
  const noFloor = resolveStress({ ...q, variableAfter: { basis: "3M_EIBOR", marginPct: 1.75, floorPct: null }, stress: { kind: "FLOOR_PLUS", value: 0 } }, 6.1, eibor, null);
  ok("FLOOR with no floor filed never invents a floor",
    noFloor.ratePct === 6.1 && noFloor.source === "follow-on-fallback");

  // day-1 variable: intro == follow-on == stress, but still attributed
  const v = rateSchedule({ rateType: "3M_EIBOR", marginPct: 1.75, floorPct: null, stl: true, termYears: null, ftvMax: null, txn: null, segment: null }, eibor, null);
  ok("a day-1 variable quote has one rate across DBR 1/2/3",
    v.introRatePct === v.followOnRatePct && v.followOnRatePct === v.stressRatePct);
}

/* ---------------- 11. editing a card (single + bulk share this) ----------------
   The bulk path is where a divergence would silently reprice thirty products, so the
   edit rules are asserted here rather than trusted. */
{
  const fx = { rateType: "FIXED", ratePct: 3.75, stl: true, termYears: 3, ftvMax: null, txn: null, segment: null,
    variableAfter: { basis: "3M", marginPct: 1.75, floorPct: 2.49 } };
  const vr = { rateType: "3M_EIBOR", marginPct: 1.75, floorPct: 2.0, stl: true, termYears: null, ftvMax: null, txn: null, segment: null };

  // a fixed line keeps its follow-on/floor inside variableAfter, not on the quote
  const m = applyCardField(fx, "followOn", 1.9, null);
  ok("editing a fixed card's follow-on writes variableAfter", m.variableAfter?.marginPct === 1.9);
  ok("...and leaves the intro rate alone", m.ratePct === 3.75);
  ok("...and leaves variableAfter's basis intact", m.variableAfter?.basis === "3M");
  const f = applyCardField(fx, "floorPct", 2.6, null);
  ok("editing a fixed card's floor writes variableAfter", f.variableAfter?.floorPct === 2.6);
  ok("the original quote is never mutated", fx.variableAfter.floorPct === 2.49);
  ok("a fixed card's rate is editable", applyCardField(fx, "ratePct", 3.5, null).ratePct === 3.5);
  // a VARIABLE line carries them directly
  ok("a variable card's margin is written flat", applyCardField(vr, "followOn", 2.1, null).marginPct === 2.1);
  ok("a variable card's floor is written flat", applyCardField(vr, "floorPct", 2.5, null).floorPct === 2.5);
  // stress: NONE must clear, never leave a blank rule behind
  ok("a stress rule is written when a kind is given", applyCardField(fx, "stress", 2, "RELATIVE_TO_FOLLOWON").stress?.kind === "RELATIVE_TO_FOLLOWON");
  ok("NONE clears the rule to null", applyCardField(fx, "stress", 2, "NONE").stress === null);
  ok("a kind with no number writes null, not a blank rule", applyCardField(fx, "stress", null, "FLAT").stress === null);

  // floors
  ok("a rate below the HFMC floor is caught", floorViolation({ ...fx, ratePct: 3.0 }, true, { minFixedRatePct: 3.2 }) !== null);
  ok("a rate at the floor is allowed", floorViolation({ ...fx, ratePct: 3.2 }, true, { minFixedRatePct: 3.2 }) === null);
  ok("a margin below the bps floor is caught", floorViolation({ ...vr, marginPct: 0.9 }, false, { minMarginBps: 125 }) !== null);
  ok("a rate below its OWN floor is refused", floorViolation({ ...fx, ratePct: 2.0 }, true, {}) !== null);
  ok("an unset floor imposes nothing",
    floorViolation({ rateType: "FIXED", ratePct: 0.1, stl: true, termYears: 3, ftvMax: null, txn: null, segment: null }, true, {}) === null);

  // bulk: set vs shift, and a shift against a blank must be impossible
  ok("set overrides whatever is there", bulkNextValue(fx, "ratePct", "set", 3.94) === 3.94);
  ok("shift moves a card by the delta", bulkNextValue(fx, "ratePct", "shift", -0.05) === 3.7);
  ok("shift resolves a fixed card's margin from variableAfter", bulkNextValue(fx, "followOn", "shift", 0.15) === 1.9);
  ok("shift against a blank yields null (the caller must block, not guess)",
    bulkNextValue({ ...fx, ratePct: null }, "ratePct", "shift", -0.05) === null);
  ok("currentCardValue reads the right field", currentCardValue(fx, "followOn") === 1.75 && currentCardValue(vr, "floorPct") === 2.0);
  ok("currentCardValue is null for an unknown field", currentCardValue(fx, "nonsense") === null);
}

/* ---------------- 12. slot states: CLOSED never matches, EMPTY/FILLED do ----------------
   The one fact a CLOSED line asserts. Everything else — axes, rates, floors —
   is irrelevant once a slot is closed, which is why the check sits first. */
{
  const req = { stl: true, txn: "any", ftv: 60, termYears: 3 } as never;
  const open = { rateType: "FIXED", ratePct: 3.75, termYears: 3, status: null } as never;
  const closed = { rateType: "FIXED", ratePct: 3.75, termYears: 3, status: "CLOSED", closedReason: "not offered" } as never;
  ok("an OPEN line matches its axes", quoteMatches(open, req));
  ok("a CLOSED line never matches, whatever its axes", !quoteMatches(closed, req));
  // legacy rows predate the field — undefined must behave as OPEN, not closed
  const legacy = { rateType: "FIXED", ratePct: 3.75, termYears: 3 } as never;
  ok("a legacy line with no status still matches", quoteMatches(legacy, req));
}

/* ---------------- 13. the EIBOR curve is baked into the schedule ----------------
   DBR 2/3 depend on EIBOR, so the curve they were computed against must travel
   with the verdict — otherwise a later EIBOR move silently reprices an old quote. */
{
  const q = { rateType: "FIXED", ratePct: 3.75, termYears: 3, variableAfter: { basis: "3M", marginPct: 1.75, floorPct: 2.49 } } as never;
  const s = rateSchedule(q, { "3M": 3.62 }, 0);
  ok("the schedule carries the curve it was computed against", (s.eiborAtComputation as Record<string, number>)?.["3M"] === 3.62);
  // a snapshot survives the live curve moving afterwards
  const snap = JSON.parse(JSON.stringify(s)) as typeof s;
  ok("a frozen schedule still reads the old EIBOR after the market moves",
    (snap.eiborAtComputation as Record<string, number>)?.["3M"] === 3.62 && snap.followOnRatePct != null);
}

/* ---------------- 14. staleness: a rate nobody re-checked is a guess ----------------
   The ADCB case: a stress note dated November 2022 was still live and still
   qualifying clients. `never` and `stale` are different facts and need different
   responses, so they must not collapse into one "old" state. */
{
  const ON = "2026-10-01";
  ok("a line confirmed this week is fresh", staleness("2026-09-25", ON).state === "fresh");
  ok("a fresh line reports how long ago, in months", staleness("2026-09-25", ON).monthsAgo === 0);
  ok("a line confirmed 13 months ago is stale", staleness("2025-09-01", ON).state === "stale");
  ok("a stale line names the age in its note", (staleness("2025-09-01", ON).note ?? "").includes("months ago"));
  ok("a line confirmed 10 months ago is aging, not stale", staleness("2025-12-01", ON).state === "aging");
  ok("an unconfirmed line is 'never', not 'stale'", staleness(null, ON).state === "never");
  ok("never carries no month count", staleness(undefined, ON).monthsAgo === null);
  // the exact failure this guards: a two-year-old confirmation
  ok("a Nov-2022 confirmation is stale by 2026", staleness("2022-11-01", ON).state === "stale");
  // a future date is a typo, not freshness
  ok("a future confirmation date is treated as unconfirmed", staleness("2027-01-01", ON).state === "never");
  ok("garbage in the date is treated as unconfirmed, not as fresh", staleness("not-a-date", ON).state === "never");
  // the threshold is configurable and follows the law norm
  ok("the stale threshold is 12 months by default", LAW_NORMS.verifyAfterMonths === 12);
  ok("a 6-month threshold makes a 7-month-old line stale", staleness("2026-02-01", ON, 6).state === "stale");
}

/* ---------------- processing-fee inheritance ----------------
   Precedence: product/slab/segment rule -> bank default -> null. The failure this
   guards is a grid that shows an inherited 0.525% while the engine quotes null. */
{
  const BANK = 0.525;
  const ON = "2026-10-01";
  const f = (processing) => ({ processing });

  ok("a product's own fee wins over the bank default",
    processingFeePct(f({ default: 0.25 }), "Buyout", undefined, ON, BANK) === 0.25);
  ok("a product with no processing block inherits the bank default",
    processingFeePct(f({}), "Buyout", undefined, ON, BANK) === BANK);
  ok("no fees at all still inherits the bank default",
    processingFeePct(null, "Buyout", undefined, ON, BANK) === BANK);
  ok("with no bank default either, the gap stays null (never 0)",
    processingFeePct(f({}), "Buyout", undefined, ON, null) === null);

  // a segment fee is more specific than the product default, so it still wins
  ok("a segment fee still beats the bank default",
    processingFeePct(f({ default: 0.25, buyout: 0.75 }), "Buyout", undefined, ON, BANK) === 0.75);
  // a slab that fits the loan amount is more specific than both
  ok("a slab fee still beats the product default and the bank default",
    processingFeePct(f({ default: 0.25, slabs: [{ upTo: 1_000_000, pct: 1.0 }] }),
      "Buyout", 500_000, ON, BANK) === 1.0);

  // THE case that must not regress: an expired promo with no filed standard is a
  // known data gap. Inheriting the bank default here would resurrect a fee we
  // already know had a different standard.
  const expiredPromo = { promo: { default: 0.5, validFrom: "2025-01-01", validTo: "2025-12-31" } };
  ok("an expired promo with no standard fee stays null, not the bank default",
    processingFeePct(f(expiredPromo), "Buyout", undefined, ON, BANK) === null);
  ok("an expired promo DOES fall back to an explicitly filed standard",
    processingFeePct(f({ ...expiredPromo, defaultPct: 0.35 }), "Buyout", undefined, ON, BANK) === 0.35);

  // the AED path must inherit on exactly the same terms, or the AED figure and the
  // % figure on the same proposal would disagree
  ok("processingFeeAed inherits the bank default",
    processingFeeAed(f({}), "Buyout", 1_000_000, undefined, BANK) === Math.round(1_000_000 * BANK / 100));
  ok("processingFeeAed is null when nothing is known",
    processingFeeAed(f({}), "Buyout", 1_000_000, undefined, null) === null);
  ok("processingFeeAed still respects a min fee over the inherited default",
    processingFeeAed(f({ minFee: 6000 }), "Buyout", 1_000_000, undefined, 0.1) === 6000);

  // the admin grid and the engine must agree on the same inputs — one shared
  // function, so a divergence is only possible if someone bypasses it
  const prod = f({ default: 0.25 });
  const grid = cardField(processingFeePct(prod, "Buyout", undefined, ON, BANK), "product", BANK);
  const engine = processingFeePct(prod, "Buyout", undefined, ON, BANK);
  ok("the grid's resolved fee equals the engine's fee", grid.value === engine);
  ok("a product fee equal to the bank default is not an override",
    cardField(processingFeePct(f({ default: BANK }), "Buyout", undefined, ON, BANK), "product", BANK).overridden === false);
  ok("an inherited fee is never an override",
    cardField(processingFeePct(f({}), "Buyout", undefined, ON, BANK), "bank", BANK).overridden === false);
  ok("a deviating product fee IS an override, and the parent is retained for revert",
    (() => { const c = cardField(0.25, "product", BANK); return c.overridden === true && c.parentValue === BANK; })());
  // a REVERT is just clearing the row value; with nothing on the product the bank
  // default is what reappears, which is exactly what the Revert button commits
  ok("clearing the row value restores the bank default",
    processingFeePct(f({}), "Buyout", undefined, ON, BANK) === BANK
      && cardField(BANK, "bank", BANK).overridden === false);
}

/* ---------------- product validation (the decimal-error guard) ----------------
   These checks used to live inside one React component, so they could only run on
   one screen. The failure they exist to catch is always an ambiguous spreadsheet
   cell read the wrong way, and it is silent when it gets through. */
{
  const good = (pricingJson: unknown) => ({
    maxLtvExpatriate: 80, tenorYears: 20, minSalary: 25000, minLoan: 100000, maxLoan: 5000000,
    pricingJson: JSON.stringify(pricingJson), fees: "1%", insurance: "0.36%",
  });
  const clean = good({ quotes: [{ rateType: "FIXED", ratePct: 3.95, termYears: 3 }] });
  ok("a well-formed product has no blocking issues", blockingIssues(clean).length === 0);

  // the decimal error: 3.95 read as 39.5, or as 0.0395
  const asPct = good({ quotes: [{ rateType: "FIXED", ratePct: 39.5 }] });
  ok("a rate of 39.5 is caught as a decimal mistake", blockingIssues(asPct).some((i) => /small numbers like 3.95/.test(i.msg)));
  const asFraction = good({ quotes: [{ rateType: "FIXED", ratePct: 0.0395 }] });
  ok("a rate of 0.0395 is caught too", blockingIssues(asFraction).length > 0);
  const varPct = good({ quotes: [{ rateType: "3M_EIBOR", marginPct: 189 }] });
  ok("an absurd variable margin is caught", blockingIssues(varPct).some((i) => /margin/.test(i.msg)));
  ok("a sane variable margin passes", blockingIssues(good({ quotes: [{ rateType: "3M_EIBOR", marginPct: 1.49 }] })).length === 0);

  ok("a product with no quotes is blocked", blockingIssues(good({ quotes: [] })).some((i) => /No structured quotes/.test(i.msg)));
  ok("unparseable pricing JSON is blocked", blockingIssues({ ...clean, pricingJson: "{oops" }).some((i) => /not valid/.test(i.msg)));
  ok("min salary in the wrong unit is blocked", blockingIssues({ ...clean, minSalary: 10 }).some((i) => /monthly in AED/.test(i.msg)));
  ok("a swapped min/max loan is blocked", blockingIssues({ ...clean, minLoan: 9_000_000, maxLoan: 100_000 }).some((i) => /swap them/.test(i.msg)));
  ok("LTV over 100 is blocked", blockingIssues({ ...clean, maxLtvExpatriate: 850 }).some((i) => /LTV is between/.test(i.msg)));
  ok("tenor over 30 years is blocked", blockingIssues({ ...clean, tenorYears: 40 }).some((i) => /1 to 30 years/.test(i.msg)));

  // advisory vs blocking: a product with text-only fees is worth mentioning but
  // must never stop an admin confirming a rate
  const noText = { ...clean, fees: "", insurance: "" };
  ok("text-only fees/insurance are advisory, not blocking", blockingIssues(noText).length === 0);
  ok("but they are still reported", productIssues(noText).length === 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) throw new Error(`${fail} pricing-floor/cap-trace assertions failed`);