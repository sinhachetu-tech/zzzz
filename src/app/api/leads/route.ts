// GET/POST/PATCH/DELETE /api/leads — the funnel's own entity (Phase 4).
//
// WHY A SEPARATE ROUTE: a lead is NOT a LoanCase with stage === "Lead". It is a
// cheap, disposable expression of interest that becomes a case only once it is
// qualified. Modelling it as a half-built case meant 40 mortgage date columns,
// a case number and a pipeline stage for someone who had typed a name and a
// phone number — and it made "how many leads do we have?" unanswerable, because
// the row carried no indication of which line of business they were asking about.
//
// RULES ENFORCED HERE (not left to the UI):
//   1. serviceLineId is REQUIRED on create. A six-service consultancy cannot
//      answer "how many leads do we have?" without it.
//   2. firstContactedAt is stamped on the FIRST transition away from "New" —
//      never on create. The SLA clock measures human contact, not arrival.
//   3. A converted lead cannot be un-converted. The case it became is live work;
//      reopening the lead would fork the funnel.
//   4. Invalid vs Lost are separate statuses — conflating them understates the
//      conversion rate (spam and wrong numbers are not lost business).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { serLead } from "@/lib/ser";
import { LEAD_STATUSES, OPEN_LEAD_STATUSES } from "@/lib/types";

export async function GET() {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  const rows = await db.lead.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      serviceLine: { select: { id: true, code: true, name: true } },
      product: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true } },
    },
  });
  const dtos = rows.map((l) =>
    serLead(l, {
      serviceLineName: l.serviceLine.name,
      serviceLineCode: l.serviceLine.code,
      productName: l.product?.name ?? null,
      ownerName: l.owner?.name ?? null,
    }),
  );
  return NextResponse.json({ leads: flags.viewRevenue ? dtos : dtos.map((l) => ({ ...l, intendedAmount: null })) });
}

export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json();

  const fullName = String(b.fullName ?? "").trim();
  if (!fullName) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  // Rule 1 — required, and validated against the catalogue so a typo can't create
  // a lead whose service line resolves to nothing in every picker.
  const serviceLineId = Number(b.serviceLineId);
  if (!serviceLineId) {
    return NextResponse.json({ error: "Pick the service they're asking about" }, { status: 400 });
  }
  const line = await db.serviceLine.findUnique({ where: { id: serviceLineId } });
  if (!line) return NextResponse.json({ error: "Unknown service line" }, { status: 400 });

  let productId: number | null = null;
  if (b.productId) {
    const p = await db.product.findUnique({ where: { id: Number(b.productId) } });
    // A product from a DIFFERENT line would put the lead in a state no journey
    // can serve, so reject rather than quietly storing an impossible pairing.
    if (!p || p.serviceLineId !== serviceLineId) {
      return NextResponse.json({ error: "That product doesn't belong to the chosen service line" }, { status: 400 });
    }
    productId = p.id;
  }

  // Phone is stored DIGITS-ONLY. It is a match hint for the duplicate warning,
  // never a merge key — two family members share a number, and merging on it
  // would fuse two people's KYC into one record.
  const phone = String(b.phone ?? "").replace(/\D/g, "");

  const created = await db.lead.create({
    data: {
      fullName,
      phone,
      email: b.email?.trim() || null,
      serviceLineId,
      productId,
      intendedAmount: b.intendedAmount != null && b.intendedAmount !== "" ? Number(b.intendedAmount) : null,
      source: String(b.source || "Direct"),
      sourceDetail: String(b.sourceDetail ?? ""),
      // An agent entering a lead on the floor usually knows who owns it; an
      // unassigned lead from the website is normal and stays unassigned.
      ownerId: b.ownerId ? Number(b.ownerId) : null,
      status: "New",
    },
    include: { serviceLine: true },
  });
  return NextResponse.json({ lead: serLead(created, { serviceLineName: line.name, serviceLineCode: line.code }) });
}

