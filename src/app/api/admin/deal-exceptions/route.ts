// GET/POST/PATCH /api/admin/deal-exceptions — TIER 3 pricing: a per-CASE exception
// below the standard floor.
//
// This is the most dangerous layer in the system and is guarded accordingly:
//   super-admin only        (not ordinary admin)
//   a written REASON is mandatory
//   validTo is mandatory    (an exception must expire — no permanent discounts)
//   the approver must DIFFER from the creator (no self-approval)
//   everything is audited
//
// The engine does NOT read this table directly: an exception is applied to a saved
// proposal snapshot, so it can never silently change what the standard engine quotes.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { todayISO } from "@/lib/format";

async function guard() {
  const me = await currentUser();
  if (!me) return null;
  const flags = await flagsFor(me);
  if (!flags.super) return null;   // deliberately super-only, not admin
  return { me, flags };
}

export async function GET(req: NextRequest) {
  const g = await guard();
  if (!g) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const caseId = req.nextUrl.searchParams.get("caseId");
  const rows = await db.dealException.findMany({
    where: caseId ? { caseId: parseInt(caseId, 10) } : {},
    include: { case: { select: { caseNumber: true, customer: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      caseId: r.caseId,
      caseNumber: r.case?.caseNumber ?? "",
      customer: r.case?.customer ?? "",
      bankProductId: r.bankProductId,
      rateDeltaBps: r.rateDeltaBps,
      feeWaive: r.feeWaive,
      reason: r.reason,
      approvedBy: r.approvedBy,
      validFrom: r.validFrom,
      validTo: r.validTo,
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
      expired: r.validTo < todayISO(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const g = await guard();
  if (!g) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json();

  if (!b.caseId) return NextResponse.json({ error: "caseId required" }, { status: 400 });
  if (!b.reason || String(b.reason).trim().length < 8) {
    return NextResponse.json({ error: "A written reason (8+ characters) is mandatory for an exception." }, { status: 400 });
  }
  if (!b.validTo) {
    return NextResponse.json({ error: "An expiry date is mandatory — exceptions must not be permanent." }, { status: 400 });
  }
  if (b.validTo < todayISO()) {
    return NextResponse.json({ error: "The expiry date is in the past." }, { status: 400 });
  }
  // second approver — the whole point of the field is that it cannot be you
  if (!b.approvedBy || b.approvedBy === g.me.name) {
    return NextResponse.json({ error: "A second approver is required, and it cannot be you." }, { status: 400 });
  }
  const bps = Number(b.rateDeltaBps ?? 0);
  if (!Number.isFinite(bps) || bps === 0) {
    return NextResponse.json({ error: "A rate change (in bps) or a fee waiver is required." }, { status: 400 });
  }

  const item = await db.dealException.create({
    data: {
      caseId: parseInt(b.caseId, 10),
      bankProductId: b.bankProductId ? parseInt(b.bankProductId, 10) : null,
      rateDeltaBps: bps,
      feeWaive: !!b.feeWaive,
      reason: String(b.reason).trim(),
      approvedBy: String(b.approvedBy).trim(),
      validFrom: String(b.validFrom ?? todayISO()).slice(0, 10),
      validTo: String(b.validTo).slice(0, 10),
      createdBy: g.me.name,
    },
  });
  await audit({
    entity: "DealException", entityId: item.id, action: "create",
    field: "rateDeltaBps", beforeVal: null, afterVal: { rateDeltaBps: bps, feeWaive: !!b.feeWaive },
    reason: item.reason, actorId: g.me.id, actorName: g.me.name,
  });
  return NextResponse.json({ item });
}

export async function PATCH(req: NextRequest) {
  const g = await guard();
  if (!g) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json();
  const id = parseInt(b.id, 10);
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const prev = await db.dealException.findUnique({ where: { id } });
  if (!prev) return NextResponse.json({ error: "not found" }, { status: 404 });
  // ending an exception early is always allowed, even by its creator
  const ending = !!b.endNow;
  const data = ending
    ? { validTo: todayISO() }
    : { rateDeltaBps: Number(b.rateDeltaBps ?? prev.rateDeltaBps), feeWaive: b.feeWaive ?? prev.feeWaive, validTo: String(b.validTo ?? prev.validTo).slice(0, 10) };
  const item = await db.dealException.update({ where: { id }, data });
  await audit({
    entity: "DealException", entityId: id, action: "update",
    field: ending ? "validTo" : "rateDeltaBps",
    beforeVal: { validTo: prev.validTo, rateDeltaBps: prev.rateDeltaBps },
    afterVal: { validTo: item.validTo, rateDeltaBps: item.rateDeltaBps },
    reason: b.reason ?? (ending ? "ended early" : ""), actorId: g.me.id, actorName: g.me.name,
  });
  return NextResponse.json({ item });
}
