// POST /api/ai/rule-draft — AI reads a bank product's rate-card text and
// proposes structured quote rows + structured fees as JSON. Draft only:
// the human reviews in the guided editor and approves.
import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";

const SYSTEM = `You are a UAE mortgage rate-card parser. Convert the given bank rate text into STRICT JSON.

Schema:
{
  "quotes": [
    {
      "stl": true|false|null,
      "termYears": 0|1|2|3|5,
      "rateType": "FIXED"|"1M_EIBOR"|"3M_EIBOR"|"6M_EIBOR"|"1Y_EIBOR",
      "ratePct": number|null,
      "marginPct": number|null,
      "floorPct": number|null,
      "ftvMax": number|null,
      "txn": null|"Resale"|"Primary Handover"|"Buyout"|"Equity Release"|"Buyout + Equity Release"|"Land"|"Self Construction"|"LAP",
      "segment": null|"GECO"|"SZHP"|"AUH Developer",
      "note": "short source hint"
    }
  ],
  "fees": {
    "processing": {
      "default": number|null,
      "equityRelease": number|null,
      "buyout": number|null,
      "minFee": number|null,
      "maxFee": number|null,
      "note": string
    },
    "preApproval": {
      "fee": number|null,
      "feeStl": number|null,
      "feeNstl": number|null,
      "feeSelfEmployed": number|null,
      "note": string
    },
    "valuation": { "note": string },
    "earlySettlement": {
      "pct": number|null,
      "minFee": number|null,
      "cap": number|null,
      "freeAfterYears": number|null,
      "note": string
    },
    "partialSettlement": {
      "freeYearlyPct": number|null,
      "pct": number|null,
      "cap": number|null,
      "note": string
    }
  },
  "insurance": {
    "life": { "basis": "per_million_monthly"|"pct_pa_of_loan", "rate": number, "note": string },
    "property": { "basis": "pct_pa_of_property", "rate": number, "note": string }
  },
  "eligibility": {
    "minServiceMonths": number|null,
    "maxAgeAtMaturityYears": number|null,
    "stressBufferPct": number|null,
    "totalTatDays": number|null,
    "paTatDays": number|null,
    "paValidityDays": number|null,
    "folValidityDays": number|null,
    "valuationValidityDays": number|null
  },
  "confidence": "high"|"medium"|"low",
  "questions": ["any ambiguity a human must confirm"]
}

Rules:
- termYears 0 = day-1 variable. FIXED uses ratePct; EIBOR quotes use marginPct only.
- Percentages are small numbers (3.95, 1.79, 1.05) — NEVER 0.0395.
- processing.default is % of loan (e.g. 1.05 for 1.05%). If given as decimal like 0.0105, convert to 1.05.
- preApproval.fee is AED fixed amount (e.g. 1575). If given as "1575/-" extract 1575. If "Free" use 0.
- earlySettlement.cap: if text says "1% or AED 10,000 whichever lower" → pct=1, cap=10000.
- partialSettlement.freeYearlyPct: if "free up to 25% per year" → freeYearlyPct=25.
- insurance life rate: if "0.03 p.m on loan outstanding" this means 0.03% per month → basis=per_million_monthly, rate=0.03. If "0.0187% p.a." → basis=pct_pa_of_loan, rate=0.0187.
- stressBufferPct: if bank uses "EIBOR + 2%" for qualification → stressBufferPct=2.0.
- minServiceMonths: if "6 months+ confirmed" → 6. If "1 year" → 12.
- maxAgeAtMaturityYears: e.g. "65 years" for expats.
- paTatDays, totalTatDays: working days (e.g. "5 working days" → 5).
- Extract ONLY what the text states; use null when absent.
- Output JSON only, no prose.`;

export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!flags.admin && !flags.super) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { productId } = await req.json();
  const p = await db.bankProduct.findUnique({ where: { id: parseInt(productId, 10) } });
  if (!p) return NextResponse.json({ error: "product not found" }, { status: 404 });

  const text = [p.rateTable, p.fees, p.insurance, p.eligibility, p.stressTest]
    .filter(Boolean)
    .join("\n---\n")
    .slice(0, 14000);
  if (!text.trim()) return NextResponse.json({ error: "no source text on this product" }, { status: 400 });

  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: SYSTEM },
        { role: "user", content: `Bank: ${(p as unknown as { bankName?: string }).bankName ?? "unknown"}\nRate card and policy text:\n\n${text}` },
      ],
      thinking: { type: "disabled" },
    });
    const raw = completion.choices[0]?.message?.content ?? "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return NextResponse.json({ error: "AI returned no parseable JSON", raw: raw.slice(0, 400) }, { status: 502 });
    const draft = JSON.parse(jsonMatch[0]);

    // sanitize quotes: drop rows without any rate/margin
    if (Array.isArray(draft.quotes)) {
      draft.quotes = draft.quotes.filter((q: Record<string, unknown>) => q.ratePct != null || q.marginPct != null);
    } else {
      draft.quotes = [];
    }

    return NextResponse.json({ draft, source: "ai" });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI unavailable" }, { status: 502 });
  }
}
