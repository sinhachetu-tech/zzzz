// POST /api/ai/advisor — AI Mortgage Advisor.
// Streams a plain-language explanation of a mortgage eligibility result + Q&A.
import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { currentUser } from "@/lib/auth";
import { computeMortgage } from "@/lib/mortgage";
import type { MortgageInput } from "@/lib/mortgage";

export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { input, question } = await req.json() as {
    input: MortgageInput;
    question?: string;
  };

  const result = computeMortgage(input);

  const ctx = {
    applicant: {
      name: input.name || "applicant",
      applicantType: input.applicantType,
      employment: input.employment,
      ageNow: result.ageNowYears,
      finalAge: input.finalAge,
    },
    property: {
      value: input.propertyValue,
      valuation: input.valuation,
      calcBasis: result.calcBasis,
      basisLabel: result.basisLabel,
      requested: input.requested,
    },
    rate: {
      actual: result.actualRate,
      loadFactor: result.loadFactor,
      assessment: result.assessmentRate,
    },
    tenor: {
      maxMonths: result.maxTenorMonths,
      label: `${Math.floor(result.maxTenorMonths / 12)}Y ${result.maxTenorMonths % 12}M`,
      limitedBy: result.tenorLimitedBy,
    },
    income: {
      own: result.ownIncome,
      co: result.coIncome,
      combined: result.eligibleIncome,
    },
    liabilities: {
      own: result.ownEmis,
      co: result.coEmis,
      combined: result.existingEmis,
    },
    dbr: {
      current: result.currentDbr,
      max: result.maxDbr,
      residual: result.residualDbr,
      after: result.dbrAfter,
    },
    ltv: { appliedPct: result.ltvPct },
    mpbf: {
      dbrMpbf: result.dbrMpbf,
      ltvMpbf: result.ltvMpbf,
      multiplierCap: result.multiplierCap,
      requested: result.requested,
      final: result.finalMpbf,
      limitedBy: result.limitedBy,
    },
    outcome: {
      finalLoan: result.finalMpbf,
      downPayment: result.downPayment,
      actualLtv: result.actualLtv,
      newEmi: result.newEmi,
    },
    notes: result.notes,
    trail: result.trail,
  };

  const system = `You are the HFMC AI Mortgage Advisor — a senior UAE mortgage credit analyst.
You explain preliminary MPBF (Maximum Permissible Bank Finance) eligibility in plain English,
using CBUAE norms (50% DBR cap, 80/70% LTV bands for expats, 25-year max tenor, age-to-retirement cap).
Be concrete, cite the numbers, and when asked "how do I improve this?" give actionable levers
(reduce a credit card limit, add a co-borrower, extend tenor, increase down payment, clear a personal loan).
Never invent bank policy. Always state this is preliminary, not a bank approval.`;

  const userMsg = question?.trim()
    ? `Eligibility result (JSON):\n\`\`\`json\n${JSON.stringify(ctx, null, 2)}\n\`\`\`\n\nQuestion: ${question}\n\nAnswer the question directly, citing the relevant figures. If the answer depends on a lever the applicant can pull, name it.`
    : `Eligibility result (JSON):\n\`\`\`json\n${JSON.stringify(ctx, null, 2)}\n\`\`\`\n\nProduce a response in EXACTLY this Markdown structure (no preamble):\n\n## The verdict\nOne sentence: is the applicant eligible, for how much, and what's the binding constraint.\n\n## In plain English\n2-3 sentences explaining how the bank arrived at this number (DBR headroom, LTV cap, age/tenor).\n\n## What threatens it\nBulleted list of the biggest risks to this eligibility (high existing DBR, rate stress, age cap, etc.).\n\n## How to improve eligibility\nA numbered list of 3-5 concrete levers, each with the expected direction of change (e.g. "Clearing the AED 50K credit card limit frees ~AED 2,500/mo DBR room → roughly +AED X in MPBF").\n\n## Monthly cost\nOne sentence: the new EMI and the DBR after this mortgage.`;

  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: system },
        { role: "user", content: userMsg },
      ],
      thinking: { type: "disabled" },
    });
    const markdown = completion.choices[0]?.message?.content ?? "";
    return NextResponse.json({ markdown, result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "AI unavailable" },
      { status: 502 }
    );
  }
}

export const runtime = "nodejs";
