// PATCH /api/eibor — update one EIBOR tenor row. Permission is granted per
// designation (editEibor) plus admins. Every write stamps who/when; the rate's
// own publish/effective date is captured separately (effectiveFrom) because a
// central-bank publication day is not always the day the rate takes effect.
// The match engine and pricing read this table live — no other wiring needed.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { toISODate } from "@/lib/format";

const TENOR_RE = /^(ON|1W|1M|3M|6M|1Y)$/;

export async function PATCH(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!flags.editEibor && !flags.admin && !flags.super) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { tenor, ratePct, effectiveFrom, note } = await req.json() as {
    tenor?: string; ratePct?: number; effectiveFrom?: string | null; note?: string;
  };

  if (!tenor || !TENOR_RE.test(tenor)) {
    return NextResponse.json({ error: "tenor must be one of ON, 1W, 1M, 3M, 6M, 1Y" }, { status: 400 });
  }
  if (typeof ratePct !== "number" || !(ratePct > 0) || ratePct > 25) {
    return NextResponse.json({ error: "enter a sane rate percentage" }, { status: 400 });
  }

  const today = toISODate(new Date());
  const row = await db.eiborRate.upsert({
    where: { tenor },
    create: {
      tenor,
      ratePct,
      updatedOn: today,
      updatedBy: me.name,
      effectiveFrom: effectiveFrom || today,
      note: note ?? "",
    },
    update: {
      ratePct,
      updatedOn: today,
      updatedBy: me.name,
      ...(effectiveFrom !== undefined ? { effectiveFrom: effectiveFrom || today } : {}),
      ...(note !== undefined ? { note } : {}),
    },
  });

  return NextResponse.json({ eibor: row });
}
