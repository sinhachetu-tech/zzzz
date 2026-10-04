// Assemble the RATE CARDS the admin grid shows.
//
// Kept separate from the route so it can be unit-tested and reused by the product
// detail sheet.
//
// The whole point: a row is a CARD (rate + follow-on + floor + processing fee), not a
// rate. Those four numbers travel together and are read together, but lived in
// pricingJson / feesJson / a 900-line modal — which is why pricing felt scattered.
import {
  parsePricing, VOLATILITY, cardField, staleness,
  type ProductPricing, type CardField, type InheritedFrom, type RateCard, type RateQuote,
} from "@/lib/bank-pricing";
import { feePromoNeedsReview, type BankFees } from "@/lib/bank-fees";
import { db } from "@/lib/db";
import { todayISO } from "@/lib/format";

/** The parsed processing block, so a promotional rate can be inspected as well as
 *  read. Returns null when feesJson is absent or unparseable — a missing fee must
 *  stay missing rather than becoming 0. */
function readFees(json: string | null | undefined): {
  processingDefault: number | null;
  obj: BankFees | null;
} {
  try {
    const parsed = JSON.parse(json || "{}") as BankFees;
    const d = parsed?.processing?.default;
    return { processingDefault: typeof d === "number" ? d : null, obj: parsed ?? null };
  } catch {
    return { processingDefault: null, obj: null };
  }
}

export interface CardBank {
  id: number; name: string;
  defaultProcessingFeePct: number | null;
  stressBufferPct: number | null;
}

export interface CardProduct {
  id: number; bankId: number; name: string; employment: string; residency: string;
  loanKind: string; financeType: string; effectiveDate: string | null; expiryDate: string;
  pricingJson: string; feesJson: string; stressBufferPct: number | null;
  isExclusive: boolean;
  /** Grid visibility only: a draft master exists and waits for its first rate,
      but the client engine still reads approved rows exclusively. */
  status: string;
}

/** Build one card per quote line, with every field resolved and its source recorded. */
export function buildCards(
  products: CardProduct[],
  banks: CardBank[],
  eibor: Record<string, number>,
): RateCard[] {
  const bankById = new Map(banks.map((b) => [b.id, b]));
  const today = todayISO();
  const cards: RateCard[] = [];

  for (const p of products) {
    // the same active-version walk the engine uses, so a card is never shown for a
    // line the engine would ignore (and vice versa)
    const eff = p.effectiveDate ? p.effectiveDate.slice(0, 10) : "";
    const exp = p.expiryDate ? p.expiryDate.slice(0, 10) : "2099-12-31";
    if (eff && eff > today) continue;
    if (exp && exp < today) continue;

    const bank = bankById.get(p.bankId);
    if (!bank) continue;

    const pricing: ProductPricing | null = parsePricing(p.pricingJson);
    if (!pricing?.quotes?.length) continue;
    const fees = readFees(p.feesJson);
    const feeObj = fees.obj;

    pricing.quotes.forEach((q, i) => {
      const isFixed = q.rateType === "FIXED";
      const ratePct = isFixed ? (q.ratePct ?? null) : null;
      // the follow-on MARGIN. There is deliberately no bank-level fallback: which
      // card you get depends on the axes, so a single "bank default margin" is
      // meaningless. Unfiled stays null and is shown as "not recorded".
      const followOn = q.variableAfter?.marginPct ?? (!isFixed ? q.marginPct ?? null : null);
      const floorPct = q.variableAfter?.floorPct ?? q.floorPct ?? null;

      // processing fee: PRODUCT first, then the bank default. This is the off-plan
      // case — a product overrides the bank's 0.525% with its own 0.25%.
      const feeFrom: InheritedFrom = fees.processingDefault != null
        ? "product" : bank.defaultProcessingFeePct != null ? "bank" : "norm";
      const feeValue = fees.processingDefault ?? bank.defaultProcessingFeePct ?? null;

      const basis = q.variableAfter?.basis ?? (isFixed ? null : q.rateType.replace("_EIBOR", ""));
      const eiborNow = basis ? eibor[basis] ?? null : null;
      const resolvedRatePct = isFixed
        ? ratePct
        : (eiborNow != null && followOn != null ? Math.round((eiborNow + followOn) * 1000) / 1000 : null);

      const issues: RateCard["issues"] = [];
      if (isFixed && ratePct == null) issues.push({ code: "no-rate", label: "no rate", severity: "error" });
      if (isFixed && !q.variableAfter) issues.push({ code: "no-followon", label: "no follow-on", severity: "warn" });
      if (floorPct == null) issues.push({ code: "no-floor", label: "no floor", severity: "warn" });
      if (p.stressBufferPct == null && bank.stressBufferPct == null) {
        issues.push({ code: "no-stress", label: "no stress buffer", severity: "warn" });
      }
      if (feeValue == null) issues.push({ code: "no-fee", label: "no processing fee", severity: "warn" });
    if (p.status === "draft") issues.push({ code: "draft", label: "draft — not quoted to clients", severity: "warn" });
      // An expired (or undated) promotion must be an ERROR, not a warning: it is
      // currently quoting clients a fee the bank does not charge. 11 DIB products
      // carried a "Q1-Q3 2026 zero processing" promo with nothing to revert it.
      if (feePromoNeedsReview(feeObj, todayISO())) {
        issues.push({ code: "promo-expired", label: "promo fee expired", severity: "error" });
      }


      const first = (a?: string[] | null) => (a && a.length ? a[0] : null);

      // a missing rate is only an error for a card the bank actually offers — some
      // products genuinely do not cover every transaction, and "no rate filed" must
      // not read as "zero percent".
      const hasRate = isFixed ? ratePct != null : followOn != null;

      cards.push({
        key: `${p.id}:${i}`,
        bankProductId: p.id,
        bankId: bank.id,
        bankName: bank.name,
        productName: p.name,
        quoteIndex: i,
        // the slot's own axes, carried so the axes editor has something to open.
        // `slotStl` prefers the SET form and normalises the legacy BOOLEAN
        // (stl:true/false) the old editor wrote -- which is why the column showed
        // "either" while the value quietly meant "STL only".
        slotTxns: [...(q.txns ?? [])],
        slotStl: q.salaryTransfer?.length ? [...q.salaryTransfer] : (q.stl === true ? ["STL"] : q.stl === false ? ["NSTL"] : []),
        slotTermYears: q.termYears ?? null,
        slotRateType: q.rateType,
        slotBasis: basis,
        // MASTER axes, carried so the header editor can open them with the saved
        // values pre-selected (not re-typed), scoped to this bank's own vocabulary.
        masterEmployment: p.employment,
        masterResidency: p.residency,
        masterMortgageType: p.loanKind || "",
        masterFinanceType: p.financeType,
        slotState: q.status === "CLOSED" ? "CLOSED" : hasRate ? "FILLED" : "EMPTY",
        closedReason: q.status === "CLOSED" ? (q.closedReason ?? null) : null,
        closedAt: q.status === "CLOSED" ? (q.closedAt ?? null) : null,
        // staleness: an unverified line is a guess. `never` (the norm for an
        // import) and `stale` (someone did confirm it, long ago) need different
        // responses, so they are deliberately distinct states.
        verification: staleness(q.verifiedAt, today),
        verifiedAt: q.verifiedAt ?? null,
        ratePct: cardField(ratePct, "product", null),
        followOn: cardField(followOn, "product", null),
        floorPct: cardField(floorPct, "product", null),
        processingFeePct: cardField(feeValue, feeFrom, bank.defaultProcessingFeePct ?? undefined),
        stress: describeStress(q.stress, p.stressBufferPct ?? bank.stressBufferPct ?? null),
        rateType: q.rateType,
        termYears: q.termYears ?? null,
        eiborBasis: basis,
        eiborNow,
        resolvedRatePct,
        salaryTransfer: (q.salaryTransfer?.[0] ?? (q.stl != null ? (q.stl ? "STL" : "NSTL") : null)) as "STL" | "NSTL" | null,
        residency: first(q.residency) ?? p.residency,
        employment: first(q.employment) ?? p.employment,
        mortgageType: p.loanKind || "—",
        transaction: q.txns?.length ? q.txns.join("/") : (q.txn ?? "Any"),
        customerProfile: first(q.profiles),
        isExclusive: p.isExclusive,
        ltvMax: q.ftvMax ?? null,
        volatility: { ...VOLATILITY },
        issues,
    effectiveFrom: q.effectiveFrom ?? null,
        effectiveTo: q.effectiveTo ?? null,
      });
    });
  }
  return cards;
}

