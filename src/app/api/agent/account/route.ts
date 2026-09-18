// DELETE /api/agent/account — agent removes their own portal access.
// Soft-deletes: PartnerItem.active = false (referred cases + commission history
// stay with the HFMC team); login is refused afterwards.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentAgent, agentLogout } from "@/lib/agent-auth";

export async function DELETE(req: NextRequest) {
  const me = await currentAgent();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { password } = await req.json() as { password?: string };
  if (!password) return NextResponse.json({ error: "Confirm your password to continue." }, { status: 400 });

  const partner = await db.partnerItem.findFirst({ where: { name: me.name, kind: me.kind } });
  if (!partner) return NextResponse.json({ error: "Partner record not found." }, { status: 404 });
  if (partner.password !== password) return NextResponse.json({ error: "Wrong password." }, { status: 400 });

  await db.partnerItem.update({ where: { id: partner.id }, data: { active: false } });
  await agentLogout();
  return NextResponse.json({ ok: true });
}
