// POST /api/cases/:id/tasks — add a task to a case.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { serTask } from "@/lib/ser";
import { parseTaskDue } from "@/lib/format";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const caseId = parseInt(id, 10);
  const body = await req.json();
  const { description, ownerId, waitingFor, whyPending, dueDate } = body as {
    description: string; ownerId: number; waitingFor: string; whyPending: string; dueDate: string;
  };

  if (!description?.trim()) return NextResponse.json({ error: "description required" }, { status: 400 });
  // Accept legacy "YYYY-MM-DD" or the new UAE wall-clock "YYYY-MM-DDTHH:mm";
  // anything else is rejected here rather than silently breaking overdue logic.
  if (typeof dueDate !== "string" || !parseTaskDue(dueDate)) {
    return NextResponse.json({ error: "dueDate must be YYYY-MM-DD or YYYY-MM-DDTHH:mm" }, { status: 400 });
  }

  const created = await db.task.create({
    data: {
      caseId, description: description.trim(),
      ownerId: ownerId || me.id, createdBy: me.id,
      waitingFor: waitingFor || "Internal", whyPending: whyPending || "Internal review",
      dueDate, status: "Open", remarks: "",
    },
  });
  await db.activity.create({
    data: { caseId, userId: me.id, action: `added task “${description.trim()}”` },
  });
  const fresh = await db.task.findUnique({ where: { id: created.id } });
  return NextResponse.json({ task: serTask(fresh!) });
}
