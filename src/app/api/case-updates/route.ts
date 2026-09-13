// POST /api/case-updates — add a dated daily-MIS entry to a case.
// Denormalizes onto LoanCase (statusNote / onHold) so the client portal and
// dashboards read the latest without a join. Logs an activity entry too.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { serCaseUpdate } from "@/lib/ser";

export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  const caseId = parseInt(body.caseId, 10);
  const note = String(body.note ?? "").trim();
  if (!caseId || !note) return NextResponse.json({ error: "caseId and note are required." }, { status: 400 });

  const c = await db.loanCase.findUnique({ where: { id: caseId } });
  if (!c) return NextResponse.json({ error: "case not found" }, { status: 404 });

  const date = body.date || new Date().toISOString().slice(0, 10);
  const onHold = !!body.onHold;

  const item = await db.caseUpdate.create({
    data: {
      caseId, date, note,
      onHold,
      holdReason: onHold ? String(body.holdReason ?? "").trim() : "",
      authorId: me.id,
    },
  });

  await db.loanCase.update({
    where: { id: caseId },
    data: { statusNote: note, onHold, holdReason: onHold ? String(body.holdReason ?? "").trim() : null },
  });
  await db.activity.create({
    data: { caseId, userId: me.id, action: onHold ? `daily update (ON HOLD): ${note.slice(0, 80)}` : `daily update: ${note.slice(0, 80)}` },
  });

  const fresh = await db.caseUpdate.findUnique({ where: { id: item.id }, include: { author: { select: { name: true } } } });
  return NextResponse.json({ item: serCaseUpdate(fresh!) });
}

// GET /api/case-updates?caseId=1 — full log for one case
export async function GET(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const caseId = parseInt(new URL(req.url).searchParams.get("caseId") ?? "", 10);
  if (!caseId) return NextResponse.json({ error: "caseId required" }, { status: 400 });
  const rows = await db.caseUpdate.findMany({
    where: { caseId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: { author: { select: { name: true } } },
  });
  return NextResponse.json({ items: rows.map(serCaseUpdate) });
}
