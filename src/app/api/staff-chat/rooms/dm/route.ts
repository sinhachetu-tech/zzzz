import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";

// POST /api/staff-chat/rooms/dm
// Body: { userId: number }   — the OTHER staff member to DM
// Finds an existing isDirect room containing exactly [me, them], or creates one.
export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const otherId = Number(body.userId);
  if (!otherId || isNaN(otherId) || otherId === me.id)
    return NextResponse.json({ error: "Invalid userId" }, { status: 400 });

  // Check the target actually exists
  const other = await db.user.findUnique({ where: { id: otherId }, select: { id: true, name: true } });
  if (!other) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Find an existing DM room shared between exactly me and the other user.
  // A DM room is isDirect=true. We look for rooms where me is a member AND
  // the other is a member AND the room is a DM.
  const existing = await db.staffRoom.findFirst({
    where: {
      isDirect: true,
      members: { some: { userId: me.id } },
      AND: [{ members: { some: { userId: otherId } } }],
    },
    include: {
      members: {
        include: { user: { select: { id: true, name: true } } },
      },
      messages: {
        orderBy: { sentAt: "desc" },
        take: 1,
        include: { sender: { select: { name: true } } },
      },
    },
  });

  if (existing) {
    // Verify the room has exactly these two members (not a group accidentally flagged isDirect)
    if (existing.members.length === 2) {
      const roomId = existing.id;
      const unread = await db.staffMessage.count({
        where: {
          roomId,
          senderId: { not: me.id },
          sentAt: {
            gt: existing.members.find((m) => m.userId === me.id)?.lastReadAt ?? new Date(0),
          },
        },
      });
      return NextResponse.json({
        item: {
          id: existing.id,
          name: other.name,
          isDirect: true,
          createdAt: existing.createdAt.toISOString(),
          createdById: existing.createdById,
          unreadCount: unread,
          lastReadAt: existing.members.find((m) => m.userId === me.id)?.lastReadAt?.toISOString() ?? null,
          lastMessage: existing.messages[0]?.text ?? null,
          lastMessageAt: existing.messages[0]?.sentAt.toISOString() ?? null,
          lastMessageSender: existing.messages[0]?.sender.name ?? null,
          members: existing.members.map((m) => ({ userId: m.userId, name: m.user.name })),
        },
      });
    }
  }

  // Create new DM room
  const room = await db.staffRoom.create({
    data: {
      name: `DM:${me.id}:${otherId}`, // internal key; UI shows other user's name
      isDirect: true,
      createdById: me.id,
      members: {
        createMany: {
          data: [{ userId: me.id }, { userId: otherId }],
          skipDuplicates: true,
        },
      },
    },
    include: {
      members: { include: { user: { select: { id: true, name: true } } } },
      messages: { orderBy: { sentAt: "desc" }, take: 1, include: { sender: { select: { name: true } } } },
    },
  });

  return NextResponse.json({
    item: {
      id: room.id,
      name: other.name,
      isDirect: true,
      createdAt: room.createdAt.toISOString(),
      createdById: room.createdById,
      unreadCount: 0,
      lastReadAt: null,
      lastMessage: null,
      lastMessageAt: null,
      lastMessageSender: null,
      members: room.members.map((m) => ({ userId: m.userId, name: m.user.name })),
    },
  }, { status: 201 });
}
