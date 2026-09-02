// POST /api/ai/doc-read — AI Document Reader (VLM).
// Accepts a base64-encoded salary certificate / bank statement / payslip image (or PDF),
// extracts structured income & liability data that can pre-fill the mortgage calculator.
import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { currentUser } from "@/lib/auth";

interface ExtractedData {
  applicantName?: string;
  monthlyIncome?: number;
  otherIncome?: number;
  age?: number;
  employmentType?: "Salaried" | "Self-Employed";
  liabilities?: { name: string; type: string; limitOrOutstanding: number; monthlyEmi: number }[];
  notes?: string[];
}

export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const { dataUrl, docType } = body as { dataUrl: string; docType?: string };
  if (!dataUrl?.startsWith("data:")) {
    return NextResponse.json({ error: "dataUrl (base64 data URL) required" }, { status: 400 });
  }

  const label = docType ? `This document is a ${docType}.` : "This is a UAE financial document (salary certificate, payslip, or bank statement).";

  const prompt = `${label}
Extract every income and liability figure you can see. UAE context — AED currency.
Return ONLY a JSON object with this exact shape (omit fields you cannot read, never invent numbers):
{
  "applicantName": string,
  "monthlyIncome": number,        // net monthly basic + allowances, in AED
  "otherIncome": number,          // rental / bonus / commission monthly equivalent
  "age": number,                  // if a DOB is shown, compute age in years
  "employmentType": "Salaried" | "Self-Employed",
  "liabilities": [
    { "name": string, "type": "Mortgage"|"Personal Loan"|"Car Loan"|"Credit Card"|"Overdraft"|"Other Loan"|"Other Liability", "limitOrOutstanding": number, "monthlyEmi": number }
  ],
  "notes": string[]               // anything a credit officer should verify manually
}
Respond with the JSON object only — no prose, no code fences.`;

  try {
    const zai = await ZAI.create();
    const response = await zai.chat.completions.createVision({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      thinking: { type: "disabled" },
    });
    const raw = response.choices[0]?.message?.content ?? "";
    // tolerate markdown fences
    const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    let parsed: ExtractedData;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      parsed = { notes: ["Could not parse AI response.", raw.slice(0, 500)] };
    }
    return NextResponse.json({ data: parsed, raw });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "AI unavailable" },
      { status: 502 }
    );
  }
}

export const runtime = "nodejs";
