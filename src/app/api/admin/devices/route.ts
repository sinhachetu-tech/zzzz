// GET /api/admin/devices  — all registered UserDevice rows (admin view)
// DELETE /api/admin/devices?id=N  — revoke a device subscription
import { NextRequest, NextResponse } from "next/server";
import { currentUser, flagsFor } from "@/lib/auth";
import { db } from "@/lib/db";

function deviceType(ua: string | null): "mobile" | "tablet" | "desktop" {
  if (!ua) return "desktop";
  const u = ua.toLowerCase();
  if (/ipad|tablet|kindle|playbook/.test(u)) return "tablet";
  if (/mobile|iphone|android|phone/.test(u)) return "mobile";
  return "desktop";
}

function parseDevice(ua: string | null) {
  if (!ua) return "Unknown browser";
  if (/Chrome/.test(ua)) return "Chrome";
  if (/Firefox/.test(ua)) return "Firefox";
  if (/Safari/.test(ua) && !/Chrome/.test(ua)) return "Safari";
  if (/Edge/.test(ua)) return "Edge";
  return "Browser";
}

export async function GET(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!flags.admin && !flags.super) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "all"; // all | staff | agent
  const pushOnly = url.searchParams.get("pushOnly") === "true";

  const devices = await db.userDevice.findMany({
    orderBy: { lastSeenAt: "desc" },
    include: {
      user: { select: { id: true, name: true, role: true, team: true } },
    },
  });

  // Fetch agent devices if needed
  const agentDevices = await db.userDevice.findMany({
    where: { userId: null, NOT: { caseId: null } },
    orderBy: { lastSeenAt: "desc" },
  });

  const allRows = [
    ...devices.map((d) => ({
      id: d.id,
      ownerType: "staff" as const,
      ownerName: d.user?.name ?? "Unknown staff",
      ownerRole: d.user?.role ?? "",
      deviceType: deviceType(d.userAgent),
      browser: parseDevice(d.userAgent),
      pwaInstalled: d.pwaInstalled,
      hasPush: !!d.pushEndpoint,
      installedAt: d.installedAt?.toISOString() ?? null,
      lastSeenAt: d.lastSeenAt.toISOString(),
    })),
    ...agentDevices.map((d) => ({
      id: d.id,
      ownerType: "agent" as const,
      ownerName: "Agent (case #" + d.caseId + ")",
      ownerRole: "Partner",
      deviceType: deviceType(d.userAgent),
      browser: parseDevice(d.userAgent),
      pwaInstalled: d.pwaInstalled,
      hasPush: !!d.pushEndpoint,
      installedAt: d.installedAt?.toISOString() ?? null,
      lastSeenAt: d.lastSeenAt.toISOString(),
    })),
  ];

  let filtered = allRows;
  if (kind === "staff") filtered = filtered.filter((d) => d.ownerType === "staff");
  if (kind === "agent") filtered = filtered.filter((d) => d.ownerType === "agent");
  if (pushOnly) filtered = filtered.filter((d) => d.hasPush);

  return NextResponse.json({ devices: filtered });
}

export async function DELETE(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!flags.admin && !flags.super) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await db.userDevice.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
