// POST /api/instructions — issue an instruction on a case (a task-like directive with replies).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { serInstruction } from "@/lib/ser";

export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!flags.issueTasks && !flags.super) {
    return NextResponse.json({ error: "you cannot issue instructions" }, { status: 403 });
  }
  const body = await req.json();
  const { caseId, instruction, assignedTo, dueDate } = body as {
    caseId: number; instruction: string; assignedTo: number; dueDate: string;
  };
  if (!instruction?.trim()) return NextResponse.json({ error: "instruction required" }, { status: 400 });
  const created = await db.instruction.create({
    data: { caseId, issuedBy: me.id, instruction: instruction.trim(), assignedTo, dueDate, status: "Open" },
    include: { replies: true },
  });
  await db.activity.create({
    data: { caseId, userId: me.id, action: `issued instruction: “${instruction.trim()}”` },
  });
  return NextResponse.json({ instruction: serInstruction(created) });
}
