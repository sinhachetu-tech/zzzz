// GET/PUT /api/admin/notification-settings
// Admin → Settings → Notifications / Integrations / Chat
import { NextRequest, NextResponse } from "next/server";
import { currentUser, flagsFor } from "@/lib/auth";
import { getNotificationSettings, saveNotificationSettings } from "@/lib/notification-settings";

export async function GET() {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const settings = await getNotificationSettings();
  // Mask secrets — return placeholder for API keys/passwords.
  // NOTE: shape is { settings } (wrapped) — the admin UI unwraps it.
  return NextResponse.json({
    settings: {
      ...settings,
      resendApiKey: settings.resendApiKey ? "••••••••" : "",
      smtpPass: settings.smtpPass ? "••••••••" : "",
    },
  });
}

export async function PUT(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!flags.admin && !flags.super) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json() as Record<string, unknown>;
  // Only save non-masked secrets (front-end sends the real key when changed)
  const patch = { ...body } as Record<string, unknown>;
  if (patch.resendApiKey === "••••••••") delete patch.resendApiKey;
  if (patch.smtpPass === "••••••••") delete patch.smtpPass;

  await saveNotificationSettings(patch);
  const settings = await getNotificationSettings();
  return NextResponse.json({
    settings: {
      ...settings,
      resendApiKey: settings.resendApiKey ? "••••••••" : "",
      smtpPass: settings.smtpPass ? "••••••••" : "",
    },
  });
}
