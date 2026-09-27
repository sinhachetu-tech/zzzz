// GET /api/graph/auth/callback — OAuth callback from Microsoft, exchange code for tokens.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { exchangeGraphCode, getGraphUserProfile, consumePKCE } from "@/lib/graph";

export async function GET(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.redirect(new URL("/login", req.url));

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL("/?graphError=" + encodeURIComponent(error), req.url));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/?graphError=missing_params", req.url));
  }

  const pkce = consumePKCE(state);
  if (!pkce) {
    return NextResponse.redirect(new URL("/?graphError=invalid_state", req.url));
  }
  if (pkce.userId !== me.id) {
    return NextResponse.redirect(new URL("/?graphError=user_mismatch", req.url));
  }

  try {
    const tokens = await exchangeGraphCode(code, pkce.verifier);
    const profile = await getGraphUserProfile(tokens.accessToken);

    // Store tokens in DB
    await db.user.update({
      where: { id: me.id },
      data: {
        graphAccessToken: tokens.accessToken,
        graphRefreshToken: tokens.refreshToken,
        graphTokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
        graphConnectedAt: new Date(),
      },
    });

    return NextResponse.redirect(new URL("/?graphConnected=1", req.url));
  } catch (e) {
    console.error("Graph auth callback error:", e);
    return NextResponse.redirect(new URL("/?graphError=" + encodeURIComponent(String(e)), req.url));
  }
}