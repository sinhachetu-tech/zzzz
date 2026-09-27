// notification-settings.ts — read/write all notification & email-provider config from AppSetting.
// Admin → Settings → Notifications / Integrations / Chat.
import { db } from "@/lib/db";

/** Email provider options */
export type EmailProvider = "disabled" | "resend" | "smtp";

export interface NotificationSettings {
  // ── Email provider ──────────────────────────────────────────────
  emailProvider: EmailProvider;           // "disabled" | "resend" | "smtp"
  emailFromName: string;                  // "HFMC Mortgage Team"
  emailFromAddress: string;               // "noreply@hfmc.ae"
  resendApiKey: string;                   // only used when provider=resend
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpTls: "starttls" | "ssl" | "none";

  // ── Chat history ─────────────────────────────────────────────────
  chatRetentionMode: "forever" | "months" | "manual";
  chatRetentionMonths: number;            // only used when mode=months

  // ── Global notification defaults (per audience × channel) ────────
  notifClientPush: boolean;
  notifClientWhatsapp: boolean;
  notifClientEmail: boolean;
  notifStaffPush: boolean;
  notifStaffWhatsapp: boolean;
  notifStaffEmail: boolean;
  notifAgentPush: boolean;
  notifAgentWhatsapp: boolean;
  notifAgentEmail: boolean;

  // ── Sound ───────────────────────────────────────────────────────
  notifSoundEnabled: boolean;
  notifSoundVolume: number;               // 0–100

  // ── Staff event switches ─────────────────────────────────────────
  notifStaffOnClientChat: boolean;
  notifStaffOnAgentChat: boolean;
  notifStaffOnTaskAssigned: boolean;
  notifStaffOnTaskOverdue: boolean;
  notifStaffOnDocUpload: boolean;
  notifStaffOnStageChange: boolean;
  notifStaffOnLeadAssigned: boolean;

  // ── Client event switches ────────────────────────────────────────
  notifClientOnStaffReply: boolean;
  notifClientOnDocRequest: boolean;
  notifClientOnStageChange: boolean;

  // ── Agent event switches ─────────────────────────────────────────
  notifAgentOnStaffReply: boolean;
  notifAgentOnStageChange: boolean;
  notifAgentOnCommission: boolean;
}

const DEFAULTS: NotificationSettings = {
  emailProvider: "disabled",
  emailFromName: "HFMC Mortgage Team",
  emailFromAddress: "noreply@hfmc.ae",
  resendApiKey: "",
  smtpHost: "",
  smtpPort: 587,
  smtpUser: "",
  smtpPass: "",
  smtpTls: "starttls",
  chatRetentionMode: "forever",
  chatRetentionMonths: 12,
  notifClientPush: true,
  notifClientWhatsapp: true,
  notifClientEmail: false,
  notifStaffPush: true,
  notifStaffWhatsapp: true,
  notifStaffEmail: false,
  notifAgentPush: true,
  notifAgentWhatsapp: false,
  notifAgentEmail: false,
  notifSoundEnabled: true,
  notifSoundVolume: 30,
  notifStaffOnClientChat: true,
  notifStaffOnAgentChat: true,
  notifStaffOnTaskAssigned: true,
  notifStaffOnTaskOverdue: true,
  notifStaffOnDocUpload: true,
  notifStaffOnStageChange: false,
  notifStaffOnLeadAssigned: false,
  notifClientOnStaffReply: true,
  notifClientOnDocRequest: true,
  notifClientOnStageChange: true,
  notifAgentOnStaffReply: true,
  notifAgentOnStageChange: true,
  notifAgentOnCommission: true,
};

function bool(map: Map<string, string>, key: string, def: boolean): boolean {
  const v = map.get(key);
  if (v === undefined) return def;
  return v === "true";
}
function num(map: Map<string, string>, key: string, def: number): number {
  const v = map.get(key);
  if (v === undefined || isNaN(Number(v))) return def;
  return Number(v);
}
function str<T extends string>(map: Map<string, string>, key: string, def: T): T {
  return (map.get(key) as T) ?? def;
}

