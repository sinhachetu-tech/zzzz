// PATCH /api/instructions/:id — complete an instruction.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { serInstruction } from "@/lib/ser";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const iid = parseInt(id, 10);
  const body = await req.json();
  if (body.action === "complete") {
    const updated = await db.instruction.update({
      where: { id: iid }, data: { status: "Done", completedAt: new Date() },
      include: { replies: true },
    });
    await db.activity.create({
      data: { caseId: updated.caseId, userId: me.id, action: `completed instruction: “${updated.instruction}”` },
    });
    return NextResponse.json({ instruction: serInstruction(updated) });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
