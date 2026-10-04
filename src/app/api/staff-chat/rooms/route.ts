import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import type { StaffRoomDto } from "@/lib/types";

// Serialize a StaffRoom row + members into a StaffRoomDto.
// "my" is the caller's StaffRoomMember row (for lastReadAt / unread).
function serRoom(
  room: {
    id: number;
    name: string;
    isDirect: boolean;
    createdAt: Date;
    createdById: number;
    members: { userId: number; joinedAt: Date; lastReadAt: Date | null; user: { id: number; name: string } }[];
    messages: { id: number; text: string | null; attachmentName?: string | null; sentAt: Date; sender: { name: string } }[];
  },
  callerId: number
): StaffRoomDto {
  const myMembership = room.members.find((m) => m.userId === callerId);
  const lastMsg = room.messages[0] ?? null;

  // Unread = messages sent AFTER my last-read timestamp (or all if never read)
  const lastReadAt = myMembership?.lastReadAt ?? null;
  const unreadCount = lastReadAt
    ? room.messages.filter((m) => m.sentAt > lastReadAt).length
    : room.messages.length;

  // DM room name: "You & {other}"  (generated client-side from member list)
  let displayName = room.name;
  if (room.isDirect) {
    const other = room.members.find((m) => m.userId !== callerId);
    displayName = other ? other.user.name : room.name;
  }

  return {
    id: room.id,
    name: displayName,
    isDirect: room.isDirect,
    createdAt: room.createdAt.toISOString(),
    createdById: room.createdById,
    unreadCount,
    lastReadAt: lastReadAt ? lastReadAt.toISOString() : null,
    lastMessage: lastMsg?.text || (lastMsg?.attachmentName ? `📎 ${lastMsg.attachmentName}` : null),
    lastMessageAt: lastMsg ? lastMsg.sentAt.toISOString() : null,
    lastMessageSender: lastMsg ? lastMsg.sender.name : null,
    members: room.members.map((m) => ({ userId: m.userId, name: m.user.name })),
  };
}

// GET /api/staff-chat/rooms
// Returns all rooms the caller belongs to, sorted by latest activity.
export async function GET() {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rooms = await db.staffRoom.findMany({
    where: { members: { some: { userId: me.id } } },
    include: {
      members: {
        include: { user: { select: { id: true, name: true } } },
      },
      messages: {
        orderBy: { sentAt: "desc" },
        take: 50, // enough for unread count + preview
        include: { sender: { select: { name: true } } },
      },
    },
  });

  // Sort by latest message timestamp descending
  const sorted = rooms.sort((a, b) => {
    const aT = a.messages[0]?.sentAt ?? a.createdAt;
    const bT = b.messages[0]?.sentAt ?? b.createdAt;
    return bT.getTime() - aT.getTime();
  });

  return NextResponse.json({ items: sorted.map((r) => serRoom(r, me.id)) });
}

// POST /api/staff-chat/rooms
// Body: { name: string; memberIds: number[] }
// Creates a group room and adds all members (including caller).
export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  const rawIds: unknown[] = Array.isArray(body.memberIds) ? body.memberIds : [];
  const memberIds = [...new Set([me.id, ...rawIds.map(Number).filter((n) => !isNaN(n))])];

  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (memberIds.length < 2) return NextResponse.json({ error: "At least one other member is required" }, { status: 400 });

  const room = await db.staffRoom.create({
    data: {
      name,
      isDirect: false,
      createdById: me.id,
      members: {
        createMany: {
          data: memberIds.map((uid) => ({ userId: uid })),
          skipDuplicates: true,
        },
      },
    },
    include: {
      members: { include: { user: { select: { id: true, name: true } } } },
      messages: { orderBy: { sentAt: "desc" }, take: 1, include: { sender: { select: { name: true } } } },
    },
  });

  return NextResponse.json({ item: serRoom(room, me.id) }, { status: 201 });
}
