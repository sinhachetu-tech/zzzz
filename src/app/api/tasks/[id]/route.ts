// PATCH /api/tasks/:id — complete / reopen / edit a task.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { serTask } from "@/lib/ser";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const taskId = parseInt(id, 10);
  const body = await req.json();

  const existing = await db.task.findUnique({ where: { id: taskId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (body.status === "Done") {
    data.status = "Done";
    data.completedAt = new Date();
    if (body.remarks !== undefined) data.remarks = body.remarks;
  } else if (body.status === "Open") {
    data.status = "Open";
    data.completedAt = null;
  }
  if (body.description !== undefined) data.description = body.description;
  if (body.ownerId !== undefined) data.ownerId = body.ownerId;
  if (body.dueDate !== undefined) data.dueDate = body.dueDate;
  if (body.waitingFor !== undefined) data.waitingFor = body.waitingFor;
  if (body.whyPending !== undefined) data.whyPending = body.whyPending;
  if (body.remarks !== undefined && body.status !== "Done") data.remarks = body.remarks;

  const updated = await db.task.update({ where: { id: taskId }, data });

  if (body.status === "Done") {
    await db.activity.create({
      data: { caseId: existing.caseId, userId: me.id, action: `completed task “${existing.description}”` },
    });
  } else if (body.status === "Open") {
    await db.activity.create({
      data: { caseId: existing.caseId, userId: me.id, action: `reopened task “${existing.description}”` },
    });
  }

  return NextResponse.json({ task: serTask(updated) });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const taskId = parseInt(id, 10);
  const t = await db.task.findUnique({ where: { id: taskId } });
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
  await db.task.delete({ where: { id: taskId } });
  await db.activity.create({
    data: { caseId: t.caseId, userId: me.id, action: `deleted task “${t.description}”` },
  });
  return NextResponse.json({ ok: true });
}
