// Append-only audit trail for pricing-affecting mutations.
//
// WHY: BankProduct.approvedBy records only WHO last approved a version, not what it
// changed or what it replaced. A pricing engine must be able to answer "what did we
// tell the client on 3 March?" — and with no migration history on this project, the
// audit log is also the only way to see what a bad edit actually did.
//
// Deliberately fire-and-forget: an audit failure must never block a save the admin
// already confirmed, so audit() swallows its own errors.
import { db } from "@/lib/db";

export interface AuditEntry {
  entity: string;            // BankProduct | Promotion | FeeRule | AppSetting | DealException
  entityId: string | number;
  action: "create" | "update" | "delete" | "revise" | "approve" | "close-slot" | "reopen-slot";
  field?: string;            // which field/axis moved, e.g. "quotes[2].ratePct"
  beforeVal?: unknown;
  afterVal?: unknown;
  reason?: string;           // required at the point of entry for rate edits
  actorId?: number | null;
  actorName?: string;
}

const str = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
};

/** Write one audit row. Never throws. */
export async function audit(e: AuditEntry): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        entity: e.entity,
        entityId: String(e.entityId ?? ""),
        action: e.action,
        field: e.field ?? "",
        beforeVal: str(e.beforeVal),
        afterVal: str(e.afterVal),
        reason: e.reason ?? "",
        actorId: e.actorId ?? null,
        actorName: e.actorName ?? "",
      },
    });
  } catch {
    // Deliberately swallowed — see the note above.
  }
}

/**
 * Diff the fields of `before`/`after` that actually changed, so one PATCH touching
 * 3 fields writes 3 precise rows instead of one whole-object blob.
 */
export async function auditDiff(
  e: Omit<AuditEntry, "action" | "beforeVal" | "afterVal"> & {
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  },
): Promise<void> {
  const keys = new Set([...Object.keys(e.before), ...Object.keys(e.after)]);
  const writes: Promise<void>[] = [];
  for (const k of keys) {
    const b = e.before[k];
    const a = e.after[k];
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    writes.push(audit({ ...e, action: "update", field: k, beforeVal: b, afterVal: a }));
  }
  await Promise.all(writes);
}
