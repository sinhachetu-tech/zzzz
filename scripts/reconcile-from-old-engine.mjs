// Reconcile the curated hfmcqewn engine data into the live DB.
// NOT a copy-paste: fill-only for null fields, attach missing variableAfter
// recipes, MERGE quotes with dedupe, and REPORT every conflict (DB vs old)
// for human validation. The old snapshot may be stale — conflicts are listed,
// never auto-resolved.
// To regenerate the curated source: clone github.com/chetans-hfmc/hfmcqewn,
// transpile src/seed.ts (npx tsc seed.ts --module esnext --target es2022),
// copy the output here as scripts/_oldseed.mjs, then rerun this script.
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const seedMod = await import("./_oldseed.mjs");
const PRODUCTS = seedMod.buildSeed().productDefs;

const BANK_MAP = {
  "b-dib": "DIB", "b-adib": "ADIB", "b-ei": "Emirates Islamic", "b-enbd": "ENBD",
  "b-hsbc": "HSBC", "b-mashreq": "Mashreq", "b-cbd": "CBD", "b-fab": "FAB",
  "b-rak": "RAK Bank", "b-scb": "SCB", "b-arab": "Arab Bank", "b-nbf": "NBF",
  "b-bob": "Bank of Baroda", "b-adcb": "ADCB", "b-alhilal": "Al Hilal",
  "b-ajman": "Ajman Bank", "b-sib": "Sharjah Islamic Bank",
};
const TXN_MAP = { PURCHASE: null, RESALE: null, BUYOUT: "Buyout", EQUITY: "Equity Release", BUYOUT_EQUITY: "Buyout + Equity Release", TOPUP: "Equity Release" };
const FTV = { LE60: 60, GT60: 100 };

const prods = await db.bankProduct.findMany({ include: { bank: { select: { name: true } } } });
const conflicts = [];
const filled = {};
const quoteStats = { added: 0, enriched: 0 };
const perBank = {};

