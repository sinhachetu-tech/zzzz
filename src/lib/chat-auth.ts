// Sibling-aware client access for chat.
// A client logs in with ONE case (anchor) but their session is CLIENT-SCOPED
// (Phase 3), so they may read every journey of the same person — sibling bank legs
// and, from Phase 4, other service lines. Chat must accept the same set, or staff
// replies on a sibling journey 403 for the client and "staff messages never
// arrive".
//
// THIS NOW DELEGATES to clientOwnsCase in lib/client-auth.ts. It used to carry its
// own copy of the sibling-matching rule, which is exactly the kind of duplication
// that drifts — two answers to "who may see this case" is one too many.
import { db } from "@/lib/db";
import { clientOwnsCase, type ClientSessionUser } from "@/lib/client-auth";

export async function clientCanAccessCase(
  client: ClientSessionUser,
  caseId: number
): Promise<boolean> {
  return clientOwnsCase(client, caseId);
}

// All caseIds this client login may read (anchor + siblings) — used so
// staff→client push reaches the client's device no matter which journey
// they are viewing.
export async function siblingCaseIds(clientCaseId: number): Promise<number[]> {
  // Kept as a caseId-only entry point for callers that only have the anchor id;
  // it reconstructs the same scope clientOwnsCase computes.
  try {
    const anchor = await db.loanCase.findUnique({
      where: { id: clientCaseId },
      select: { clientId: true, customer: true, whatsapp: true },
    });
    if (!anchor) return [clientCaseId];
    if (anchor.clientId) {
      const rows = await db.loanCase.findMany({
        where: { clientId: anchor.clientId },
        select: { id: true },
      });
      return [clientCaseId, ...rows.map((r) => r.id).filter((id) => id !== clientCaseId)];
    }
    const rows = await db.loanCase.findMany({
      where: { customer: anchor.customer, whatsapp: anchor.whatsapp },
      select: { id: true, clientId: true },
    });
    return [clientCaseId, ...rows.filter((r) => !r.clientId).map((r) => r.id)];
  } catch {
    return [clientCaseId];
  }
}
