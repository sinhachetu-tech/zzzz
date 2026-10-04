// POST /api/cases/:id/add-bank — shop an EXISTING case to another bank.
//
// WHY THIS EXISTS: `POST /api/cases` already splits a multi-bank deal into one
// LoanCase per bank (the `perBank` loop), because each bank runs its own journey
// with its own RM, TAT, approval path and — the reason this endpoint matters —
// its own case number and its own document requirements. That only happened at
// CREATION though. Once a file existed there was no way to add a bank, so the
// only available action was pushing another name into the flat `banks` JSON
// array, which produced exactly the single-row/multi-bank shape the create path
// deliberately avoids.
//
// So this reuses the same idea after the fact: it creates a SIBLING case scoped
// to the new bank, inheriting the person's profile, amount, client, owner and
// advisor, and linked back via parentCaseId so the legs read as one deal.
//
// Deliberately NOT copied: the stage, every stage-timeline date, the vault
// contents, tasks and proposals. A new bank leg starts at the beginning of the
// journey — inheriting "Pre-Approval" or a prior bank's documents would be a lie
// about what that bank has actually seen. Only syncCaseVault runs, and it now
// applies the new bank's own document rules (DocRule.applicableBank).

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { serCase } from "@/lib/ser";
import { syncCaseVault } from "@/lib/vault";
import { syncCaseClients } from "@/lib/client-master";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const caseId = parseInt(id, 10);
  const body = await req.json() as { bank?: string; bankRef?: string; bankRm?: string; startStage?: string; note?: string };

  const bank = (body.bank ?? "").trim();
  if (!bank) return NextResponse.json({ error: "Pick a bank to add." }, { status: 400 });

  const parent = await db.loanCase.findUnique({ where: { id: caseId } });
  if (!parent) return NextResponse.json({ error: "Case not found." }, { status: 404 });

  // A parent is always the FIRST leg of the deal, so a request aimed at a
  // sibling is re-pointed at the real parent — otherwise the family would fork
  // and the legs would scatter across the worklist.
  const rootId = parent.parentCaseId ?? parent.id;
  const root = rootId === parent.id ? parent : (await db.loanCase.findUnique({ where: { id: rootId } }));
  if (!root) return NextResponse.json({ error: "Parent case not found." }, { status: 404 });

  const flags = await flagsFor(me);
  const canRoute = flags.super || flags.admin || parent.ownerId === me.id;
  if (!canRoute) {
    return NextResponse.json({ error: "Only the owner or a manager can add a bank to this file." }, { status: 403 });
  }

  // Guard against a duplicate leg: if ANY case in this family already sits with
  // this bank, refuse rather than creating a second, conflicting leg.
  const family = await db.loanCase.findMany({
    where: { OR: [{ id: rootId }, { parentCaseId: rootId }] },
    select: { banks: true, caseNumber: true },
  });
  const clash = family.find((f) => {
    try { return (JSON.parse(f.banks) as string[]).includes(bank); } catch { return false; }
  });
  if (clash) {
    return NextResponse.json(
      { error: `${bank} is already on this deal as ${clash.caseNumber}. Open that leg instead of adding it twice.` },
      { status: 409 },
    );
  }

  // Case numbers are sequential off the highest existing one.
  const last = await db.loanCase.findFirst({ orderBy: { caseNumber: "desc" }, select: { caseNumber: true } });
  const seq = (last ? parseInt(last.caseNumber.replace("HFMC-", ""), 10) || 0 : 0) + 1;
  const caseNumber = `HFMC-${String(seq).padStart(4, "0")}`;

  // Start at the beginning of the pipeline unless the caller says otherwise —
  // this bank has not seen a single document yet.
  const stages = await db.stageItem.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  const firstReal = stages.find((s) => s.label !== "Lead")?.label ?? "Document Collection";
  const startStage = (body.startStage ?? "").trim() || firstReal;

  const created = await db.loanCase.create({
    data: {
      caseNumber,
      customer: parent.customer,
      banks: JSON.stringify([bank]),
      wonBank: null,
      loanAmount: parent.loanAmount,
      propertyValue: parent.propertyValue,
      stage: startStage,
      caseStatus: "Active",
      ownerId: parent.ownerId,
      advisorId: parent.advisorId,
      backup1Id: parent.backup1Id,
      backup2Id: parent.backup2Id,
      source: parent.source,
      partnerKind: parent.partnerKind,
      partnerName: parent.partnerName,
      partnerRm: parent.partnerRm,
      partnerSharePct: parent.partnerSharePct,
      submissionType: parent.submissionType,
      channelId: parent.channelId,
      channelName: parent.channelName,
      channelRatePct: parent.channelRatePct,
      whatsapp: parent.whatsapp,
      waGroup: parent.waGroup,
      // per-bank identity + lineage
      bankRef: (body.bankRef ?? "").trim() || null,
      parentCaseId: rootId,
      // Document Vault profile vectors — these DO carry over, because they
      // describe the borrower, not the bank's opinion of them.
      employmentProfile: parent.employmentProfile,
      propertyType: parent.propertyType,
      residency: parent.residency,
      // MIS/classification
      statusNote: (body.note ?? "").trim()
        || `Added to ${bank} from ${root.caseNumber} — new bank journey, no documents carried over.`,
      transactionType: parent.transactionType,
      propertyLocation: parent.propertyLocation,
      coApplicantName: parent.coApplicantName,
      bankRm: (body.bankRm ?? "").trim() || null,
      // the applicant profile itself, so the new leg qualifies without re-typing
      profileJson: parent.profileJson,
      loanType: parent.loanType,
    },
  });

  // This bank's own document requirements, resolved against the borrower.
  await syncCaseVault(created.id);

  // Carry over what a SIBLING leg already holds.
  //
  // The same EID scan, passport page and bank statement serve every bank in the
  // deal — only the REQUIREMENT differs (DIB wants EID+passlip merged, ADCB wants
  // three KYC separate). So we copy the file reference, not the file: the new row
  // points at the SAME R2 key, so this costs zero extra storage and zero upload
  // time, and the client is never asked for the same document twice.
  //
  // Two deliberate limits:
  //   · status is set to "Uploaded", NEVER "Verified" — a different bank may
  //     legitimately re-inspect it, and claiming otherwise would be a lie about
  //     what that bank has actually seen.
  //   · copiedFromId records the origin, so the "why is this already here?"
  //     question has an answer in the audit trail.
  const copied = await copyDocumentsFromSiblings(rootId, created.id);
  await db.activity.create({
    data: {
      caseId: created.id,
      userId: me.id,
      action: copied
        ? `carried over ${copied} document(s) already held on ${root.caseNumber}`
        : `no documents carried over from ${root.caseNumber}`,
    },
  });

  // Keep the Client master link so the new leg lands under the same person.
  await syncCaseClients(created.id).catch((e) => console.error("client sync failed:", e));

  await db.activity.create({
    data: { caseId: created.id, userId: me.id, action: `added as the ${bank} leg of ${root.caseNumber}` },
  });
  await db.activity.create({
    data: { caseId: rootId, userId: me.id, action: `shopped to ${bank} — opened ${created.caseNumber}` },
  });

  const fresh = (await db.loanCase.findUnique({ where: { id: created.id } }))!;
  return NextResponse.json({ case: serCase(fresh), copiedDocuments: copied });
}

