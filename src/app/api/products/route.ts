// GET /api/products — the PRODUCT BROWSER feed: one flat, filterable, paginated list
// of every live bank rate line.
//
// WHY a new route rather than reusing /api/state: the browser filters on quote-level
// axes (rate, LTV, salary transfer, exclusivity) across hundreds of products and
// paginates. Pushing that through the one-big-state hydrate would re-send the entire
// application payload on every keystroke. This returns only the page being shown.
//
// A "product row" is deliberately a RATE LINE, not a BankProduct: one product can
// publish several rates (1y/3y/5y, STL/NSTL, each with its own follow-on and fees),
// and the axis signature the broker scans for belongs to the rate line.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { parsePricing, type RateQuote } from "@/lib/bank-pricing";

export const PAGE_SIZE = 10;

/** The axis signature a broker scans: what this rate line covers. */
export interface ProductRow {
  key: string;              // `${bankProductId}:${quoteIndex}`
  bankProductId: number;
  bankName: string;
  bankLogoUrl: string | null;
  productName: string;
  quoteIndex: number;
  status: string;
  mortgageType: string;
  salaryTransfer: "STL" | "NSTL" | null;
  residency: string;
  employment: string;
  customerProfile: string | null;
  isExclusive: boolean;
  exclusivityLabel: string | null;
  transactionType: string;
  ltvMax: number | null;
  ratePct: number | null;
  marginPct: number | null;
  rateType: string;
  termYears: number | null;
  followOnLabel: string;
  processingFeePct: number | null;
  minSalary: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  attention: string[];
}

const first = <T,>(a: T[] | null | undefined): T | null => (a && a.length ? a[0] : null);

/** Join the txn set into the "Primary/Resale/Handover" shape brokers actually read. */
function txnLabel(q: RateQuote): string {
  const t = q.txns?.length ? q.txns : (q.txn ? [q.txn] : []);
  return t.length ? t.join("/") : "Any";
}

/** "3M_EIBOR" -> "3m EIBOR"; a fixed quote has no benchmark, so say so plainly. */
function followOnLabel(q: RateQuote): string {
  if (q.rateType === "FIXED" && !q.variableAfter) return "—";
  const basis = (q.variableAfter?.basis ?? q.rateType).replace("_EIBOR", "");
  const pretty = basis === "1Y" ? "1y" : basis.toLowerCase();
  if (q.variableAfter) return `${pretty} EIBOR +${q.variableAfter.marginPct}%`;
  return `${pretty} EIBOR +${q.marginPct ?? 0}%`;
}

