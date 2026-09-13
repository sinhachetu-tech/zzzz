// POST /api/bank-match — run the eligibility engine over approved bank products.
// Accepts explicit inputs or a caseId to preload the case profile.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { runBankMatch } from "@/lib/bank-match";

export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();

  let base = {
    employmentProfile: body.employmentProfile ?? "Salaried",
    residency: body.residency ?? "Resident Expatriate",
    transactionType: body.transactionType ?? "",
    loanAmount: Number(body.loanAmount) || 0,
    propertyValue: Number(body.propertyValue) || 0,
    monthlyIncome: Number(body.monthlyIncome) || 0,
    existingEmis: Number(body.existingEmis) || 0,
    cardLimitsTotal: Number(body.cardLimitsTotal) || 0,
    rentalIncome: Number(body.rentalIncome) || 0,
    bonusIncome: Number(body.bonusIncome) || 0,
    stl: body.stl ?? true,
    termYears: body.termYears === 0 || body.termYears === "0" ? 0 : Number(body.termYears) || 3,
  };

  if (body.caseId) {
    const c = await db.loanCase.findUnique({ where: { id: parseInt(body.caseId, 10) } });
    if (!c) return NextResponse.json({ error: "case not found" }, { status: 404 });
    base = {
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
      termYears: body.termYears === 0 || body.termYears === "0" ? 0 : Number(body.termYears) || 3,
    };
  }

  if (!base.propertyValue || !base.monthlyIncome) {
    return NextResponse.json({ error: "propertyValue and monthlyIncome are required." }, { status: 400 });
  }
  const results = await runBankMatch(base);
  return NextResponse.json({ input: base, results });
}
