// POST /api/proposal — assembles everything a proposal document needs:
// case summary, matched product results, transfer-fee cost sheet (from the
// FeeRule engine), the case's document checklist, and bank logos.
// mode "internal" includes commission — only for viewRevenue designations.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { serCase, serDocRule } from "@/lib/ser";
import { runBankMatch, canonicalTxn } from "@/lib/bank-match";
import type { FeeRule } from "@/lib/types";

export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  const body = await req.json();

  const requestedMode: "client" | "internal" = body.mode === "internal" ? "internal" : "client";
  const mode = flags.viewRevenue ? requestedMode : "client";

  const c = await db.loanCase.findUnique({ where: { id: parseInt(body.caseId, 10) } });
  if (!c) return NextResponse.json({ error: "case not found" }, { status: 404 });

  const input = {
    employmentProfile: body.employmentProfile ?? c.employmentProfile,
    residency: body.residency ?? c.residency,
    transactionType: body.transactionType ?? c.transactionType,
    loanAmount: Number(body.loanAmount) || c.loanAmount,
    propertyValue: Number(body.propertyValue) || 0,
    monthlyIncome: Number(body.monthlyIncome) || 0,
    existingEmis: Number(body.existingEmis) || 0,
    cardLimitsTotal: Number(body.cardLimitsTotal) || 0,
    rentalIncome: Number(body.rentalIncome) || 0,
    bonusIncome: Number(body.bonusIncome) || 0,
    stl: body.stl ?? true,
    termYears: Number(body.termYears) || 3,
  };

  const all = await runBankMatch(input);
  const ids: number[] = Array.isArray(body.productIds) ? body.productIds.map(Number) : [];
  const results = (ids.length ? all.filter((r) => ids.includes(r.bankProductId)) : all).filter(
    (r) => r.verdict !== "not_eligible",
  );
  if (results.length === 0) return NextResponse.json({ error: "no eligible products selected" }, { status: 400 });

  // cost-to-close: transfer fees from the FeeRule engine for this emirate/txn
  const txn = canonicalTxn(input.transactionType);
  const feeTxn = txn === "Primary Handover" ? "Primary" : txn.startsWith("Buyout") || txn === "Equity Release" ? "Buyout" : "Resale";
  const emirate = (c.propertyLocation || "Dubai").includes("Abu") ? "Abu Dhabi" : "Dubai";
  const feeRules = (await db.feeRule.findMany({ where: { active: true } })).map((f) => f as unknown as FeeRule);
  const transferFees = feeRules
    .filter((f) => f.emirate === emirate && f.txnType === feeTxn)
    .map((f) => ({
      label: f.label,
      note: f.note,
      paidBy: f.paidBy,
      amount:
        f.amountType === "fixed" ? f.amount
        : f.amountType === "pct_property" ? Math.round((input.propertyValue * f.amount) / 100)
        : Math.round((input.loanAmount * f.amount) / 100),
    }));
  const clientTransferFees = transferFees.filter((f) => f.paidBy === "Client");
  const transferTotal = clientTransferFees.reduce((s, f) => s + f.amount, 0);
  const equity = Math.max(input.propertyValue - input.loanAmount, 0);

  // document checklist (active vault docs for the case)
  const vaultDocs = await db.caseDocument.findMany({ where: { caseId: c.id }, orderBy: { sortOrder: "asc" } });
  const checklist = vaultDocs
    .filter((d) => (mode === "client" ? d.visibleToClient : true))
    .map((d) => ({ title: d.title, category: d.category, status: d.status, mandatory: d.mandatory }));

  const bankIds = [...new Set(results.map((r) => r.bankProductId))];
  const products = await db.bankProduct.findMany({ where: { id: { in: bankIds } }, include: { bank: { select: { id: true, name: true, logoData: true, logoType: true } } } });
  const bankLogos = products.map((p) => ({
    bankName: p.bank.name,
    logoUrl: p.bank.logoData ? `/api/banks/${p.bank.id}/logo` : null,
  }));
  const logoFor = (bankName: string) => bankLogos.find((b) => b.bankName === bankName)?.logoUrl ?? null;
  // commission per bank (internal mode only, revenue-gated above)
  const commission: Record<number, { gross: number; partnerCut: number; net: number; ratePct: number; partnerSharePct: number }> = {};
  if (mode === "internal") {
    const bankRows = await db.bankItem.findMany();
    const partnerShare = (c.partnerSharePct ?? 0) / 100;
    for (const r of results) {
      const b = bankRows.find((x) => x.id === (products.find((pp) => pp.id === r.bankProductId)?.bankId ?? -1));
      if (!b) continue;
      const gross = Math.round((input.loanAmount * b.ratePct) / 100);
      const partnerCut = Math.round(gross * partnerShare);
      commission[r.bankProductId] = { gross, partnerCut, net: gross - partnerCut, ratePct: b.ratePct, partnerSharePct: c.partnerSharePct ?? 0 };
    }
  }



  return NextResponse.json({
    mode,
    generatedAt: new Date().toISOString(),
    case: {
      caseNumber: c.caseNumber, customer: c.customer,
      employmentProfile: input.employmentProfile, residency: input.residency,
      transactionType: input.transactionType, propertyType: c.propertyType,
      loanAmount: input.loanAmount, propertyValue: input.propertyValue,
      emirate, feeTxn,
    },
    input,
    results: results.map((r) => ({ ...r, logoUrl: logoFor(r.bankName), commission: mode === "internal" ? commission[r.bankProductId] ?? null : null })),
    costs: {
      equity,
      transferFees: clientTransferFees,
      sellerFees: transferFees.filter((f) => f.paidBy === "Seller"),
      transferTotal,
      grossCashNeeded: equity + transferTotal,
    },
    checklist,
    docRuleCount: (await db.docRule.count({ where: { active: true } })),
  });
}
