// /api/service-lines — admin CRUD for the service-line catalogue.
//
// WHY ADMIN-CURABLE: the service list is a business decision that will grow (the
// firm may add "debt restructuring" or "relocation" next year). Making it a code
// change would mean a deploy for a commercial decision.
//
// TWO GUARDRAILS, both enforced here rather than in the UI:
//   1. `code` is the stable contract used by backfills and by code, so it can be
//      SET ONCE on create and NEVER changed afterwards — renaming MORTGAGE would
//      silently orphan every row that references it. The name/shortName are what
//      change when the business re-brands a line.
//   2. A line that already has CASES cannot be deleted or deactivated wholesale —
//      that would orphan live work. Deletion is blocked outright; deactivating is
//      allowed because a retired line's history must remain readable. `bankRaced`
//      refuses to flip to false on a line that already has multi-leg engagements.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { serServiceLine } from "@/lib/ser";

const CODE_RE = /^[A-Z][A-Z0-9_-]{1,31}$/;

export async function GET() {
  const lines = await db.serviceLine.findMany({
    orderBy: { sortOrder: "asc" },
    include: { products: { orderBy: { sortOrder: "asc" } } },
  });
  const counts = await db.loanCase.groupBy({ by: ["serviceLineId"], _count: { _all: true } });
  const byId = new Map(counts.map((c) => [c.serviceLineId, c._count._all]));
  return NextResponse.json({
    serviceLines: lines.map((l) => serServiceLine(l, l.products)),
    caseCounts: Object.fromEntries(byId),
  });
}
export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!flags.admin && !flags.super) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json();

  // --- product ---
  if (body.product) {
    const p = body.product;
    if (!p.code || !String(p.code).match(CODE_RE)) {
      return NextResponse.json({ error: "product code must be UPPER_SNAKE (e.g. GV-10)" }, { status: 400 });
    }
    if (!p.serviceLineId) return NextResponse.json({ error: "serviceLineId required" }, { status: 400 });
    if (p.id) {
      const { id, code, serviceLineId, ...rest } = p;
      const updated = await db.product.update({
        where: { id: Number(id) },
        data: { ...rest, sortOrder: Number(rest.sortOrder) || 0, active: rest.active !== false },
      });
      return NextResponse.json({ product: updated });
    }
    try {
      const created = await db.product.create({
        data: {
          code: p.code, name: String(p.name || p.code), serviceLineId: Number(p.serviceLineId),
          notes: String(p.notes || ""), sortOrder: Number(p.sortOrder) || 0, active: p.active !== false,
        },
      });
      return NextResponse.json({ product: created });
    } catch (e) {
      if (String(e).includes("Unique constraint")) {
        return NextResponse.json({ error: `Product code "${p.code}" already exists` }, { status: 400 });
      }
      throw e;
    }
  }
// --- service line ---
  const s = body.serviceLine;
  if (!s || !String(s.code || "").match(CODE_RE)) {
    return NextResponse.json({ error: "code must be UPPER_SNAKE (e.g. GOLDEN_VISA)" }, { status: 400 });
  }
  if (s.id) {
    // code is immutable — guardrail 1.
    const existing = await db.serviceLine.findUnique({ where: { id: Number(s.id) } });
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (s.code && s.code !== existing.code) {
      return NextResponse.json({ error: "code cannot be changed once set — it is referenced by code" }, { status: 400 });
    }
    if (!s.bankRaced && existing.bankRaced) {
      const multiLeg = await db.loanCase.count({ where: { serviceLineId: existing.id, parentCaseId: { not: null } } });
      if (multiLeg > 0) {
        return NextResponse.json(
          { error: `Cannot turn off bankRaced: ${multiLeg} legs exist on this line and would become meaningless` },
          { status: 400 },
        );
      }
    }
    const { id, code, ...rest } = s;
    const updated = await db.serviceLine.update({
      where: { id: Number(id) },
      data: {
        name: String(rest.name || existing.name),
        shortName: String(rest.shortName ?? existing.shortName),
        notes: String(rest.notes ?? existing.notes),
        active: rest.active !== false,
        bankRaced: rest.bankRaced === true,
        sortOrder: Number(rest.sortOrder) || 0,
      },
    });
    return NextResponse.json({ serviceLine: serServiceLine(updated) });
  }

  try {
    const created = await db.serviceLine.create({
      data: {
        code: s.code, name: String(s.name || s.code), shortName: String(s.shortName || s.name || s.code),
        notes: String(s.notes || ""), bankRaced: s.bankRaced === true,
        sortOrder: Number(s.sortOrder) || 99, active: s.active !== false,
      },
    });
    return NextResponse.json({ serviceLine: serServiceLine(created) });
  } catch (e) {
    if (String(e).includes("Unique constraint")) {
      return NextResponse.json({ error: `Service line code "${s.code}" already exists` }, { status: 400 });
    }
    throw e;
  }
}

export async function DELETE(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!flags.admin && !flags.super) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  const what = url.searchParams.get("what") || "serviceLine";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (what === "product") {
    const used = await db.loanCase.count({ where: { productId: id } });
    if (used > 0) {
      return NextResponse.json({ error: `${used} case(s) use this product. Deactivate it instead of deleting.` }, { status: 400 });
    }
    await db.product.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  }

  // Deleting a line would orphan its cases, leads, stages, doc rules and SLAs —
  // so deletion is blocked and deactivation is the correct verb.
  const [cases, leads] = await Promise.all([
    db.loanCase.count({ where: { serviceLineId: id } }),
    db.lead.count({ where: { serviceLineId: id } }),
  ]);
  if (cases > 0 || leads > 0) {
    return NextResponse.json(
      { error: `${cases} case(s) and ${leads} lead(s) use this service line. Deactivate it instead — history must stay readable.` },
      { status: 400 },
    );
  }
  await db.serviceLine.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}