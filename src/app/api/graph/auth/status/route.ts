// GET /api/graph/auth/status — check if current user has Outlook connected.
import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const user = await db.user.findUnique({
    where: { id: me.id },
    select: { graphConnectedAt: true, email: true },
  });

  return NextResponse.json({
    connected: !!user?.graphConnectedAt,
    connectedAt: user?.graphConnectedAt,
    email: user?.email,
    configured: !!(process.env.GRAPH_CLIENT_ID && process.env.GRAPH_CLIENT_SECRET && process.env.GRAPH_REDIRECT_URI),
  });
}