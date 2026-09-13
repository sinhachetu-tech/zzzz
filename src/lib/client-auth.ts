// Client portal auth — login with phone (last 4 digits) + case number.
// No password — clients don't remember passwords. The case number is the key.
import { cookies } from "next/headers";
import { db } from "@/lib/db";

export const CLIENT_SESSION_COOKIE = "hfmc_client_session";
const CLIENT_SESSION_TTL_DAYS = 30;

export interface ClientSessionUser {
  caseId: number;
  phone: string; // last 4 digits
  caseNumber: string;
  customer: string;
}

export async function clientLogin(caseNumber: string, phoneLast4: string): Promise<{ ok: true; user: ClientSessionUser } | { ok: false; error: string }> {
  const c = await db.loanCase.findUnique({ where: { caseNumber: caseNumber.trim().toUpperCase() } });
  if (!c) return { ok: false, error: "Case not found. Check your case number (e.g. HFMC-0001)." };

  // Match last 4 digits of the WhatsApp/phone on file
  const phoneDigits = c.whatsapp.replace(/\D/g, "");
  const last4 = phoneDigits.slice(-4);
  if (!last4) return { ok: false, error: "No phone number on file. Please contact your advisor." };
  if (phoneLast4.trim() !== last4) return { ok: false, error: "Phone digits don't match our records." };

  const sid = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + CLIENT_SESSION_TTL_DAYS * 86400000);
  await db.clientSession.create({ data: { id: sid, caseId: c.id, phone: last4, expiresAt } });
  const store = await cookies();
  store.set(CLIENT_SESSION_COOKIE, sid, { httpOnly: true, sameSite: "lax", path: "/", expires: expiresAt });
  return { ok: true, user: { caseId: c.id, phone: last4, caseNumber: c.caseNumber, customer: c.customer } };
}

export async function clientLogout(): Promise<void> {
  const store = await cookies();
  const sid = store.get(CLIENT_SESSION_COOKIE)?.value;
  if (sid) {
    await db.clientSession.deleteMany({ where: { id: sid } }).catch(() => {});
    store.delete(CLIENT_SESSION_COOKIE);
  }
}

export async function currentClient(): Promise<ClientSessionUser | null> {
  const store = await cookies();
  const sid = store.get(CLIENT_SESSION_COOKIE)?.value;
  if (!sid) return null;
  const session = await db.clientSession.findUnique({ where: { id: sid }, include: { case: true } });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await db.clientSession.delete({ where: { id: sid } }).catch(() => {});
    return null;
  }
  return { caseId: session.caseId, phone: session.phone, caseNumber: session.case.caseNumber, customer: session.case.customer };
}
