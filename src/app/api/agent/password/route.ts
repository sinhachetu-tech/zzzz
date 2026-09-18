// POST /api/agent/password — agent changes their own portal password.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentAgent } from "@/lib/agent-auth";

export async function POST(req: NextRequest) {
  const me = await currentAgent();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { current, next } = await req.json() as { current?: string; next?: string };
  if (!current || !next) return NextResponse.json({ error: "Fill in both fields." }, { status: 400 });
  if (next.length < 6) return NextResponse.json({ error: "New password must be at least 6 characters." }, { status: 400 });

  const partner = await db.partnerItem.findFirst({ where: { name: me.name, kind: me.kind } });
  if (!partner) return NextResponse.json({ error: "Partner record not found." }, { status: 404 });
  if (partner.password !== current) return NextResponse.json({ error: "Current password is wrong." }, { status: 400 });

  await db.partnerItem.update({ where: { id: partner.id }, data: { password: next } });
  return NextResponse.json({ ok: true });
}
