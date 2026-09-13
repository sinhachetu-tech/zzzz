// POST /api/cases — create a new case (with optional first task).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { serCase } from "@/lib/ser";
import { syncCaseVault } from "@/lib/vault";
import { toISODate } from "@/lib/format";
import type { CaseSource, CasePartner } from "@/lib/types";

// Subset of MIS / bank-submission / pre-approval / FOL fields accepted on
// case creation. All optional — defaults come from the Prisma schema.
interface NewCaseMisInput {
  // Document Vault profile vectors
  employmentProfile?: string;
  propertyType?: string;
  residency?: string;
  // MIS operational
  statusNote?: string;
  bankRm?: string | null;
  vrmId?: number | null;
  transactionType?: string;
  propertyLocation?: string | null;
  coApplicantName?: string | null;
  onHold?: boolean;
  holdReason?: string | null;
  holdUntil?: string | null;
  // Bank submission
  loanType?: string | null;
  fileSubmittedDate?: string | null;
  bankRate?: number | null;
  bankTenor?: number | null;
  // Pre-approval
  preApprovalDate?: string | null;
  preApprovalAmount?: number | null;
  preApprovalTenure?: number | null;
  preApprovalRoi?: number | null;
  // FOL
  folDate?: string | null;
  folAmount?: number | null;
  folTenure?: number | null;
  folRoi?: number | null;
}

export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const {
    customer, banks, loanAmount, stage, ownerId, source, partner,
    whatsapp, waGroup, task,
    submissionType, channelId, channelName, channelRatePct,
    statusNote, bankRm, vrmId, transactionType, propertyLocation, coApplicantName,
    employmentProfile, propertyType, residency,
    onHold, holdReason, holdUntil,
    loanType, fileSubmittedDate, bankRate, bankTenor,
    preApprovalDate, preApprovalAmount, preApprovalTenure, preApprovalRoi,
    folDate, folAmount, folTenure, folRoi,
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
  } & NewCaseMisInput;

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
      // Document Vault profile vectors
      employmentProfile: employmentProfile ?? "Salaried",
      propertyType: propertyType ?? "Ready",
      residency: residency ?? "Resident Expatriate",
      // MIS operational
      statusNote: statusNote ?? "",
      bankRm: bankRm ?? null,
      vrmId: vrmId ?? null,
      transactionType: transactionType ?? "",
      propertyLocation: propertyLocation ?? null,
      coApplicantName: coApplicantName ?? null,
      onHold: onHold ?? false,
      holdReason: holdReason ?? null,
      holdUntil: holdUntil ?? null,
      // Bank submission
      loanType: loanType ?? null,
      fileSubmittedDate: fileSubmittedDate ?? null,
      bankRate: bankRate ?? null,
      bankTenor: bankTenor ?? null,
      // Pre-approval
      preApprovalDate: preApprovalDate ?? null,
      preApprovalAmount: preApprovalAmount ?? null,
      preApprovalTenure: preApprovalTenure ?? null,
      preApprovalRoi: preApprovalRoi ?? null,
      // FOL
      folDate: folDate ?? null,
      folAmount: folAmount ?? null,
      folTenure: folTenure ?? null,
      folRoi: folRoi ?? null,
    },
  });

  await db.activity.create({
    data: { caseId: created.id, userId: me.id, action: `opened case ${caseNumber}` },
  });

  // populate the conditional Document Vault for the new case
  await syncCaseVault(created.id);

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
