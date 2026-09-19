// Admin-configured portal settings (AppSetting key-value rows).
// Decided in Admin → Portal settings; consumed by the client portal
// (default advisor) and the agent portal (mortgage desk card).
import { db } from "@/lib/db";

export interface PortalSettings {
  clientPortalAdvisorId: number | null; // fallback advisor when a case has none
  agentDeskName: string; // staff representative shown to agents
  agentDeskPhone: string; // WhatsApp number on the agent desk card
}

const DEFAULTS: PortalSettings = {
  clientPortalAdvisorId: null,
  agentDeskName: "HFMC Partnership Team",
  agentDeskPhone: "",
};

export async function getPortalSettings(): Promise<PortalSettings> {
  const rows = await db.appSetting.findMany();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const advisorRaw = map.get("clientPortalAdvisorId") ?? "";
  const advisorId = advisorRaw && !isNaN(Number(advisorRaw)) ? Number(advisorRaw) : null;
  return {
    clientPortalAdvisorId: advisorId,
    agentDeskName: map.get("agentDeskName") || DEFAULTS.agentDeskName,
    agentDeskPhone: map.get("agentDeskPhone") || DEFAULTS.agentDeskPhone,
  };
}

export async function savePortalSettings(patch: Partial<PortalSettings>): Promise<PortalSettings> {
  const entries: [string, string][] = [];
  if (patch.clientPortalAdvisorId !== undefined) entries.push(["clientPortalAdvisorId", patch.clientPortalAdvisorId ? String(patch.clientPortalAdvisorId) : ""]);
  if (patch.agentDeskName !== undefined) entries.push(["agentDeskName", patch.agentDeskName.trim()]);
  if (patch.agentDeskPhone !== undefined) entries.push(["agentDeskPhone", patch.agentDeskPhone.trim()]);
  for (const [key, value] of entries) {
    await db.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
  return getPortalSettings();
}
