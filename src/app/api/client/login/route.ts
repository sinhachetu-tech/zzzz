// POST /api/client/login — client logs in with case number + last 4 digits of phone.
import { NextRequest, NextResponse } from "next/server";
import { clientLogin } from "@/lib/client-auth";

export async function POST(req: NextRequest) {
  const { caseNumber, phoneLast4 } = await req.json();
  if (!caseNumber?.trim()) return NextResponse.json({ error: "Case number is required." }, { status: 400 });
  if (!phoneLast4?.trim()) return NextResponse.json({ error: "Last 4 digits of your phone are required." }, { status: 400 });
  const res = await clientLogin(caseNumber, phoneLast4);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 401 });
  return NextResponse.json({ user: res.user });
}
