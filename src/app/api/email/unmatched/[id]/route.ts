// PATCH /api/email/unmatched/:id — resolve an unmatched email.
//   { action: "link", caseId }  → move to EmailLog, create an auto Task
//   { action: "ignore" }        → mark Ignored
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { directionFor, dueInBusinessDays } from "@/lib/email-match";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const emailId = parseInt(id, 10);
  const body = await req.json();

  const email = await db.unmatchedEmail.findUnique({ where: { id: emailId } });
  if (!email) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (email.status !== "Pending") {
    return NextResponse.json({ error: `already ${email.status}` }, { status: 409 });
  }

  if (body.action === "ignore") {
    await db.unmatchedEmail.update({
      where: { id: emailId },
      data: { status: "Ignored", resolvedBy: me.id, resolvedAt: new Date() },
    });
    return NextResponse.json({ ok: true, action: "ignored" });
  }

  if (body.action === "link" && body.caseId) {
    const caseId = parseInt(body.caseId, 10);
    const c = await db.loanCase.findUnique({ where: { id: caseId } });
    if (!c) return NextResponse.json({ error: "case not found" }, { status: 404 });
    const direction = directionFor(email.sender);
    await db.$transaction([
      db.emailLog.create({
        data: {
          caseId,
          subject: email.subject,
          sender: email.sender,
          direction,
          messageId: email.messageId,
        },
      }),
      db.unmatchedEmail.update({
        where: { id: emailId },
        data: { status: "Linked", resolvedBy: me.id, resolvedAt: new Date() },
      }),
      db.task.create({
        data: {
          caseId,
          description: `Email: ${email.subject}`,
          ownerId: c.ownerId,
          createdBy: me.id,
          waitingFor: direction === "from_bank" ? "Bank" : direction === "from_client" ? "Client" : "Internal",
          whyPending: "Bank Query",
          dueDate: dueInBusinessDays(2),
          status: "Open",
          remarks: `Linked from the email review queue by ${me.name}.`,
        },
      }),
      db.activity.create({
        data: { caseId, userId: me.id, action: `linked email: ${email.subject.slice(0, 60)}` },
      }),
    ]);
    return NextResponse.json({ ok: true, action: "linked", caseId });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
