// GET /api/products/[id] — the PRODUCT SUMMARY SHEET.
//
// One product, fully expanded, for the "what exactly is this?" question a broker
// asks before quoting. The fields are read from the SAME structured sources the
// pricing engine reads (pricingJson / feesJson / insuranceJson), never re-parsed from
// display text, so this sheet can never disagree with what the engine will quote.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { parsePricing } from "@/lib/bank-pricing";
import { parseFees, parseInsurance } from "@/lib/bank-fees";
import { emi, loanForEmi } from "@/lib/calc";

/** The benchmark rate a quote reverts to once its fixed period ends. */
function basisOf(q: { rateType: string; variableAfter?: { basis: string } | null }): string | null {
  if (q.rateType === "FIXED" && !q.variableAfter) return null;
  return (q.variableAfter?.basis ?? q.rateType).replace("_EIBOR", "");
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = parseInt((await params).id, 10);
  if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const [prod, eiborRows] = await Promise.all([
    db.bankProduct.findUnique({
      where: { id },
      include: { bank: { select: { name: true, id: true, logoData: true, posPoints: true, negPoints: true } } },
    }),
    db.eiborRate.findMany(),
  ]);
  if (!prod) return NextResponse.json({ error: "product not found" }, { status: 404 });

  const pricing = parsePricing(prod.pricingJson);
  const fees = parseFees(prod.feesJson);
  const ins = parseInsurance(prod.insuranceJson);
  const eibor: Record<string, number> = Object.fromEntries(eiborRows.map((e) => [e.tenor, e.ratePct]));
  const r3 = (n: number) => Math.round(n * 1000) / 1000;

  // Every rate line this product publishes, each fully resolved against TODAY's
  // EIBOR, so the sheet shows "3.75% now, 3m EIBOR + 1.75% after" rather than a bare
  // margin the reader has to add up themselves.
  const SAMPLE_LOAN = 1_000_000;
  const quotes = (pricing?.quotes ?? []).map((q) => {
    const basis = basisOf(q);
    const eiborNow = basis ? eibor[basis] ?? null : null;
    const margin = q.variableAfter?.marginPct ?? (q.rateType === "FIXED" ? null : q.marginPct ?? null);
    const effective = q.rateType === "FIXED"
      ? (q.ratePct ?? null)
      : (eiborNow != null && margin != null ? r3(eiborNow + margin) : null);
    const followOn = eiborNow != null && q.variableAfter?.marginPct != null
      ? r3(eiborNow + q.variableAfter.marginPct)
      : q.rateType !== "FIXED" ? effective : null;
    const y = prod.tenorYears ?? 25;
    const emiAt = (rate: number) => Math.round(emi(SAMPLE_LOAN, rate, y));
    return {
      ...q,
      eiborBasis: basis,
      eiborRateNow: eiborNow,
      effectiveRatePct: effective,
      followOnRatePct: followOn,
      // a worked example makes the follow-on concrete instead of abstract
      worked: effective != null
        ? { emi: emiAt(effective), followOnEmi: followOn != null ? emiAt(followOn) : null }
        : null,
    };
  });

  // How much could be borrowed at this rate? Indicative on a sample EMI only.
  const sampleEmi = quotes.find((q) => q.worked)?.worked?.emi ?? null;
  const sampleRate = quotes.find((q) => q.worked)?.effectiveRatePct ?? null;
  const maxAtSample =
    sampleEmi != null && sampleRate != null
      ? Math.round(loanForEmi(sampleEmi, sampleRate, prod.tenorYears ?? 25))
      : null;

  return NextResponse.json({
    product: {
      id: prod.id,
      name: prod.name,
      sheet: prod.sheet,
      status: prod.status,
      version: prod.version ?? 1,
      effectiveDate: prod.effectiveDate ?? null,
      expiryDate: prod.expiryDate ?? null,
      updatedAt: prod.updatedAt.toISOString(),
      approvedBy: prod.approvedBy ?? "",
      sourceFiles: prod.sourceFiles ?? "",
      bank: {
        name: prod.bank?.name ?? "",
        logoUrl: prod.bank?.logoData ? `/api/banks/${prod.bank.id}/logo` : null,
        posPoints: prod.bank?.posPoints ?? "",
        negPoints: prod.bank?.negPoints ?? "",
      },
      // axes
      mortgageType: prod.loanKind || "—",
      employment: prod.employment,
      residency: prod.residency,
      financeType: prod.financeType,
      program: prod.program,
      isExclusive: prod.isExclusive || (parsePricing(prod.pricingJson)?.quotes ?? []).some((q) =>
        (q.profiles ?? []).some((p) => /exclusive/i.test(p)),
      ),
      // limits — the "who does this suit" block
      maxLtvNational: prod.maxLtvNational,
      maxLtvExpatriate: prod.maxLtvExpatriate,
      minLoan: prod.minLoan,
      maxLoan: prod.maxLoan,
      minSalary: prod.minSalary,
      serviceMonthsMin: prod.serviceMonthsMin,
      propertyAgeYearsMax: prod.propertyAgeYearsMax,
      firstPropertyOnly: prod.firstPropertyOnly,
      tenorYears: prod.tenorYears,
      maxAgeSalaried: (prod as unknown as { maxAgeSalaried?: number | null }).maxAgeSalaried,
      maxAgeSelfEmp: (prod as unknown as { maxAgeSelfEmp?: number | null }).maxAgeSelfEmp,
      dbrPct: prod.dbrPct,
      cardRulePct: prod.cardRulePct,
      bonusPct: prod.bonusPct,
      rentalIncomePct: prod.rentalIncomePct,
      stressBufferPct: prod.stressBufferPct,
      tat: {
        totalTatDays: prod.totalTatDays,
        paTatDays: prod.paTatDays,
        paValidityDays: prod.paValidityDays,
        folValidityDays: prod.folValidityDays,
        valuationValidityDays: prod.valuationValidityDays,
      },
    },
    quotes,
    fees,
    insurance: ins,
    sampleLoan: SAMPLE_LOAN,
    maxAtSample,
    eibor,
    // untouched source text — the safety net when a field is missing or wrong
    raw: {
      rateTable: prod.rateTable,
      fees: prod.fees,
      insurance: prod.insurance,
      eligibility: prod.eligibility,
      documents: prod.documents,
      notes: prod.notes,
    },
  });
}
