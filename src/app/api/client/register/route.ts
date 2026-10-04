// POST /api/client/register — a new client self-registers before a case exists.
//
// PHASE 4: this now creates a LEAD, not a half-built LoanCase. Previously a
// registrant who typed a name and a phone number got a full case row — 40
// mortgage date columns, a case number, a pipeline stage — which made the funnel
// impossible to count per line of business and meaningless as a funnel at all.
//
// It also creates a Client row when the person is new, so Phase 3's client-scoped
// session has a real identity to attach to. That is what lets a lead-only
// registrant (who has NO case at all) log in and be served: session.clientId
// resolves independently of any caseId.
//
// No case is created, so `caseId` on the session is null. The portal shows an
// empty-but-correct "no active case yet" state, and the moment staff convert the
// lead the case appears for them automatically — they do not need to re-register.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cookies } from "next/headers";
import { matchClientByPhoneName } from "@/lib/client-master";
import { phoneDigits } from "@/lib/lead-readiness";

const CLIENT_SESSION_COOKIE = "hfmc_client_session";

export async function POST(req: NextRequest) {
  const { name, phone, email, propertyValue, employmentType, message, serviceLineId } = await req.json() as {
    name?: string; phone?: string; email?: string; propertyValue?: number; employmentType?: string;
    message?: string; serviceLineId?: number;
  };

  if (!name?.trim()) return NextResponse.json({ error: "Name is required." }, { status: 400 });
  if (!phone?.trim()) return NextResponse.json({ error: "Phone number is required." }, { status: 400 });

  // Which line of business are they asking about? The public form is mortgage-
  // shaped today, so it defaults to MORTGAGE — but the column is REQUIRED and is
  // what makes the funnel countable by service line.
  const lineId = serviceLineId
    ? Number(serviceLineId)
    : (await db.serviceLine.findUnique({ where: { code: "MORTGAGE" } }))?.id;
  if (!lineId) return NextResponse.json({ error: "Could not determine the service line." }, { status: 500 });
  const line = await db.serviceLine.findUnique({ where: { id: lineId } });
  if (!line) return NextResponse.json({ error: "Unknown service line." }, { status: 400 });

  // Repeat client? A phone+name match on the Client master links the lead to the
  // person we already know, so their second product (a buyout in two years, a
  // visa now) shows up against the SAME Client rather than a second person.
  const known = await matchClientByPhoneName(phone, name.trim());
  const knownClient = known ? await db.client.findUnique({ where: { id: known.id } }) : null;

  const lead = await db.lead.create({
    data: {
      fullName: name.trim(),
      phone: phoneDigits(phone),
      email: email?.trim() || knownClient?.email || null,
      serviceLineId: line.id,
      intendedAmount: propertyValue && propertyValue > 0 ? Number(propertyValue) : null,
      source: "Website",
      sourceDetail: message?.trim() || "",
      // A website registrant has no human owner yet. ownerId stays NULL rather
      // than defaulting to the head of company — an unassigned lead is normal,
      // and it is what makes the "unassigned" triage filter meaningful.
      ownerId: null,
      status: "New",
      clientId: knownClient?.id ?? null,
    },
  });

  // Create the Client row for a first-timer so the portal session below has an
  // identity. syncCaseClients can't do this now that there is no case, so this is
  // the explicit path. Reuses the same merge rules via matchClientByPhoneName.
  let clientId = knownClient?.id ?? null;
  if (!clientId) {
    const created = await db.client.create({
      data: {
        fullName: name.trim(),
        phone: phoneDigits(phone),
        email: email?.trim() || null,
        eidNo: knownClient?.eidNo ?? null,
        passportNo: knownClient?.passportNo ?? null,
        residency: knownClient?.residency ?? "Resident Expatriate",
      },
    }).catch(() => null);
    clientId = created?.id ?? null;
    if (clientId) await db.lead.update({ where: { id: lead.id }, data: { clientId } });
  }

  // Session is CLIENT-scoped (Phase 3). caseId is omitted rather than set to
  // null: the column is nullable and this registrant genuinely has no case, so
  // leaving it unset says exactly that — whereas an explicit null would read as
  // "a case used to be here and was cleared".
  const last4 = phoneDigits(phone).slice(-4);
  const sid = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 86400000);
  await db.clientSession.create({
    data: { id: sid, clientId, phone: last4, expiresAt },
  });
  const store = await cookies();
  store.set(CLIENT_SESSION_COOKIE, sid, { httpOnly: true, sameSite: "lax", path: "/", expires: expiresAt });

  return NextResponse.json({
    user: { clientId, caseId: null, leadId: lead.id, phone: last4, name: name.trim() },
  });
}
