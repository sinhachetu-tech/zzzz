// POST /api/cases — create a new case (with optional first task).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { serCase } from "@/lib/ser";
import { toISODate } from "@/lib/format";
import type { CaseSource, CasePartner } from "@/lib/types";

export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const {
    customer, banks, loanAmount, stage, ownerId, source, partner,
    whatsapp, waGroup, task,
    submissionType, channelId, channelName, channelRatePct,
  } = body as {
    customer: string;
    banks: string[];
    loanAmount: number;
    stage: string;
    ownerId: number;
    source: CaseSource;
    partner: CasePartner | null;
    whatsapp: string;
    waGroup: string | null;
    task?: { description: string; dueDate: string; waitingFor: string; whyPending: string; ownerId: number };
    submissionType?: "direct" | "channel";
    channelId?: number | null;
    channelName?: string | null;
    channelRatePct?: number;
  };

  if (!customer?.trim()) return NextResponse.json({ error: "Customer name is required." }, { status: 400 });
  if (!loanAmount || loanAmount <= 0) return NextResponse.json({ error: "Invalid loan amount." }, { status: 400 });

  const count = await db.loanCase.count();
  const caseNumber = `HFMC-${String(count + 1).padStart(4, "0")}`;

  const created = await db.loanCase.create({
    data: {
      caseNumber,
      customer: customer.trim(),
      banks: JSON.stringify(banks ?? []),
      wonBank: null,
      loanAmount,
      stage: stage || "WhatsApp Group Creation",
      caseStatus: "Active",
      ownerId,
      source,
      partnerKind: partner?.kind ?? null,
      partnerName: partner?.name ?? null,
      partnerSharePct: partner?.sharePct ?? null,
      whatsapp: whatsapp ?? "",
      waGroup: waGroup ?? null,
      submissionType: submissionType ?? "direct",
      channelId: channelId ?? null,
      channelName: channelName ?? null,
      channelRatePct: channelRatePct ?? 0,
    },
  });

  await db.activity.create({
    data: { caseId: created.id, userId: me.id, action: `opened case ${caseNumber}` },
  });

  if (task?.description?.trim()) {
    await db.task.create({
      data: {
        caseId: created.id,
        description: task.description.trim(),
        ownerId: task.ownerId || ownerId,
        createdBy: me.id,
        waitingFor: task.waitingFor || "Internal",
        whyPending: task.whyPending || "Internal review",
        dueDate: task.dueDate,
        status: "Open",
        remarks: "",
      },
    });
    await db.activity.create({
      data: { caseId: created.id, userId: me.id, action: `added task “${task.description.trim()}”` },
    });
  }

  const fresh = await db.loanCase.findUnique({ where: { id: created.id } });
  return NextResponse.json({ case: serCase(fresh!) });
}
