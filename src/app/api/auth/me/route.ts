import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";

export async function GET() {
  const me = await currentUser();
  if (!me) return NextResponse.json({ user: null }, { status: 200 });
  return NextResponse.json({ user: me });
}
