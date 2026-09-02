// POST /api/email/inbound — inbound email webhook.
//
// Accepts a Postmark-style payload: { From, Subject, MessageID, Date, TextBody? }
// Auth: Bearer token matching EMAIL_WEBHOOK_SECRET env var.
//
// Runs the fuzzy matcher. On a confident match, creates an EmailLog row +
// an auto Task on the case (waiting_for derived from sender domain, due +2
// business days). On a partial/no match, queues in UnmatchedEmail with a
// best-guess caseId if we have one.
//
// No email body is ever stored — only subject, sender, direction, and an
// optional Outlook deep link. Keeps the table small and sidesteps storing
// sensitive email content in the tracker.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { matchEmail, directionFor, dueInBusinessDays } from "@/lib/email-match";

export async function POST(req: NextRequest) {
  const secret = process.env.EMAIL_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "EMAIL_WEBHOOK_SECRET not set on the server" }, { status: 500 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { From?: string; Subject?: string; MessageID?: string; Date?: string; MailboxHash?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const sender = (body.From ?? "").trim();
  const subject = (body.Subject ?? "").trim();
  const messageId = body.MessageID ?? `${sender}|${subject}|${body.Date ?? Date.now()}`;

  if (!sender || !subject) {
    return NextResponse.json({ error: "From and Subject are required" }, { status: 400 });
  }

  // Dedup by messageId — a forwarded email might arrive twice.
  const existing = await db.emailLog.findUnique({ where: { messageId } }).catch(() => null);
  if (existing) {
    return NextResponse.json({ ok: true, action: "duplicate", caseId: existing.caseId });
  }
  const existingUnmatched = await db.unmatchedEmail.findUnique({ where: { messageId } }).catch(() => null);
  if (existingUnmatched) {
    return NextResponse.json({ ok: true, action: "duplicate-unmatched" });
  }

  // Load open cases + active banks for matching.
  const [cases, banks] = await Promise.all([
    db.loanCase.findMany({ where: { caseStatus: "Active" } }),
    db.bankItem.findMany(),
  ]);

  const result = matchEmail({
    subject,
    sender,
    cases: cases.map((c) => ({
      id: c.id,
      customer: c.customer,
      caseStatus: c.caseStatus,
      banks: (() => { try { return JSON.parse(c.banks) as string[]; } catch { return []; } })(),
    })),
    banks: banks.map((b) => ({ name: b.name, active: b.active })),
  });

  if (result.kind === "matched") {
    const direction = directionFor(sender);
    // Create the EmailLog + an auto Task.
    const [email] = await db.$transaction([
      db.emailLog.create({
        data: {
          caseId: result.caseId,
          subject,
          sender,
          direction,
          messageId,
        },
      }),
      db.task.create({
        data: {
          caseId: result.caseId,
          description: `Email: ${subject}`,
          ownerId: cases.find((c) => c.id === result.caseId)?.ownerId ?? 1,
          createdBy: 1, // system
          waitingFor: direction === "from_bank" ? "Bank" : direction === "from_client" ? "Client" : "Internal",
          whyPending: "Bank Query",
          dueDate: dueInBusinessDays(2),
          status: "Open",
          remarks: `Auto-created from inbound email — ${result.bankName ?? "bank"} query.`,
        },
      }),
      db.activity.create({
        data: {
          caseId: result.caseId,
          userId: 1,
          action: `email logged: ${direction === "from_bank" ? "bank" : "client"} query — ${result.bankName ?? "—"}`,
        },
      }),
    ]);
    return NextResponse.json({
      ok: true,
      action: "linked",
      caseId: result.caseId,
      emailId: email.id,
      confidence: result.confidence,
      bank: result.bankName,
    });
  }

  // Partial / no match → review queue.
  const unmatched = await db.unmatchedEmail.create({
    data: {
      subject,
      sender,
      messageId,
      bestGuessCaseId: result.bestGuessCaseId,
      status: "Pending",
    },
  });
  return NextResponse.json({
    ok: true,
    action: "queued",
    unmatchedId: unmatched.id,
    bestGuessCaseId: result.bestGuessCaseId,
    customerScore: result.customerScore,
    reason: result.reason,
  });
}
