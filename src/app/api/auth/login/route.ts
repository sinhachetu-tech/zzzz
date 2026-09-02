import { NextRequest, NextResponse } from "next/server";
import { login } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }
  const res = await login(email, password);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 401 });
  return NextResponse.json({ user: res.user });
}
