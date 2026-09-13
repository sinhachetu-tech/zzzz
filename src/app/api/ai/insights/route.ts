// POST /api/ai/insights — AI Case Copilot.
// Given a case + its tasks + activity + bank commission context, the LLM produces a
// concise narrative, risk flags, and 3-5 prioritised next actions.
import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { commissionFor, caseStatusOf, fmtMoneyFull, fmtDate, todayISO } from "@/lib/format";
import { serCase, serTask, serActivity } from "@/lib/ser";

export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { caseId } = await req.json();
  if (!caseId) return NextResponse.json({ error: "caseId required" }, { status: 400 });

  const c = await db.loanCase.findUnique({
    where: { id: parseInt(caseId, 10) },
    include: {
      owner: true,
      tasks: { orderBy: { dueDate: "asc" } },
      activities: { orderBy: { at: "desc" }, take: 25 },
    },
  });
  if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });

  const banks = await db.bankItem.findMany();
  const partners = await db.partnerItem.findMany();
  const users = await db.user.findMany();

  const caseDto = serCase(c);
  const taskDtos = c.tasks.map(serTask);
  const status = caseStatusOf(caseDto, taskDtos);
  const commission = commissionFor(caseDto, banks);
  const owner = users.find((u) => u.id === c.ownerId);
  const partner = partners.find((p) => p.name === caseDto.partner?.name);

  const openTasks = taskDtos.filter((t) => t.status === "Open");
  const overdueTasks = openTasks.filter((t) => t.dueDate < todayISO());
  const recentActivity = c.activities.slice(0, 12).map(serActivity);

  const ctx = {
    case: {
      caseNumber: caseDto.caseNumber,
      customer: caseDto.customer,
      stage: caseDto.stage,
      status: caseDto.caseStatus,
      derivedStatus: status,
      loanAmount: caseDto.loanAmount,
      banks: caseDto.banks,
      wonBank: caseDto.wonBank,
      source: caseDto.source,
      owner: owner?.name,
      partner: caseDto.partner,
      whatsapp: caseDto.whatsapp ? "on file" : "missing",
      createdAt: caseDto.createdAt,
      ageDays: Math.round((Date.now() - new Date(caseDto.createdAt).getTime()) / 86400000),
    },
    commission: {
      bank: commission.bank,
      ratePct: commission.ratePct,
      gross: commission.gross,
      partnerCut: commission.partnerCut,
      net: commission.net,
    },
    openTasks: openTasks.map((t) => ({
      description: t.description,
      waitingFor: t.waitingFor,
      whyPending: t.whyPending,
      dueDate: t.dueDate,
      overdue: t.dueDate < todayISO(),
    })),
    overdueCount: overdueTasks.length,
    recentActivity: recentActivity.map((a) => ({
      action: a.action,
      at: a.at,
      who: users.find((u) => u.id === a.userId)?.name,
    })),
    partnerMaster: partner ? { kind: partner.kind, defaultSharePct: partner.defaultSharePct } : null,
  };

  const system = `You are the HFMC mortgage case copilot — a senior UAE mortgage operations advisor.
Analyse the case context (JSON) and respond with crisp, actionable insight.
Use AED currency, UAE banking norms (CBUAE DBR/LTV), and reference the specific case number.
Be direct, no fluff. The mortgage advisor is reading this between calls.`;

  const user = `Case context:\n\`\`\`json\n${JSON.stringify(ctx, null, 2)}\n\`\`\`\n\nProduce a response in EXACTLY this Markdown structure (no preamble):\n\n## Snapshot\nOne paragraph (2-3 sentences) summarising where this file stands and the single biggest risk.\n\n## Risk flags\nA bulleted list of concrete risks (empty stage, overdue tasks, missing WhatsApp, thin DBR, etc.). Omit the heading only if there are zero risks — otherwise always include at least one.\n\n## Recommended next actions\nA numbered list of 3-5 prioritised actions the case owner should take today/tomorrow. Each action: a verb, the specific party to contact, and why it moves the file forward.\n\n## Commission outlook\nOne sentence on the money at stake and what threatens it (or confirms it).\n\nKeep each section tight. Today is ${fmtDate(todayISO())}.`;

  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: system },
        { role: "user", content: user },
      ],
      thinking: { type: "disabled" },
    });
    const markdown = completion.choices[0]?.message?.content ?? "";
    return NextResponse.json({ markdown, caseNumber: caseDto.caseNumber });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "AI unavailable" },
      { status: 502 }
    );
  }
}

export const runtime = "nodejs";
