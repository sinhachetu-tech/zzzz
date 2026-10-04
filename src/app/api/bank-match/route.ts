import { parseCaseProfile } from "@/lib/case-profile";
// POST /api/bank-match — run the eligibility engine over approved bank products.
// Accepts explicit inputs or a caseId to preload the case profile.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { runBankMatch } from "@/lib/bank-match";
import { getPricingFloor } from "@/lib/pricing-floor";

export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  // Tier-1 floor is applied on EVERY match so a floor change repricing the whole
  // book takes effect immediately, with no product edits and no deploy.
  const floor = await getPricingFloor();

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
    processingMonths: Number(body.processingMonths) || 3,
    secondPartyRole: body.secondPartyRole,
    coBorrowerIncome: Number(body.coBorrowerIncome) || 0,
    coBorrowerBonus: Number(body.coBorrowerBonus) || 0,
    coBorrowerRental: Number(body.coBorrowerRental) || 0,
    coBorrowerEmis: Number(body.coBorrowerEmis) || 0,
    coBorrowerCardLimits: Number(body.coBorrowerCardLimits) || 0,
    primaryAge: Number(body.primaryAge) || undefined,
    coBorrowerAge: Number(body.coBorrowerAge) || undefined,
    // Phase-1 multi-axis passthrough — quote sets only constrain when passed
    nationality: body.nationality ?? undefined,
    emirate: body.emirate ?? undefined,
    financeType: body.financeType ?? undefined,
    loanKind: body.loanKind ?? undefined,
    segment: body.segment ?? undefined,
    // NEW: eligibility inputs the engine can now actually enforce
    propertyStage: body.propertyStage ?? undefined,
    transactionPurpose: body.transactionPurpose ?? undefined,
    propertyTypeCanonical: body.propertyTypeCanonical ?? undefined,
    customerProfile: body.customerProfile ?? undefined,
    serviceMonths: body.serviceMonths != null ? Number(body.serviceMonths) : undefined,
    propertyAgeYears: body.propertyAgeYears != null ? Number(body.propertyAgeYears) : undefined,
    isFirstProperty: body.isFirstProperty ?? undefined,
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
      propertyTypeCanonical: (c as unknown as { propertyTypeCanonical?: string }).propertyTypeCanonical,
      commercialSubtype: (c as unknown as { commercialSubtype?: string | null }).commercialSubtype,
      propertyStage: (c as unknown as { propertyStage?: string }).propertyStage,
      constructionStatus: (c as unknown as { constructionStatus?: string }).constructionStatus,
      partyRelationship: (c as unknown as { partyRelationship?: string }).partyRelationship,
      existingFinance: (c as unknown as { existingFinance?: string }).existingFinance,
      transactionPurpose: (c as unknown as { transactionPurpose?: string }).transactionPurpose,
    });

    base = {
      employmentProfile: body.employmentProfile ?? prof.primary.employmentProfile ?? c.employmentProfile,
      residency: body.residency ?? prof.primary.residency ?? c.residency,
      transactionType: body.transactionType ?? prof.property.transactionType ?? c.transactionType,
      loanAmount: Number(body.loanAmount) || prof.property.loanAmount || c.loanAmount,
      // REAL property value only — never loanAmount/0.8. If absent, the engine
      // reports an LTV data gap instead of inventing an 80% LTV.
      propertyValue: Number(body.propertyValue) || prof.property.propertyValue || 0,
      monthlyIncome: Number(body.monthlyIncome) || prof.primary.monthlySalary || 0,
      existingEmis: Number(body.existingEmis) || prof.primary.existingEmis || 0,
      cardLimitsTotal: Number(body.cardLimitsTotal) || prof.primary.creditCardLimits || 0,
      rentalIncome: Number(body.rentalIncome) || prof.primary.rentalIncome || 0,
      bonusIncome: Number(body.bonusIncome) || prof.primary.variableIncome || 0,
      stl: body.stl ?? true,
      termYears: body.termYears === 0 || body.termYears === "0" ? 0 : Number(body.termYears) || 3,
      ratePref: body.ratePref === "fixed" || body.ratePref === "flexible" ? body.ratePref : undefined,
      processingMonths: Number(body.processingMonths) || prof.processingMonths || 3,
      secondPartyRole: body.secondPartyRole ?? prof.secondParty.role,
      coBorrowerIncome: Number(body.coBorrowerIncome) || prof.secondParty.monthlySalary || 0,
      coBorrowerBonus: Number(body.coBorrowerBonus) || prof.secondParty.variableIncome || 0,
      coBorrowerRental: Number(body.coBorrowerRental) || prof.secondParty.rentalIncome || 0,
      coBorrowerEmis: Number(body.coBorrowerEmis) || prof.secondParty.existingEmis || 0,
      coBorrowerCardLimits: Number(body.coBorrowerCardLimits) || prof.secondParty.creditCardLimits || 0,
      primaryAge: Number(body.primaryAge) || prof.primary.age || undefined,
      coBorrowerAge: Number(body.coBorrowerAge) || prof.secondParty.age || undefined,
      // canonical property classification → engine axes (explicit answers only;
      // UNKNOWN/absent imposes no constraint — never blocks on a guess)
      nationality: body.nationality ?? prof.primary.nationality ?? undefined,
      emirate: body.emirate ?? prof.property.propertyLocation ?? c.propertyLocation ?? undefined,
      financeType: body.financeType ?? (
        prof.property.canonicalPropertyType === "COMMERCIAL" ? "Commercial"
        : prof.property.canonicalPropertyType === "RESIDENTIAL" ? "Residential"
        : undefined
      ),
      loanKind: body.loanKind ?? (prof.primary.islamicOnly ? "Islamic" : undefined),
      segment: body.segment ?? undefined,
      // Canonical property classification -> engine axes. These LoanCase columns
      // existed but nothing read them until now.
      propertyStage: body.propertyStage ?? (prof.property.canonicalPropertyStage && prof.property.canonicalPropertyStage !== "UNKNOWN" ? prof.property.canonicalPropertyStage : undefined),
      transactionPurpose: body.transactionPurpose ?? (prof.property.canonicalTransactionPurpose ? prof.property.canonicalTransactionPurpose : undefined),
      propertyTypeCanonical: body.propertyTypeCanonical ?? (prof.property.canonicalPropertyType !== "UNKNOWN" ? prof.property.canonicalPropertyType : undefined),
      customerProfile: body.customerProfile ?? undefined,
      serviceMonths: body.serviceMonths != null ? Number(body.serviceMonths) : undefined,
      propertyAgeYears: body.propertyAgeYears != null ? Number(body.propertyAgeYears) : undefined,
      isFirstProperty: body.isFirstProperty ?? undefined,
    };
  }

  if (!base.propertyValue || !base.monthlyIncome) {
    return NextResponse.json({ error: "propertyValue and monthlyIncome are required." }, { status: 400 });
  }
  // Apply the admin floor. Only pass it when it has a value, so an unset floor
  // leaves the call shape byte-identical to before.
  const results = await runBankMatch({ ...base, floor: Object.keys(floor).length ? floor : undefined });
  return NextResponse.json({ input: base, floor, results });
}
