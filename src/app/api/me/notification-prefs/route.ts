// GET/PUT /api/me/notification-prefs
// Personal notification preferences per staff member.
// Stored in AppSetting as "userNotifPrefs:{userId}" JSON.
import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export interface UserNotificationPrefs {
  // Per-event toggles
  chatPush: boolean;
  chatEmail: boolean;
  chatSound: boolean;
  taskAssignedPush: boolean;
  taskAssignedEmail: boolean;
  taskAssignedSound: boolean;
  taskOverduePush: boolean;
  taskOverdueEmail: boolean;
  taskOverdueSound: boolean;
  docUploadPush: boolean;
  docUploadEmail: boolean;
  docUploadSound: boolean;
  stageChangePush: boolean;
  stageChangeEmail: boolean;
  stageChangeSound: boolean;
  // Quiet hours
  quietHoursEnabled: boolean;
  quietHoursFrom: string;  // "22:00"
  quietHoursTo: string;    // "07:00"
  // Sound master
  soundEnabled: boolean;
}

const DEFAULTS: UserNotificationPrefs = {
  chatPush: true,
  chatEmail: false,
  chatSound: true,
  taskAssignedPush: true,
  taskAssignedEmail: true,
  taskAssignedSound: true,
  taskOverduePush: true,
  taskOverdueEmail: false,
  taskOverdueSound: true,
  docUploadPush: true,
  docUploadEmail: false,
  docUploadSound: false,
  stageChangePush: false,
  stageChangeEmail: false,
  stageChangeSound: false,
  quietHoursEnabled: false,
  quietHoursFrom: "22:00",
  quietHoursTo: "07:00",
  soundEnabled: true,
};

function settingKey(userId: number) {
  return `userNotifPrefs:${userId}`;
}

async function loadPrefs(userId: number): Promise<UserNotificationPrefs> {
  const row = await db.appSetting.findUnique({ where: { key: settingKey(userId) } });
  if (!row) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(row.value) } as UserNotificationPrefs;
  } catch {
    return { ...DEFAULTS };
  }
}

export async function GET() {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const prefs = await loadPrefs(me.id);
  // Also load this user's registered devices for "My devices" list
  const devices = await db.userDevice.findMany({
    where: { userId: me.id },
    orderBy: { lastSeenAt: "desc" },
  });
  return NextResponse.json({
    prefs,
    devices: devices.map((d) => ({
      id: d.id,
      deviceType: d.deviceType ?? "desktop",
      pwaInstalled: d.pwaInstalled,
      hasPush: !!d.pushEndpoint,
      installedAt: d.installedAt?.toISOString() ?? null,
      lastSeenAt: d.lastSeenAt.toISOString(),
      userAgent: d.userAgent ?? null,
    })),
  });
}

export async function PUT(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json() as Partial<UserNotificationPrefs>;
  const current = await loadPrefs(me.id);
  const merged = { ...current, ...body };
  const key = settingKey(me.id);
  await db.appSetting.upsert({
    where: { key },
    create: { key, value: JSON.stringify(merged) },
    update: { value: JSON.stringify(merged) },
  });
  return NextResponse.json({ prefs: merged });
}

// DELETE one specific device from "My devices"
export async function DELETE(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("deviceId"));
  if (!id) return NextResponse.json({ error: "deviceId required" }, { status: 400 });
  // Only allow deleting own devices
  const device = await db.userDevice.findUnique({ where: { id } });
  if (!device || device.userId !== me.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  await db.userDevice.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
