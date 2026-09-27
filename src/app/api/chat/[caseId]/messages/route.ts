import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { currentClient } from "@/lib/client-auth";
import { currentAgent } from "@/lib/agent-auth";
import { serCaseDocument, serChatMessage } from "@/lib/ser";
import { sendPushNotification } from "@/lib/push";

// GET /api/chat/[caseId]/messages
// Query params:
// - thread: 'CLIENT' | 'AGENT' (default 'CLIENT')
// - after: ISO date string (fetch messages newer than this)
// - limit: number (default 50)
// - stream: 'true' (returns SSE text/event-stream)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const { caseId: caseIdStr } = await params;
  const caseId = parseInt(caseIdStr, 10);
  if (isNaN(caseId)) return NextResponse.json({ error: "Invalid case ID" }, { status: 400 });

  const url = new URL(req.url);
  const threadType = (url.searchParams.get("thread")?.toUpperCase() === "AGENT" ? "AGENT" : "CLIENT") as "CLIENT" | "AGENT";
  const isStream = url.searchParams.get("stream") === "true";
  const after = url.searchParams.get("after");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "60", 10), 200);

  // Authenticate participant
  const staff = await currentUser();
  const client = await currentClient();
  const agent = await currentAgent();

  if (!staff && !client && !agent) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Authorization checks — staff sessions win (a laptop can hold BOTH a
  // staff cookie and a stale client cookie; the client check must not 403
  // staff). Clients may read sibling bank journeys of the same person.
  if (staff) {
    // staff may read both threads on any case they can see
  } else if (client) {
    const { clientCanAccessCase } = await import("@/lib/chat-auth");
    if (!(await clientCanAccessCase(client, caseId)))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (threadType === "AGENT") return NextResponse.json({ error: "Forbidden thread" }, { status: 403 });
  } else if (agent) {
    // Check if agent is partner on this case
    const c = await db.loanCase.findUnique({ where: { id: caseId }, select: { partnerName: true, partnerKind: true } });
    if (!c || c.partnerName?.toLowerCase() !== agent.name.toLowerCase()) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (threadType === "CLIENT") return NextResponse.json({ error: "Forbidden thread" }, { status: 403 });
  }

  // Server-Sent Events (SSE) mode
  if (isStream) {
    let lastSeenId = 0;
    const initial = await db.chatMessage.findMany({
      where: { caseId, threadType },
      orderBy: { id: "desc" },
      take: 1,
    });
    if (initial.length > 0) lastSeenId = initial[0].id;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        req.signal.addEventListener("abort", () => {
          closed = true;
          try { controller.close(); } catch {}
        });

        // Send initial connect ping
        controller.enqueue(encoder.encode(`event: ping\ndata: {"connected":true}\n\n`));

        // Poll loop for SSE push (every 2.5s)
        const interval = setInterval(async () => {
          if (closed) {
            clearInterval(interval);
            return;
          }
          try {
            const newMessages = await db.chatMessage.findMany({
              where: {
                caseId,
                threadType,
                id: { gt: lastSeenId },
              },
              orderBy: { id: "asc" },
            });

            if (newMessages.length > 0) {
              lastSeenId = newMessages[newMessages.length - 1].id;
              const sseKeys = newMessages.map((m) => m.attachmentKey).filter((k): k is string => !!k);
              const sseDocs = sseKeys.length
                ? await db.caseDocument.findMany({ where: { caseId, storageKey: { in: sseKeys } }, select: { id: true, storageKey: true } })
                : [];
              const sseDocByKey = new Map(sseDocs.map((d) => [d.storageKey as string, d.id]));
              for (const m of newMessages) {
                const payload = JSON.stringify(
                  serChatMessage({
                    ...m,
                    documentId: m.attachmentKey ? sseDocByKey.get(m.attachmentKey) ?? null : null,
                  })
                );
                controller.enqueue(encoder.encode(`event: message\ndata: ${payload}\n\n`));
              }
            } else {
              // Heartbeat keepalive comment
              controller.enqueue(encoder.encode(`: heartbeat\n\n`));
            }
          } catch {
            clearInterval(interval);
            try { controller.close(); } catch {}
          }
        }, 2500);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
      },
    });
  }

  // Standard JSON response — attach documentId by joining the vault row
  // created for this chat file (same case + same storage key).
  const where: { caseId: number; threadType: string; sentAt?: { gt: Date } } = { caseId, threadType };
  if (after) {
    const afterDate = new Date(after);
    if (!isNaN(afterDate.getTime())) where.sentAt = { gt: afterDate };
  }

  const messages = await db.chatMessage.findMany({
    where,
    orderBy: { sentAt: "asc" },
    take: limit,
  });
  const keys = messages.map((m) => m.attachmentKey).filter((k): k is string => !!k);
  const docs = keys.length
    ? await db.caseDocument.findMany({ where: { caseId, storageKey: { in: keys } }, select: { id: true, storageKey: true } })
    : [];
  const docByKey = new Map(docs.map((d) => [d.storageKey as string, d.id]));

  return NextResponse.json({
    items: messages.map((m) =>
      serChatMessage({
        ...m,
        documentId: m.attachmentKey ? docByKey.get(m.attachmentKey) ?? null : null,
      })
    ),
  });
}

