// GET /api/agent/rates — live rates table for the agent Tools tab:
// the EIBOR curve + each bank's current best "from" rate across its APPROVED
// products (fixed = lowest live FIXED quote; variable = lowest live margin over 1M EIBOR).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentAgent } from "@/lib/agent-auth";
import { parsePricing } from "@/lib/bank-pricing";
import { todayISO } from "@/lib/format";

export async function GET() {
  const me = await currentAgent();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const on = todayISO();
  const [eibor, products, banks] = await Promise.all([
    db.eiborRate.findMany(),
    db.bankProduct.findMany({ where: { status: "approved", active: true }, include: { bank: true } }),
    db.bankItem.findMany({ where: { active: true } }),
  ]);

  const eibor1m = eibor.find((e) => e.tenor === "1M")?.ratePct ?? null;

  const bestByBank = new Map<string, { fixedFrom: number | null; variableFrom: number | null }>();
  for (const p of products) {
    const pricing = parsePricing(p.pricingJson);
    if (!pricing?.quotes?.length) continue;
    const live = pricing.quotes.filter((q) => {
      const from = q.effectiveFrom ?? "";
      const to = q.effectiveTo ?? "";
      if (from && from > on) return false;
      if (to && to !== "2099-12-31" && to < on) return false;
      return true;
    });
    if (!live.length) continue;

    // sanity bounds — a real UAE mortgage rate never leaves this window;
    // guards the table against mis-parsed quotes (e.g. a 2024% HSBC margin)
    const fixed = live.filter((q) => q.rateType === "FIXED" && q.ratePct != null && q.ratePct > 0.5 && q.ratePct < 15);
    const variable = live.filter((q) => q.rateType !== "FIXED" && q.marginPct != null && q.marginPct >= 0 && q.marginPct < 15);
    const cur = bestByBank.get(p.bank.name) ?? { fixedFrom: null, variableFrom: null };

    for (const q of fixed) {
      if (cur.fixedFrom == null || (q.ratePct as number) < cur.fixedFrom) cur.fixedFrom = q.ratePct as number;
    }
    for (const q of variable) {
      const allIn = (q.marginPct as number) + (eibor1m ?? 0);
      if (cur.variableFrom == null || allIn < cur.variableFrom) cur.variableFrom = allIn;
    }
    bestByBank.set(p.bank.name, cur);
  }

  const TENORS = ["ON", "1W", "1M", "3M", "6M", "1Y"];
  const rows = banks
    .filter((b) => bestByBank.has(b.name))
    .sort((a, b) => {
      const fa = bestByBank.get(a.name)?.fixedFrom ?? 99;
      const fb = bestByBank.get(b.name)?.fixedFrom ?? 99;
      return fa - fb;
    })
    .map((b) => ({ bank: b.name, ...(bestByBank.get(b.name) as { fixedFrom: number | null; variableFrom: number | null }) }));

  return NextResponse.json({
    eibor: TENORS.map((t) => {
      const row = eibor.find((e) => e.tenor === t);
      return { tenor: t, ratePct: row?.ratePct ?? null, updatedOn: row?.updatedOn ?? "" };
    }),
    eibor1m,
    rows,
    asOf: on,
  });
}
