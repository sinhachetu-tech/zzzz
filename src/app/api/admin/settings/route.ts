// GET/PUT /api/admin/settings — Admin → Portal settings.
// GET is open to any signed-in teammate (the values are non-sensitive);
// only admin/super may change them.
import { NextRequest, NextResponse } from "next/server";
import { currentUser, flagsFor } from "@/lib/auth";
import { getPortalSettings, savePortalSettings } from "@/lib/portal-settings";

export async function GET() {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ settings: await getPortalSettings() });
}

export async function PUT(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!flags.admin && !flags.super) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json() as {
    clientPortalAdvisorId?: number | null;
    clientFacingUserId?: number | null;
    clientPortalWhatsapp?: string;
    agentDeskUserId?: number | null;
    agentDeskName?: string;
    agentDeskPhone?: string;
  };
  const settings = await savePortalSettings({
    clientPortalAdvisorId: body.clientPortalAdvisorId !== undefined ? (body.clientPortalAdvisorId ? Number(body.clientPortalAdvisorId) : null) : undefined,
    clientFacingUserId: body.clientFacingUserId !== undefined ? (body.clientFacingUserId ? Number(body.clientFacingUserId) : null) : undefined,
    clientPortalWhatsapp: body.clientPortalWhatsapp,
    agentDeskUserId: body.agentDeskUserId !== undefined ? (body.agentDeskUserId ? Number(body.agentDeskUserId) : null) : undefined,
    agentDeskName: body.agentDeskName,
    agentDeskPhone: body.agentDeskPhone,
  });
  return NextResponse.json({ settings });
}