export async function PATCH(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json();
  const id = Number(b.id);
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const existing = await db.lead.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const data: Record<string, unknown> = {};

  if (b.status !== undefined) {
    const status = String(b.status);
    if (!LEAD_STATUSES.includes(status as never)) {
      return NextResponse.json({ error: `Unknown status "${status}"` }, { status: 400 });
    }
    // Rule 3 — a converted lead is a historical fact about work that is now
    // live. Reopening it would fork the funnel and double-count the conversion.
    if (existing.status === "Converted" && status !== "Converted") {
      return NextResponse.json(
        { error: "This lead has already been converted — reopen the case instead" },
        { status: 400 },
      );
    }
    data.status = status;

    // Rule 2 — the SLA clock starts when a HUMAN first touches the lead, and is
    // only ever set once. Re-touching a lead must not reset it, or a lead that
    // has been chased for a week would report as freshly contacted.
    if (status !== "New" && !existing.firstContactedAt) {
      data.firstContactedAt = new Date();
    }
    // Closing a lead for a reason should never leave the reason blank — an
    // unexplained loss is indistinguishable from a duplicate in the reports.
    if ((status === "Lost" || status === "Invalid") && !existing.lostReason) {
      data.lostReason =
        String(b.lostReason ?? "").trim() || (status === "Invalid" ? "Marked invalid" : "No reason given");
    }
  }

  if (b.lostReason !== undefined) data.lostReason = String(b.lostReason);
  if (b.ownerId !== undefined) data.ownerId = b.ownerId ? Number(b.ownerId) : null;
  if (b.email !== undefined) data.email = b.email?.trim() || null;
  if (b.phone !== undefined) data.phone = String(b.phone).replace(/\D/g, "");
  if (b.fullName !== undefined) data.fullName = String(b.fullName).trim();
  if (b.source !== undefined) data.source = String(b.source);
  if (b.sourceDetail !== undefined) data.sourceDetail = String(b.sourceDetail);

  if (b.productId !== undefined) {
    const pid = b.productId ? Number(b.productId) : null;
    if (pid) {
      const p = await db.product.findUnique({ where: { id: pid } });
      const lineId = Number(b.serviceLineId ?? existing.serviceLineId);
      if (!p || p.serviceLineId !== lineId) {
        return NextResponse.json({ error: "That product doesn't belong to the chosen service line" }, { status: 400 });
      }
    }
    data.productId = pid;
  }

  if (b.serviceLineId !== undefined && Number(b.serviceLineId) !== existing.serviceLineId) {
    // Changing the line on a live lead would orphan its product and silently
    // move it into a different funnel. Only allowed while it is untouched.
    if (!OPEN_LEAD_STATUSES.includes(existing.status as never) || existing.caseId) {
      return NextResponse.json({ error: "Can't change the service line once the lead is in play" }, { status: 400 });
    }
    const line = await db.serviceLine.findUnique({ where: { id: Number(b.serviceLineId) } });
    if (!line) return NextResponse.json({ error: "Unknown service line" }, { status: 400 });
    data.serviceLineId = line.id;
    data.productId = null; // a product from the old line is meaningless now
  }

  if (b.intendedAmount !== undefined) {
    data.intendedAmount = b.intendedAmount == null || b.intendedAmount === "" ? null : Number(b.intendedAmount);
  }

  const updated = await db.lead.update({
    where: { id },
    data,
    include: { serviceLine: true, product: true, owner: true },
  });
  return NextResponse.json({
    lead: serLead(updated, {
      serviceLineName: updated.serviceLine.name,
      serviceLineCode: updated.serviceLine.code,
      productName: updated.product?.name ?? null,
      ownerName: updated.owner?.name ?? null,
    }),
  });
}

export async function DELETE(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const existing = await db.lead.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // A converted lead is deleted only as part of deleting its CASE (Phase 2 rule:
  // never orphan live work). Losing the lead record while the case survives
  // would erase the only record of where that business came from.
  if (existing.caseId) {
    return NextResponse.json(
      { error: "This lead became a case — delete the case instead so its history stays intact" },
      { status: 400 },
    );
  }
  if (!flags.admin && !flags.super && existing.ownerId && existing.ownerId !== me.id) {
    return NextResponse.json({ error: "You can only delete leads you own" }, { status: 403 });
  }
  await db.lead.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}