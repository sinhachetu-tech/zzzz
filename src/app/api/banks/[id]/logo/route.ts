// POST /api/banks/:id/logo — admin-only logo upload (stored in DB, 1 MB cap).
// GET /api/banks/:id/logo — serve the logo image.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";

const MAX_BYTES = 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!flags.admin && !flags.super) return NextResponse.json({ error: "unauthorized" }, { status: 403 });

  const { id } = await params;
  const bankId = parseInt(id, 10);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Logo exceeds 1 MB." }, { status: 400 });
  if (!file.type.startsWith("image/")) return NextResponse.json({ error: "Use a PNG/JPG/SVG image." }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const bank = await db.bankItem.update({
    where: { id: bankId },
    data: { logoData: bytes, logoType: file.type },
  });
  return NextResponse.json({ ok: true, name: bank.name });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bank = await db.bankItem.findUnique({ where: { id: parseInt(id, 10) } });
  if (!bank?.logoData) return NextResponse.json({ error: "no logo" }, { status: 404 });
  const body = new Uint8Array(bank.logoData);
  return new NextResponse(body, {
    headers: {
      "Content-Type": bank.logoType || "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
