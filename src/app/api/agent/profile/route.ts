// PATCH /api/agent/profile — agent edits their own portal profile.
// Changing the IBAN or licence number resets the verified flag — the HFMC
// finance/compliance team re-verifies ( stamps live in Case 360-style admin).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentAgent } from "@/lib/agent-auth";

export async function PATCH(req: NextRequest) {
  const me = await currentAgent();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json() as {
    email?: string; phone?: string; about?: string; expertise?: string;
    iban?: string; licenseNo?: string; avatarData?: string | null;
  };

  const partner = await db.partnerItem.findFirst({ where: { name: me.name, kind: me.kind } });
  if (!partner) return NextResponse.json({ error: "Partner record not found." }, { status: 404 });

  if (body.avatarData && body.avatarData.length > 400_000) {
    return NextResponse.json({ error: "Picture too large — pick a smaller one." }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (body.email !== undefined) data.email = body.email.trim() || null;
  if (body.phone !== undefined) data.phone = body.phone.trim() || null;
  if (body.about !== undefined) data.about = body.about.trim() || null;
  if (body.expertise !== undefined) data.expertise = body.expertise.trim() || null;
  if (body.iban !== undefined) {
    const next = body.iban.trim().toUpperCase().replace(/\s+/g, "");
    if (next && next !== (partner.iban ?? "").replace(/\s+/g, "")) data.ibanVerified = false; // re-verify on change
    data.iban = next || null;
  }
  if (body.licenseNo !== undefined) {
    const next = body.licenseNo.trim();
    if (next && next !== (partner.licenseNo ?? "")) data.licenseVerified = false;
    data.licenseNo = next || null;
  }
  if (body.avatarData !== undefined) data.avatarData = body.avatarData || null;

  const updated = await db.partnerItem.update({ where: { id: partner.id }, data });

  return NextResponse.json({
    ok: true,
    profile: {
      sharePct: updated.defaultSharePct,
      email: updated.email ?? "",
      phone: updated.phone ?? "",
      about: updated.about ?? "",
      expertise: updated.expertise ?? "",
      iban: updated.iban ?? "",
      ibanVerified: updated.ibanVerified,
      licenseNo: updated.licenseNo ?? "",
      licenseVerified: updated.licenseVerified,
      avatarData: updated.avatarData ?? "",
    },
  });
}