/**
 * Fill the new leg's empty documents from sibling legs of the same deal.
 * Returns how many rows were populated.
 */
async function copyDocumentsFromSiblings(rootId: number, intoCaseId: number): Promise<number> {
  const siblings = await db.loanCase.findMany({
    where: { id: { not: intoCaseId }, OR: [{ id: rootId }, { parentCaseId: rootId }] },
    select: { id: true, caseNumber: true, stage: true, caseStatus: true },
  });
  if (siblings.length === 0) return 0;

  // Only borrow from a leg that is still live — a lost or booked leg is a
  // finished attempt and its paperwork is not a template for the next one.
  const live = siblings.filter((s) => s.caseStatus === "Active");
  if (live.length === 0) return 0;

  const siblingIds = live.map((s) => s.id);

  // Every document on the new leg that has NO file yet, keyed by its rule.
  // Ad-hoc rows (templateId null) are skipped: they are specific to that leg.
  const empty = await db.caseDocument.findMany({
    where: { caseId: intoCaseId, templateId: { not: null }, OR: [{ storageKey: null }, { fileName: null }] },
    select: { id: true, templateId: true, title: true, expiryDate: true },
  });
  if (empty.length === 0) return 0;

  const sources = await db.caseDocument.findMany({
    where: { caseId: { in: siblingIds }, templateId: { not: null } },
    select: {
      id: true, caseId: true, templateId: true, fileName: true, fileType: true, fileSize: true,
      storageKey: true, compressedKey: true, compressedSize: true, selectedVersion: true,
      driveFileId: true, expiryDate: true, fileData: true,
    },
  });
  if (sources.length === 0) return 0;

  // First live sibling that actually holds a file for this rule wins. Iterate
  // the SIBLING order, not the source order, so the result is deterministic.
  const byTemplate = new Map<number, (typeof sources)[number]>();
  for (const leg of live) {
    for (const d of sources) {
      if (d.caseId !== leg.id) continue;
      if (!d.fileName && !d.storageKey) continue;
      if (byTemplate.has(d.templateId as number)) continue;
      byTemplate.set(d.templateId as number, d);
    }
  }

  let copied = 0;
  for (const target of empty) {
    const src = byTemplate.get(target.templateId as number);
    if (!src) continue;
    await db.caseDocument.update({
      where: { id: target.id },
      data: {
        fileName: src.fileName,
        fileType: src.fileType,
        fileSize: src.fileSize,
        // Same key = same bytes in R2. `fileData` is only the legacy
        // Postgres-blob fallback and is copied only when there is no key.
        storageKey: src.storageKey,
        fileData: src.storageKey ? null : src.fileData,
        compressedKey: src.compressedKey,
        compressedSize: src.compressedSize,
        selectedVersion: src.selectedVersion,
        driveFileId: src.driveFileId,
        expiryDate: src.expiryDate,
        // NOT "Verified" — see the note above. A file exists; this bank has not
        // yet checked it.
        status: "Uploaded",
        uploadedByKind: "staff",
        uploadedById: null,
        uploadedAt: new Date(),
        copiedFromId: src.id,
      },
    });
    copied++;
  }
  return copied;
}
