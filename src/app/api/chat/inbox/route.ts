import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { visibleCases } from "@/lib/domain";
import { serCase } from "@/lib/ser";

// GET /api/chat/inbox
// Returns aggregated case threads with unread counts and latest messages for staff
export async function GET() {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const flags = await flagsFor(me);
  const [allCasesRaw, allUsers] = await Promise.all([
    db.loanCase.findMany({ orderBy: { updatedAt: "desc" } }),
    db.user.findMany({ select: { id: true, name: true, email: true, role: true, team: true, active: true, createdAt: true, phone: true } }),
  ]);

  const allCases = allCasesRaw.map(serCase);
  const allowed = visibleCases(allCases, allUsers.map((u) => ({ ...u, password: "", createdAt: u.createdAt.toISOString() })), { ...me, active: true, password: "", createdAt: new Date().toISOString() }, flags);
  const allowedIds = new Set(allowed.map((c) => c.id));

  // Fetch recent messages across visible cases
  const messages = await db.chatMessage.findMany({
    where: { caseId: { in: Array.from(allowedIds) } },
    orderBy: { sentAt: "desc" },
    take: 300,
  });

  // Group by caseId and threadType
  const threadsMap = new Map<string, {
    caseId: number;
    caseNumber: string;
    customer: string;
    threadType: "CLIENT" | "AGENT";
    unreadCount: number;
    lastMessage: {
      text: string | null;
      attachmentName: string | null;
      senderName: string;
      senderType: string;
      sentAt: string;
    };
  }>();

  for (const m of messages) {
    const key = `${m.caseId}_${m.threadType}`;
    const targetCase = allowed.find((c) => c.id === m.caseId);
    if (!targetCase) continue;

    if (!threadsMap.has(key)) {
      threadsMap.set(key, {
        caseId: m.caseId,
        caseNumber: targetCase.caseNumber,
        customer: targetCase.customer,
        threadType: m.threadType as "CLIENT" | "AGENT",
        unreadCount: 0,
        lastMessage: {
          text: m.text,
          attachmentName: m.attachmentName,
          senderName: m.senderName,
          senderType: m.senderType,
          sentAt: m.sentAt.toISOString(),
        },
      });
    }

    if (!m.readByStaff) {
      const thread = threadsMap.get(key)!;
      thread.unreadCount += 1;
    }
  }

  const threads = Array.from(threadsMap.values()).sort(
    (a, b) => new Date(b.lastMessage.sentAt).getTime() - new Date(a.lastMessage.sentAt).getTime()
  );

  const totalUnread = threads.reduce((acc, t) => acc + t.unreadCount, 0);

  return NextResponse.json({
    totalUnread,
    threads,
  });
}
