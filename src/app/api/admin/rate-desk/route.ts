// GET/PUT /api/admin/rate-desk — THE RATE CARDS.
//
// A row is a CARD: a rate plus the follow-on, floor and processing fee that travel
// with it. Changing a rate used to mean navigating a ~900-line modal, finding one
// quote row and PATCHing the whole product in place. Now the card is one row and
// every commit is effective-dated + audited, never an in-place mutation.
//
// Editing is ONE FIELD AT A TIME by default: banks very often send a new rate and
// nothing else, so a "apply the whole card" default would quietly change a floor or
// fee the bank never moved.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { parsePricing, LAW_NORMS, applyCardField, floorViolation, currentCardValue, bulkNextValue, staleness, type ProductPricing, type RateQuote } from "@/lib/bank-pricing";
import { getPricingFloor, savePricingFloor } from "@/lib/pricing-floor";
import { loadCards } from "@/lib/rate-cards";
import { audit, auditDiff } from "@/lib/audit";
import { todayISO } from "@/lib/format";
import { productIssues } from "@/lib/product-issues";

async function guard() {
  const me = await currentUser();
  if (!me) return null;
  const flags = await flagsFor(me);
  if (!flags.admin && !flags.super) return null;
  return { me, flags };
}

export interface RateDeskIssue {
  code: string;
  label: string;
  severity: "warn" | "error";
}

/** One row per live rate line, flattened for the table. */
export interface RateDeskRow {
  key: string;              // stable row id: `${bankProductId}:${quoteIndex}`
  bankProductId: number;
  bankName: string;
  productName: string;
  quoteIndex: number;
  quote: RateQuote;
  status: string;
  version: number;
  effectiveDate: string | null;
  expiryDate: string;
  /** Per-row attention flags — these are the failure modes that produce a wrong quote. */
  issues: RateDeskIssue[];
}

/**
 * Per-row attention flags. These are the actual failure modes that produce a wrong
 * client quote: a fixed line with no follow-on has no stressed rate, and a product
 * with no recorded stress buffer gets qualified at zero cushion.
 */
function rowIssues(p: { stressBufferPct?: number | null }, q: RateQuote): RateDeskIssue[] {
  const out: RateDeskIssue[] = [];
  if (q.status === "CLOSED") return out; // a closed slot asserts nothing quotable — flagging it would cry wolf
  const isFixed = q.rateType === "FIXED";
  if (isFixed && q.ratePct == null) out.push({ code: "no-rate", label: "no rate", severity: "error" });
  if (!isFixed && q.marginPct == null) out.push({ code: "no-margin", label: "no margin", severity: "error" });
  if (isFixed && !q.variableAfter) out.push({ code: "no-followon", label: "no follow-on rate", severity: "warn" });
  if (!isFixed && q.floorPct == null && !q.variableAfter?.floorPct) out.push({ code: "no-floor", label: "no floor", severity: "warn" });
  // A filed TYPED stress rule IS the bank's methodology, so the legacy numeric buffer
  // is irrelevant there — warning about it would cry wolf on every correct row.
  const hasRule = q.stress != null && q.stress.kind !== "NONE";
  if (!hasRule && p.stressBufferPct == null) out.push({ code: "no-buffer", label: "no stress rule", severity: "warn" });
  // staleness: a rate nobody has re-checked is a guess. A confirmed-then-forgotten
  // line (ADCB's stress note still says November 2022) is the failure this catches.
  const fresh = staleness(q.verifiedAt);
  if (fresh.state === "stale") out.push({ code: "stale", label: `not re-checked in ${fresh.monthsAgo} months`, severity: "warn" });
  else if (fresh.state === "never") out.push({ code: "unverified", label: "never verified", severity: "warn" });
  return out;
}

export async function GET() {
  const g = await guard();
  if (!g) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { cards, banks, eibor } = await loadCards();
  const floor = await getPricingFloor();

  return NextResponse.json({
    cards,
    banks,
    eibor,
    floor,
    law: LAW_NORMS,   // DBR 50% · VAT 5% · ESF cap — law, not per-bank settings
    counts: {
      total: cards.length,
      attention: cards.filter((c) => c.issues.some((i) => i.severity === "error")).length,
      warnings: cards.filter((c) => c.issues.length && !c.issues.some((i) => i.severity === "error")).length,
      noFloor: cards.filter((c) => c.floorPct.value == null).length,
    },
  });
}

