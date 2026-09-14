// PATCH /api/cases/:id — update a case (stage, status, wonBank, owner, partner, banks, etc.)
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { serCase } from "@/lib/ser";
import { syncCaseVault } from "@/lib/vault";
import { syncCaseClients } from "@/lib/client-master";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const caseId = parseInt(id, 10);
  const body = await req.json();

  const existing = await db.loanCase.findUnique({ where: { id: caseId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  const actions: string[] = [];

  if (body.stage && body.stage !== existing.stage) {
    data.stage = body.stage;
    actions.push(`stage → ${body.stage}`);
  }
  if (body.caseStatus && body.caseStatus !== existing.caseStatus) {
    data.caseStatus = body.caseStatus;
    if (body.caseStatus === "Closed" || body.caseStatus === "Lost") {
      data.closedDate = new Date().toISOString().slice(0, 10);
    }
    actions.push(`status → ${body.caseStatus}`);
  }
  if (body.wonBank !== undefined && body.wonBank !== existing.wonBank) {
    data.wonBank = body.wonBank;
    actions.push(body.wonBank ? `won by ${body.wonBank}` : "cleared winning bank");
  }
  if (body.ownerId !== undefined && body.ownerId !== existing.ownerId) {
    data.ownerId = body.ownerId;
    const u = await db.user.findUnique({ where: { id: body.ownerId } });
    actions.push(`owner → ${u?.name ?? body.ownerId}`);
  }
  if (body.banks !== undefined) {
    data.banks = JSON.stringify(body.banks);
  }
  if (body.source !== undefined) data.source = body.source;
  if (body.partner !== undefined) {
    data.partnerKind = body.partner?.kind ?? null;
    data.partnerName = body.partner?.name ?? null;
    data.partnerSharePct = body.partner?.sharePct ?? null;
  }
  if (body.statusNote !== undefined) data.statusNote = body.statusNote;
  // Document Vault profile vectors — changing any of them re-syncs the checklist
  let profileChanged = false;
  if (body.employmentProfile !== undefined && body.employmentProfile !== existing.employmentProfile) {
    data.employmentProfile = body.employmentProfile;
    profileChanged = true;
  }
  if (body.propertyType !== undefined && body.propertyType !== existing.propertyType) {
    data.propertyType = body.propertyType;
    profileChanged = true;
  }
  if (body.residency !== undefined && body.residency !== existing.residency) {
    data.residency = body.residency;
    profileChanged = true;
  }
  if (body.transactionType !== undefined && body.transactionType !== existing.transactionType) {
    data.transactionType = body.transactionType;
    profileChanged = true;
  }
  if (body.bankRm !== undefined) data.bankRm = body.bankRm;
  if (body.propertyLocation !== undefined) data.propertyLocation = body.propertyLocation;
  if (body.coApplicantName !== undefined) data.coApplicantName = body.coApplicantName;
  if (body.onHold !== undefined) data.onHold = !!body.onHold;
  if (body.holdReason !== undefined) data.holdReason = body.holdReason;
  if (body.holdUntil !== undefined) data.holdUntil = body.holdUntil;
  if (body.preApprovalDate !== undefined) data.preApprovalDate = body.preApprovalDate;
  if (body.preApprovalAmount !== undefined) data.preApprovalAmount = body.preApprovalAmount;
  if (body.preApprovalTenure !== undefined) data.preApprovalTenure = body.preApprovalTenure;
  if (body.preApprovalRoi !== undefined) data.preApprovalRoi = body.preApprovalRoi;
  if (body.folDate !== undefined) data.folDate = body.folDate;
  if (body.folAmount !== undefined) data.folAmount = body.folAmount;
  if (body.folTenure !== undefined) data.folTenure = body.folTenure;
  if (body.folRoi !== undefined) data.folRoi = body.folRoi;
  if (body.whatsapp !== undefined) data.whatsapp = body.whatsapp;
  if (body.waGroup !== undefined) data.waGroup = body.waGroup;
  if (body.customer !== undefined) data.customer = body.customer;
  if (body.loanAmount !== undefined) data.loanAmount = body.loanAmount;
  // structured profile (income, liabilities, KYC ids, second party) — persisted
  // verbatim; each case keeps its own snapshot of the applicant as filed
  if (body.profileJson !== undefined) data.profileJson = body.profileJson;

  const updated = await db.loanCase.update({ where: { id: caseId }, data });

  // profile vectors moved → pull in newly-applicable document requirements
  if (profileChanged) await syncCaseVault(caseId);

  // identity/profile data changed → refresh the Client master links
  let fresh = updated;
  if (body.profileJson !== undefined || body.whatsapp !== undefined || body.customer !== undefined || body.coApplicantName !== undefined) {
    try {
      await syncCaseClients(caseId);
      fresh = (await db.loanCase.findUnique({ where: { id: caseId } })) ?? updated;
    } catch (e) {
      console.error("client sync failed:", e);
    }
  }

  if (data.stage) {
    await db.stageTransition.create({
      data: {
        caseId,
        fromStage: existing.stage,
        toStage: String(data.stage),
        comment: typeof body.stageComment === 'string' ? body.stageComment : '',
        userId: me.id,
      },
    });
  }

  for (const a of actions) {
    await db.activity.create({
      data: { caseId, userId: me.id, action: a },
    });
  }

  return NextResponse.json({ case: serCase(fresh!) });
}
