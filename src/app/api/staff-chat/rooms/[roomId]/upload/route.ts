import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { r2Configured, r2Put, staffDocKey } from "@/lib/r2";
import type { StaffMessageDto } from "@/lib/types";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

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

// POST /api/staff-chat/rooms/[roomId]/upload
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

  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });

  const file = formData.get("file");
  const text = formData.get("text") ? String(formData.get("text")).trim() : null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File is required" }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds 25 MB limit." }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "application/octet-stream";
  const originalName = file.name;

  let storageKey: string | null = null;
  if (r2Configured()) {
    storageKey = staffDocKey(roomId, originalName);
    await r2Put(storageKey, bytes, mime);
  }

  const msg = await db.staffMessage.create({
    data: {
      roomId,
      senderId: me.id,
      text: text || null,
      attachmentKey: storageKey,
      attachmentName: originalName,
      attachmentSize: file.size,
      mimeType: mime,
      fileData: storageKey ? null : bytes,
    },
    include: { sender: { select: { name: true } } },
  });

  // Bump caller's lastReadAt
  await db.staffRoomMember.update({
    where: { roomId_userId: { roomId, userId: me.id } },
    data: { lastReadAt: msg.sentAt },
  }).catch(() => {});

  return NextResponse.json({ item: serMsg(msg) }, { status: 201 });
}
