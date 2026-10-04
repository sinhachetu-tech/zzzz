// GET /api/admin/changelog — the pricing change log (Admin → Change log).
//
// WHY: BankProduct.approvedBy records only WHO last approved a version, not what it
// changed. When a client asks "what rate were we quoted in March?", this is the
// query that answers it. Reads AuditLog; all writes happen in /api/admin/*.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!flags.admin && !flags.super) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");
  const entityId = url.searchParams.get("entityId");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "200", 10) || 200, 500);

  const rows = await db.auditLog.findMany({
    where: {
      ...(entity ? { entity } : {}),
      ...(entityId ? { entityId } : {}),
    },
    orderBy: { at: "desc" },
    take: limit,
  });

  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      entity: r.entity,
      entityId: r.entityId,
      action: r.action,
      field: r.field,
      beforeVal: r.beforeVal,
      afterVal: r.afterVal,
      reason: r.reason,
      actorName: r.actorName,
      at: r.at.toISOString(),
    })),
  });
}
