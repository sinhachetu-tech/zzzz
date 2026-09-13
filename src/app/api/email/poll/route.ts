// GET /api/email/poll — read unread messages from the shared Outlook mailbox
// via Microsoft Graph, run the fuzzy matcher, create EmailLog/UnmatchedEmail,
// mark the messages read. Designed to be called by a cron every 60s.
//
// Auth: a cron-secret in the query string OR a logged-in admin.
//   /api/email/poll?secret=...   (for Vercel Cron / external scheduler)
//   /api/email/poll              (for an admin clicking "Poll now" in the UI)
//
// Returns: { processed, linked, queued, duplicates, errors }
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { listUnread, markRead, senderOf, isGraphConfigured } from "@/lib/graph";
import { matchEmail, directionFor, dueInBusinessDays } from "@/lib/email-match";

export async function GET(req: NextRequest) {
  // Auth: either the cron secret or a logged-in user
  const cronSecret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const secretParam = url.searchParams.get("secret");
  const isCron = cronSecret && secretParam === cronSecret;
  if (!isCron) {
    const me = await currentUser();
    if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isGraphConfigured()) {
    return NextResponse.json(
      { error: "Graph env vars not set (GRAPH_CLIENT_ID, GRAPH_TENANT_ID, GRAPH_CLIENT_SECRET, GRAPH_MAILBOX)" },
      { status: 503 }
    );
  }

  const stats = { processed: 0, linked: 0, queued: 0, duplicates: 0, errors: 0 };

  let messages;
  try {
    messages = await listUnread(50);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Graph call failed", ...stats },
      { status: 502 }
    );
  }

  // Load cases + banks once for the matcher
  const [cases, banks] = await Promise.all([
    db.loanCase.findMany({ where: { caseStatus: "Active" } }),
    db.bankItem.findMany(),
  ]);
  const casesForMatch = cases.map((c) => ({
    id: c.id,
    customer: c.customer,
    caseStatus: c.caseStatus,
    banks: (() => { try { return JSON.parse(c.banks) as string[]; } catch { return []; } })(),
  }));
  const banksForMatch = banks.map((b) => ({ name: b.name, active: b.active }));

  for (const msg of messages) {
    stats.processed++;
    const messageId = msg.internetMessageId ?? msg.id;
    const subject = msg.subject ?? "";
    const sender = senderOf(msg);

    // Dedup by messageId — a message we already processed shouldn't appear
    // unread again, but guard against it anyway.
    const alreadyLogged = await db.emailLog.findUnique({ where: { messageId } }).catch(() => null);
    const alreadyQueued = await db.unmatchedEmail.findUnique({ where: { messageId } }).catch(() => null);
    if (alreadyLogged || alreadyQueued) {
      stats.duplicates++;
      await markRead(msg.id).catch(() => {});
      continue;
    }

    const result = matchEmail({
      subject, sender,
      cases: casesForMatch,
      banks: banksForMatch,
    });

    try {
      if (result.kind === "matched") {
        const direction = directionFor(sender);
        await db.$transaction([
          db.emailLog.create({
            data: {
              caseId: result.caseId,
              subject,
              sender,
              direction,
              messageId,
              outlookLink: msg.webLink ?? null,
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
              remarks: `Auto-linked from Outlook (${result.bankName ?? "bank"} query).`,
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
        stats.linked++;
      } else {
        await db.unmatchedEmail.create({
          data: {
            subject,
            sender,
            messageId,
            bestGuessCaseId: result.bestGuessCaseId,
            status: "Pending",
          },
        });
        stats.queued++;
      }
      // Mark read so we don't re-process next poll
      await markRead(msg.id).catch(() => {});
    } catch {
      stats.errors++;
      // Don't mark read on error — we'll retry next poll.
    }
  }

  return NextResponse.json({ ok: true, ...stats });
}
