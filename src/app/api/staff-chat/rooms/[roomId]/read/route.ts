import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";

type Params = { params: Promise<{ roomId: string }> };

// POST /api/staff-chat/rooms/[roomId]/read
// Sets lastReadAt = now for the calling user.
export async function POST(_req: NextRequest, { params }: Params) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { roomId: roomIdStr } = await params;
  const roomId = parseInt(roomIdStr, 10);
  if (isNaN(roomId)) return NextResponse.json({ error: "Invalid room ID" }, { status: 400 });

  const membership = await db.staffRoomMember.findUnique({
    where: { roomId_userId: { roomId, userId: me.id } },
  });
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await db.staffRoomMember.update({
    where: { roomId_userId: { roomId, userId: me.id } },
    data: { lastReadAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
