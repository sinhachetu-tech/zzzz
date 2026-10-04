import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";

type Params = { params: Promise<{ roomId: string }> };

// PATCH /api/staff-chat/rooms/[roomId]/members
// Body: { add?: number[]; remove?: number[] }
// Only the room creator can modify membership.
export async function PATCH(req: NextRequest, { params }: Params) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { roomId: roomIdStr } = await params;
  const roomId = parseInt(roomIdStr, 10);
  if (isNaN(roomId)) return NextResponse.json({ error: "Invalid room ID" }, { status: 400 });

  const room = await db.staffRoom.findUnique({ where: { id: roomId } });
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (room.isDirect) return NextResponse.json({ error: "Cannot modify DM room members" }, { status: 400 });
  if (room.createdById !== me.id) return NextResponse.json({ error: "Only the room creator can edit members" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const toAdd: number[] = Array.isArray(body.add) ? body.add.map(Number).filter((n: number) => !isNaN(n)) : [];
  const toRemove: number[] = Array.isArray(body.remove) ? body.remove.map(Number).filter((n: number) => !isNaN(n)) : [];

  // Never remove the creator
  const safeRemove = toRemove.filter((id) => id !== me.id);

  if (toAdd.length) {
    await db.staffRoomMember.createMany({
      data: toAdd.map((uid) => ({ roomId, userId: uid })),
      skipDuplicates: true,
    });
  }
  if (safeRemove.length) {
    await db.staffRoomMember.deleteMany({
      where: { roomId, userId: { in: safeRemove } },
    });
  }

  const updated = await db.staffRoomMember.findMany({
    where: { roomId },
    include: { user: { select: { id: true, name: true } } },
  });

  return NextResponse.json({
    members: updated.map((m) => ({ userId: m.userId, name: m.user.name })),
  });
}