export async function PUT(req: NextRequest) {
  const g = await guard();
  if (!g) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json();

  // --- floor save ---
  if (body?.kind === "floor") {
    const before = await getPricingFloor();
    const after = await savePricingFloor(body.floor ?? {}, g.me.name);
    await audit({
      entity: "AppSetting",
      entityId: "pricing_floor",
      action: "update",
      field: "pricing_floor",
      beforeVal: before,
      afterVal: after,
      reason: body.reason ?? "",
      actorId: g.me.id,
      actorName: g.me.name,
    });
    return NextResponse.json({ floor: after });
  }

  // --- VERIFY: stamp that a human confirmed this line with the bank today ---
  // Not a rate change — nothing about the price moves. It records that the price
  // was checked, which is the only defence against a two-year-old note still
  // quoting a client. Deliberately separate from edit so the two can't be confused.
  if (body?.kind === "verify") {
    const { bankProductId, quoteIndex, cards: many, note } = body ?? {};
    // bulk verify: a bank sends one confirmation covering its whole card
    const targets: { pid: number; qi: number }[] = Array.isArray(many)
      ? many.map((c: { bankProductId: number; quoteIndex: number }) => ({ pid: Number(c?.bankProductId), qi: Number(c?.quoteIndex) })).filter((t: { pid: number; qi: number }) => t.pid && !Number.isNaN(t.qi))
      : [{ pid: Number(bankProductId), qi: Number(quoteIndex) }];
    if (!targets.length || targets.some((t) => !t.pid || Number.isNaN(t.qi))) {
      return NextResponse.json({ error: "bankProductId & quoteIndex required" }, { status: 400 });
    }
    const verifiedAt = todayISO();
    const byProduct = new Map<number, number[]>();
    for (const t of targets) {
      if (!byProduct.has(t.pid)) byProduct.set(t.pid, []);
      byProduct.get(t.pid)!.push(t.qi);
    }
    let stamped = 0;
    for (const [pid, indices] of byProduct) {
      const p = await db.bankProduct.findUnique({ where: { id: pid } });
      if (!p) continue;
      const pricing = parsePricing(p.pricingJson);
      if (!pricing?.quotes?.length) continue;
      // Never stamp a confirmation onto a rate that is obviously wrong. "Confirmed
      // with the bank" is the strongest claim the UI makes, and it must not be
      // available for a rate typed as 39.5 instead of 3.95 — that is the exact
      // decimal error `productIssues()` exists to catch, and this is the last point
      // before it becomes "fresh" and stops being questioned for 12 months.
      // Server-side, because a client-side check is one screen away from being
      // bypassed by the next screen someone writes.
      const bad = productIssues(p).filter((i) => i.blocking);
      if (bad.length) {
        return NextResponse.json({
          error: "This product has problems that must be fixed before it can be marked as confirmed.",
          issues: bad,
        }, { status: 400 });
      }
      const quotes = [...pricing.quotes];
      for (const qi of indices) {
        const target = quotes[qi];
        if (!target) continue;
        quotes[qi] = { ...target, verifiedAt };
        stamped++;
      }
      await db.bankProduct.update({ where: { id: pid }, data: { pricingJson: JSON.stringify({ quotes }) } });
      await audit({
        entity: "BankProduct", entityId: pid, action: "update",
        field: `quotes[${indices.join(",")}].verifiedAt`,
        beforeVal: null, afterVal: verifiedAt,
        reason: String(note ?? "").trim() || "confirmed with the bank",
        actorId: g.me.id, actorName: g.me.name,
      });
    }
    return NextResponse.json({ ok: true, verified: stamped, verifiedAt });
  }

  // --- SLOT close / reopen (deliberately not offered vs back on the table) ---
  // A close needs a REASON because "the bank doesn't offer this" and "we haven't
  // filed it yet" must never look the same. Reopening returns the slot to EMPTY —
  // the slot never auto-fills, because a reopened slot with an invented rate is
  // worse than an empty one.
  if (body?.kind === "slot") {
    const { bankProductId, quoteIndex, action, closedReason, reason } = body ?? {};
    if (bankProductId == null || quoteIndex == null || (action !== "close" && action !== "reopen")) {
      return NextResponse.json({ error: "bankProductId, quoteIndex & action (close/reopen) required" }, { status: 400 });
    }
    if (!reason || String(reason).trim().length < 4) {
      return NextResponse.json({ error: "A reason is required for every change." }, { status: 400 });
    }
    if (action === "close" && (!closedReason || String(closedReason).trim().length < 4)) {
      return NextResponse.json({ error: "A closed slot needs a reason — otherwise it becomes a dumping ground for unfinished work." }, { status: 400 });
    }
    const p = await db.bankProduct.findUnique({ where: { id: Number(bankProductId) } });
    if (!p) return NextResponse.json({ error: "product not found" }, { status: 404 });
    const pricing = parsePricing(p.pricingJson);
    const target = pricing?.quotes?.[Number(quoteIndex)];
    if (!target) return NextResponse.json({ error: "card not found — the rate card may have changed" }, { status: 404 });
    if (action === "close" && target.status === "CLOSED") {
      return NextResponse.json({ error: "Already closed." }, { status: 400 });
    }
    if (action === "reopen" && target.status !== "CLOSED") {
      return NextResponse.json({ error: "Only a closed slot can be reopened." }, { status: 400 });
    }
    const today = todayISO();
    const updated: RateQuote = action === "close"
      ? { ...target, status: "CLOSED", closedReason: String(closedReason).trim(), closedAt: today }
      : { ...target, status: null, closedReason: null, closedAt: null };
    const quotes = [...(pricing as ProductPricing).quotes];
    quotes[Number(quoteIndex)] = updated;
    await db.bankProduct.update({ where: { id: p.id }, data: { pricingJson: JSON.stringify({ quotes }) } });
    await audit({
      entity: "BankProduct", entityId: p.id, action: action === "close" ? "close-slot" : "reopen-slot",
      field: `quotes[${quoteIndex}].status`,
      beforeVal: { status: target.status ?? null, closedReason: target.closedReason ?? null },
      afterVal: { status: updated.status ?? null, closedReason: updated.closedReason ?? null },
      reason: String(reason).trim(), actorId: g.me.id, actorName: g.me.name,
    });
    return NextResponse.json({ ok: true, slotState: updated.status === "CLOSED" ? "CLOSED" : "EMPTY" });
  }

  // --- SLOT AXES: re-file who a price applies to (transaction, term, rate type, STL) ---
  // Never moves a rate. The axes an importer filed are guesses from prose, so they
  // must be correctable, and correcting them is what confirms the line — so the
  // same action stamps verifiedAt.
  if (body?.kind === "slot-axes") {
    const { bankProductId, quoteIndex, txns, termYears, rateType, eiborBasis, salaryTransfer, reason } = body ?? {};
    if (bankProductId == null || quoteIndex == null) {
      return NextResponse.json({ error: "bankProductId & quoteIndex required" }, { status: 400 });
    }
    if (!reason || String(reason).trim().length < 4) {
      return NextResponse.json({ error: "A reason is required for every change." }, { status: 400 });
    }
    const RATE_TYPES = ["FIXED", "1M_EIBOR", "3M_EIBOR", "6M_EIBOR", "1Y_EIBOR"];
    if (!RATE_TYPES.includes(String(rateType))) {
      return NextResponse.json({ error: "Unknown rate type." }, { status: 400 });
    }
    const isFixed = rateType === "FIXED";
    if (isFixed && (termYears == null || !Number.isFinite(Number(termYears)))) {
      return NextResponse.json({ error: "A fixed line needs a term." }, { status: 400 });
    }
    const p = await db.bankProduct.findUnique({ where: { id: Number(bankProductId) } });
    if (!p) return NextResponse.json({ error: "product not found" }, { status: 404 });
    const pricing = parsePricing(p.pricingJson);
    const target = pricing?.quotes?.[Number(quoteIndex)];
    if (!target) return NextResponse.json({ error: "card not found — the rate card may have changed" }, { status: 404 });

    // The axes an admin ticks are the axes the ENGINE matches on, so they are written
    // to the set fields (`txns`, `salaryTransfer`) AND the legacy scalars cleared —
    // leaving `txn`/`stl` behind would let a stale scalar out-vote the new set.
    const cleanTxns = Array.isArray(txns) ? txns.map(String).filter(Boolean) : [];
    const cleanStl = Array.isArray(salaryTransfer)
      ? salaryTransfer.map(String).filter((s: string) => s === "STL" || s === "NSTL") as Array<"STL" | "NSTL">
      : [];
    const updated: RateQuote = {
      ...target,
      txns: cleanTxns.length ? cleanTxns : null,
      txn: null,
      salaryTransfer: cleanStl.length && cleanStl.length < 2 ? cleanStl : null,
      stl: null,
      rateType: rateType as RateQuote["rateType"],
      termYears: isFixed ? Number(termYears) : 0,
      verifiedAt: todayISO(),
    };
    if (isFixed) {
      const basis = (String(eiborBasis ?? "3M") || "3M") as "1M" | "3M" | "6M" | "1Y";
      if (target.variableAfter) updated.variableAfter = { ...target.variableAfter, basis };
      else if (!updated.variableAfter) updated.variableAfter = { basis, marginPct: 0 };
    }
    const quotes = [...(pricing as ProductPricing).quotes];
    quotes[Number(quoteIndex)] = updated;
    await db.bankProduct.update({ where: { id: p.id }, data: { pricingJson: JSON.stringify({ quotes }) } });
    await audit({
      entity: "BankProduct", entityId: p.id, action: "update",
      field: `quotes[${quoteIndex}].axes`,
      beforeVal: { txns: target.txns ?? null, txn: target.txn ?? null, salaryTransfer: target.salaryTransfer ?? null, stl: target.stl ?? null, rateType: target.rateType, termYears: target.termYears ?? null },
      afterVal: { txns: updated.txns ?? null, salaryTransfer: updated.salaryTransfer ?? null, rateType: updated.rateType, termYears: updated.termYears ?? null },
      reason: String(reason).trim(), actorId: g.me.id, actorName: g.me.name,
    });
    return NextResponse.json({ ok: true });
  }

  // --- SLOT ADD: open a NEW row in a master -------------------------------
  // A master's rows are its rate lines (one per transaction x term x STL). There
  // was no way to add one — the grid could only edit rows an importer happened to
  // leave behind, so a bank publishing a NEW transaction type had nowhere to go.
  //
  // The new row is created EMPTY with its axes filed and no rate. That is the
  // honest state: "we know this combination exists, we have not been told the
  // price". It sorts with the other empty rows and carries the `no rate` flag, so
  // it cannot be mistaken for a filed price of zero.
  if (body?.kind === "slot-add") {
    const { bankProductId, txns, termYears, rateType, eiborBasis, salaryTransfer, reason } = body ?? {};
    if (bankProductId == null) {
      return NextResponse.json({ error: "bankProductId required — a row belongs to a master." }, { status: 400 });
    }
    if (!reason || String(reason).trim().length < 4) {
      return NextResponse.json({ error: "A reason is required for every change." }, { status: 400 });
    }
    const RATE_TYPES = ["FIXED", "1M_EIBOR", "3M_EIBOR", "6M_EIBOR", "1Y_EIBOR"];
    if (!RATE_TYPES.includes(String(rateType))) {
      return NextResponse.json({ error: "Unknown rate type." }, { status: 400 });
    }
    const isFixed = rateType === "FIXED";
    if (isFixed && (termYears == null || !Number.isFinite(Number(termYears)))) {
      return NextResponse.json({ error: "A fixed line needs a term — pick how many years." }, { status: 400 });
    }
    const p = await db.bankProduct.findUnique({ where: { id: Number(bankProductId) } });
    if (!p) return NextResponse.json({ error: "product not found" }, { status: 404 });
    const pricing = parsePricing(p.pricingJson);
    const existing = pricing?.quotes ?? [];

    const cleanTxns = Array.isArray(txns) ? txns.map(String).filter(Boolean) : [];
    const cleanStl = Array.isArray(salaryTransfer)
      ? salaryTransfer.map(String).filter((s: string) => s === "STL" || s === "NSTL") as Array<"STL" | "NSTL">
      : [];
    const basis = (String(eiborBasis ?? "3M") || "3M") as "1M" | "3M" | "6M" | "1Y";

    // Refuse a duplicate: two rows with the same axes and no rate is a row nobody
    // can tell apart from the one beside it, and the second would shadow the first
    // in a rate resolution. Matched on the SET fields the engine actually reads.
    const sameTxns = (a?: string[] | null) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...cleanTxns].sort());
    const sameStl = (a?: Array<"STL" | "NSTL"> | null) =>
      JSON.stringify([...(a ?? [])].sort()) === JSON.stringify(cleanStl.length && cleanStl.length < 2 ? [...cleanStl].sort() : []);
    const clash = existing.find((q) =>
      q.rateType === rateType
      && (isFixed ? Number(q.termYears) === Number(termYears) : true)
      && sameTxns(q.txns)
      && sameStl(q.salaryTransfer)
      && q.status !== "CLOSED");
    if (clash) {
      return NextResponse.json({
        error: "That row already exists in this master — edit it instead of adding a second one.",
      }, { status: 409 });
    }

    const newLine: RateQuote = {
      rateType: rateType as RateQuote["rateType"],
      termYears: isFixed ? Number(termYears) : 0,
      ratePct: null,
      marginPct: isFixed ? null : null,
      floorPct: null,
      txns: cleanTxns.length ? cleanTxns : null,
      txn: null,
      salaryTransfer: cleanStl.length && cleanStl.length < 2 ? cleanStl : null,
      stl: null,
      variableAfter: isFixed ? { basis, marginPct: 0 } : null,
      verifiedAt: null,   // a brand-new row asserts nothing — it is not "confirmed"
    };
    const quotes = [...existing, newLine];
    await db.bankProduct.update({ where: { id: p.id }, data: { pricingJson: JSON.stringify({ quotes }) } });
    await audit({
      entity: "BankProduct", entityId: p.id, action: "create",
      field: `quotes[${quotes.length - 1}]`,
      beforeVal: null,
      afterVal: { rateType, termYears: newLine.termYears, txns: newLine.txns, salaryTransfer: newLine.salaryTransfer, ratePct: null },
      reason: String(reason).trim(), actorId: g.me.id, actorName: g.me.name,
    });
    return NextResponse.json({ ok: true, quoteIndex: quotes.length - 1 });
  }

  // --- MASTER AXES: change the pinned family identity (employment, residency, type) ---
  // Employment and residency change the RULES, not just the price, so a master cannot
  // hold two of either. Rewriting them must also rewrite the derived NAME — a name that
  // disagrees with its own axes is how bank 16 ended up with two blank-type variants.
  if (body?.kind === "master-axes") {
    const { productIds, employment, residency, loanKind, financeType, reason } = body ?? {};
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return NextResponse.json({ error: "No products to update." }, { status: 400 });
    }
    if (!reason || String(reason).trim().length < 4) {
      return NextResponse.json({ error: "A reason is required for every change." }, { status: 400 });
    }
    if (!String(employment ?? "").trim() || !String(residency ?? "").trim()) {
      return NextResponse.json({ error: "Employment and residency are the family identity — they cannot be blank." }, { status: 400 });
    }
    const emp = String(employment).trim();
    const res = String(residency).trim();
    const kind = String(loanKind ?? "").trim() || "Conventional";
    const fin = String(financeType ?? "").trim() || "Residential";
    const name = [emp, res, kind, fin !== "Residential" ? fin : null].filter(Boolean).join(" · ");
    let updated = 0;
    for (const raw of productIds) {
      const pid = Number(raw);
      if (!pid) continue;
      const before = await db.bankProduct.findUnique({ where: { id: pid } });
      if (!before) continue;
      await db.bankProduct.update({
        where: { id: pid },
        data: { employment: emp, residency: res, loanKind: kind, financeType: fin, name },
      });
      await audit({
        entity: "BankProduct", entityId: pid, action: "update", field: "masterAxes",
        beforeVal: { name: before.name, employment: before.employment, residency: before.residency, loanKind: before.loanKind, financeType: before.financeType },
        afterVal: { name, employment: emp, residency: res, loanKind: kind, financeType: fin },
        reason: String(reason).trim(), actorId: g.me.id, actorName: g.me.name,
      });
      updated++;
    }
    return NextResponse.json({ ok: true, updated });
  }

  // --- MASTER CREATE: declare a new master (bank + pinned axes) ---
  // A master is a declaration ("DIB sells to self-employed non-residents"), not a
  // by-product of imports. Before this the only path to a new family was importing
  // a policy sheet — there was no way to add one deliberately. Creating one writes
  // a single BankProduct row whose name is DERIVED from the axes (never typed, so
  // it cannot disagree with them) with one starter EMPTY quote the grid can show.
  // Duplicate masters are refused: two nameless rows that differ only by id are
  // exactly the derived-not-declarative problem this fixes.
  if (body?.kind === "master-create") {
    const { bankId, employment, residency, loanKind, financeType, reason } = body ?? {};
    const bid = Number(bankId);
    if (!bid) return NextResponse.json({ error: "Pick the bank this master belongs to." }, { status: 400 });
    if (!reason || String(reason).trim().length < 4) {
      return NextResponse.json({ error: "A reason is required for every change." }, { status: 400 });
    }
    const emp = String(employment ?? "").trim();
    const res = String(residency ?? "").trim();
    if (!emp || !res) {
      return NextResponse.json({ error: "Employment and residency are the family identity — they cannot be blank." }, { status: 400 });
    }
    const kind = String(loanKind ?? "").trim() || "Conventional";
    const fin = String(financeType ?? "").trim() || "Residential";
    const bank = await db.bankItem.findUnique({ where: { id: bid } });
    if (!bank) return NextResponse.json({ error: "Bank not found." }, { status: 404 });
    const clash = await db.bankProduct.findFirst({
      where: { bankId: bid, employment: emp, residency: res, loanKind: kind, financeType: fin },
    });
    if (clash) {
      return NextResponse.json({
        error: `${bank.name} already has “${clash.name}” — open it from the grid instead of creating a duplicate.`,
      }, { status: 409 });
    }
    const name = [emp, res, kind, fin !== "Residential" ? fin : null].filter(Boolean).join(" · ");
    const item = await db.bankProduct.create({
      data: {
        bankId: bid, name,
        sheet: "Manual", employment: emp, residency: res, loanKind: kind, financeType: fin,
        pricingJson: JSON.stringify({ quotes: [{ rateType: "FIXED", termYears: null, ratePct: null, txns: null, salaryTransfer: null, verifiedAt: null }] }),
        feesJson: "{}", insuranceJson: "{}",
        status: "draft", active: true,
        effectiveDate: todayISO(), expiryDate: "2099-12-31",
        approvedBy: null,
      },
    });
    await audit({
      entity: "BankProduct", entityId: item.id, action: "create", field: "master",
      beforeVal: null,
      afterVal: { name, employment: emp, residency: res, loanKind: kind, financeType: fin, bankId: bid },
      reason: String(reason).trim(), actorId: g.me.id, actorName: g.me.name,
    });
    return NextResponse.json({ ok: true, id: item.id });
  }

  // --- CARD edit (rate / follow-on margin / floor / processing fee) ---
  // `field` names WHICH single field moves. Banks routinely send a new rate and
  // nothing else, so this is deliberately one-at-a-time; `applyWholeCard` is opt-in.
  if (body?.kind === "card") {
    const { bankProductId, quoteIndex, field, value, effectiveFrom, reason, applyWholeCard } = body;
    if (bankProductId == null || quoteIndex == null || !field) {
      return NextResponse.json({ error: "bankProductId, quoteIndex & field required" }, { status: 400 });
    }
    if (!reason || String(reason).trim().length < 4) {
      return NextResponse.json({ error: "A reason is required for every change." }, { status: 400 });
    }
    const num = value === null || value === "" ? null : Number(value);
    if (num != null && (!Number.isFinite(num) || num < 0 || num > 100)) {
      return NextResponse.json({ error: "Enter a percentage between 0 and 100." }, { status: 400 });
    }
    // A stress rule is a TYPED value (a kind plus a number), not a plain percentage,
    // so it carries `stressKind` and is checked against the union rather than 0-100.
    const stressKind = field === "stress" ? String(body.stressKind ?? "NONE") : null;
    const STRESS_KINDS = ["FLAT", "EIBOR_PLUS_MARGIN", "RELATIVE_TO_FOLLOWON", "FLOOR_PLUS", "NONE"];
    if (field === "stress" && !STRESS_KINDS.includes(stressKind ?? "")) {
      return NextResponse.json({ error: "Unknown stress rule type." }, { status: 400 });
    }
    const from = String(effectiveFrom ?? todayISO()).slice(0, 10);
    const p = await db.bankProduct.findUnique({ where: { id: Number(bankProductId) } });
    if (!p) return NextResponse.json({ error: "product not found" }, { status: 404 });
    const pricing = parsePricing(p.pricingJson);
    const target = pricing?.quotes?.[Number(quoteIndex)];
    if (!target) return NextResponse.json({ error: "card not found — the rate card may have changed" }, { status: 404 });

    const floorCfg = await getPricingFloor();
    const prevDay = new Date(new Date(from).getTime() - 86400000).toISOString().slice(0, 10);
    const isFixed = target.rateType === "FIXED";

    // Build the new quote: only the named field moves. `applyWholeCard` is the
    // explicit opt-in for the days a bank does reprice everything at once.
    const FIELDS = ["ratePct", "followOn", "floorPct"];
    // A bank does not send its stress methodology along with a rate card, so opting
    // into "apply the whole card" must never move the stress rule as a side effect.
    const edited = applyWholeCard && field !== "stress"
      ? FIELDS.reduce<RateQuote>((acc, f) => applyCardField(acc, f, num, null), target)
      : applyCardField(target, field, num, stressKind);

    // floor guard, on whatever the edit produced
    const violation = floorViolation(edited, isFixed, floorCfg);
    if (violation) return NextResponse.json({ error: violation }, { status: 400 });

    // processing fee is a PRODUCT field (feesJson), not a quote field
    if (field === "processingFeePct" || (applyWholeCard && field === "processingFeePct")) {
      let fees: { processing?: Record<string, unknown> } = {};
      try { fees = JSON.parse(p.feesJson || "{}"); } catch { fees = {}; }
      const before = (fees.processing as { default?: unknown } | undefined)?.default;
      if (num == null) {
        // A null here is a REVERT, not a zero. Drop the key so the product stops
        // overriding and the bank default shows through again — writing
        // `default: null` would look like a filed fee of nothing and quietly shadow
        // the default with a blank. Sibling fee keys (min/max/slab) are left alone:
        // clearing the row default must not delete a product's other filed fees.
        const { default: _dropped, ...rest } = (fees.processing ?? {}) as Record<string, unknown>;
        fees.processing = rest;
      } else {
        fees.processing = { ...(fees.processing ?? {}), default: num };
      }
      await db.bankProduct.update({ where: { id: p.id }, data: { feesJson: JSON.stringify(fees) } });
      await audit({
        entity: "BankProduct", entityId: p.id, action: "revise", field: "processing.default",
        beforeVal: typeof before === "number" ? before : null, afterVal: num, reason, actorId: g.me.id, actorName: g.me.name,
      });
      return NextResponse.json({ ok: true });
    }

    const closedLine = { ...edited, effectiveTo: prevDay };
    const newLine = { ...edited, effectiveFrom: from, effectiveTo: null, note: `${edited.note ? edited.note + " — " : ""}revised ${from}` };
    const quotes = [...(pricing as ProductPricing).quotes];
    quotes[Number(quoteIndex)] = closedLine;
    quotes.push(newLine);
    await db.bankProduct.update({ where: { id: p.id }, data: { pricingJson: JSON.stringify({ quotes }) } });
    await audit({
      entity: "BankProduct", entityId: p.id, action: "revise",
      field: `quotes[${quoteIndex}].${field}`,
      beforeVal: { ...target, effectiveTo: prevDay }, afterVal: newLine,
      reason, actorId: g.me.id, actorName: g.me.name,
    });
    return NextResponse.json({ ok: true });
  }

  // --- BULK: one field, many cards (a bank repricing its whole card at once) ---
  //
  // ATOMIC by design. Every selected card is edited and floor-checked in memory
  // first, and nothing is written until all of them pass. A batch that quietly
  // half-applies is worse than one that refuses: the admin would believe a whole
  // rate card moved when only a third of it did, and the half that moved is the
  // half nobody re-checks.
  if (body?.kind === "bulk") {
    const { cards: sel, field, value, mode: rawMode, effectiveFrom, reason, stressKind } = body;
    // "set" = every selected card becomes this number; "shift" = every card moves by
    // it (−5bps across the board). The server computes the per-card result so the
    // preview the admin approved and what actually lands cannot diverge.
    const mode: "set" | "shift" = rawMode === "shift" ? "shift" : "set";
    if (!Array.isArray(sel) || sel.length === 0) {
      return NextResponse.json({ error: "Select at least one card." }, { status: 400 });
    }
    if (!field) return NextResponse.json({ error: "field required" }, { status: 400 });
    if (!reason || String(reason).trim().length < 4) {
      return NextResponse.json({ error: "A reason is required for every change." }, { status: 400 });
    }
    if (sel.length > 500) {
      return NextResponse.json({ error: "That is more than 500 cards — narrow the filter first." }, { status: 400 });
    }
    if (field === "processingFeePct") {
      return NextResponse.json({ error: "The processing fee is a product fee, not a card field — edit it on one card." }, { status: 400 });
    }
    if (field === "stress" && !["FLAT", "EIBOR_PLUS_MARGIN", "RELATIVE_TO_FOLLOWON", "FLOOR_PLUS", "NONE"].includes(String(stressKind ?? ""))) {
      return NextResponse.json({ error: "Pick a stress rule type." }, { status: 400 });
    }
    if (field === "stress" && mode === "shift") {
      return NextResponse.json({ error: "A stress rule is set, not shifted — pick \"set to\"." }, { status: 400 });
    }
    const num = value === null || value === "" ? null : Number(value);
    // a shift is a delta, so it may be negative; a set is a rate, so it may not
    if (num != null && !Number.isFinite(num)) {
      return NextResponse.json({ error: "Enter a number." }, { status: 400 });
    }
    if (num != null && mode === "set" && (num < 0 || num > 100)) {
      return NextResponse.json({ error: "Enter a percentage between 0 and 100." }, { status: 400 });
    }
    if (num != null && mode === "shift" && (num < -20 || num > 20)) {
      return NextResponse.json({ error: "A shift of more than 20 points at once is almost certainly a typo — split it into two steps if it is real." }, { status: 400 });
    }
    const from = String(effectiveFrom ?? todayISO()).slice(0, 10);
    const prevDay = new Date(new Date(from).getTime() - 86400000).toISOString().slice(0, 10);
    const floorCfg = await getPricingFloor();

    // group by product so each pricingJson is read and written exactly once
    const byProduct = new Map<number, number[]>();
    for (const c of sel) {
      const pid = Number(c?.bankProductId);
      const qi = Number(c?.quoteIndex);
      if (!pid || Number.isNaN(qi)) continue;
      if (!byProduct.has(pid)) byProduct.set(pid, []);
      byProduct.get(pid)!.push(qi);
    }
    if (byProduct.size === 0) return NextResponse.json({ error: "Nothing selectable was sent." }, { status: 400 });

    // ---- draft every change, validate, and only then write ----
    interface Draft { pid: number; name: string; quotes: RateQuote[]; before: RateQuote[]; after: RateQuote[]; indices: number[] }
    const drafts: Draft[] = [];
    const problems: string[] = [];

    for (const [pid, indices] of byProduct) {
      const p = await db.bankProduct.findUnique({ where: { id: pid } });
      if (!p) { problems.push(`product ${pid} no longer exists`); continue; }
      const pricing = parsePricing(p.pricingJson);
      const quotes = [...(pricing?.quotes ?? [])];
      if (!pricing?.quotes?.length) { problems.push(`${p.name}: has no rate lines`); continue; }

      const before: RateQuote[] = [];
      const after: RateQuote[] = [];
      for (const qi of indices) {
        const target = quotes[qi];
        if (!target) { problems.push(`${p.name}: card ${qi} no longer exists`); continue; }
        // A shift against a blank field cannot be computed, so it blocks the batch
        // rather than being silently skipped.
        const cur = currentCardValue(target, field);
        if (mode === "shift" && cur == null) {
          problems.push(`${p.name} · ${target.txns?.join("/") ?? "card"}: has no current value to shift — set it instead`);
          continue;
        }
        const next = bulkNextValue(target, field, mode, num);
        const edited = applyCardField(target, field, next, field === "stress" ? String(stressKind ?? "NONE") : null);
        const bad = floorViolation(edited, target.rateType === "FIXED", floorCfg);
        if (bad) { problems.push(`${p.name} · ${target.txns?.join("/") ?? "card"}: ${bad}`); continue; }
        quotes[qi] = { ...edited, effectiveTo: prevDay };
        quotes.push({ ...edited, effectiveFrom: from, effectiveTo: null, note: `${edited.note ? edited.note + " — " : ""}revised ${from}` });
        before.push({ ...target, effectiveTo: prevDay });
        after.push(quotes[quotes.length - 1]);
      }
      drafts.push({ pid, name: p.name, quotes, before, after, indices });
    }

    if (problems.length) {
      // refuse the WHOLE batch rather than the offending cards — a partial reprice
      // leaves the catalogue in a state neither the admin nor anyone after them
      // would expect.
      return NextResponse.json({ error: `Nothing was changed. ${problems.length} card(s) blocked the batch:`, problems: problems.slice(0, 8) }, { status: 400 });
    }

    let touched = 0;
    for (const dft of drafts) {
      await db.bankProduct.update({ where: { id: dft.pid }, data: { pricingJson: JSON.stringify({ quotes: dft.quotes }) } });
      await audit({
        entity: "BankProduct", entityId: dft.pid, action: "revise",
        field: `quotes[${dft.indices.join(",")}].${field} (bulk)`,
        beforeVal: dft.before, afterVal: dft.after,
        reason: `${reason} — bulk change, ${dft.indices.length} card(s) on this product`,
        actorId: g.me.id, actorName: g.me.name,
      });
      touched += dft.indices.length;
    }
    return NextResponse.json({ ok: true, updated: touched, products: drafts.length });
  }

  // --- rate revision (legacy path, kept for the calculator/other callers) ---
  // A revision NEVER mutates the live line: it closes the old line the day before
  // the effective date and appends a new dated line. Same Finacle pattern the quote
  // editor uses, so a 5bp change never rewrites history.
  const { bankProductId, quoteIndex, patch, effectiveFrom, reason } = body ?? {};
  if (bankProductId == null || quoteIndex == null) {
    return NextResponse.json({ error: "bankProductId & quoteIndex required" }, { status: 400 });
  }
  if (!reason || !String(reason).trim()) {
    return NextResponse.json({ error: "A reason is required for every rate change." }, { status: 400 });
  }
  const from = String(effectiveFrom ?? todayISO()).slice(0, 10);
  const p = await db.bankProduct.findUnique({ where: { id: Number(bankProductId) } });
  if (!p) return NextResponse.json({ error: "product not found" }, { status: 404 });

  const pricing = parsePricing(p.pricingJson);
  const target = pricing?.quotes?.[Number(quoteIndex)];
  if (!target) {
    return NextResponse.json({ error: "quote line not found — the rate card may have changed" }, { status: 404 });
  }

  // floor guard: refuse a revision that breaches the admin floor
  const floor = await getPricingFloor();
  const edited: RateQuote = { ...target, ...(patch ?? {}) };
  if (floor.minFixedRatePct != null && edited.rateType === "FIXED" && edited.ratePct != null && edited.ratePct < floor.minFixedRatePct - 0.005) {
    return NextResponse.json({ error: `Below the HFMC floor (${floor.minFixedRatePct}%). Adjust the floor in Admin → Pricing floor first, if that is intended.` }, { status: 400 });
  }
  if (floor.minMarginBps != null && edited.rateType !== "FIXED" && edited.marginPct != null && edited.marginPct < floor.minMarginBps / 100 - 0.005) {
    return NextResponse.json({ error: `Margin below the HFMC floor (${floor.minMarginBps}bps).` }, { status: 400 });
  }
  if (floor.hardStopPct != null) {
    const eff = edited.rateType === "FIXED" ? edited.ratePct : edited.marginPct;
    if (eff != null && eff < floor.hardStopPct - 0.005) {
      return NextResponse.json({ error: `Below the hard stop (${floor.hardStopPct}%) — this line would not be priced.` }, { status: 400 });
    }
  }

  const prevDay = new Date(new Date(from).getTime() - 86400000).toISOString().slice(0, 10);
  const closedLine = { ...edited, effectiveTo: prevDay };
  const newLine = { ...edited, effectiveFrom: from, effectiveTo: null, note: `${edited.note ? edited.note + " — " : ""}revised ${from}` };

  const quotes = [...(pricing as ProductPricing).quotes];
  quotes[Number(quoteIndex)] = closedLine;
  quotes.push(newLine);

  const updated = await db.bankProduct.update({
    where: { id: p.id },
    data: { pricingJson: JSON.stringify({ quotes }) },
  });

  await audit({
    entity: "BankProduct",
    entityId: p.id,
    action: "revise",
    field: `quotes[${quoteIndex}]`,
    beforeVal: { ...target, effectiveTo: prevDay },
    afterVal: newLine,
    reason,
    actorId: g.me.id,
    actorName: g.me.name,
  });

  return NextResponse.json({ ok: true, product: updated });
}

