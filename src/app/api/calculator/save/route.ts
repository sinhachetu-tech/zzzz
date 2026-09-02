// POST /api/calculator/save — persist an affordability check.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { computeAffordability } from "@/lib/calc";

export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  const { input, caseId, customerName } = body as {
    input: Parameters<typeof computeAffordability>[0];
    caseId?: number | null;
    customerName?: string;
  };
  const res = computeAffordability(input);
  const saved = await db.affordabilityCheck.create({
    data: {
      caseId: caseId ?? null,
      customerName: customerName || input.bank || "—",
      monthlyIncome: input.monthlyIncome,
      otherIncome: input.otherIncome,
      existingEmis: input.existingEmis,
      age: input.age,
      employmentType: input.employmentType,
      propertyValue: input.propertyValue,
      bank: input.bank,
      interestRate: input.interestRate,
      tenureYears: input.tenureYears,
      applicableLtv: res.applicableLtv,
      maxLoanByLtv: res.maxLoanByLtv,
      maxDbrPct: res.maxDbrPct,
      availableDbrEmi: res.availableDbrEmi,
      maxLoanByDbr: res.maxLoanByDbr,
      maxTenureByAge: res.maxTenureByAge,
      finalEligibleLoan: res.finalEligibleLoan,
      estimatedEmi: res.estimatedEmi,
      eligible: res.eligible,
      createdBy: me.id,
      payload: JSON.stringify(input),
    },
  });
  return NextResponse.json({ id: saved.id, result: res });
}
