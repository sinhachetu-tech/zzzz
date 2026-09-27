import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { currentClient } from "@/lib/client-auth";

export async function POST(req: NextRequest) {
  const staff = await currentUser();
  const client = await currentClient();

  if (!staff && !client) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { endpoint, keys, deviceType } = body;

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return NextResponse.json({ error: "Invalid subscription payload" }, { status: 400 });
  }

  const userAgent = req.headers.get("user-agent") || null;
  const now = new Date();

  // Upsert subscription by endpoint
  await db.userDevice.upsert({
    where: { pushEndpoint: endpoint },
    update: {
      userId: staff ? staff.id : null,
      caseId: client ? client.caseId : null,
      deviceType: deviceType || "desktop",
      pushP256dh: keys.p256dh,
      pushAuth: keys.auth,
      lastSeenAt: now,
      userAgent,
    },
    create: {
      userId: staff ? staff.id : null,
      caseId: client ? client.caseId : null,
      deviceType: deviceType || "desktop",
      pushEndpoint: endpoint,
      pushP256dh: keys.p256dh,
      pushAuth: keys.auth,
      lastSeenAt: now,
      userAgent,
    },
  });

  return NextResponse.json({ ok: true });
}
