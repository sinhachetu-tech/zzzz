// POST /api/cases — create a new case (with optional first task).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { serCase } from "@/lib/ser";
import { syncCaseVault } from "@/lib/vault";
import { syncCaseClients, resolveClient, type ClientSeed } from "@/lib/client-master";
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
    whatsapp, waGroup, task, advisorId, backup1Id, backup2Id,
    submissionType, channelId, channelName, channelRatePct,
    statusNote, bankRm, vrmId, transactionType, propertyLocation, coApplicantName,
    employmentProfile, propertyType, residency,
    onHold, holdReason, holdUntil,
    loanType, fileSubmittedDate, bankRate, bankTenor,
    preApprovalDate, preApprovalAmount, preApprovalTenure, preApprovalRoi,
    folDate, folAmount, folTenure, folRoi,
    // Phase C — the segregation is decided AT INTAKE, not bolted on afterwards.
    serviceLineId, productId, clientId,
  } = body as {
    customer: string;
    banks: string[];
    loanAmount: number;
    /** REAL property value. Optional at intake; the engine reports an LTV data gap
     *  when absent rather than deriving one from the loan amount. */
    propertyValue?: number | null;
    stage: string;
    ownerId: number;
    source: CaseSource;
    partner: CasePartner | null;
    whatsapp: string;
    waGroup: string | null;
    task?: { description: string; dueDate: string; waitingFor: string; whyPending: string; ownerId: number };
    advisorId?: number | null; // client-facing advisor decided at intake (senior on the client's Ask card)
    backup1Id?: number | null; // first backup staffer — covers the file while the owner is on leave
    backup2Id?: number | null; // second backup staffer — covers the file while the owner is on leave
    submissionType?: "direct" | "channel";
    channelId?: number | null;
    channelName?: string | null;
    channelRatePct?: number;
    // Phase C — decided at intake. serviceLineId omitted ⇒ MORTGAGE server-side.
    // productId is `number | null | ""` because the picker sends "" for "not specified";
    // typing it as a bare number would make that falsy branch unreachable to the
    // compiler while the UI kept sending it.
    serviceLineId?: number | null;
    productId?: number | null | "";
    clientId?: number | null;
  } & NewCaseMisInput;

  if (!customer?.trim()) return NextResponse.json({ error: "Customer name is required." }, { status: 400 });
  if (!loanAmount || loanAmount <= 0) return NextResponse.json({ error: "Invalid loan amount." }, { status: 400 });

  /* ---- Phase C: which department, which offering, which person ----
   *
   * These three were previously decided AFTER the fact (or never). Deciding them at
   * intake is the whole point of the phase: a golden-visa case created as "mortgage"
   * because the picker did not exist is the exact failure the multi-service work is
   * meant to prevent.
   */
  // Default to MORTGAGE when the caller sends nothing, because every pre-Phase-1 case
   // is mortgage and a missing value must not block opening a file. An UNKNOWN line is
   // a hard error though — silently storing a dangling id would break the department
  // scoping in src/lib/domain.ts (a case on a line nobody can see).
  let lineId = 1;
  let lineCode = "MORTGAGE";
  if (serviceLineId != null) {
    const line = await db.serviceLine.findUnique({ where: { id: Number(serviceLineId) }, select: { id: true, code: true, active: true } });
    if (!line) return NextResponse.json({ error: "Unknown service line." }, { status: 400 });
    if (!line.active) return NextResponse.json({ error: `${line.code} is deactivated — reactivate it before opening cases on it.` }, { status: 400 });
    lineId = line.id;
    lineCode = line.code;
  } else {
    const mort = await db.serviceLine.findFirst({ where: { code: "MORTGAGE" }, select: { id: true } });
    if (mort) { lineId = mort.id; lineCode = "MORTGAGE"; }
  }

  // A product must belong to the chosen line. Rejecting a mismatch stops "First-home
  // purchase" on a golden-visa case, which would otherwise report nonsense in every
  // per-department rollup.
  let prodId: number | null = null;
  if (productId != null && productId !== "") {
    const prod = await db.product.findUnique({ where: { id: Number(productId) }, select: { id: true, serviceLineId: true, active: true } });
    if (!prod) return NextResponse.json({ error: "Unknown product." }, { status: 400 });
    if (prod.serviceLineId !== lineId) {
      return NextResponse.json({ error: "That product belongs to a different service line." }, { status: 400 });
    }
    if (!prod.active) return NextResponse.json({ error: "That product is deactivated." }, { status: 400 });
    prodId = prod.id;
  }

  // Resolve the PERSON. Reuses the existing merge ladder unchanged (EID → phone+name →
  // never phone alone), so opening a case for a returning customer links their existing
  // Client instead of minting a duplicate. A case with no client at all is the gap Phase
  // C exists to close, so it is created here rather than left null.
  const clientIdNum = clientId ? Number(clientId) : null;
  let resolvedClientId: number | null = null;
  let resolvedName = customer.trim();
  if (clientIdNum) {
    const c = await db.client.findUnique({ where: { id: clientIdNum }, select: { id: true, fullName: true } });
    if (!c) return NextResponse.json({ error: "Unknown client." }, { status: 400 });
    resolvedClientId = c.id;
    resolvedName = c.fullName;
  } else {
    const { client } = await resolveClient({
      fullName: customer.trim(),
      phone: whatsapp ?? "",
      email: "",
    } as ClientSeed);
    resolvedClientId = client.id;
    resolvedName = client.fullName;
  }

  // Each bank runs its own journey (its own RM, TAT, approval path), so
  // selecting multiple banks at creation opens one case per bank.
  const bankList = Array.isArray(banks) ? banks : [];
  const createdList: { id: number; caseNumber: string }[] = [];
  const perBank = bankList.length > 1 ? bankList : [null];

  const rmMap = (body.bankRms && typeof body.bankRms === "object") ? body.bankRms as Record<string, string> : {};
  const partnerRm = typeof body.partnerRm === "string" ? body.partnerRm.trim() : "";
  const last = await db.loanCase.findFirst({ orderBy: { caseNumber: "desc" }, select: { caseNumber: true } });
  let seq = last ? parseInt(last.caseNumber.replace("HFMC-", ""), 10) || 0 : 0;
  for (const singleBank of perBank) {
  seq += 1;
  const caseNumber = `HFMC-${String(seq).padStart(4, "0")}`;

  const created = await db.loanCase.create({
    data: {
      caseNumber,
      // Phase C: use the RESOLVED name, not whatever was typed. When the merge ladder
      // matched an existing Client the canonical name is theirs, so the case and the
      // client master cannot drift apart.
      customer: resolvedName,
      // Phase C: the department and offering, decided at intake. `lineCode` is carried
      // only to make the intent readable here — the stored link is the id.
      serviceLineId: lineId,
      productId: prodId,
      clientId: resolvedClientId,
      banks: JSON.stringify(singleBank ? [singleBank] : (banks ?? [])),
      bankRm: singleBank ? (rmMap[singleBank] ?? bankRm ?? null) : (bankRm ?? null),
      wonBank: null,
      loanAmount,
      propertyValue: body.propertyValue ? Number(body.propertyValue) : null,
      stage: stage || "WhatsApp Group Creation",
      caseStatus: "Active",
      ownerId,
      advisorId: advisorId ? Number(advisorId) : null,
      backup1Id: backup1Id ? Number(backup1Id) : null,
      backup2Id: backup2Id ? Number(backup2Id) : null,
      source,
      partnerKind: partner?.kind ?? null,
      partnerName: partner?.name ?? null,
      partnerRm: partnerRm || null,
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

  // link the primary applicant to the Client master (repeat-business anchor)
  await syncCaseClients(created.id).catch((e) => console.error("client sync failed:", e));

  createdList.push({ id: created.id, caseNumber });
  }

  const created = (await db.loanCase.findUnique({ where: { id: createdList[0].id } }))!;

  // Link every bank after the first back to the FIRST one, so the legs of one
  // multi-bank deal stay visibly one deal. The first leg is the parent (null).
  if (createdList.length > 1) {
    const parentId = createdList[0].id;
    for (const sib of createdList.slice(1)) {
      await db.loanCase.update({ where: { id: sib.id }, data: { parentCaseId: parentId } });
      await db.activity.create({
        data: { caseId: sib.id, userId: me.id, action: "opened as a leg of a multi-bank deal" },
      });
    }
    await db.activity.create({
      data: { caseId: parentId, userId: me.id, action: `opened with ${createdList.length - 1} additional bank leg(s)` },
    });
  }

  if (task?.description?.trim()) {
    for (const c of createdList) {
      await db.task.create({
        data: {
          caseId: c.id,
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
        data: { caseId: c.id, userId: me.id, action: `added task “${task.description.trim()}”` },
      });
    }
  }

  const fresh = await db.loanCase.findUnique({ where: { id: created.id } });
  return NextResponse.json({ case: serCase(fresh!), cases: createdList });
}
