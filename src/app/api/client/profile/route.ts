// PATCH /api/client/profile — the CLIENT saves their own data sheet.
// Security: session-bound; writes the session-linked case's profileJson only,
// stamps profileClientVerifiedAt (staff sees "client verified"), and refreshes
// the Client master so match/proposals consume the new figures immediately.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentClient } from "@/lib/client-auth";
import { syncCaseClients } from "@/lib/client-master";

export async function PATCH(req: NextRequest) {
  const me = await currentClient();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { profileJson } = await req.json() as { profileJson?: string };
  if (!profileJson) return NextResponse.json({ error: "profileJson required" }, { status: 400 });
  try { JSON.parse(profileJson); } catch { return NextResponse.json({ error: "invalid profile data" }, { status: 400 }); }

  const c = await db.loanCase.findUnique({ where: { id: me.caseId } });
  if (!c) return NextResponse.json({ error: "case not found" }, { status: 404 });

  await db.loanCase.update({
    where: { id: c.id },
    data: { profileJson, profileClientVerifiedAt: new Date() },
  });

  await syncCaseClients(c.id).catch(() => {});
  return NextResponse.json({ ok: true, verifiedAt: new Date().toISOString() });
}
