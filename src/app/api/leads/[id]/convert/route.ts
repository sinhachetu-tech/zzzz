// POST /api/leads/:id/convert — turn a qualified Lead into a real case (Phase 4).
//
// This is the moment the funnel forks. Before it, the person is a name, a phone
// and a question ("how much can I borrow?"). After it, they are a case with a
// stage, an owner, documents and a commission.
//
// WHAT IS CARRIED ACROSS: contact details, intended amount, source attribution,
// owner, service line and product. That is exactly the set a Lead is allowed to
// hold (see the Placement Rule in MIGRATION-NOTES.md) — which is why this
// conversion is a straight copy rather than a field-by-field translation.
//
// WHY ONE TRANSACTION: a lead that is marked Converted but whose case failed to
// create would be a lead nobody can ever convert again, with no trace of where
// it went. Either both happen or neither does.
//
// IDEMPOTENCE: converting an already-converted lead returns the SAME case rather
// than creating a second one. A double-click on "Convert" must not fork a
// client into two parallel pipelines.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { serLead } from "@/lib/ser";
import { syncCaseClients } from "@/lib/client-master";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const leadId = Number(id);
  if (!leadId) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);

  const lead = await db.lead.findUnique({
    where: { id: leadId },
    include: { serviceLine: true, product: true, owner: true },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // Idempotence — return the case this lead already became.
  if (lead.caseId) {
    const existing = await db.loanCase.findUnique({ where: { id: lead.caseId } });
    if (existing) {
      return NextResponse.json({ case: existing, lead: serLead(lead), alreadyConverted: true });
    }
  }
  if (lead.status === "Converted" && !lead.caseId) {
    return NextResponse.json(
      { error: "This lead is marked converted but has no case — resolve it manually before converting again" },
      { status: 409 },
    );
  }

  const line = lead.serviceLine;
  // The case enters its line's FIRST active stage, not a hardcoded mortgage one.
  // For a golden visa that is "Documents"; for mortgage it stays
  // "WhatsApp Group Creation" exactly as before, because the seeded stage set
  // preserves the existing mortgage labels.
  //
  // Scoped through StageSet, because that is where a stage's service line
  // actually lives — StageItem itself only knows which SET it belongs to.
  const stageSet = await db.stageSet.findFirst({
    where: { serviceLineId: line.id, active: true },
    orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }],
  });
  const firstStage = stageSet
    ? await db.stageItem.findFirst({
        // Skips a stage literally called "Lead". The mortgage journey's first
        // stage IS "Lead" (that is where a lead-stage case used to sit), so
        // without this a freshly converted mortgage case would land back in the
        // funnel it just graduated from, and the Leads list would show it twice.
        where: { stageSetId: stageSet.id, active: true, NOT: { label: "Lead" } },
        orderBy: { sortOrder: "asc" },
      })
    : null;
  // Non-mortgage lines get their stage sets in Phase 5; until then they fall
  // back to a neutral label rather than landing in "WhatsApp Group Creation",
  // which would be vocabulary from a different line of business.
  const stage = firstStage?.label ?? "New Case";

  const amount = body.loanAmount != null && body.loanAmount !== ""
    ? Number(body.loanAmount)
    : lead.intendedAmount ?? 0;

  const count = await db.loanCase.count();
  const caseNumber = `HFMC-${String(count + 1).padStart(4, "0")}`;

  const customer = String(body.customer ?? lead.fullName).trim();
  const phoneDigits = lead.phone;

  const created = await db.$transaction(async (tx) => {
    const c = await tx.loanCase.create({
      data: {
        caseNumber,
        customer,
        banks: JSON.stringify([]),
        loanAmount: amount,
        propertyValue: body.propertyValue ? Number(body.propertyValue) : null,
        stage,
        caseStatus: "Active",
        // Falls back to the person doing the conversion: an unowned case is how
        // work goes quiet, and the converter is by definition engaged with it.
        ownerId: lead.ownerId ?? me.id,
        source: lead.source,
        whatsapp: phoneDigits,
        waGroup: null,
        statusNote: String(body.statusNote ?? `Converted from lead — ${line.name}${lead.product ? ` · ${lead.product.name}` : ""}`),
        transactionType: "",
        propertyLocation: null,
        coApplicantName: null,
        serviceLineId: line.id,
        productId: lead.productId,
        legStatus: "Active",
        // Stamped on the CASE as well as the lead, so the "From lead" saved view
        // and the CaseCommandBar provenance line keep working unchanged.
        convertedAt: new Date(),
        convertedById: me.id,
      },
    });

    await tx.lead.update({
      where: { id: leadId },
      data: {
        status: "Converted",
        caseId: c.id,
        clientId: lead.clientId,
        convertedAt: new Date(),
        convertedById: me.id,
        // A converted lead is by definition human-touched.
        firstContactedAt: lead.firstContactedAt ?? new Date(),
      },
    });

    await tx.activity.create({
      data: { caseId: c.id, userId: me.id, action: `converted lead: ${lead.fullName} (${line.name})` },
    });

    return c;
  });

  // Warm the case's client profile from the master (and create the Client row if
  // this person's first). Runs OUTSIDE the transaction because it does its own
  // read-modify-write and must not hold the case row locked.
  await syncCaseClients(created.id).catch(() => {});

  return NextResponse.json({ case: created, caseId: created.id, caseNumber: created.caseNumber });
}