import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { currentClient } from "@/lib/client-auth";
import { r2Configured, r2Put, docKey } from "@/lib/r2";
import { serCaseDocument, serChatMessage } from "@/lib/ser";
import { sendPushNotification } from "@/lib/push";


const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const { caseId: caseIdStr } = await params;
  const caseId = parseInt(caseIdStr, 10);
  if (isNaN(caseId)) return NextResponse.json({ error: "Invalid case ID" }, { status: 400 });

  const staff = await currentUser();
  const client = await currentClient();

  if (!staff && !client) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  // threadType is always CLIENT — the AGENT thread has been removed.
  const threadType = "CLIENT" as const;
  const text = formData.get("text") ? String(formData.get("text")).trim() : null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File is required" }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds 25 MB limit." }, { status: 400 });
  }

  let senderType: "STAFF" | "CLIENT" = "STAFF";
  let senderId: number | null = null;
  let senderName = "HFMC Team";

  // Staff session wins — same laptop can hold a stale client cookie.
  if (staff) {
    const flags = await flagsFor(staff);
    if (!flags.clientChat && !flags.admin && !flags.super) {
      return NextResponse.json({ error: "Your designation is not permitted to reply in chat. Ask an admin to enable Chat in Admin → Designations." }, { status: 403 });
    }
    senderType = "STAFF";
    senderId = staff.id;
    senderName = staff.name;
  } else if (client) {
    const { clientCanAccessCase } = await import("@/lib/chat-auth");
    if (!(await clientCanAccessCase(client, caseId)))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    senderType = "CLIENT";
    senderId = null;
    senderName = client.customer || "You";
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "application/octet-stream";
  const originalName = file.name;

  let storageKey: string | null = null;
  if (r2Configured()) {
    storageKey = docKey(caseId, 0, originalName);
    await r2Put(storageKey, bytes, mime);
  }

  // 1. Create CaseDocument row in Doc Vault
  const doc = await db.caseDocument.create({
    data: {
      caseId,
      title: originalName,
      displayName: originalName,
      category: "Chat",
      source: "chat",
      storageKey,
      fileData: storageKey ? null : bytes, // fallback if R2 not configured
      fileName: originalName,
      fileSize: file.size,
      fileType: mime,
      status: "Uploaded",
      mandatory: false,
      visibleToClient: threadType === "CLIENT",
      clientCanUpload: true,
      uploadedByKind: senderType.toLowerCase(),
      uploadedById: senderId,
      uploadedAt: new Date(),
    },
  });

  // 2. Create ChatMessage
  const message = await db.chatMessage.create({
    data: {
      caseId,
      senderId,
      senderType,
      senderName,
      threadType,
      text,
      attachmentKey: storageKey,
      attachmentName: originalName,
      attachmentSize: file.size,
      mimeType: mime,
      readByStaff: senderType === "STAFF",
      readByExternal: senderType !== "STAFF",
    },
  });

  await db.activity.create({
    data: {
      caseId,
      userId: senderId ?? 1,
      action: `uploaded document via chat: ${originalName} (${senderName})`,
    },
  }).catch(() => {});

  // 3. Dispatch Web Push notification
  try {
    const pushBody = text ? `${text} (📎 ${originalName})` : `📎 ${originalName}`;
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
              title: `📎 ${senderName} uploaded document (${c.caseNumber})`,
              body: pushBody,
              url: `/`,
            }
          ).catch(() => {});
        }
      }
    } else if (senderType === "STAFF") {
      // Sibling-aware push so the client gets it on any journey.
      const { siblingCaseIds } = await import("@/lib/chat-auth");
      const targets = await siblingCaseIds(caseId);
      for (const targetCaseId of targets) {
        sendPushNotification(
          { caseId: targetCaseId },
          {
            title: `📎 ${senderName} — HFMC sent a document`,
            body: pushBody,
            url: `/client`,
          }
        ).catch(() => {});
      }
    }
  } catch {}

  return NextResponse.json({
    item: serChatMessage({ ...message, documentId: doc.id }),
    document: serCaseDocument(doc),
  });
}
