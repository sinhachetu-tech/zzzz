// POST /api/graph/auth/disconnect — revoke stored tokens.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await db.user.update({
    where: { id: me.id },
    data: {
      graphAccessToken: null,
      graphRefreshToken: null,
      graphTokenExpiresAt: null,
      graphConnectedAt: null,
    },
  });

  return NextResponse.json({ success: true });
}