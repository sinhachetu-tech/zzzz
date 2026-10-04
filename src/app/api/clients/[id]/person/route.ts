// PATCH /api/clients/:id/person — save the bank-form answer sheet.
//
// WHY THIS IS SEPARATE FROM THE CLIENT PROFILE ROUTE: /api/client/profile is
// session-bound to ONE case and is what the CLIENT writes about themselves in the
// portal. This route is staff-side and writes the same data, but to whichever
// person the case is about — the main applicant (clientId) or the co-partner
// (secondPartyClientId). One route, one place the data lands, whichever side
// fills it in.
//
// MERGE, NOT REPLACE. The sheet is filled in over months, by two parties, in
// bits. A PUT that replaced the whole object would let one stale tab wipe a
// field the other party had just completed, so this merges per key and an
// explicit null removes a single field.
//
// FIELDS ARE NOT VALIDATED AGAINST A SCHEMA, ON PURPOSE: the field set is
// discovered incrementally (every new bank form turns up something new) and the
// contract is `src/lib/person-sheet.ts`. Rejecting an unknown key here would
// break the portal the moment a field is added to that file and not yet to a
// deployed build.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { serClient } from "@/lib/ser";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const clientId = parseInt(id, 10);

  const flags = await flagsFor(me);
  if (!(flags.super || flags.admin || flags.issueTasks)) {
    return NextResponse.json({ error: "Your designation cannot edit client data." }, { status: 403 });
  }

  const body = await req.json() as { patch?: Record<string, unknown>; remove?: string[] };
  const patch = body.patch && typeof body.patch === "object" ? body.patch : {};
  const remove = Array.isArray(body.remove) ? body.remove.map(String) : [];

  const cl = await db.client.findUnique({ where: { id: clientId } });
  if (!cl) return NextResponse.json({ error: "client not found" }, { status: 404 });

  let current: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(cl.personJson ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) current = parsed as Record<string, unknown>;
  } catch { current = {}; }

  const next = { ...current };
  for (const [k, v] of Object.entries(patch)) next[k] = v;
  for (const k of remove) delete next[k];

  const updated = await db.client.update({
    where: { id: clientId },
    data: { personJson: JSON.stringify(next) },
  });

  // An activity line so "who completed which part of this person's sheet" is
  // answerable later — the same reason the EID merge policy exists.
  const changed = Object.keys(patch).length + remove.length;
  if (changed > 0) {
    const anyCase = await db.loanCase.findFirst({
      where: { OR: [{ clientId }, { secondPartyClientId: clientId }] },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (anyCase) {
      await db.activity.create({
        data: {
          caseId: anyCase.id,
          userId: me.id,
          action: `updated the application data sheet for ${cl.fullName} (${changed} field${changed > 1 ? "s" : ""})`,
        },
      });
    }
  }

  return NextResponse.json({ client: serClient(updated) });
}
