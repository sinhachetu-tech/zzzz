// GET /api/client/state — returns the client's case + stage history + documents.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentClient, clientOwnsCase } from "@/lib/client-auth";
import { serCase, serCaseDocument } from "@/lib/ser";
import { getPortalSettings } from "@/lib/portal-settings";

export async function GET(req: Request) {
  const me = await currentClient();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // ONE CLIENT, MANY JOURNEYS (Phase 3).
  //
  // A session used to be pinned to a single case and this route then hand-rolled
  // a sibling check. Now the session is CLIENT-SCOPED, so the rule is simply
  // "is this case one of theirs" — clientOwnsCase — and the engagement list is
  // every case the CLIENT holds, across every service line. That is what makes
  // the portal able to show a mortgage AND a golden visa AND a will under one
  // login, which is the whole point of Phase 1–3.
  const url = new URL(req.url);
  const requestedId = Number(url.searchParams.get("caseId")) || me.caseId;

  // LEAD-ONLY REGISTRANT (Phase 4). They have a session and a Client row but no
  // case yet — the lead has not been converted. Returning a 404 here would look
  // broken to the person who just signed up, so they get an explicit empty state
  // and the portal tells them their enquiry is with an advisor.
  if (requestedId == null) {
    return NextResponse.json({
      me: { ...me, caseId: null, caseNumber: null },
      engagements: [],
      case: null,
      awaitingConversion: true,
      stages: [],
      stageTransitions: [],
      documents: [],
      vaultDocuments: [],
      advisor: null,
      advisorWhatsapp: null,
      profile: null,
      profileClientVerifiedAt: null,
    });
  }

  if (requestedId !== me.caseId && !(await clientOwnsCase(me, requestedId))) {
    return NextResponse.json({ error: "case not linked to this client" }, { status: 403 });
  }
  const selectedId = requestedId;

  // The anchor's clientId defines the scope for the engagement list.
  const anchor = await db.loanCase.findUnique({ where: { id: selectedId }, select: { clientId: true } });
  const clientId = me.clientId ?? anchor?.clientId ?? null;

  // Service-line names for the journey switcher labels. Cheap lookup (6 rows).
  const serviceLines = await db.serviceLine.findMany({ select: { id: true, name: true, shortName: true } });

  // Every journey this person holds. Grouped by service line in the UI so a
  // person with four products sees four labelled journeys, not one flat list.
  const engagements = clientId
    ? await db.loanCase.findMany({
        where: { clientId },
        orderBy: { id: "asc" },
        select: {
          id: true, caseNumber: true, banks: true, stage: true, caseStatus: true,
          loanAmount: true, wonBank: true, serviceLineId: true, legStatus: true,
        },
      })
    : [];

  const c = await db.loanCase.findUnique({
    where: { id: selectedId },
    include: {
      owner: true,
      advisor: true,
      stageTransitions: { orderBy: { at: "desc" }, include: { user: { select: { name: true } } } },
      clientDocuments: { orderBy: { uploadedAt: "desc" } },
      vaultDocuments: { where: { visibleToClient: true }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!c) return NextResponse.json({ error: "case not found" }, { status: 404 });

  const caseDto = serCase(c);
  const stages = await db.stageItem.findMany({ orderBy: { sortOrder: "asc" } });

  // Advisor shown to the client: the case's assigned advisor, else the
  // admin-configured default (Admin → Portal settings), else the owner.
  const settings = await getPortalSettings();
  const fallbackAdvisor = settings.clientPortalAdvisorId
    ? await db.user.findUnique({ where: { id: settings.clientPortalAdvisorId } })
    : null;
  const advisorUser = c.advisor ?? fallbackAdvisor ?? c.owner;

  // Name + number are always a PAIRED pair from one staff record (never mixed).
  // Facing staff (Admin → Portal settings, usually a senior) fronts the card
  // unless the case's own advisor has a WhatsApp number of their own.
  let facingUser: { name: string; role: string; phone: string | null } | null =
    advisorUser ? { name: advisorUser.name, role: advisorUser.role, phone: advisorUser.phone } : null;
  if (settings.clientFacingUserId) {
    const facing = await db.user.findUnique({ where: { id: settings.clientFacingUserId } });
    if (facing?.active) facingUser = { name: facing.name, role: facing.role, phone: facing.phone };
  }
  // Per-case override: if the case has its own advisor (differs from the fallback
  // or the facing staff) AND that advisor has a number, they front their own card.
  if (c.advisorId && c.advisor && c.advisor.phone) {
    facingUser = { name: c.advisor.name, role: c.advisor.role, phone: c.advisor.phone };
  }

  return NextResponse.json({
    me: { ...me, caseId: selectedId, caseNumber: caseDto.caseNumber },
    engagements: engagements.map((e) => ({
      id: e.id, caseNumber: e.caseNumber,
      banks: (() => { try { return JSON.parse(e.banks); } catch { return []; } })(),
      stage: e.stage, caseStatus: e.caseStatus, loanAmount: e.loanAmount, wonBank: e.wonBank,
      // Phase 3: the portal labels each journey by service line, so a person with
      // a mortgage and a golden visa can tell the two apart at a glance. The label
      // is resolved server-side — the client portal has no access to the admin
      // catalogue endpoint.
      serviceLineId: e.serviceLineId,
      serviceLine: e.serviceLineId
        ? (serviceLines.find((s) => s.id === e.serviceLineId)?.shortName ??
           serviceLines.find((s) => s.id === e.serviceLineId)?.name ?? null)
        : null,
      // A leg beaten by another bank is still on file, but it is not a live
      // journey — the switcher shows it dimmed rather than hiding the history.
      legStatus: e.legStatus,
    })),
    case: caseDto,
    stages: stages.map((s) => ({ id: s.id, label: s.label, sortOrder: s.sortOrder, active: s.active })),
    stageTransitions: c.stageTransitions.map((t) => ({
      id: t.id, fromStage: t.fromStage, toStage: t.toStage, comment: t.comment,
      userName: t.user?.name ?? "—", at: t.at.toISOString(),
    })),
    vaultDocuments: c.vaultDocuments.map(serCaseDocument),
    documents: c.clientDocuments.map((d) => ({
      // Phase G: fileName/fileType/fileSize/uploadedAt are now NULLABLE because a
      // vault entry is created as a placeholder ("pending upload") before any file
      // exists. uploadedAt is null until a file actually lands, so the old
      // `.toISOString()` would throw on the very first pending row — which is the
      // state every document starts in.
      id: d.id,
      title: d.title,
      category: d.category,
      status: d.status,
      sharing: d.sharing,
      fileName: d.fileName,
      fileType: d.fileType,
      fileSize: d.fileSize,
      uploadedAt: d.uploadedAt ? d.uploadedAt.toISOString() : null,
      createdAt: d.createdAt.toISOString(),
    })),
    advisor: facingUser ? { name: facingUser.name, role: facingUser.role } : null,
    advisorWhatsapp: facingUser?.phone || settings.clientPortalWhatsapp || null,
    profile: c.profileJson ? (() => { try { return JSON.parse(c.profileJson); } catch { return null; } })() : null,
    profileClientVerifiedAt: c.profileClientVerifiedAt ? c.profileClientVerifiedAt.toISOString() : null,
  });
}
