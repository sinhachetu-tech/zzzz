// GET/PUT /api/admin/bank-defaults — the inherited layer.
//
// WHY this exists: almost every "constant" is per BANK, not per product. Measured
// across the catalogue: max tenor was identical for 14/14 banks, and six fields the
// engine already reads (dbrPct, cardRulePct, bonusPct, rentalIncomePct,
// maxAgeSalaried, serviceMonthsMin) were recorded on ZERO products — so the engine was
// silently falling back to hardcoded constants for all of them.
//
// A product that disagrees sets its own value and is badged OVERRIDDEN. `overrides`
// counts how many products do, which is the blast radius of changing a default here —
// without that number, editing a default is a leap of faith.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, flagsFor } from "@/lib/auth";
import { audit, auditDiff } from "@/lib/audit";

async function guard() {
  const me = await currentUser();
  if (!me) return null;
  const flags = await flagsFor(me);
  if (!flags.admin && !flags.super) return null;
  return { me, flags };
}

/** Fields a bank default may own, mapped to the product column that overrides it. */
const OVERRIDE_MAP: Record<string, string> = {
  defaultProcessingFeePct: "feesJson",
  maxTenorYears: "tenorYears",
  maxLtvNational: "maxLtvNational",
  maxLtvExpatriate: "maxLtvExpatriate",
  minSalaryAed: "minSalary",
  totalTatDays: "totalTatDays",
  paTatDays: "paTatDays",
  stressBufferPct: "stressBufferPct",
  cardRulePct: "cardRulePct",
  bonusPct: "bonusPct",
  rentalIncomePct: "rentalIncomePct",
  maxAgeSalaried: "maxAgeSalaried",
  maxAgeSelfEmp: "maxAgeSelfEmp",
  serviceMonthsMin: "serviceMonthsMin",
};

const NUMERIC = new Set(Object.keys(OVERRIDE_MAP));

/** How many of this bank's products currently set their own value for a field. */
async function overrideCounts(bankId: number) {
  const products = await db.bankProduct.findMany({
    where: { bankId },
    select: {
      tenorYears: true, maxLtvNational: true, maxLtvExpatriate: true, minSalary: true,
      totalTatDays: true, paTatDays: true, stressBufferPct: true, cardRulePct: true,
      bonusPct: true, rentalIncomePct: true, feesJson: true,
      maxAgeSalaried: true, maxAgeSelfEmp: true, serviceMonthsMin: true,
    },
  });
  const counts: Record<string, number> = {};
  for (const [field, col] of Object.entries(OVERRIDE_MAP)) {
    let n = 0;
    for (const p of products) {
      if (col === "feesJson") {
        try {
          const d = (JSON.parse(p.feesJson || "{}") as { processing?: { default?: number } }).processing?.default;
          if (typeof d === "number") n += 1;
        } catch { /* unparseable = not an override */ }
        continue;
      }
      const v = (p as unknown as Record<string, unknown>)[col];
      if (typeof v === "number") n += 1;
    }
    if (n > 0) counts[field] = n;
  }
  return { counts, productCount: products.length };
}

/** Writable default fields, with labels for the error messages. A superset of the
 *  UI's FIELDS: the API accepts anything in OVERRIIDE_MAP plus the flags. */
const FIELDS: { key: string; label: string }[] = [
  { key: "defaultProcessingFeePct", label: "Default processing fee" },
  { key: "maxTenorYears", label: "Max tenure" },
  { key: "maxLtvNational", label: "Max LTV — UAE National" },
  { key: "maxLtvExpatriate", label: "Max LTV — Expatriate" },
  { key: "minSalaryAed", label: "Min. monthly salary" },
  { key: "totalTatDays", label: "Total TAT" },
  { key: "paTatDays", label: "Pre-approval TAT" },
  { key: "paValidityDays", label: "Pre-approval validity" },
  { key: "folValidityDays", label: "FOL validity" },
  { key: "valuationValidityDays", label: "Valuation validity" },
  { key: "stressBufferPct", label: "Stress buffer" },
  { key: "cardRulePct", label: "Card limits counted" },
  { key: "bonusPct", label: "Bonus counted" },
  { key: "rentalIncomePct", label: "Rental counted" },
  { key: "maxAgeSalaried", label: "Age at maturity — salaried" },
  { key: "maxAgeSelfEmp", label: "Age at maturity — self-employed" },
  { key: "serviceMonthsMin", label: "Min. service with employer" },
  { key: "propertyAgeYearsMax", label: "Property age cap" },
  { key: "defaultValuationFeeAed", label: "Default valuation fee" },
  { key: "defaultPreApprovalAed", label: "Default pre-approval fee" },
];

export async function GET() {
  const g = await guard();
  if (!g) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const banks = await db.bankItem.findMany({ orderBy: { name: "asc" } });
  // logoData is binary — strip it so the response stays small; the grid takes a
  // separate logoUrl. Typing: the spread includes the relations, so give the array
  // an explicit shape instead of letting inference collapse it.
  const out: Array<Record<string, unknown> & { overrides: Record<string, number>; productCount: number }> = [];
  for (const b of banks) {
    const { counts, productCount } = await overrideCounts(b.id);
    const { logoData: _logo, ...rest } = b;
    out.push({ ...rest, overrides: counts, productCount });
  }
  return NextResponse.json({ items: out });
}

export async function PUT(req: NextRequest) {
  const g = await guard();
  if (!g) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json();
  const id = parseInt(body.id, 10);
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (!body.reason || String(body.reason).trim().length < 3) {
    return NextResponse.json({ error: "A short reason is required — this is a default every product inherits." }, { status: 400 });
  }
  const prev = await db.bankItem.findUnique({ where: { id } });
  if (!prev) return NextResponse.json({ error: "bank not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  for (const f of FIELDS) {
    if (body[f.key] === undefined) continue;
    const raw = body[f.key];
    const v = raw === null || raw === "" ? null : Number(raw);
    if (v != null && (!Number.isFinite(v) || v < 0)) {
      return NextResponse.json({ error: `${f.label}: enter a positive number, or leave blank to inherit the norm.` }, { status: 400 });
    }
    data[f.key] = v;
  }
  if (body.firstPropertyOnly !== undefined) data.firstPropertyOnly = !!body.firstPropertyOnly;
  if (body.offersIslamic !== undefined) data.offersIslamic = !!body.offersIslamic;
  if (body.offersConventional !== undefined) data.offersConventional = !!body.offersConventional;
  if (body.defaultsVerifiedAt !== undefined) data.defaultsVerifiedAt = String(body.defaultsVerifiedAt).slice(0, 10);
  // Negotiating intel. Per BANK, not per product, and internal-only — /api/proposal
  // sends them only when mode === "internal". They had no writable endpoint at all
  // until this one existed, so they were populated by the seed and never by a human.
  if (body.posPoints !== undefined) data.posPoints = String(body.posPoints).slice(0, 2000);
  if (body.negPoints !== undefined) data.negPoints = String(body.negPoints).slice(0, 2000);

  const before: Record<string, unknown> = {};
  for (const k of Object.keys(data)) before[k] = (prev as unknown as Record<string, unknown>)[k];
  const item = await db.bankItem.update({ where: { id }, data });
  await auditDiff({
    entity: "BankItem", entityId: id, before, after: data,
    reason: body.reason, actorId: g.me.id, actorName: g.me.name,
  });
  const { counts, productCount } = await overrideCounts(id);
  return NextResponse.json({ item: { ...item, overrides: counts, productCount } });
}
