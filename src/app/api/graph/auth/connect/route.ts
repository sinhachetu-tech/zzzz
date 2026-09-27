// GET /api/graph/auth/connect — initiate OAuth flow to connect user's Outlook.
import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getGraphAuthUrl, generatePKCE, storePKCE } from "@/lib/graph";

export async function GET(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!process.env.GRAPH_CLIENT_ID || !process.env.GRAPH_REDIRECT_URI) {
    return NextResponse.json({ error: "Graph not configured" }, { status: 400 });
  }

  const state = crypto.getRandomValues(new Uint8Array(16));
  const stateStr = Buffer.from(state).toString("base64url");
  const { verifier, challenge } = await generatePKCE();

  storePKCE(stateStr, verifier, me.id);

  const authUrl = getGraphAuthUrl(stateStr, challenge);
  return NextResponse.json({ authUrl });
}