export async function getNotificationSettings(): Promise<NotificationSettings> {
  const rows = await db.appSetting.findMany({ where: { key: { startsWith: "notif_" } } });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    emailProvider:           str(map, "notif_emailProvider",           DEFAULTS.emailProvider),
    emailFromName:           str(map, "notif_emailFromName",           DEFAULTS.emailFromName),
    emailFromAddress:        str(map, "notif_emailFromAddress",        DEFAULTS.emailFromAddress),
    resendApiKey:            str(map, "notif_resendApiKey",            DEFAULTS.resendApiKey),
    smtpHost:                str(map, "notif_smtpHost",                DEFAULTS.smtpHost),
    smtpPort:                num(map, "notif_smtpPort",                DEFAULTS.smtpPort),
    smtpUser:                str(map, "notif_smtpUser",                DEFAULTS.smtpUser),
    smtpPass:                str(map, "notif_smtpPass",                DEFAULTS.smtpPass),
    smtpTls:                 str(map, "notif_smtpTls",                 DEFAULTS.smtpTls),
    chatRetentionMode:       str(map, "notif_chatRetentionMode",       DEFAULTS.chatRetentionMode),
    chatRetentionMonths:     num(map, "notif_chatRetentionMonths",     DEFAULTS.chatRetentionMonths),
    notifClientPush:         bool(map, "notif_clientPush",             DEFAULTS.notifClientPush),
    notifClientWhatsapp:     bool(map, "notif_clientWhatsapp",         DEFAULTS.notifClientWhatsapp),
    notifClientEmail:        bool(map, "notif_clientEmail",            DEFAULTS.notifClientEmail),
    notifStaffPush:          bool(map, "notif_staffPush",              DEFAULTS.notifStaffPush),
    notifStaffWhatsapp:      bool(map, "notif_staffWhatsapp",          DEFAULTS.notifStaffWhatsapp),
    notifStaffEmail:         bool(map, "notif_staffEmail",             DEFAULTS.notifStaffEmail),
    notifAgentPush:          bool(map, "notif_agentPush",              DEFAULTS.notifAgentPush),
    notifAgentWhatsapp:      bool(map, "notif_agentWhatsapp",          DEFAULTS.notifAgentWhatsapp),
    notifAgentEmail:         bool(map, "notif_agentEmail",             DEFAULTS.notifAgentEmail),
    notifSoundEnabled:       bool(map, "notif_soundEnabled",           DEFAULTS.notifSoundEnabled),
    notifSoundVolume:        num(map, "notif_soundVolume",             DEFAULTS.notifSoundVolume),
    notifStaffOnClientChat:  bool(map, "notif_staffOnClientChat",      DEFAULTS.notifStaffOnClientChat),
    notifStaffOnAgentChat:   bool(map, "notif_staffOnAgentChat",       DEFAULTS.notifStaffOnAgentChat),
    notifStaffOnTaskAssigned:bool(map, "notif_staffOnTaskAssigned",    DEFAULTS.notifStaffOnTaskAssigned),
    notifStaffOnTaskOverdue: bool(map, "notif_staffOnTaskOverdue",     DEFAULTS.notifStaffOnTaskOverdue),
    notifStaffOnDocUpload:   bool(map, "notif_staffOnDocUpload",       DEFAULTS.notifStaffOnDocUpload),
    notifStaffOnStageChange: bool(map, "notif_staffOnStageChange",     DEFAULTS.notifStaffOnStageChange),
    notifStaffOnLeadAssigned:bool(map, "notif_staffOnLeadAssigned",    DEFAULTS.notifStaffOnLeadAssigned),
    notifClientOnStaffReply: bool(map, "notif_clientOnStaffReply",     DEFAULTS.notifClientOnStaffReply),
    notifClientOnDocRequest: bool(map, "notif_clientOnDocRequest",     DEFAULTS.notifClientOnDocRequest),
    notifClientOnStageChange:bool(map, "notif_clientOnStageChange",    DEFAULTS.notifClientOnStageChange),
    notifAgentOnStaffReply:  bool(map, "notif_agentOnStaffReply",      DEFAULTS.notifAgentOnStaffReply),
    notifAgentOnStageChange: bool(map, "notif_agentOnStageChange",     DEFAULTS.notifAgentOnStageChange),
    notifAgentOnCommission:  bool(map, "notif_agentOnCommission",      DEFAULTS.notifAgentOnCommission),
  };
}

export async function saveNotificationSettings(patch: Partial<NotificationSettings>): Promise<void> {
  const entries: [string, string][] = [];
  const set = (key: string, val: string | boolean | number | undefined) => {
    if (val !== undefined) entries.push([key, String(val)]);
  };
  set("notif_emailProvider",            patch.emailProvider);
  set("notif_emailFromName",            patch.emailFromName);
  set("notif_emailFromAddress",         patch.emailFromAddress);
  set("notif_resendApiKey",             patch.resendApiKey);
  set("notif_smtpHost",                 patch.smtpHost);
  set("notif_smtpPort",                 patch.smtpPort);
  set("notif_smtpUser",                 patch.smtpUser);
  set("notif_smtpPass",                 patch.smtpPass);
  set("notif_smtpTls",                  patch.smtpTls);
  set("notif_chatRetentionMode",        patch.chatRetentionMode);
  set("notif_chatRetentionMonths",      patch.chatRetentionMonths);
  set("notif_clientPush",               patch.notifClientPush);
  set("notif_clientWhatsapp",           patch.notifClientWhatsapp);
  set("notif_clientEmail",              patch.notifClientEmail);
  set("notif_staffPush",                patch.notifStaffPush);
  set("notif_staffWhatsapp",            patch.notifStaffWhatsapp);
  set("notif_staffEmail",               patch.notifStaffEmail);
  set("notif_agentPush",                patch.notifAgentPush);
  set("notif_agentWhatsapp",            patch.notifAgentWhatsapp);
  set("notif_agentEmail",               patch.notifAgentEmail);
  set("notif_soundEnabled",             patch.notifSoundEnabled);
  set("notif_soundVolume",              patch.notifSoundVolume);
  set("notif_staffOnClientChat",        patch.notifStaffOnClientChat);
  set("notif_staffOnAgentChat",         patch.notifStaffOnAgentChat);
  set("notif_staffOnTaskAssigned",      patch.notifStaffOnTaskAssigned);
  set("notif_staffOnTaskOverdue",       patch.notifStaffOnTaskOverdue);
  set("notif_staffOnDocUpload",         patch.notifStaffOnDocUpload);
  set("notif_staffOnStageChange",       patch.notifStaffOnStageChange);
  set("notif_staffOnLeadAssigned",      patch.notifStaffOnLeadAssigned);
  set("notif_clientOnStaffReply",       patch.notifClientOnStaffReply);
  set("notif_clientOnDocRequest",       patch.notifClientOnDocRequest);
  set("notif_clientOnStageChange",      patch.notifClientOnStageChange);
  set("notif_agentOnStaffReply",        patch.notifAgentOnStaffReply);
  set("notif_agentOnStageChange",       patch.notifAgentOnStageChange);
  set("notif_agentOnCommission",        patch.notifAgentOnCommission);
  for (const [key, value] of entries) {
    await db.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
}
