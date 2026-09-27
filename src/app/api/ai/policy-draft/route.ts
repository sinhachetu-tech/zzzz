// AI policy-draft assistant — wraps deterministic ingestion (policy-ingest.ts)
// with clarification questions. NEVER writes to the DB: everything lands in the
// guided editor's human review queue.
import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { currentUser, flagsFor } from "@/lib/auth";
import { ingestPolicyText, missingInfo } from "@/lib/policy-ingest";

const DRAFT_SYSTEM = `You are a UAE mortgage policy assistant. An admin pasted a bank policy
document, and a deterministic parser already listed what is MISSING from it.

You are given the document text plus a "needs" list of { key, question, importance }.

For EVERY need output one of:
- { "key": ..., "status": "found", "value": <extracted>, "unit": "pct|aed|date|list|string", "evidence": "<short verbatim quote>" }
  ONLY when the document actually states it. Evidence MUST be a real substring (under 140 chars).
- { "key": ..., "status": "ask", "question": "<same question, plain words>" } otherwise.
Never guess a value to avoid asking.

Also list "confirm": axis values you are unsure about (ambiguous/conflicting), for human double-check.

Output STRICT JSON: { "resolved": [...], "confirm": [{ "field": string, "value": unknown, "why": string }], "confidence": "high|medium|low" }.
No prose. Rates are small numbers (3.95 not 0.0395). Dates YYYY-MM-DD when stated.`;

const RESOLVE_SYSTEM = `You are a UAE mortgage policy assistant. An admin answered a missing-field
question in plain words. Convert it to STRICT JSON:
{ "key": string, "value": <number|string|array|null>, "unit": "pct|aed|date|list|string" }.
Rules: percentages stay small (1.05 for 1.05%); "waived"/"nil"/"zero fee" → 0;
"all"/"both"/"everyone" → null (applies to all); country lists → string arrays;
"don't know"/"not sure" → null (leave unverified). Output JSON only.`;

export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!flags.admin && !flags.super) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const { text, answers } = body as {
    text?: string;
    answers?: Array<{ key: string; answer: string }>;
  };
  const raw = String(text ?? "").slice(0, 14000);
  if (!raw.trim()) return NextResponse.json({ error: "policy text required" }, { status: 400 });

  try {
    const ingested = ingestPolicyText(raw);
    // fold human answers back in and re-check what is still missing
    const answeredText = (answers ?? [])
      .map((a) => `${a.key}: ${a.answer}`)
      .join("\n");
    const remaining = missingInfo(
      ingested.axes,
      ingested.quoteHints,
      `${raw}\n${answeredText}`,
    );
    const needs = remaining.length ? remaining : ingested.needs;

    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: DRAFT_SYSTEM },
        {
          role: "user",
          content: `Document:\n${raw}\n\nNeeds:\n${JSON.stringify(needs, null, 1)}${
            answeredText ? `\n\nAdmin answers so far:\n${answeredText}` : ""
          }`,
        },
      ],
      thinking: { type: "disabled" },
    });
    const out = completion.choices[0]?.message?.content ?? "";
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) return NextResponse.json({ error: "AI returned no parseable JSON", raw: out.slice(0, 400) }, { status: 502 });
    const ai = JSON.parse(m[0]) as {
      resolved?: Array<{ key: string; status: string; value?: unknown; unit?: string; evidence?: string; question?: string }>;
      confirm?: Array<{ field: string; value: unknown; why: string }>;
      confidence?: string;
    };
    return NextResponse.json({
      draft: ai,
      axes: ingested.axes,
      quoteHints: ingested.quoteHints,
      needs: remaining,
      source: "ai",
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI unavailable" }, { status: 502 });
  }
}

export async function PUT(req: NextRequest) {
  // one plain-words answer → strict value patch
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!flags.admin && !flags.super) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json();
  const { key, question, answer } = body as { key: string; question: string; answer: string };
  if (!answer?.trim()) return NextResponse.json({ error: "answer required" }, { status: 400 });
  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: RESOLVE_SYSTEM },
        { role: "user", content: `Field: ${key}\nQuestion asked: ${question}\nAdmin answer: ${answer}` },
      ],
      thinking: { type: "disabled" },
    });
    const out = completion.choices[0]?.message?.content ?? "";
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) return NextResponse.json({ error: "AI returned no parseable JSON" }, { status: 502 });
    return NextResponse.json({ patch: JSON.parse(m[0]) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI unavailable" }, { status: 502 });
  }
}
