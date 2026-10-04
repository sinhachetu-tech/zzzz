// POST /api/cases/:id/borrow-document — pull a document this client already
// supplied on ANOTHER case into this one.
//
// WHY THIS EXISTS, SEPARATE FROM THE AUTOMATIC SIBLING COPY: the automatic copy
// in /api/cases/:id/add-bank fires once, silently, at the moment a bank is added
// — so it never helps the common case the user actually hit ("the EID is on the
// Mashreq leg, I'm on the ADCB leg, how do I get it across?"), and it cannot help
// at all for legs created BEFORE it existed, or documents uploaded afterwards.
// This is the manual, discoverable version.
//
// SCOPE IS THE PERSON, not just the sibling family. The same human's EID is on
// their other case, and that is exactly where a broker will look for it, so the
// source list is every other case this client is on — primary or co-partner.
//
// NO BYTES ARE COPIED. The new row points at the SAME R2 key, so a shared EID
// scan costs no extra storage and cannot drift out of sync with the original.
// Status is set to "Uploaded", never "Verified": the previous bank saw it, this
// one has not, and claiming otherwise would be a lie about what this bank has
// actually inspected. `copiedFromId` records the origin.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { requireDocManager } from "@/lib/domain";
import { serCaseDocument } from "@/lib/ser";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!(await requireDocManager(me, flags))) {
    return NextResponse.json({ error: "Your designation does not allow document operations." }, { status: 403 });
  }
  const { id } = await params;
  const caseId = parseInt(id, 10);
  const { sourceDocId, templateId, title } = await req.json() as {
    sourceDocId?: number; templateId?: number | null; title?: string;
  };
  if (!sourceDocId) return NextResponse.json({ error: "sourceDocId required" }, { status: 400 });

  const target = await db.loanCase.findUnique({ where: { id: caseId } });
  if (!target) return NextResponse.json({ error: "case not found" }, { status: 404 });

  // The source must belong to the SAME PERSON — this is a client-level share,
  // not a way to pull a stranger's passport.
  const personIds = [target.clientId, target.secondPartyClientId].filter(Boolean) as number[];
  if (personIds.length === 0) {
    return NextResponse.json({ error: "This case has no client linked yet, so nothing can be borrowed." }, { status: 400 });
  }
  const source = await db.caseDocument.findUnique({ where: { id: sourceDocId } });
  if (!source) return NextResponse.json({ error: "source document not found" }, { status: 404 });
  if (source.caseId === caseId) {
    return NextResponse.json({ error: "That document is already on this case." }, { status: 400 });
  }
  const sourceCase = await db.loanCase.findUnique({ where: { id: source.caseId } });
  const samePerson =
    sourceCase && [sourceCase.clientId, sourceCase.secondPartyClientId].some((x) => x && personIds.includes(x));
  if (!samePerson) {
    return NextResponse.json({ error: "That document belongs to a different client." }, { status: 403 });
  }
  if (!source.fileName && !source.storageKey) {
    return NextResponse.json({ error: "That document has no file attached, so there is nothing to copy." }, { status: 400 });
  }

  // Never create a duplicate: if this case already has a row for the same
  // template, refresh the file onto it instead of adding a second one.
  const existing = templateId != null
    ? await db.caseDocument.findFirst({ where: { caseId, templateId } })
    : null;

  const payload = {
    fileName: source.fileName,
    fileType: source.fileType,
    fileSize: source.fileSize,
    storageKey: source.storageKey,
    fileData: source.storageKey ? null : source.fileData,
    compressedKey: source.compressedKey,
    compressedSize: source.compressedSize,
    selectedVersion: source.selectedVersion,
    driveFileId: source.driveFileId,
    status: "Uploaded",
    uploadedByKind: "staff",
    uploadedById: me.id,
    uploadedAt: new Date(),
    copiedFromId: source.id,
  };

  const saved = existing
    ? await db.caseDocument.update({ where: { id: existing.id }, data: payload })
    : await db.caseDocument.create({
        data: {
          caseId,
          templateId: templateId ?? null,
          title: title?.trim() || source.title,
          category: source.category,
          mandatory: source.mandatory,
          visibleToClient: true,
          clientCanUpload: true,
          sortOrder: (await db.caseDocument.aggregate({ where: { caseId }, _max: { sortOrder: true } }))._max.sortOrder ?? 0,
          ...payload,
        },
      });

  await db.activity.create({
    data: {
      caseId,
      userId: me.id,
      action: `copied "${source.title}" from ${sourceCase.caseNumber} (same client)`,
    },
  });

  return NextResponse.json({ document: serCaseDocument(saved), replaced: !!existing });
}
