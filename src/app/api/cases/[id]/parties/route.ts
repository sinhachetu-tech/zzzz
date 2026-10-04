// The people on a case (Phase B) — add, re-role, or remove a co-borrower,
// co-applicant or guarantor.
//
// THE RULE: the PERSON is a Client; the ROLE lives here. Nothing about the human is
// stored on this row, and nothing about the deal is stored on the Client. That is
// the boundary the whole multi-service model rests on — see CODEBASE.md.
//
// `secondPartyClientId` on LoanCase is the legacy single slot, kept in step with
// the FIRST CoBorrower on the case because client-master.ts and the KYC data sheet
// still read it. It is a mirror, not the source of truth.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { serCaseParty } from "@/lib/ser";
import { resolveClient } from "@/lib/client-master";
import { PARTY_ROLES, type PartyRole } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };
type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

async function loadCase(caseId: number) {
  return db.loanCase.findUnique({
    where: { id: caseId },
    select: { id: true, caseNumber: true, customer: true, clientId: true, secondPartyClientId: true },
  });
}

/** Party rows for a case, serialised, with the client's name joined in. */
async function listParties(caseId: number, legacySlotClientId?: number | null) {
  const legacy = legacySlotClientId === undefined
    ? (await loadCase(caseId))?.secondPartyClientId ?? null
    : legacySlotClientId;
  const rows = await db.caseParty.findMany({
    where: { caseId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: { client: { select: { fullName: true } } },
  });
  return rows.map((p) =>
    serCaseParty(p, { clientName: p.client.fullName, legacySlot: legacy === p.clientId }),
  );
}

/**
 * Re-point the legacy single slot at whoever is the first CoBorrower.
 *
 * Runs inside the same transaction as every mutation so the two can never drift.
 * "First" is by sortOrder — the top of the list is the primary second party, which
 * is what the KYC sheet and the portal have always assumed.
 *
 * Exported for the test in scripts/phase5-test-parties.cjs. Re-implementing this
 * rule in the test would prove nothing about the code that actually ships.
 */
export async function syncLegacySlot(tx: Tx, caseId: number): Promise<void> {
  const first = await tx.caseParty.findFirst({
    where: { caseId, role: "CoBorrower" },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { clientId: true },
  });
  await tx.loanCase.update({
    where: { id: caseId },
    data: { secondPartyClientId: first?.clientId ?? null },
  });
}

/** GET — the parties on this case. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const caseId = parseInt(id, 10);
  if (!(await loadCase(caseId))) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ parties: await listParties(caseId) });
}

/** POST — add a party. Either an existing clientId, or a seed to resolve/create. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // No extra permission gate: any signed-in staff member may amend a case, and the
  // case PATCH route sets the precedent. A narrower flag here would make a
  // co-borrower the one thing a broker can see but not fix.

  const { id } = await params;
  const caseId = parseInt(id, 10);
  const kase = await loadCase(caseId);
  if (!kase) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  const role = String(body.role ?? "CoBorrower") as PartyRole;
  if (!PARTY_ROLES.includes(role)) {
    return NextResponse.json(
      { error: `role must be one of ${PARTY_ROLES.join(", ")}` },
      { status: 400 },
    );
  }

  // Two ways in: an explicit clientId (picked from search), or a seed to resolve
  // (the "create a new person" path). Both go through client-master's merge
  // policy — EID exact, else phone+name, NEVER phone alone.
  let clientId = Number(body.clientId) || 0;
  let createdClient = false;
  let matchedBy: string | null = null;

  if (!clientId) {
    const fullName = String(body.fullName ?? "").trim();
    if (!fullName) {
      return NextResponse.json(
        { error: "Pick an existing client, or give a name to create one." },
        { status: 400 },
      );
    }
    const res = await resolveClient({
      fullName,
      phone: body.phone ? String(body.phone) : null,
      eidNo: body.eidNo ? String(body.eidNo) : null,
      email: body.email ? String(body.email) : null,
      nationality: body.nationality ? String(body.nationality) : null,
    });
    clientId = res.client.id;
    createdClient = res.matched === null;
    matchedBy = res.matched;
  } else {
    const exists = await db.client.findUnique({ where: { id: clientId }, select: { id: true } });
    if (!exists) return NextResponse.json({ error: "No such client" }, { status: 404 });
  }

  // The primary applicant is not a "party" — they ARE the case. Listing them again
  // would double their income on the affordability check.
  if (kase.clientId && kase.clientId === clientId) {
    return NextResponse.json(
      { error: "That person is already the primary applicant on this case." },
      { status: 400 },
    );
  }

  // The (caseId, clientId) unique index is the real guard; this turns the
  // violation into a sentence a person can act on instead of a 500.
  const already = await db.caseParty.findUnique({
    where: { caseId_clientId: { caseId, clientId } },
  });
  if (already) {
    return NextResponse.json(
      { error: "Already on this case — change their role rather than adding them twice." },
      { status: 409 },
    );
  }

  const top = await db.caseParty.findFirst({
    where: { caseId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const party = await db.$transaction(async (tx) => {
    const row = await tx.caseParty.create({
      data: { caseId, clientId, role, sortOrder: (top?.sortOrder ?? -1) + 1 },
    });
    await syncLegacySlot(tx, caseId);
    return row;
  });

  const full = await db.caseParty.findUniqueOrThrow({
    where: { id: party.id },
    include: { client: { select: { fullName: true } } },
  });

  // `createdClient` lets the UI say "we added her to the client master" rather
  // than silently minting a near-duplicate of someone already on file.
  return NextResponse.json({
    party: serCaseParty(full, { clientName: full.client.fullName }),
    createdClient,
    matchedBy,
    parties: await listParties(caseId),
  });
}

/** PATCH — change a party's role. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const caseId = parseInt(id, 10);
  if (!(await loadCase(caseId))) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const partyId = Number(body.partyId) || 0;
  if (!partyId) return NextResponse.json({ error: "partyId is required" }, { status: 400 });

  const existing = await db.caseParty.findUnique({ where: { id: partyId } });
  // Scoped by caseId: a party id from another case must not be editable here.
  if (!existing || existing.caseId !== caseId) {
    return NextResponse.json({ error: "That person is not on this case" }, { status: 404 });
  }

  const role = String(body.role ?? "") as PartyRole;
  if (!PARTY_ROLES.includes(role)) {
    return NextResponse.json(
      { error: `role must be one of ${PARTY_ROLES.join(", ")}` },
      { status: 400 },
    );
  }

  // Re-ordering is what "first Co-borrower" means — if the demoted person is
  // currently top of that list, the next one inherits the legacy slot.
  const data: Record<string, unknown> = { role };
  if (typeof body.sortOrder === "number") data.sortOrder = body.sortOrder;

  await db.$transaction(async (tx) => {
    await tx.caseParty.update({ where: { id: partyId }, data });
    await syncLegacySlot(tx, caseId);
  });

  const parties = await listParties(caseId);
  return NextResponse.json({ party: parties.find((p) => p.id === partyId) ?? null, parties });
}

/** DELETE — remove a party from the case. The Client row is never touched. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const caseId = parseInt(id, 10);
  if (!(await loadCase(caseId))) return NextResponse.json({ error: "not found" }, { status: 404 });

  const partyId = Number(new URL(req.url).searchParams.get("partyId")) || 0;
  if (!partyId) return NextResponse.json({ error: "partyId is required" }, { status: 400 });

  const existing = await db.caseParty.findUnique({ where: { id: partyId } });
  if (!existing || existing.caseId !== caseId) {
    return NextResponse.json({ error: "That person is not on this case" }, { status: 404 });
  }

  // Removing the party does NOT delete the Client. They are a real person we may
  // be dealing with again next year, and their record holds their own KYC and
  // financials — losing that to a UI mis-click would be unrecoverable.
  await db.$transaction(async (tx) => {
    await tx.caseParty.delete({ where: { id: partyId } });
    await syncLegacySlot(tx, caseId);
  });

  return NextResponse.json({ ok: true, parties: await listParties(caseId) });
}