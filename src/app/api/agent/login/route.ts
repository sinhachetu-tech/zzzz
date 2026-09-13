// POST /api/agent/login
import { NextRequest, NextResponse } from "next/server";
import { agentLogin } from "@/lib/agent-auth";

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  if (!email?.trim() || !password) return NextResponse.json({ error: "Name and password are required." }, { status: 400 });
  const res = await agentLogin(email, password);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 401 });
  return NextResponse.json({ user: res.user });
}
