// PATCH /api/client/profile — the CLIENT saves their own data sheet.
// Session-bound; writes the session-linked case's profileJson, stamps
// profileClientVerifiedAt (staff sees "client verified"), and refreshes the
// Client master so match/proposals consume the new figures immediately.
//
// ALSO ACCEPTS `personData` — the bank-form ANSWER SHEET (see
// src/lib/person-sheet.ts). That one is written to the CLIENT, not the case, on
// purpose: most of those fields are things only the client can ever know
// (mother's maiden name, their home-country address, a reference's mobile) and
// they are identical on their next loan. Writing them per case would mean asking
// again on every application — the exact waste the sheet exists to remove.
//
// MERGE, NOT REPLACE, for the same reason as the staff route: the sheet is
// filled in over months by two parties, and a whole-object PUT would let one
// stale tab wipe what the other had just completed. An explicit null clears a
// single field.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentClient } from "@/lib/client-auth";
import { syncCaseClients } from "@/lib/client-master";

export async function PATCH(req: NextRequest) {
  const me = await currentClient();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { profileJson, personData } = await req.json() as {
    profileJson?: string;
    personData?: Record<string, unknown>;
  };
  if (!profileJson && !personData) {
    return NextResponse.json({ error: "profileJson or personData required" }, { status: 400 });
  }
  if (profileJson) {
    try { JSON.parse(profileJson); } catch { return NextResponse.json({ error: "invalid profile data" }, { status: 400 }); }
  }
  if (!me.caseId) return NextResponse.json({ error: "case not found" }, { status: 404 });
  const c = await db.loanCase.findUnique({ where: { id: me.caseId }, select: { id: true, clientId: true } });
  if (!c) return NextResponse.json({ error: "case not found" }, { status: 404 });
  // Session clientId wins over the case's — after Phase 3 the session is the
  // person's identity, and the anchor case may be a sibling leg.
  const clientId = me.clientId ?? c.clientId ?? null;

  if (profileJson) {
    await db.loanCase.update({
      where: { id: c.id },
      data: { profileJson, profileClientVerifiedAt: new Date() },
    });
    await syncCaseClients(c.id).catch(() => {});
  }

  // The answer sheet goes on the PERSON, so it carries to every future case.
  if (personData && clientId) {
    const cl = await db.client.findUnique({ where: { id: clientId }, select: { personJson: true } });
    let current: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(cl?.personJson ?? "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) current = parsed as Record<string, unknown>;
    } catch { current = {}; }
    const next = { ...current };
    for (const [k, v] of Object.entries(personData)) {
      if (v === null) delete next[k]; // explicit null clears one field
      else next[k] = v;
    }
    await db.client.update({ where: { id: clientId }, data: { personJson: JSON.stringify(next) } });
  }

  return NextResponse.json({ ok: true, verifiedAt: new Date().toISOString() });
}
