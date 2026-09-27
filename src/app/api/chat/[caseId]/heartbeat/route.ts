import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { currentClient } from "@/lib/client-auth";
import { currentAgent } from "@/lib/agent-auth";

const LIVE_THRESHOLD_MS = 60 * 1000; // 60 seconds

// GET /api/chat/[caseId]/heartbeat
// Check presence of participants on this case
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const { caseId: caseIdStr } = await params;
  const caseId = parseInt(caseIdStr, 10);
  if (isNaN(caseId)) return NextResponse.json({ error: "Invalid case ID" }, { status: 400 });

  const now = Date.now();
  const threshold = new Date(now - LIVE_THRESHOLD_MS);

  // Look up recent devices
  const clientDevice = await db.userDevice.findFirst({
    where: { caseId, lastSeenAt: { gte: threshold } },
    orderBy: { lastSeenAt: "desc" },
  });

  // Check case owner or assigned staff presence
  const loanCase = await db.loanCase.findUnique({
    where: { id: caseId },
    select: { ownerId: true, advisorId: true },
  });

  const staffDevice = loanCase
    ? await db.userDevice.findFirst({
        where: {
          userId: { in: [loanCase.ownerId, loanCase.advisorId].filter((id): id is number => id != null) },
          lastSeenAt: { gte: threshold },
        },
      })
    : null;

  return NextResponse.json({
    clientLive: !!clientDevice,
    clientLastSeen: clientDevice?.lastSeenAt.toISOString() ?? null,
    staffLive: !!staffDevice,
  });
}

// POST /api/chat/[caseId]/heartbeat
// Sends heartbeat and optionally marks messages as read
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const { caseId: caseIdStr } = await params;
  const caseId = parseInt(caseIdStr, 10);
  if (isNaN(caseId)) return NextResponse.json({ error: "Invalid case ID" }, { status: 400 });

  const staff = await currentUser();
  const client = await currentClient();
  const agent = await currentAgent();

  if (!staff && !client && !agent) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const userAgent = req.headers.get("user-agent") || null;
  const now = new Date();

  // Staff wins when both cookies exist (same test laptop).
  if (staff) {
    const existing = await db.userDevice.findFirst({
      where: { userId: staff.id },
      orderBy: { id: "desc" },
    });
    if (existing) {
      await db.userDevice.update({
        where: { id: existing.id },
        data: { lastSeenAt: now },
      });
    } else {
      await db.userDevice.create({
        data: {
          userId: staff.id,
          deviceType: "desktop",
          lastSeenAt: now,
          userAgent,
        },
      });
    }

    // Mark messages read by staff
    if (body.markRead) {
      const threadType = body.threadType === "AGENT" ? "AGENT" : "CLIENT";
      await db.chatMessage.updateMany({
        where: { caseId, threadType, readByStaff: false },
        data: { readByStaff: true },
      });
    }
  } else if (client) {
    // Sibling-aware: mark read works from any journey of the same person.
    const { clientCanAccessCase } = await import("@/lib/chat-auth");
    if (!(await clientCanAccessCase(client, caseId)))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    // Upsert or update device for client
    const existing = await db.userDevice.findFirst({
      where: { caseId },
      orderBy: { id: "desc" },
    });
    if (existing) {
      await db.userDevice.update({
        where: { id: existing.id },
        data: { lastSeenAt: now },
      });
    } else {
      await db.userDevice.create({
        data: {
          caseId,
          deviceType: "desktop",
          lastSeenAt: now,
          userAgent,
        },
      });
    }

    // Mark client thread messages read by external (client opened the chat)
    if (body.markRead) {
      await db.chatMessage.updateMany({
        where: { caseId, threadType: "CLIENT", readByExternal: false },
        data: { readByExternal: true },
      });
    }
  } else if (agent) {
    if (body.markRead) {
      await db.chatMessage.updateMany({
        where: { caseId, threadType: "AGENT", readByExternal: false },
        data: { readByExternal: true },
      });
    }
  }

  return NextResponse.json({ ok: true, timestamp: now.toISOString() });
}
