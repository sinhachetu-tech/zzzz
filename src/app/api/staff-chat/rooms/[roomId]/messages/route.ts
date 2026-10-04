import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import type { StaffMessageDto } from "@/lib/types";

type Params = { params: Promise<{ roomId: string }> };

function serMsg(m: {
  id: number;
  roomId: number;
  senderId: number;
  text: string | null;
  attachmentKey?: string | null;
  attachmentName?: string | null;
  attachmentSize?: number | null;
  mimeType?: string | null;
  sentAt: Date;
  editedAt: Date | null;
  sender: { name: string };
}): StaffMessageDto {
  return {
    id: m.id,
    roomId: m.roomId,
    senderId: m.senderId,
    senderName: m.sender.name,
    text: m.text,
    attachmentKey: m.attachmentKey ?? null,
    attachmentName: m.attachmentName ?? null,
    attachmentSize: m.attachmentSize ?? null,
    mimeType: m.mimeType ?? null,
    sentAt: m.sentAt.toISOString(),
    editedAt: m.editedAt ? m.editedAt.toISOString() : null,
  };
}

// GET /api/staff-chat/rooms/[roomId]/messages
// Query params: after (ISO), limit (max 200), stream (SSE)
export async function GET(req: NextRequest, { params }: Params) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { roomId: roomIdStr } = await params;
  const roomId = parseInt(roomIdStr, 10);
  if (isNaN(roomId)) return NextResponse.json({ error: "Invalid room ID" }, { status: 400 });

  // Verify membership
  const membership = await db.staffRoomMember.findUnique({
    where: { roomId_userId: { roomId, userId: me.id } },
  });
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const isStream = url.searchParams.get("stream") === "true";
  const after = url.searchParams.get("after");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "80", 10), 200);

  // ── SSE streaming mode ─────────────────────────────────────────────────────
  if (isStream) {
    let lastSeenId = 0;
    const seed = await db.staffMessage.findMany({
      where: { roomId },
      orderBy: { id: "desc" },
      take: 1,
    });
    if (seed.length) lastSeenId = seed[0].id;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        req.signal.addEventListener("abort", () => {
          closed = true;
          try { controller.close(); } catch {}
        });

        controller.enqueue(encoder.encode(`event: ping\ndata: {"connected":true}\n\n`));

        const interval = setInterval(async () => {
          if (closed) { clearInterval(interval); return; }
          try {
            const newMsgs = await db.staffMessage.findMany({
              where: { roomId, id: { gt: lastSeenId } },
              orderBy: { id: "asc" },
              include: { sender: { select: { name: true } } },
            });
            if (newMsgs.length) {
              lastSeenId = newMsgs[newMsgs.length - 1].id;
              for (const m of newMsgs) {
                controller.enqueue(
                  encoder.encode(`event: message\ndata: ${JSON.stringify(serMsg(m))}\n\n`)
                );
              }
            } else {
              controller.enqueue(encoder.encode(`: heartbeat\n\n`));
            }
          } catch {
            clearInterval(interval);
            try { controller.close(); } catch {}
          }
        }, 2500);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
      },
    });
  }

  // ── Regular JSON response ──────────────────────────────────────────────────
  const where: { roomId: number; sentAt?: { gt: Date } } = { roomId };
  if (after) {
    const d = new Date(after);
    if (!isNaN(d.getTime())) where.sentAt = { gt: d };
  }

  const messages = await db.staffMessage.findMany({
    where,
    orderBy: { sentAt: "asc" },
    take: limit,
    include: { sender: { select: { name: true } } },
  });

  return NextResponse.json({ items: messages.map(serMsg) });
}

// POST /api/staff-chat/rooms/[roomId]/messages
// Body: { text: string }
export async function POST(req: NextRequest, { params }: Params) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { roomId: roomIdStr } = await params;
  const roomId = parseInt(roomIdStr, 10);
  if (isNaN(roomId)) return NextResponse.json({ error: "Invalid room ID" }, { status: 400 });

  // Verify membership
  const membership = await db.staffRoomMember.findUnique({
    where: { roomId_userId: { roomId, userId: me.id } },
  });
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const text = String(body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });

  const msg = await db.staffMessage.create({
    data: { roomId, senderId: me.id, text },
    include: { sender: { select: { name: true } } },
  });

  // Bump caller's lastReadAt (they just sent — trivially "read" by them)
  await db.staffRoomMember.update({
    where: { roomId_userId: { roomId, userId: me.id } },
    data: { lastReadAt: msg.sentAt },
  }).catch(() => {});

  return NextResponse.json({ item: serMsg(msg) }, { status: 201 });
}
