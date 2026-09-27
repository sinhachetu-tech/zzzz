// POST /api/admin/chat-purge — manual or retention-based message purge.
// Admin only. Deletes ChatMessage rows older than the configured retention window.
import { NextRequest, NextResponse } from "next/server";
import { currentUser, flagsFor } from "@/lib/auth";
import { db } from "@/lib/db";
import { getNotificationSettings } from "@/lib/notification-settings";

export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!flags.admin && !flags.super) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { months?: number };
  const cfg = await getNotificationSettings();

  // Determine cutoff: body.months overrides config (for manual purge with custom window)
  const months = body.months ?? (cfg.chatRetentionMode === "months" ? cfg.chatRetentionMonths : null);

  if (!months || months < 1) {
    return NextResponse.json({ error: "months must be >= 1" }, { status: 400 });
  }

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);

  const { count } = await db.chatMessage.deleteMany({
    where: { sentAt: { lt: cutoff } },
  });

  // Record purge time in AppSetting
  await db.appSetting.upsert({
    where: { key: "notif_lastChatPurge" },
    create: { key: "notif_lastChatPurge", value: new Date().toISOString() },
    update: { value: new Date().toISOString() },
  });

  return NextResponse.json({
    ok: true,
    deleted: count,
    cutoff: cutoff.toISOString(),
    purgedAt: new Date().toISOString(),
  });
}

export async function GET() {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const row = await db.appSetting.findUnique({ where: { key: "notif_lastChatPurge" } });
  const count = await db.chatMessage.count();
  return NextResponse.json({ lastPurge: row?.value ?? null, totalMessages: count });
}
