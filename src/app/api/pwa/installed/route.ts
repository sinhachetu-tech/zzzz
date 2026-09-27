import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { currentClient } from "@/lib/client-auth";
import { currentAgent } from "@/lib/agent-auth";

// POST /api/pwa/installed
// Tracks PWA installation on the user's profile and device record
export async function POST(req: NextRequest) {
  const staff = await currentUser();
  const client = await currentClient();
  const agent = await currentAgent();

  if (!staff && !client && !agent) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const deviceType = body.deviceType === "mobile" ? "mobile" : body.deviceType === "tablet" ? "tablet" : "desktop";
  const userAgent = req.headers.get("user-agent") || null;
  const now = new Date();

  if (staff) {
    await db.userDevice.create({
      data: {
        userId: staff.id,
        deviceType,
        pwaInstalled: true,
        installedAt: now,
        lastSeenAt: now,
        userAgent,
      },
    });
  } else if (client) {
    await db.userDevice.create({
      data: {
        caseId: client.caseId,
        deviceType,
        pwaInstalled: true,
        installedAt: now,
        lastSeenAt: now,
        userAgent,
      },
    });
  } else if (agent) {
    // If agent has a user account or device
    await db.userDevice.create({
      data: {
        deviceType,
        pwaInstalled: true,
        installedAt: now,
        lastSeenAt: now,
        userAgent,
      },
    });
  }

  return NextResponse.json({ ok: true, installedAt: now.toISOString() });
}
