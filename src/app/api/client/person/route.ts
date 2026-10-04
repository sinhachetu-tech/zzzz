// GET + PATCH /api/client/person — the CLIENT reads and writes their own bank
// application answer sheet.
//
// SESSION-BOUND to the case the client is logged into, then resolved to the
// PERSON behind it: the sheet belongs to the client, not to this engagement, so
// it carries to every future application instead of being asked again. It is
// written to Client.personJson — the same place staff read and edit it from —
// so there is ONE store with two doors and the two can never disagree.
//
// MERGE, NOT REPLACE. The sheet is filled in over months by two parties; a
// whole-object PUT would let one stale tab wipe what the other had just done.
// A null value clears a single field.
//
// UNLIKE /api/client/profile (which stamps the case as "client verified"), this
// does NOT stamp verification: supplying a mother's maiden name is not the same
// act as confirming the case profile is correct.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentClient } from "@/lib/client-auth";

function parseBag(json: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* fall through */ }
  return {};
}

async function resolve() {
  const me = await currentClient();
  if (!me) return null;
  const c = await db.loanCase.findUnique({ where: { id: me.caseId }, select: { clientId: true } });
  return c?.clientId ?? null;
}

export async function GET() {
  const clientId = await resolve();
  if (!clientId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const cl = await db.client.findUnique({ where: { id: clientId }, select: { personJson: true } });
  return NextResponse.json({ personData: parseBag(cl?.personJson) });
}

export async function PATCH(req: NextRequest) {
  const clientId = await resolve();
  if (!clientId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json() as { personData?: Record<string, unknown> };
  if (!body.personData || typeof body.personData !== "object") {
    return NextResponse.json({ error: "personData required" }, { status: 400 });
  }

  const cl = await db.client.findUnique({ where: { id: clientId }, select: { personJson: true } });
  const next = { ...parseBag(cl?.personJson) };
  for (const [k, v] of Object.entries(body.personData)) {
    if (v === null) delete next[k];
    else next[k] = v;
  }

  await db.client.update({ where: { id: clientId }, data: { personJson: JSON.stringify(next) } });
  return NextResponse.json({ ok: true, personData: next });
}
