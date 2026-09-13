// POST /api/client/register — a new client self-registers before a case exists.
// Creates a LoanCase in "Lead" stage (before WhatsApp Group Creation) and a ClientSession.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cookies } from "next/headers";
import { toISODate } from "@/lib/format";

const CLIENT_SESSION_COOKIE = "hfmc_client_session";

export async function POST(req: NextRequest) {
  const { name, phone, email, propertyValue, employmentType, message } = await req.json() as {
    name?: string; phone?: string; email?: string; propertyValue?: number; employmentType?: string; message?: string;
  };

  if (!name?.trim()) return NextResponse.json({ error: "Name is required." }, { status: 400 });
  if (!phone?.trim()) return NextResponse.json({ error: "Phone number is required." }, { status: 400 });

  // Create a case in "Lead" stage — before the normal pipeline starts.
  // The team will pick it up, assign an owner, and move it to WhatsApp Group Creation.
  const count = await db.loanCase.count();
  const caseNumber = `HFMC-${String(count + 1).padStart(4, "0")}`;

  const created = await db.loanCase.create({
    data: {
      caseNumber,
      customer: name.trim(),
      banks: JSON.stringify([]),
      loanAmount: propertyValue ?? 0,
      stage: "Lead",
      caseStatus: "Active",
      ownerId: 1, // default to head of company until assigned
      source: "Website",
      whatsapp: phone.trim(),
      waGroup: null,
      statusNote: message?.trim() || "New client registration — awaiting advisor assignment.",
      transactionType: "",
      propertyLocation: null,
      coApplicantName: null,
    },
  });

  // Log an activity
  await db.activity.create({
    data: { caseId: created.id, userId: 1, action: `new client registered: ${name.trim()}` },
  });

  // Create a client session so they're logged in immediately
  const phoneDigits = phone.replace(/\D/g, "");
  const last4 = phoneDigits.slice(-4);
  const sid = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 86400000);
  await db.clientSession.create({ data: { id: sid, caseId: created.id, phone: last4, expiresAt } });
  const store = await cookies();
  store.set(CLIENT_SESSION_COOKIE, sid, { httpOnly: true, sameSite: "lax", path: "/", expires: expiresAt });

  return NextResponse.json({
    user: { caseId: created.id, phone: last4, caseNumber: created.caseNumber, customer: created.customer },
  });
}
