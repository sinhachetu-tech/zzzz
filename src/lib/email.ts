// email.ts — outbound email sender respecting the admin-configured provider.
// Supports Resend (API) and SMTP (nodemailer). Falls back silently when disabled.
// Never throws — caller does not need try/catch.

import { getNotificationSettings } from "@/lib/notification-settings";

export interface EmailMessage {
  to: string;            // recipient email
  subject: string;
  text: string;          // plain-text fallback
  html?: string;         // richer HTML body (optional)
}

export type EmailResult =
  | { sent: true }
  | { sent: false; reason: string };

export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  try {
    const cfg = await getNotificationSettings();

    if (cfg.emailProvider === "disabled") {
      return { sent: false, reason: "email provider is disabled" };
    }

    const from = `${cfg.emailFromName} <${cfg.emailFromAddress}>`;

    // ── Resend ────────────────────────────────────────────────────
    if (cfg.emailProvider === "resend") {
      if (!cfg.resendApiKey) return { sent: false, reason: "Resend API key not configured" };
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [msg.to],
          subject: msg.subject,
          text: msg.text,
          ...(msg.html ? { html: msg.html } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { message?: string };
        return { sent: false, reason: err.message ?? `Resend HTTP ${res.status}` };
      }
      return { sent: true };
    }

    // ── SMTP (nodemailer) ─────────────────────────────────────────
    if (cfg.emailProvider === "smtp") {
      if (!cfg.smtpHost || !cfg.smtpUser) {
        return { sent: false, reason: "SMTP not fully configured" };
      }
      // Dynamic import — nodemailer is only used when actually needed.
      // @ts-ignore
      const nodemailer: any = await import("nodemailer").catch(() => null);
      if (!nodemailer) return { sent: false, reason: "nodemailer not installed" };

      const secure = cfg.smtpTls === "ssl";
      const requireTls = cfg.smtpTls === "starttls";

      const transport = (nodemailer.default || nodemailer).createTransport({
        host: cfg.smtpHost,
        port: cfg.smtpPort,
        secure,
        requireTLS: requireTls,
        auth: { user: cfg.smtpUser, pass: cfg.smtpPass },
      });

      await transport.sendMail({
        from,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        ...(msg.html ? { html: msg.html } : {}),
      });
      return { sent: true };
    }

    return { sent: false, reason: "unknown email provider" };
  } catch (err) {
    return { sent: false, reason: err instanceof Error ? err.message : "unknown error" };
  }
}

/** Quick HTML wrapper for chat notification emails */
export function chatEmailHtml(opts: {
  caseName: string;
  caseNumber: string;
  senderName: string;
  message: string;
  url: string;
}): string {
  return `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a">
  <p style="font-size:13px;color:#666;margin:0 0 16px">HFMC Mortgage · Case ${opts.caseNumber}</p>
  <h2 style="margin:0 0 8px;font-size:17px">New message from ${opts.senderName}</h2>
  <p style="font-size:14px;background:#f4f4f4;border-radius:8px;padding:14px;margin:0 0 20px">${opts.message}</p>
  <a href="${opts.url}" style="display:inline-block;background:#f2b04c;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">Open chat →</a>
  <p style="font-size:11px;color:#aaa;margin-top:24px">You received this because your notification settings include email. Manage them in My Account.</p>
</body>
</html>`;
}
