import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { r2Configured, r2PresignGet } from "@/lib/r2";

type Params = { params: Promise<{ messageId: string }> };

// GET /api/staff-chat/messages/[messageId]/file
export async function GET(req: NextRequest, { params }: Params) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { messageId: messageIdStr } = await params;
  const messageId = parseInt(messageIdStr, 10);
  if (isNaN(messageId)) return NextResponse.json({ error: "Invalid message ID" }, { status: 400 });

  const msg = await db.staffMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      roomId: true,
      attachmentKey: true,
      attachmentName: true,
      attachmentSize: true,
      mimeType: true,
      fileData: true,
    },
  });

  if (!msg || (!msg.attachmentKey && !msg.fileData)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  // Verify membership in the room
  const membership = await db.staffRoomMember.findUnique({
    where: { roomId_userId: { roomId: msg.roomId, userId: me.id } },
  });
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const forceDownload = url.searchParams.get("download") === "1";
  const fileName = msg.attachmentName || "attachment";

  // R2 path
  if (msg.attachmentKey && r2Configured()) {
    const signed = await r2PresignGet(msg.attachmentKey, {
      inline: !forceDownload,
      fileName,
      expirySeconds: 15 * 60,
    });
    return NextResponse.redirect(signed, 302);
  }

  // Postgres bytes path
  if (msg.fileData) {
    const bytes = Buffer.from(msg.fileData);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": msg.mimeType || "application/octet-stream",
        "Content-Length": String(bytes.length),
        "Content-Disposition": `${forceDownload ? "attachment" : "inline"}; filename="${encodeURIComponent(fileName)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  return NextResponse.json({ error: "File data unavailable" }, { status: 404 });
}
