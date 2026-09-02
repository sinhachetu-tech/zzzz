// PATCH /api/bulletin/:id — complete / drop / carry a directive.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { bulletinCanAct, bulletinCanDelete } from "@/lib/domain";
import { serBulletin } from "@/lib/ser";
import { toISODate } from "@/lib/format";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  const { id } = await params;
  const bid = parseInt(id, 10);
  const body = await req.json();

  const item = await db.bulletinItem.findUnique({
    where: { id: bid }, include: { targets: true, replies: true },
  });
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (body.action === "complete") {
    if (!bulletinCanAct(serBulletin(item), me as never, flags)) {
      return NextResponse.json({ error: "not yours to complete" }, { status: 403 });
    }
    const updated = await db.bulletinItem.update({
      where: { id: bid },
      data: { status: "Done", completedAt: new Date(), completedBy: me.id },
      include: { targets: true, replies: true },
    });
    return NextResponse.json({ item: serBulletin(updated) });
  }

  if (body.action === "drop") {
    if (!bulletinCanDelete(serBulletin(item), me as never, flags)) {
      return NextResponse.json({ error: "not yours to drop" }, { status: 403 });
    }
    const updated = await db.bulletinItem.update({
      where: { id: bid }, data: { dropped: true },
      include: { targets: true, replies: true },
    });
    return NextResponse.json({ item: serBulletin(updated) });
  }

  if (body.action === "carry") {
    if (!bulletinCanDelete(serBulletin(item), me as never, flags)) {
      return NextResponse.json({ error: "not yours to carry" }, { status: 403 });
    }
    const today = toISODate(new Date());
    const carried = await db.bulletinItem.create({
      data: {
        date: today, issuedBy: item.issuedBy, task: item.task, caseId: item.caseId,
        status: "Open", carriedFrom: item.date,
        targets: { create: item.targets.map((t) => ({ userId: t.userId })) },
      },
      include: { targets: true, replies: true },
    });
    await db.bulletinItem.update({ where: { id: bid }, data: { dropped: true } });
    return NextResponse.json({ item: serBulletin(carried) });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