for (const def of PRODUCTS) {
  const bankName = BANK_MAP[def.bankId];
  if (!bankName) continue;
  const candidates = prods.filter(p => p.bank.name === bankName);
  if (!candidates.length) { conflicts.push(bankName + ': old product "' + def.name + '" — no DB products for this bank'); continue; }
  // best-match: loanKind + employment overlap with our product name encoding
  const score = (p) => {
    let s = 0;
    const kind = def.loanType;
    if (kind === "ISLAMIC" && /Islamic/i.test(p.name)) s += 2;
    if (kind === "CONVENTIONAL" && /Conventional/i.test(p.name)) s += 2;
    if (kind === "BOTH") s += 1;
    const cls = def.classes || [];
    if (/Salaried or Self-Employed/i.test(p.name) && cls.includes("SALARIED") && cls.includes("SELF_EMPLOYED")) s += 2;
    else if (/^Salaried/i.test(p.name) && cls.includes("SALARIED")) s += 2;
    else if (/Self-Employed/i.test(p.name) && cls.includes("SELF_EMPLOYED")) s += 2;
    if (/Non-Resident/i.test(p.name) && /NR|Non-Resident/i.test(def.name + (def.tags || []).join(" "))) s += 2;
    if (/Commercial/i.test(p.name) && /commercial/i.test(def.name)) s += 2;
    return s;
  };
  const target = [...candidates].sort((a, b) => score(b) - score(a))[0];
  const v = (def.versions ?? []).find(x => x.status === "ACTIVE") ?? (def.versions ?? [])[(def.versions ?? []).length - 1];
  if (!v) continue;
  const R = perBank[bankName] = perBank[bankName] || { products: new Set(), fields: 0, quotes: 0 };
  R.products.add(target.id);
  const patch = {};
  const el = v.eligibility ?? {}, aff = v.affordability ?? {}, tat = v.tat ?? {}, fees = v.fees ?? {};
  const fill = (field, val, label) => {
    if (val == null || val === 0) return;
    if (target[field] == null || target[field] === 0) { patch[field] = val; R.fields++; filled[field] = (filled[field] || 0) + 1; }
    else if (String(target[field]) !== String(val)) conflicts.push(bankName + " · " + target.name + " · " + label + ": DB=" + target[field] + " vs old=" + val);
  };
  fill("minSalary", el.minSalary, "minSalary");
  fill("minLoan", el.minLoan, "minLoan");
  fill("maxLoan", el.maxLoan, "maxLoan");
  fill("tenorYears", v.tenure?.maxMonths ? Math.round(v.tenure.maxMonths / 12) : null, "tenorYears");
  fill("dbrPct", aff.maxDBR, "maxDBR");
  fill("cardRulePct", aff.ccPct, "cardRulePct");
  fill("rentalIncomePct", aff.rentalPct, "rentalPct");
  fill("paTatDays", tat.paDays, "paTatDays");
  fill("paValidityDays", tat.paValidityDays, "paValidityDays");
  fill("folValidityDays", tat.folDays, "folValidityDays");
  fill("totalTatDays", tat.totalDays, "totalTatDays");

  // fees: only fill missing slots inside existing feesJson
  let fj = {}; try { fj = JSON.parse(target.feesJson || "{}"); } catch { fj = {}; }
  let feesChanged = false;
  if (fees.processingPct && fj.processing?.default == null) { fj.processing = { ...(fj.processing || {}), default: fees.processingPct }; feesChanged = true; }
  if (fees.earlySettlement && !fj.earlySettlement?.note) { fj.earlySettlement = { ...(fj.earlySettlement || {}), note: String(fees.earlySettlement).slice(0, 200) }; feesChanged = true; }
  if (fees.partialSettlement && !fj.partialSettlement?.note) { fj.partialSettlement = { ...(fj.partialSettlement || {}), note: String(fees.partialSettlement).slice(0, 200) }; feesChanged = true; }
  let ij = {}; try { ij = JSON.parse(target.insuranceJson || "{}"); } catch { ij = {}; }
  let insChanged = false;
  if (fees.lifeInsurancePct && !ij.life) { ij.life = { basis: "per_million_monthly", rate: fees.lifeInsurancePct, note: String(fees.lifeInsuranceNote ?? "").slice(0, 120) }; insChanged = true; }
  if (fees.propertyInsurancePct && !ij.property) { ij.property = { basis: "pct_pa_of_property", rate: fees.propertyInsurancePct, note: String(fees.propertyInsuranceNote ?? "").slice(0, 120) }; insChanged = true; }
  if (feesChanged) { patch.feesJson = JSON.stringify(fj); R.fields++; }
  if (insChanged) { patch.insuranceJson = JSON.stringify(ij); R.fields++; }

  // quotes: build from grid cells; merge + dedupe; attach variableAfter to a
  // matching bare FIXED quote (the "intro=after-intro" bug fix)
  let quotes = [];
  try { quotes = JSON.parse(target.pricingJson || "{}").quotes ?? []; } catch { quotes = []; }
  const before = quotes.length;
  const key = (q) => JSON.stringify([q.stl, q.termYears, q.rateType, q.ratePct, q.marginPct, q.txn]);
  for (const cell of (v.grid?.cells ?? [])) {
    const stl = cell.key?.stl === "STL" ? true : cell.key?.stl === "NSTL" ? false : null;
    const txn = TXN_MAP[cell.key?.transaction ?? ""] ?? null;
    const ftvMax = FTV[cell.key?.ftvBand ?? ""] ?? null;
    const seg = cell.key?.segment ?? null;
    const stress = cell.stressRate != null ? " stress-qualified @ " + cell.stressRate + "%" : "";
    const note = ((cell.note ?? "") + stress).trim().slice(0, 200) || ("curated from " + (def.source ?? "hfmcqewn engine"));
    if (cell.structure === "FIXED" || cell.structure === "FIXED_THEN_VAR") {
      const q = { stl, termYears: Math.round((cell.fixedMonths ?? 36) / 12), rateType: "FIXED", ratePct: cell.fixedRate, txn, segment: seg, note, confidence: "high", sourceLine: "hfmcqewn:" + cell.id };
      if (cell.structure === "FIXED_THEN_VAR" && cell.followOn) {
        q.variableAfter = { basis: String(cell.followOn.index || "EIBOR_3M").replace("EIBOR_", ""), marginPct: cell.followOn.margin, floorPct: cell.followOn.floor ?? null };
      }
      if (!quotes.some(x => key(x) === key(q))) quotes.push(q);
    }
    const fo = cell.followOn;
    if (cell.structure === "MARGIN_INDEX" || (cell.structure === "FIXED_THEN_VAR" && fo && cell.key?.stl)) {
      const idxRaw = String((fo?.index || cell.index || "EIBOR_3M")).replace("EIBOR_", "");
      const vq = { stl, termYears: 0, rateType: idxRaw + "_EIBOR", marginPct: fo?.margin ?? cell.margin, floorPct: fo?.floor ?? cell.floor ?? null, txn, segment: seg, note: String(cell.note ?? ("curated margin (hfmcqewn:" + cell.id + ")")).slice(0, 200), confidence: "high", sourceLine: "hfmcqewn:" + cell.id };
      if (vq.marginPct != null && !quotes.some(x => key(x) === key(vq))) quotes.push(vq);
    }
  }
  // enrich: attach variableAfter to an existing bare FIXED quote with same rate+term
  for (const q of quotes) {
    if (q.rateType === "FIXED" && !q.variableAfter) {
      const curated = quotes.find(x => x.variableAfter && x.ratePct === q.ratePct && x.termYears === q.termYears && x.stl === q.stl);
      if (curated) { q.variableAfter = curated.variableAfter; quoteStats.enriched++; }
    }
  }
  if (quotes.length > before) {
    patch.pricingJson = JSON.stringify({ quotes });
    quoteStats.added += quotes.length - before;
    R.quotes += quotes.length - before;
  }

  if (Object.keys(patch).length) await db.bankProduct.update({ where: { id: target.id }, data: patch });
}

console.log("== PER BANK ==");
for (const [b, r] of Object.entries(perBank)) console.log("  " + b + ": " + r.products.size + " products touched, " + r.fields + " fields filled, " + r.quotes + " quotes added");
console.log("");
console.log("quotes added=" + quoteStats.added + " - bare FIXED quotes enriched with follow-on recipes=" + quoteStats.enriched);
console.log("");
console.log("== CONFLICTS for human validation (" + conflicts.length + ") ==");
for (const c of conflicts.slice(0, 40)) console.log("  " + c);
await db.$disconnect();
