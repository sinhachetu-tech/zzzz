import { NextResponse } from "next/server";
import { clientLogout } from "@/lib/client-auth";

export async function POST() {
  await clientLogout();
  return NextResponse.json({ ok: true });
}
