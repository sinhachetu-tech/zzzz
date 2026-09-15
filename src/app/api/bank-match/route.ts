import { parseCaseProfile } from "@/lib/case-profile";
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
    ratePref: body.ratePref === "fixed" || body.ratePref === "flexible" ? body.ratePref : undefined,
    secondPartyRole: body.secondPartyRole,
    coBorrowerIncome: Number(body.coBorrowerIncome) || 0,
    coBorrowerBonus: Number(body.coBorrowerBonus) || 0,
    coBorrowerRental: Number(body.coBorrowerRental) || 0,
    coBorrowerEmis: Number(body.coBorrowerEmis) || 0,
    coBorrowerCardLimits: Number(body.coBorrowerCardLimits) || 0,
    primaryAge: Number(body.primaryAge) || undefined,
    coBorrowerAge: Number(body.coBorrowerAge) || undefined,
  };

  if (body.caseId) {
    const c = await db.loanCase.findUnique({ where: { id: parseInt(body.caseId, 10) } });
    if (!c) return NextResponse.json({ error: "case not found" }, { status: 404 });
    const prof = parseCaseProfile((c as unknown as { profileJson?: string })?.profileJson, {
      customer: c.customer,
      whatsapp: c.whatsapp,
      loanAmount: c.loanAmount,
      employmentProfile: c.employmentProfile,
      residency: c.residency,
      propertyType: c.propertyType,
      transactionType: c.transactionType,
      propertyLocation: c.propertyLocation,
      coApplicantName: c.coApplicantName,
    });

    base = {
      employmentProfile: body.employmentProfile ?? prof.primary.employmentProfile ?? c.employmentProfile,
      residency: body.residency ?? prof.primary.residency ?? c.residency,
      transactionType: body.transactionType ?? prof.property.transactionType ?? c.transactionType,
      loanAmount: Number(body.loanAmount) || prof.property.loanAmount || c.loanAmount,
      propertyValue: Number(body.propertyValue) || prof.property.propertyValue || 0,
      monthlyIncome: Number(body.monthlyIncome) || prof.primary.monthlySalary || 0,
      existingEmis: Number(body.existingEmis) || prof.primary.existingEmis || 0,
      cardLimitsTotal: Number(body.cardLimitsTotal) || prof.primary.creditCardLimits || 0,
      rentalIncome: Number(body.rentalIncome) || prof.primary.rentalIncome || 0,
      bonusIncome: Number(body.bonusIncome) || prof.primary.variableIncome || 0,
      stl: body.stl ?? true,
      termYears: body.termYears === 0 || body.termYears === "0" ? 0 : Number(body.termYears) || 3,
      ratePref: body.ratePref === "fixed" || body.ratePref === "flexible" ? body.ratePref : undefined,
      secondPartyRole: body.secondPartyRole ?? prof.secondParty.role,
      coBorrowerIncome: Number(body.coBorrowerIncome) || prof.secondParty.monthlySalary || 0,
      coBorrowerBonus: Number(body.coBorrowerBonus) || prof.secondParty.variableIncome || 0,
      coBorrowerRental: Number(body.coBorrowerRental) || prof.secondParty.rentalIncome || 0,
      coBorrowerEmis: Number(body.coBorrowerEmis) || prof.secondParty.existingEmis || 0,
      coBorrowerCardLimits: Number(body.coBorrowerCardLimits) || prof.secondParty.creditCardLimits || 0,
      primaryAge: Number(body.primaryAge) || prof.primary.age || undefined,
      coBorrowerAge: Number(body.coBorrowerAge) || prof.secondParty.age || undefined,
    };
  }

  if (!base.propertyValue || !base.monthlyIncome) {
    return NextResponse.json({ error: "propertyValue and monthlyIncome are required." }, { status: 400 });
  }
  const results = await runBankMatch(base);
  return NextResponse.json({ input: base, results });
}
