// Tier-1 HFMC pricing floor — the minimum WE will sell at, independent of what the
// bank allows. Stored as a single JSON blob in the existing AppSetting key-value
// table (no new model) and read by the engine on every match, so tightening the
// floor repricing the whole book needs no deploy and no product edits.
//
// Fail-OPEN by design: a corrupt or missing floor means "no floor", never a crash
// and never an accidental hard stop. The audit log (src/lib/audit.ts) is what records
// WHO changed the floor and WHEN.
import { db } from "@/lib/db";
import type { PricingFloor } from "@/lib/bank-pricing";

const KEY = "pricing_floor";

export async function getPricingFloor(): Promise<PricingFloor> {
  const row = await db.appSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  if (!row?.value) return {};
  try {
    const v = JSON.parse(row.value);
    return v && typeof v === "object" ? (v as PricingFloor) : {};
  } catch {
    return {};
  }
}

export async function savePricingFloor(f: PricingFloor, by: string): Promise<PricingFloor> {
  const next: PricingFloor = {
    minMarginBps: f.minMarginBps ?? null,
    minFixedRatePct: f.minFixedRatePct ?? null,
    minNetCommissionPct: f.minNetCommissionPct ?? null,
    hardStopPct: f.hardStopPct ?? null,
    updatedBy: by,
    updatedAt: new Date().toISOString(),
  };
  await db.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  });
  return next;
}
