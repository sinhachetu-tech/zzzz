// POST /api/policy/apply — commit a reviewed policy import into BankProduct rows.
// NEVER invents: only the reviewed axes + quote rows + answers the admin
// explicitly confirmed are written. Three modes: axes | quotes | answers.
import { NextRequest, NextResponse } from "next/server";
import { currentUser, flagsFor } from "@/lib/auth";
import { db } from "@/lib/db";

type AxisMap = Record<string, string>;

const AXIS_TO_TEXT: Array<[string, "rateTable" | "stressTest" | "fees" | "insurance"]> = [
  ["Fixed Rate", "rateTable"],
  ["Variable Rate post fixed period", "rateTable"],
  ["Variable Day 1", "rateTable"],
  ["Fully Variable Day 1", "rateTable"],
  ["Stress Test for DSR", "stressTest"],
  ["Fee Finance", "fees"],
  ["Early Settlement", "fees"],
  ["Partial Settlement", "fees"],
  ["Processing Fee", "fees"],
  ["Buyout Processing Fee", "fees"],
  ["Equity Processing Fee", "fees"],
  ["Pre Approval Fee", "fees"],
  ["Valuation Fee", "fees"],
  ["Life Insurance", "insurance"],
  ["Property Insurance", "insurance"],
];

const numOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function POST(req: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const flags = await flagsFor(me);
  if (!flags.admin && !flags.super) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const {
    mode, bankName, sheet, employment, residency, financeType, program, loanKind,
    productId, axes, quotes, answers, sourceFiles,
  } = body as {
    mode: "axes" | "quotes" | "answers";
    bankName?: string; sheet?: string; employment?: string; residency?: string;
    financeType?: string; program?: string; loanKind?: string;
    productId?: number; axes?: Record<string, string>; quotes?: Array<Record<string, unknown>>;
    answers?: Array<{ key: string; value: unknown; unit?: string }>;
    sourceFiles?: string;
  };
  if (!mode) return NextResponse.json({ error: "mode required (axes|quotes|answers)" }, { status: 400 });

  if (mode === "axes") {
    if (!bankName || !axes) return NextResponse.json({ error: "bankName + axes required" }, { status: 400 });
    const blocks: Record<string, string[]> = { rateTable: [], stressTest: [], fees: [], insurance: [], eligibility: [], documents: [] };
    for (const [label, field] of AXIS_TO_TEXT) {
      if (axes[label]) blocks[field].push(`${label}: ${axes[label]}`);
    }
    const leftovers = Object.entries(axes)
      .filter(([label]) => !AXIS_TO_TEXT.some(([l]) => l === label))
      .map(([label, v]) => `${label}: ${v}`);
    const data = {
      rateTable: blocks.rateTable.join("\n"),
      stressTest: blocks.stressTest.join("\n"),
      fees: blocks.fees.join("\n"),
      insurance: blocks.insurance.join("\n"),
      eligibility: [...blocks.eligibility, ...leftovers.filter((s) => /salary|service|bonus|rental|national|age|emirate/i.test(s))].join("\n"),
      documents: blocks.documents.join("\n"),
      axesJson: JSON.stringify(axes),
      sourceFiles: sourceFiles ?? "policy import",
      status: "draft",
      notes: `Policy import ${new Date().toISOString().slice(0, 10)} — human review required before approve`,
    };
    let product;
    if (productId) {
      product = await db.bankProduct.update({ where: { id: Number(productId) }, data: { ...data, status: "draft" } });
    } else {
      let bank = await db.bankItem.findFirst({ where: { name: bankName } });
      if (!bank) bank = await db.bankItem.create({ data: { name: bankName, ratePct: 0, active: true } });
      const name = `${employment ?? "Salaried"} · ${residency ?? "Resident"}${financeType ? " · " + financeType : ""}${program ? " · " + program : ""}`;
      product = await db.bankProduct.create({
        data: {
          bankId: bank.id, name, sheet: sheet ?? "Salaried",
          employment: employment ?? "Salaried", residency: residency ?? "Resident",
          financeType: financeType ?? "Residential", program: program ?? "",
          loanKind: loanKind ?? "", ...data,
        },
      });
    }
    return NextResponse.json({ ok: true, productId: product.id, mode: productId ? "updated" : "created" });
  }

  if (mode === "quotes") {
    if (!productId || !Array.isArray(quotes)) return NextResponse.json({ error: "productId + quotes required" }, { status: 400 });
    const p = await db.bankProduct.findUnique({ where: { id: Number(productId) } });
    if (!p) return NextResponse.json({ error: "product not found" }, { status: 404 });
    let existing: Array<Record<string, unknown>> = [];
    try { existing = JSON.parse(p.pricingJson || "{}").quotes ?? []; } catch { existing = []; }
    const clean = quotes
      .filter((q) => q.ratePct != null || q.marginPct != null)
      .map((q) => ({
        stl: q.stl ?? null,
        termYears: q.termYears ?? 0,
        ftvMin: numOrNull(q.ftvMin),
        ftvMax: numOrNull(q.ftvMax),
        rateType: q.rateType ?? "3M_EIBOR",
        ratePct: numOrNull(q.ratePct),
        marginPct: numOrNull(q.marginPct),
        floorPct: numOrNull(q.floorPct),
        variableAfter: q.variableAfter ?? null,
        txns: Array.isArray(q.txns) ? q.txns : null,
        txn: typeof q.txn === "string" ? q.txn : null,
        salaryTransfer: Array.isArray(q.salaryTransfer) ? q.salaryTransfer : null,
        segments: Array.isArray(q.segments) ? q.segments : null,
        residency: Array.isArray(q.residency) ? q.residency : null,
        employment: Array.isArray(q.employment) ? q.employment : null,
        financeType: Array.isArray(q.financeType) ? q.financeType : null,
        loanKind: Array.isArray(q.loanKind) ? q.loanKind : null,
        emirates: Array.isArray(q.emirates) ? q.emirates : null,
        nationalityRule: q.nationalityRule ?? null,
        sourceLabel: typeof q.sourceLabel === "string" ? q.sourceLabel : null,
        note: String(q.note ?? q.sourceLine ?? "").slice(0, 160),
      }));
    // merge: reviewed rows replace rows with identical match-keys, rest append
    const keyOf = (q: Record<string, unknown>) => JSON.stringify([q.stl, q.termYears, q.rateType, q.txn, q.txns, q.ftvMin, q.ftvMax]);
    const byKey = new Map(existing.map((q) => [keyOf(q), q]));
    for (const q of clean) byKey.set(keyOf(q), q);
    const merged = [...byKey.values()];
    await db.bankProduct.update({
      where: { id: Number(productId) },
      data: { pricingJson: JSON.stringify({ quotes: merged }), status: "draft" },
    });
    return NextResponse.json({ ok: true, quotes: merged.length, added: clean.length });
  }

  // PLACEHOLDER — answers commit continues below
  if (mode === "answers") {
    if (!productId || !Array.isArray(answers)) return NextResponse.json({ error: "productId + answers required" }, { status: 400 });
    const pAns = await db.bankProduct.findUnique({ where: { id: Number(productId) } });
    if (!pAns) return NextResponse.json({ error: "product not found" }, { status: 404 });
    let fees: Record<string, unknown> = {};
    let insurance: Record<string, unknown> = {};
    try { fees = JSON.parse(pAns.feesJson || "{}"); } catch { fees = {}; }
    try { insurance = JSON.parse(pAns.insuranceJson || "{}"); } catch { insurance = {}; }
    const applied: string[] = [];
    const put = (obj: Record<string, unknown>, path: string[], value: unknown) => {
      let cur = obj;
      for (let i = 0; i < path.length - 1; i++) {
        if (typeof cur[path[i]] !== "object" || cur[path[i]] == null) cur[path[i]] = {};
        cur = cur[path[i]] as Record<string, unknown>;
      }
      cur[path[path.length - 1]] = value;
    };
    for (const a of answers) {
      if (a.value == null) continue; // "don't know" stays unverified
      switch (a.key) {
        case "processingFee": put(fees, ["processing", "default"], Number(a.value)); applied.push(a.key); break;
        case "earlySettlement": put(fees, ["earlySettlement", "pct"], Number(a.value)); applied.push(a.key); break;
        case "lifeInsurance": put(insurance, ["life", "rate"], Number(a.value)); applied.push(a.key); break;
        case "propertyInsurance": put(insurance, ["property", "rate"], Number(a.value)); applied.push(a.key); break;
        case "minSalary": case "incomeAddbacks": case "nationalityRule":
          put(fees, [`_pending_${a.key}`], a.value); applied.push(a.key); break;
        default: applied.push(`${a.key} (noted, no structured slot)`);
      }
    }
    await db.bankProduct.update({
      where: { id: Number(productId) },
      data: { feesJson: JSON.stringify(fees), insuranceJson: JSON.stringify(insurance), status: "draft" },
    });
    return NextResponse.json({ ok: true, applied });
  }

  return NextResponse.json({ error: "unreachable", mode });
}
