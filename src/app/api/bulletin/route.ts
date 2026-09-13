// POST /api/bulletin — create a directive.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { serBulletin } from "@/lib/ser";
import { toISODate } from "@/lib/format";

export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!flags.issueTasks && !flags.super) {
    return NextResponse.json({ error: "you cannot issue directives" }, { status: 403 });
  }
  const body = await req.json();
  const { task, caseId, targets, date } = body as {
    task: string; caseId: number | null; targets: number[]; date?: string;
  };
  if (!task?.trim()) return NextResponse.json({ error: "task required" }, { status: 400 });
  if (!targets?.length) return NextResponse.json({ error: "pick at least one target" }, { status: 400 });

  const created = await db.bulletinItem.create({
    data: {
      date: date || toISODate(new Date()),
      issuedBy: me.id,
      task: task.trim(),
      caseId: caseId ?? null,
      status: "Open",
      targets: { create: targets.map((userId) => ({ userId })) },
    },
    include: { targets: true, replies: true },
  });
  return NextResponse.json({ item: serBulletin(created) });
}
