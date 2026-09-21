// Admin-configured portal settings (AppSetting key-value rows).
// Decided in Admin → Portal settings; consumed by the client portal
// (default advisor) and the agent portal (mortgage desk card).
import { db } from "@/lib/db";

export interface PortalSettings {
  clientPortalAdvisorId: number | null; // fallback advisor when a case has none
  clientFacingUserId: number | null; // staff (usually senior) whose name+number pair fronts all client advisor cards
  clientPortalWhatsapp: string; // free-text fallback number when no facing staff is picked
  agentDeskUserId: number | null; // staff whose name+number pair fronts the agent desk card
  agentDeskName: string; // free-text fallback when no desk staff is picked
  agentDeskPhone: string; // free-text fallback when no desk staff is picked
}

const DEFAULTS: PortalSettings = {
  clientPortalAdvisorId: null,
  clientFacingUserId: null,
  clientPortalWhatsapp: "",
  agentDeskUserId: null,
  agentDeskName: "HFMC Partnership Team",
  agentDeskPhone: "",
};

export async function getPortalSettings(): Promise<PortalSettings> {
  const rows = await db.appSetting.findMany();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const advisorRaw = map.get("clientPortalAdvisorId") ?? "";
  const facingRaw = map.get("clientFacingUserId") ?? "";
  const deskUserRaw = map.get("agentDeskUserId") ?? "";
  const advisorId = advisorRaw && !isNaN(Number(advisorRaw)) ? Number(advisorRaw) : null;
  return {
    clientPortalAdvisorId: advisorId,
    clientFacingUserId: facingRaw && !isNaN(Number(facingRaw)) ? Number(facingRaw) : null,
    clientPortalWhatsapp: map.get("clientPortalWhatsapp") || DEFAULTS.clientPortalWhatsapp,
    agentDeskUserId: deskUserRaw && !isNaN(Number(deskUserRaw)) ? Number(deskUserRaw) : null,
    agentDeskName: map.get("agentDeskName") || DEFAULTS.agentDeskName,
    agentDeskPhone: map.get("agentDeskPhone") || DEFAULTS.agentDeskPhone,
  };
}

export async function savePortalSettings(patch: Partial<PortalSettings>): Promise<PortalSettings> {
  const entries: [string, string][] = [];
  if (patch.clientPortalAdvisorId !== undefined) entries.push(["clientPortalAdvisorId", patch.clientPortalAdvisorId ? String(patch.clientPortalAdvisorId) : ""]);
  if (patch.clientFacingUserId !== undefined) entries.push(["clientFacingUserId", patch.clientFacingUserId ? String(patch.clientFacingUserId) : ""]);
  if (patch.clientPortalWhatsapp !== undefined) entries.push(["clientPortalWhatsapp", patch.clientPortalWhatsapp.trim()]);
  if (patch.agentDeskUserId !== undefined) entries.push(["agentDeskUserId", patch.agentDeskUserId ? String(patch.agentDeskUserId) : ""]);
  if (patch.agentDeskName !== undefined) entries.push(["agentDeskName", patch.agentDeskName.trim()]);
  if (patch.agentDeskPhone !== undefined) entries.push(["agentDeskPhone", patch.agentDeskPhone.trim()]);
  for (const [key, value] of entries) {
    await db.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
  return getPortalSettings();
}
