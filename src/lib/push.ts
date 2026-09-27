import webpush from "web-push";
import { db } from "@/lib/db";
import { getNotificationSettings } from "@/lib/notification-settings";
import { sendEmail, chatEmailHtml } from "@/lib/email";

// Default VAPID details (can be configured in .env or auto-initialized)
const VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY ||
  "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
const VAPID_PRIVATE_KEY =
  process.env.VAPID_PRIVATE_KEY ||
  "UUxI2q4sK-VqL6_0kZq633_Fz6Mvd2B1Z6wF3Y_eP9U";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:dev@hfmc.ae";

try {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} catch {}

export function getVapidPublicKey() {
  return VAPID_PUBLIC_KEY;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  icon?: string;
}

/** Send Web Push to all registered devices matching user or case */
export async function sendPushNotification(
  target: { userId?: number; caseId?: number },
  payload: PushPayload
) {
  try {
    const devices = await db.userDevice.findMany({
      where: {
        ...(target.userId ? { userId: target.userId } : {}),
        ...(target.caseId ? { caseId: target.caseId } : {}),
        pushEndpoint: { not: null },
      },
    });

    const notifications = devices.map(async (device) => {
      if (!device.pushEndpoint || !device.pushP256dh || !device.pushAuth) return;

      const sub = {
        endpoint: device.pushEndpoint,
        keys: {
          p256dh: device.pushP256dh,
          auth: device.pushAuth,
        },
      };

      try {
        await webpush.sendNotification(sub, JSON.stringify(payload));
      } catch (err: unknown) {
        // If subscription has expired or is invalid (404/410), delete it
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await db.userDevice.delete({ where: { id: device.id } }).catch(() => {});
        }
      }
    });

    await Promise.all(notifications);
  } catch {}
}

/* ------------------------------------------------------------------ */
/*  Notification chain: push → email (respects admin settings)        */
/* ------------------------------------------------------------------ */

export type Audience = "staff" | "client" | "agent";

export interface NotifyOpts {
  /** Who should receive the notification */
  audience: Audience;
  /** Target user ID (for staff push / email lookup) */
  userId?: number;
  /** Target case ID (for case-scoped push subscriptions) */
  caseId?: number;
  /** Recipient email (for email fallback; resolved from userId if omitted) */
  email?: string;
  /** Push payload */
  push: PushPayload;
  /** Optional: email details (auto-built from push payload if omitted) */
  emailSubject?: string;
  emailText?: string;
  emailHtml?: string;
  /** Context for building chat-style email */
  chatContext?: {
    caseName: string;
    caseNumber: string;
    senderName: string;
    message: string;
    url: string;
  };
}

/**
 * Sends notifications through the configured chain:
 * 1. Web Push (if enabled for the audience)
 * 2. Email (if enabled for the audience and configured)
 *
 * Never throws — fire-and-forget safe.
 */
export async function sendNotificationChain(opts: NotifyOpts): Promise<void> {
  try {
    const cfg = await getNotificationSettings();

    const pushEnabled =
      opts.audience === "staff"  ? cfg.notifStaffPush :
      opts.audience === "client" ? cfg.notifClientPush :
      cfg.notifAgentPush;

    const emailEnabled =
      opts.audience === "staff"  ? cfg.notifStaffEmail :
      opts.audience === "client" ? cfg.notifClientEmail :
      cfg.notifAgentEmail;

    // 1. Web Push
    if (pushEnabled) {
      await sendPushNotification(
        { userId: opts.userId, caseId: opts.caseId },
        opts.push
      );
    }

    // 2. Email fallback
    if (emailEnabled) {
      let toEmail = opts.email;
      if (!toEmail && opts.userId) {
        const user = await db.user.findUnique({ where: { id: opts.userId }, select: { email: true } });
        toEmail = user?.email;
      }
      if (toEmail) {
        const subject = opts.emailSubject ?? opts.push.title;
        const text = opts.emailText ?? opts.push.body;
        const html = opts.emailHtml ??
          (opts.chatContext ? chatEmailHtml(opts.chatContext) : undefined);

        await sendEmail({ to: toEmail, subject, text, html });
      }
    }
  } catch {}
}