// POST /api/chat/[caseId]/messages
// Sends a new message and optional attachment
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const { caseId: caseIdStr } = await params;
  const caseId = parseInt(caseIdStr, 10);
  if (isNaN(caseId)) return NextResponse.json({ error: "Invalid case ID" }, { status: 400 });

  const staff = await currentUser();
  const client = await currentClient();
  const agent = await currentAgent();

  if (!staff && !client && !agent) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const text = body.text ? String(body.text).trim() : null;
  const threadType = (body.threadType === "AGENT" ? "AGENT" : "CLIENT") as "CLIENT" | "AGENT";
  const attachmentKey = body.attachmentKey ? String(body.attachmentKey) : null;
  const attachmentName = body.attachmentName ? String(body.attachmentName) : null;
  const attachmentSize = body.attachmentSize ? Number(body.attachmentSize) : null;
  const mimeType = body.mimeType ? String(body.mimeType) : null;

  if (!text && !attachmentKey) {
    return NextResponse.json({ error: "Message text or attachment is required" }, { status: 400 });
  }

  let senderType: "STAFF" | "CLIENT" | "AGENT" = "STAFF";
  let senderId: number | null = null;
  let senderName = "HFMC Mortgage Team";

  // Staff session wins — same laptop can hold a stale client cookie.
  if (staff) {
    const flags = await flagsFor(staff);
    if (!flags.clientChat && !flags.admin && !flags.super) {
      return NextResponse.json({ error: "Your designation is not permitted to reply in chat. Ask an admin to enable Chat in Admin → Designations." }, { status: 403 });
    }
    senderType = "STAFF";
    senderId = staff.id;
    senderName = `${staff.name} (HFMC)`;
  } else if (client) {
    const { clientCanAccessCase } = await import("@/lib/chat-auth");
    if (!(await clientCanAccessCase(client, caseId)))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (threadType === "AGENT") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    senderType = "CLIENT";
    senderId = null;
    senderName = client.customer || "Client";
  } else if (agent) {
    const c = await db.loanCase.findUnique({ where: { id: caseId }, select: { partnerName: true } });
    if (!c || c.partnerName?.toLowerCase() !== agent.name.toLowerCase()) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (threadType === "CLIENT") return NextResponse.json({ error: "Forbidden thread" }, { status: 403 });
    senderType = "AGENT";
    senderId = null;
    senderName = `${agent.name} (Partner)`;
  }

  // 1. Create chat message
  const message = await db.chatMessage.create({
    data: {
      caseId,
      senderId,
      senderType,
      senderName,
      threadType,
      text,
      attachmentKey,
      attachmentName,
      attachmentSize,
      mimeType,
      readByStaff: senderType === "STAFF",
      readByExternal: senderType !== "STAFF",
    },
  });

  // 2. If attachment was provided, auto-create CaseDocument in Doc Vault
  let docRow: any = null;
  if (attachmentKey && attachmentName) {
    docRow = await db.caseDocument.create({
      data: {
        caseId,
        title: attachmentName,
        displayName: attachmentName,
        category: "Chat",
        source: "chat",
        storageKey: attachmentKey,
        fileName: attachmentName,
        fileSize: attachmentSize,
        fileType: mimeType,
        status: "Uploaded",
        mandatory: false,
        visibleToClient: threadType === "CLIENT",
        clientCanUpload: true,
        uploadedByKind: senderType.toLowerCase(),
        uploadedById: senderId,
        uploadedAt: new Date(),
      },
    });

    // Record activity
    await db.activity.create({
      data: {
        caseId,
        userId: senderId ?? 1,
        action: `shared file in chat: ${attachmentName} (${senderName})`,
      },
    }).catch(() => {});
  }

  // 3. Dispatch Web Push notification
  try {
    const pushBody = text || (attachmentName ? `📎 ${attachmentName}` : "New message");
    if (senderType === "CLIENT") {
      const c = await db.loanCase.findUnique({
        where: { id: caseId },
        select: { ownerId: true, advisorId: true, caseNumber: true },
      });
      if (c) {
        const recipients = [c.ownerId, c.advisorId].filter((id): id is number => id != null);
        for (const recipientId of recipients) {
          sendPushNotification(
            { userId: recipientId },
            {
              title: `💬 ${senderName} (${c.caseNumber})`,
              body: pushBody,
              url: `/`,
            }
          ).catch(() => {});
        }
      }
    } else if (senderType === "STAFF") {
      // Sibling-aware: client may be viewing any bank journey of the same
      // person — push to every sibling caseId so it always arrives.
      const { siblingCaseIds } = await import("@/lib/chat-auth");
      const targets = await siblingCaseIds(caseId);
      for (const targetCaseId of targets) {
        sendPushNotification(
          { caseId: targetCaseId },
          {
            title: `💬 ${senderName}`,
            body: pushBody,
            url: `/client`,
          }
        ).catch(() => {});
      }
    } else if (senderType === "AGENT") {
      const c = await db.loanCase.findUnique({
        where: { id: caseId },
        select: { ownerId: true, advisorId: true, caseNumber: true },
      });
      if (c) {
        const recipients = [c.ownerId, c.advisorId].filter((id): id is number => id != null);
        for (const recipientId of recipients) {
          sendPushNotification(
            { userId: recipientId },
            {
              title: `💬 ${senderName} (${c.caseNumber})`,
              body: pushBody,
              url: `/`,
            }
          ).catch(() => {});
        }
      }
    }
  } catch {}

  return NextResponse.json({
    item: serChatMessage({ ...message, documentId: docRow ? docRow.id : null }),
    document: docRow ? serCaseDocument(docRow) : null,
  });
}