export async function GET(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const p = new URL(req.url).searchParams;
  // default to ACTIVE products with NO filter applied — an empty filter must never
  // widen the set; unapproved rows are opt-in via ?active=false
  const activeOnly = p.get("active") !== "false";
  const bank = p.get("bank") ?? "";
  const employment = p.get("employment") ?? "";
  const residency = p.get("residency") ?? "";
  const mortgageType = p.get("mortgageType") ?? "";
  const txn = p.get("txn") ?? "";
  const salaryTransfer = p.get("salaryTransfer") ?? "";
  const exclusivity = p.get("exclusivity") ?? "";   // "" | "exclusive" | "standard"
  const maxRate = p.get("maxRate") ?? "";
  const minLtv = p.get("minLtv") ?? "";
  const maxLtv = p.get("maxLtv") ?? "";
  const q = (p.get("q") ?? "").trim().toLowerCase();
  const page = Math.max(1, parseInt(p.get("page") ?? "1", 10) || 1);

  const products = await db.bankProduct.findMany({
    where: {
      ...(activeOnly ? { status: "approved", active: true } : {}),
      ...(bank ? { bank: { name: bank } } : {}),
    },
    include: { bank: { select: { name: true, id: true, logoData: true } } },
  });

  const today = new Date().toISOString().slice(0, 10);
  const rows: ProductRow[] = [];
  for (const prod of products) {
    // respect the product's own effective window — same rule the engine uses
    const eff = prod.effectiveDate ? prod.effectiveDate.slice(0, 10) : "";
    const exp = prod.expiryDate ? prod.expiryDate.slice(0, 10) : "2099-12-31";
    if (eff && eff > today) continue;
    if (exp && exp < today) continue;

    const pricing = parsePricing(prod.pricingJson);
    const fees = (() => { try { return JSON.parse(prod.feesJson || "{}"); } catch { return {}; } }) as {
      processing?: { default?: number | null } | null;
    };
    // A customer profile lives on the RATE LINE, not the product, and can differ
    // between two lines of the same product — so read it from the quote below.
    // Exclusivity, by contrast, is a property of the PRODUCT (you cannot sell the
    // product at all outside the promotion), so that flag lives on the product.
    const exclusive = prod.isExclusive;

    pricing?.quotes?.forEach((qt, i) => {
      const profile = first(qt.profiles ?? null);
      const rowExclusive = exclusive || /exclusive/i.test(profile ?? "");
      rows.push({
        key: `${prod.id}:${i}`,
        bankProductId: prod.id,
        bankName: prod.bank?.name ?? "",
        bankLogoUrl: prod.bank?.logoData ? `/api/banks/${prod.bank.id}/logo` : null,
        productName: prod.name,
        quoteIndex: i,
        status: prod.status,
        mortgageType: prod.loanKind || "—",
        salaryTransfer: qt.salaryTransfer?.[0] ?? (qt.stl != null ? (qt.stl ? "STL" : "NSTL") : null),
        residency: first(qt.residency) ?? prod.residency,
        employment: first(qt.employment) ?? prod.employment,
        customerProfile: profile,
        isExclusive: rowExclusive,
        exclusivityLabel: rowExclusive ? profile : null,
        transactionType: txnLabel(qt),
        ltvMax: qt.ftvMax ?? null,
        ratePct: qt.rateType === "FIXED" ? (qt.ratePct ?? null) : null,
        marginPct: qt.rateType === "FIXED" ? null : (qt.marginPct ?? null),
        rateType: qt.rateType,
        termYears: qt.termYears ?? null,
        followOnLabel: followOnLabel(qt),
        processingFeePct: fees?.processing?.default ?? null,
        minSalary: prod.minSalary,
        effectiveFrom: qt.effectiveFrom ?? null,
        effectiveTo: qt.effectiveTo ?? null,
        attention: [
          ...(qt.rateType === "FIXED" && !qt.variableAfter ? ["no follow-on"] : []),
          ...(prod.stressBufferPct == null ? ["no stress buffer"] : []),
        ],
      });
    });
  }

  // ---- filters applied in memory: one query, then narrow -------------------
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  const maxRateN = num(maxRate);
  const minLtvN = num(minLtv);
  const maxLtvN = num(maxLtv);
  const filtered = rows.filter((r) => {
    if (employment && r.employment !== employment) return false;
    if (residency && r.residency !== residency) return false;
    if (mortgageType && r.mortgageType !== mortgageType) return false;
    if (txn && r.transactionType !== txn) return false;
    if (salaryTransfer && r.salaryTransfer !== salaryTransfer) return false;
    if (exclusivity === "exclusive" && !r.isExclusive) return false;
    if (exclusivity === "standard" && r.isExclusive) return false;
    if (maxRateN != null) {
      const eff = r.ratePct ?? r.marginPct;
      if (eff == null || eff > maxRateN) return false;
    }
    // A row with no declared LTV cap covers everything, so it satisfies both ends
    // of a band and must be KEPT — dropping it would hide the most flexible offers.
    if (r.ltvMax != null) {
      if (minLtvN != null && r.ltvMax <= minLtvN) return false;
      if (maxLtvN != null && r.ltvMax > maxLtvN) return false;
    }
    if (q && !`${r.bankName} ${r.productName} ${r.customerProfile ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });

  // default sort: cheapest headline rate first, so the broker opens on the best deal.
  // A variable quote's margin is not comparable to a fixed rate, so it is ranked by
  // a rough all-in proxy rather than pretending margin < fixed rate always wins.
  const headline = (r: ProductRow) =>
    r.ratePct ?? (r.marginPct != null ? r.marginPct + 4 : 99);
  const sorted = [...filtered].sort((a, b) => headline(a) - headline(b));

  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE;

  // facet values for the dropdowns, taken from ALL rows so the options never
  // disappear as a side-effect of the current filter
  const uniq = (f: (r: ProductRow) => string | null) =>
    [...new Set(rows.map(f).filter((x): x is string => !!x))].sort();

  return NextResponse.json({
    items: sorted.slice(start, start + PAGE_SIZE),
    page,
    pages,
    total,
    pageSize: PAGE_SIZE,
    facets: {
      banks: uniq((r) => r.bankName),
      employment: uniq((r) => r.employment),
      residency: uniq((r) => r.residency),
      mortgageType: uniq((r) => r.mortgageType),
      transaction: uniq((r) => r.transactionType),
    },
  });
}
