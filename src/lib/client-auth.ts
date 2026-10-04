// Client portal auth — login with phone (last 4 digits) + case number.
// No password — clients don't remember passwords. The case number is the key.
//
// PHASE 3 — THE SESSION IS CLIENT-SCOPED. A session used to be pinned to ONE
// case, which only worked because the firm sold one thing. Now a person can hold
// a mortgage AND a golden-visa case AND a will, and a person who has registered
// as a LEAD has no case to log in with at all. So:
//
//   clientId — WHO. The Client master row. Real identity.
//   caseId   — WHERE THEY STARTED. The anchor journey the portal opens on.
//
// Access is therefore NEVER `caseId === doc.caseId`. That check is now
// `clientOwnsCase()`, which resolves client scope with a legacy fallback for rows
// that predate the Client master (customer + phone only, and never for a row
// that HAS a clientId).
import { cookies } from "next/headers";
import { db } from "@/lib/db";

export const CLIENT_SESSION_COOKIE = "hfmc_client_session";
const CLIENT_SESSION_TTL_DAYS = 30;

export interface ClientSessionUser {
  /** The person. Null only for a legacy session whose case has no clientId yet. */
  clientId: number | null;
  /**
   * The journey they logged in on. NULLABLE as of Phase 4: a lead-only
   * registrant has a real session but no case yet. `clientId` is what
   * identifies them, which is precisely why Phase 3 had to land first.
   */
  caseId: number | null;
  phone: string; // last 4 digits
  /** Null until a lead is converted — the portal renders an empty state, not a crash. */
  caseNumber: string | null;
  /** Null until a lead is converted. */
  customer: string | null;
}

/**
 * Can this signed-in client reach this case? THE ONE ACCESS CHECK — every
 * client-facing route must use this instead of comparing case ids.
 *
 *   1. the anchor case itself
 *   2. a case whose clientId matches the session's (sibling bank legs, and from
 *      Phase 4 other service lines for the same person)
 *   3. LEGACY ONLY: neither side has a clientId and customer + phone match. Kept
 *      so rows written before the Client master existed keep working, and
 *      deliberately narrow — a row WITH a clientId never falls through to name
 *      matching, or a shared family phone would expose one member's documents to
 *      another.
 */
export async function clientOwnsCase(me: ClientSessionUser, caseId: number): Promise<boolean> {
  if (me.caseId === caseId) return true;
  try {
    let clientId = me.clientId;
    if (clientId == null) {
      // No clientId and no anchor case = a lead-only registrant (Phase 4). They
      // own nothing yet, so nothing is reachable.
      if (!me.caseId) return false;
      const anchor = await db.loanCase.findUnique({
        where: { id: me.caseId },
        select: { clientId: true, customer: true, whatsapp: true },
      });
      clientId = anchor?.clientId ?? null;
      if (clientId == null) {
        const target = await db.loanCase.findUnique({
          where: { id: caseId },
          select: { clientId: true, customer: true, whatsapp: true },
        });
        return !!target && !target.clientId && !!anchor &&
          target.customer === anchor.customer && target.whatsapp === anchor.whatsapp;
      }
    }
    const target = await db.loanCase.findUnique({ where: { id: caseId }, select: { clientId: true } });
    return !!target?.clientId && target.clientId === clientId;
  } catch {
    return false;
  }
}

/** Every case id this client may reach — the anchor plus its siblings. */
export async function clientCaseIds(me: ClientSessionUser): Promise<number[]> {
  try {
    let clientId = me.clientId;
    // Captured in a local because TypeScript cannot narrow `me.caseId` (a
    // property of a parameter) across the awaits below.
    const anchorId = me.caseId;
    if (clientId == null) {
      // Lead-only registrant (Phase 4): no clientId yet, no anchor case. Empty.
      if (anchorId == null) return [];
      const anchor = await db.loanCase.findUnique({
        where: { id: anchorId },
        select: { clientId: true, customer: true, whatsapp: true },
      });
      clientId = anchor?.clientId ?? null;
      if (clientId == null) {
        const rows = await db.loanCase.findMany({
          where: { customer: anchor?.customer ?? "", whatsapp: anchor?.whatsapp ?? "", clientId: null },
          select: { id: true },
        });
        return [anchorId, ...rows.map((r) => r.id)];
      }
    }
    const rows = await db.loanCase.findMany({ where: { clientId }, select: { id: true } });
    const ids = rows.map((r) => r.id);
    if (anchorId != null && !ids.includes(anchorId)) ids.unshift(anchorId);
    return ids;
  } catch {
    return me.caseId ? [me.caseId] : [];
  }
}

export async function clientLogin(caseNumber: string, phoneLast4: string): Promise<{ ok: true; user: ClientSessionUser } | { ok: false; error: string }> {
  const c = await db.loanCase.findUnique({
    where: { caseNumber: caseNumber.trim().toUpperCase() },
    select: { id: true, caseNumber: true, customer: true, whatsapp: true, clientId: true },
  });
  if (!c) return { ok: false, error: "Case not found. Check your case number (e.g. HFMC-0001)." };

  // Match last 4 digits of the WhatsApp/phone on file
  const phoneDigits = (c.whatsapp || "").replace(/\D/g, "");
  const last4 = phoneDigits.slice(-4);
  if (!last4) return { ok: false, error: "No phone number on file. Please contact your advisor." };
  if (phoneLast4.trim() !== last4) return { ok: false, error: "Phone digits don't match our records." };

  const sid = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + CLIENT_SESSION_TTL_DAYS * 86400000);
  // clientId is stamped at login, so every NEW session is client-scoped from the
  // start — the portal can then show every journey this person holds.
  await db.clientSession.create({
    data: { id: sid, clientId: c.clientId ?? null, caseId: c.id, phone: last4, expiresAt },
  });
  const store = await cookies();
  store.set(CLIENT_SESSION_COOKIE, sid, { httpOnly: true, sameSite: "lax", path: "/", expires: expiresAt });
  return {
    ok: true,
    user: {
      clientId: c.clientId ?? null, caseId: c.id, phone: last4,
      caseNumber: c.caseNumber, customer: c.customer,
    },
  };
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
  return {
    // Fall back to the case's clientId for a session created before the backfill.
    // `session.case` is null for a lead-only registrant (Phase 4) — they are a
    // real person with a real session, they just have no case yet.
    clientId: session.clientId ?? session.case?.clientId ?? null,
    caseId: session.caseId,
    phone: session.phone,
    caseNumber: session.case?.caseNumber ?? null,
    customer: session.case?.customer ?? null,
  };
}
