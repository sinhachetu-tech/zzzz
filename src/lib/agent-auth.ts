// Agent portal auth — agents log in with email + password (same as team but
// matched against PartnerItem records instead of User records).
import { cookies } from "next/headers";
import { db } from "@/lib/db";

export const AGENT_SESSION_COOKIE = "hfmc_agent_session";
const AGENT_SESSION_TTL_DAYS = 30;

export interface AgentSessionUser {
  partnerId: number;
  name: string;
  kind: string;
  email: string;
}

// Simple agent auth — agents are stored as PartnerItem with an email+password.
// For now, we use a simple password stored on the PartnerItem (extended).
// In production, this would be bcrypt + a proper auth flow.
export async function agentLogin(email: string, password: string): Promise<{ ok: true; user: AgentSessionUser } | { ok: false; error: string }> {
  // Partners log in with their registered name + the password set in Admin → Partners
  const partners = await db.partnerItem.findMany({ where: { active: true } });
  const partner = partners.find((p) => p.name.toLowerCase() === email.trim().toLowerCase());
  if (!partner) return { ok: false, error: "Agent not found. Check your name with the team." };
  if (!password || password !== partner.password) return { ok: false, error: "Wrong password." };
  const sid = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + AGENT_SESSION_TTL_DAYS * 86400000);
  // Reuse the client session table with a different cookie name
  const store = await cookies();
  store.set(AGENT_SESSION_COOKIE, JSON.stringify({ partnerId: partner.id, name: partner.name, kind: partner.kind }), { httpOnly: true, sameSite: "lax", path: "/", expires: expiresAt });
  return { ok: true, user: { partnerId: partner.id, name: partner.name, kind: partner.kind, email: partner.name } };
}

export async function currentAgent(): Promise<AgentSessionUser | null> {
  const store = await cookies();
  const raw = store.get(AGENT_SESSION_COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AgentSessionUser;
  } catch {
    return null;
  }
}

export async function agentLogout(): Promise<void> {
  const store = await cookies();
  store.delete(AGENT_SESSION_COOKIE);
}
