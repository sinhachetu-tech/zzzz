// POST /api/bulletin/:id/replies — reply on a directive.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { serReply } from "@/lib/ser";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const bid = parseInt(id, 10);
  const { text } = await req.json();
  if (!text?.trim()) return NextResponse.json({ error: "text required" }, { status: 400 });

  const reply = await db.reply.create({
    data: { bulletinId: bid, userId: me.id, text: text.trim() },
  });
  return NextResponse.json({ reply: serReply(reply) });
}