/**
 * Turn a filed stress rule into something a human can read.
 *
 * Three states, and the difference matters commercially: a TYPED rule is the bank's
 * own methodology; a legacy numeric buffer is an approximation we inferred; "none
 * filed" means the client would be qualified at the follow-on rate with no cushion.
 * Showing all three as a number would hide which is which.
 */
function describeStress(s: RateQuote["stress"], bufferPct: number | null): { kind: string; value: number | null; label: string } {
  if (s && s.kind !== "NONE") {
    const v = s.value ?? null;
    const label =
      s.kind === "FLAT" ? `flat ${v ?? "?"}%`
      : s.kind === "RELATIVE_TO_FOLLOWON" ? `follow-on +${v ?? 0}%`
      : s.kind === "FLOOR_PLUS" ? `floor +${v ?? 0}%`
      : `EIBOR +${v ?? 0}%`;
    return { kind: s.kind, value: v, label };
  }
  if (bufferPct != null && bufferPct > 0) {
    return { kind: "BANK_BUFFER", value: bufferPct, label: `follow-on +${bufferPct}%` };
  }
  return { kind: "NONE", value: null, label: "none filed" };
}

export interface CardBankView {
  id: number; name: string; logoUrl: string | null;
  commissionPct: number;          // explicitly NOT a rate — the source of much confusion
  defaultsVerifiedAt: string;
  offersIslamic: boolean;
  offersConventional: boolean;
  defaultProcessingFeePct: number | null;
  stressBufferPct: number | null;
  maxTenorYears: number | null;
}

/** Load everything the grid needs and assemble it. */
export async function loadCards() {
  const [products, banks, eiborRows] = await Promise.all([
    db.bankProduct.findMany({ where: { status: { in: ["approved", "draft"] }, active: true } }),
    db.bankItem.findMany(),
    db.eiborRate.findMany(),
  ]);
  const eibor: Record<string, number> = Object.fromEntries(eiborRows.map((e) => [e.tenor, e.ratePct]));
  const cards = buildCards(products as unknown as CardProduct[], banks, eibor);
  const used = new Set(cards.map((c) => c.bankId));
  const bankViews: CardBankView[] = banks
    .filter((b) => used.has(b.id))
    .map((b) => ({
      id: b.id,
      name: b.name,
      logoUrl: b.logoData ? `/api/banks/${b.id}/logo` : null,
      commissionPct: b.ratePct,
      defaultsVerifiedAt: b.defaultsVerifiedAt,
      offersIslamic: b.offersIslamic,
      offersConventional: b.offersConventional,
      defaultProcessingFeePct: b.defaultProcessingFeePct,
      stressBufferPct: b.stressBufferPct,
      maxTenorYears: b.maxTenorYears,
    }));
  return { cards, eibor, banks: bankViews };
}
