// POST /api/graph/send — send email via Microsoft Graph with attachments from vault.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { requireDocManager } from "@/lib/domain";
import { sendMailGraph, refreshGraphToken, getFileBase64FromR2 } from "@/lib/graph";

export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const flags = await flagsFor(me);
  if (!(await requireDocManager(me, flags))) {
    return NextResponse.json({ error: "Your designation does not allow document operations." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { to, cc, bcc, subject, bodyHtml, bodyText, docIds, saveToSentItems } = body;

  if (!to || !Array.isArray(to) || to.length === 0) {
    return NextResponse.json({ error: "At least one recipient required" }, { status: 400 });
  }
  if (!subject || !bodyHtml) {
    return NextResponse.json({ error: "Subject and body required" }, { status: 400 });
  }

  // Get user's Graph tokens
  const user = await db.user.findUnique({
    where: { id: me.id },
    select: { graphAccessToken: true, graphRefreshToken: true, graphTokenExpiresAt: true, email: true },
  });

  if (!user?.graphAccessToken || !user?.graphRefreshToken) {
    return NextResponse.json({ error: "Outlook not connected — click Connect Outlook first" }, { status: 400 });
  }

  // Check token expiry, refresh if needed
  let accessToken = user.graphAccessToken;
  if (user.graphTokenExpiresAt && new Date(user.graphTokenExpiresAt).getTime() < Date.now() + 60_000) {
    try {
      const refreshed = await refreshGraphToken(user.graphRefreshToken);
      accessToken = refreshed.accessToken;
      await db.user.update({
        where: { id: me.id },
        data: {
          graphAccessToken: refreshed.accessToken,
          graphRefreshToken: refreshed.refreshToken,
          graphTokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
        },
      });
    } catch (e) {
      return NextResponse.json({ error: "Token refresh failed — reconnect Outlook" }, { status: 401 });
    }
  }

  // Fetch attachments from R2
  const attachments: { name: string; contentType: string; contentBytes: string }[] = [];
  if (docIds && Array.isArray(docIds) && docIds.length > 0) {
    const docs = await db.caseDocument.findMany({
      where: { id: { in: docIds } },
      select: { id: true, fileName: true, fileType: true, storageKey: true, compressedKey: true },
    });

    for (const doc of docs) {
      const key = doc.compressedKey || doc.storageKey;
      if (!key) continue;
      const file = await getFileBase64FromR2(key);
      if (file) {
        attachments.push({
          name: doc.fileName || "document",
          contentType: file.contentType,
          contentBytes: file.base64,
        });
      }
    }
  }

  try {
    await sendMailGraph(accessToken, {
      to,
      cc,
      bcc,
      subject,
      bodyHtml,
      bodyText,
      attachments,
      saveToSentItems: saveToSentItems ?? true,
    });

    await db.activity.create({
      data: {
        caseId: body.caseId || 0,
        userId: me.id,
        action: `sent email via Outlook to ${to.join(", ")} (${attachments.length} attachments)`,
      },
    });

    return NextResponse.json({ success: true, attachmentsSent: attachments.length });
  } catch (e) {
    console.error("Graph sendMail error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}