// PATCH /api/cases/:id — update a case (stage, status, wonBank, owner, partner, banks, etc.)
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { serCase } from "@/lib/ser";
import { syncCaseVault } from "@/lib/vault";
import { syncCaseClients } from "@/lib/client-master";

// DELETE /api/cases/:id — remove an accidentally-created lead/case.
// Deliberately restricted: admin/super only, because it cascades to tasks,
// documents, proposals and the whole audit trail.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!flags.admin && !flags.super) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const caseId = parseInt(id, 10);
  const existing = await db.loanCase.findUnique({ where: { id: caseId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  await db.loanCase.delete({ where: { id: caseId } });
  return NextResponse.json({ ok: true });
}

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
  // --- FINAL PROPERTY CLASSIFICATION (canonical dims — validated, additive) ---
  // Validation rules enforced server-side:
  //  - commercialSubtype must be NULL unless propertyTypeCanonical = COMMERCIAL
  //  - unknown/guessed values are rejected: only the documented enums pass
  const VALID = {
    propertyTypeCanonical: ["RESIDENTIAL", "COMMERCIAL", "UNKNOWN"],
    commercialSubtype: ["OFFICE", "RETAIL_SHOP", "WAREHOUSE", "INDUSTRIAL", "HOTEL_HOSPITALITY", "MIXED_USE", "LAND_PLOT", "OTHER_COMMERCIAL", "UNKNOWN"],
    propertyStage: ["OFF_PLAN", "HANDOVER", "COMPLETED", "UNKNOWN"],
    constructionStatus: ["NOT_STARTED", "UNDER_CONSTRUCTION", "COMPLETED", "UNKNOWN"],
    partyRelationship: ["DEVELOPER", "EXISTING_OWNER", "SELF", "UNKNOWN"],
    existingFinance: ["NONE", "MORTGAGE", "UNKNOWN"],
    transactionPurpose: ["PURCHASE", "REFINANCE", "EQUITY_RELEASE", "REFINANCE_AND_EQUITY", "UNKNOWN"],
  } as const;
  for (const [field, allowed] of Object.entries(VALID)) {
    if (body[field] === undefined) continue;
    const v = body[field];
    if (v !== null && v !== "" && !(allowed as readonly string[]).includes(String(v))) {
      return NextResponse.json({ error: `${field}: invalid value "${v}"` }, { status: 400 });
    }
    data[field] = v === "" ? (field === "commercialSubtype" ? null : "UNKNOWN") : v;
  }
  if (data.propertyTypeCanonical !== undefined && data.propertyTypeCanonical !== "COMMERCIAL") {
    data.commercialSubtype = null; // subtype NULL iff not COMMERCIAL — never guessed
  } else if (data.propertyTypeCanonical === "COMMERCIAL" && data.commercialSubtype === undefined && existing.commercialSubtype) {
    // subtype left untouched on a COMMERCIAL update
  } else if (data.propertyTypeCanonical === "COMMERCIAL" && data.commercialSubtype === undefined) {
    data.commercialSubtype = "UNKNOWN"; // commercial but subtype not yet known — TO_VERIFY, not invented
  }
  if (data.commercialSubtype !== undefined && data.commercialSubtype !== null && data.commercialSubtype !== "UNKNOWN"
      && (data.propertyTypeCanonical ?? (existing as unknown as { propertyTypeCanonical?: string }).propertyTypeCanonical) !== "COMMERCIAL") {
    data.commercialSubtype = null; // guard: subtype only sticks when the property IS commercial
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
  if (body.lostReason !== undefined) data.lostReason = body.lostReason;
  if (body.advisorId !== undefined) data.advisorId = body.advisorId ? Number(body.advisorId) : null;
  if (body.backup1Id !== undefined) data.backup1Id = body.backup1Id ? Number(body.backup1Id) : null;
  if (body.backup2Id !== undefined) data.backup2Id = body.backup2Id ? Number(body.backup2Id) : null;
  if (body.notificationOverrides !== undefined) {
    data.notificationOverrides = body.notificationOverrides ? JSON.stringify(body.notificationOverrides) : null;
  }
  if (body.preApprovalDate !== undefined) data.preApprovalDate = body.preApprovalDate;
  if (body.preApprovalAmount !== undefined) data.preApprovalAmount = body.preApprovalAmount;
  if (body.preApprovalTenure !== undefined) data.preApprovalTenure = body.preApprovalTenure;
  if (body.preApprovalRoi !== undefined) data.preApprovalRoi = body.preApprovalRoi;
  if (body.folDate !== undefined) data.folDate = body.folDate;
  if (body.folAmount !== undefined) data.folAmount = body.folAmount;
  if (body.folTenure !== undefined) data.folTenure = body.folTenure;
  if (body.folRoi !== undefined) data.folRoi = body.folRoi;
  // stage timeline (Case 360 drawer). RULE: signing can never precede conversion.
  const STAGE_DATES = [
    "valuationInitiatedDate", "inspectionDate", "valuationReportDate",
    "folConversionDate", "folSignedDate",
    "liabilityLetterDate", "settlementDate", "transferDate", "titleDeedDate",
  ] as const;
  for (const f of STAGE_DATES) {
    if (body[f] === undefined) continue;
    if (f === "folSignedDate" && body[f]) {
      // RULE 4.1 → 4.4: signing can never be recorded before the FOL conversion.
      // Cast keeps this compiling while the Prisma client catches up after
      // `prisma generate` (schema.prisma already carries the column).
      const ex = existing as unknown as { folConversionDate?: string | null };
      const conv = body.folConversionDate !== undefined ? body.folConversionDate : ex.folConversionDate;
      if (!conv) {
        return NextResponse.json(
          { error: "FOL conversion must be recorded before signing (4.1 → 4.4)." },
          { status: 400 }
        );
      }
    }
    data[f] = body[f] === "" ? null : body[f];
  }
  if (body.ddaActive !== undefined) data.ddaActive = !!body.ddaActive;
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
