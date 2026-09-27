// Sibling-aware client access for chat.
// A client logs in with ONE case (anchor) but /api/client/state lets them
// switch between sibling bank journeys sharing the same clientId
// (or legacy customer+phone match). Chat must accept the same set —
// otherwise staff replies on a sibling journey 403 for the client and
// "staff messages never arrive".
import { db } from "@/lib/db";
import type { ClientSessionUser } from "@/lib/client-auth";

export async function clientCanAccessCase(
  client: ClientSessionUser,
  caseId: number
): Promise<boolean> {
  if (client.caseId === caseId) return true;
  try {
    const anchor = await db.loanCase.findUnique({
      where: { id: client.caseId },
      select: { clientId: true, customer: true, whatsapp: true },
    });
    if (!anchor) return false;
    const requested = await db.loanCase.findUnique({
      where: { id: caseId },
      select: { clientId: true, customer: true, whatsapp: true },
    });
    if (!requested) return false;
    if (anchor.clientId && requested.clientId === anchor.clientId) return true;
    if (
      !anchor.clientId &&
      !requested.clientId &&
      anchor.customer === requested.customer &&
      anchor.whatsapp === requested.whatsapp
    )
      return true;
    return false;
  } catch {
    return false;
  }
}

// All caseIds this client login may read (anchor + siblings) — used so
// staff→client push reaches the client's device no matter which journey
// they are viewing.
export async function siblingCaseIds(
  clientCaseId: number
): Promise<number[]> {
  try {
    const anchor = await db.loanCase.findUnique({
      where: { id: clientCaseId },
      select: { id: true, clientId: true, customer: true, whatsapp: true },
    });
    if (!anchor) return [clientCaseId];
    if (anchor.clientId) {
      const rows = await db.loanCase.findMany({
        where: { clientId: anchor.clientId },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    }
    const rows = await db.loanCase.findMany({
      where: { customer: anchor.customer, whatsapp: anchor.whatsapp },
      select: { id: true, clientId: true },
    });
    return rows.filter((r) => !r.clientId).map((r) => r.id);
  } catch {
    return [clientCaseId];
  }
}
