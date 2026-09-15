// Graduate bank policy from source files into typed DB fields, one product at
// a time. Fills ONLY empty/missing fields — never overwrites a value someone
// already typed in. Sources: src/data/seed/bankProductsAll.json (typed fields),
// bankIntel.json (pos/neg), and the deterministic quote parser for pricingJson.
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
const db = new PrismaClient();

const src = JSON.parse(readFileSync("./src/data/seed/bankProductsAll.json", "utf8"));
const products = Array.isArray(src) ? src : (src.products || Object.values(src)[0]);
const intel = JSON.parse(readFileSync("./src/data/seed/bankIntel.json", "utf8"));

// ---- quote parser (ported from src/lib/quote-parser.ts) ----
function parseRateTable(text) {
  const lines = String(text || "").split(/\n|(?=STL|NSTL)/g).map(l => l.trim()).filter(Boolean);
  const quotes = []; let ctxStl = null, ctxTxn = null, ctxFtvMax = null;
  for (const l of lines) {
    if (/\bSTL\b/i.test(l) && !/\bNSTL\b/i.test(l)) ctxStl = true;
    if (/\bNSTL\b/i.test(l)) ctxStl = false;
    if (/equity release|cashout/i.test(l)) ctxTxn = "Equity Release";
    else if (/buyout\s*\+|buyout with equity/i.test(l)) ctxTxn = "Buyout + Equity Release";
    else if (/buyout/i.test(l)) ctxTxn = "Buyout";
    else if (/land/i.test(l)) ctxTxn = "Land";
    else if (/lap/i.test(l)) ctxTxn = "LAP";
    else if (/primary|handover|developer|direct|fresh/i.test(l) && !/buyout/i.test(l)) ctxTxn = /off-?plan/i.test(l) ? "Primary Handover" : "Resale";
    if (/ftv/i.test(l)) {
      const up = l.match(/(?:up\s*to|<=|≤)\s*(\d+(?:\.\d+)?)\s*%?/i);
      const above = l.match(/above\s*(\d+(?:\.\d+)?)/i);
      if (above) ctxFtvMax = 100; else if (up) ctxFtvMax = parseFloat(up[1]);
    }
    const fm = l.match(/(\d+(?:\.\d+)?)\s*%?\s*[-–]?\s*fixed[^0-9]{0,20}(\d+)\s*year/i);
    if (fm) {
      quotes.push({ stl: ctxStl, termYears: parseInt(fm[2], 10), ftvMax: ctxFtvMax, rateType: "FIXED",
        ratePct: parseFloat(fm[1]), txn: ctxTxn, segment: /geco/i.test(l) ? "GECO" : null,
        note: l.slice(0, 160), confidence: ctxStl != null ? "high" : "medium", sourceLine: l.slice(0, 160) });
      continue;
    }
    const vm = l.match(/(\d+(?:\.\d+)?)\s*%?\s*(?:fixed\s*margin\s*(?:of|:)?|[-+])\s*\+?\s*(3|6|1|12)?\s*-?\s*months?\s*(?:\s*\+)?\s*eibor/i);
    if (vm) {
      quotes.push({ stl: ctxStl, termYears: 0, ftvMax: ctxFtvMax, rateType: (vm[2] || "3") + "M_EIBOR",
        marginPct: parseFloat(vm[1]), txn: ctxTxn,
        segment: /geco/i.test(l) ? "GECO" : /szhp/i.test(l) ? "SZHP" : null,
        note: l.slice(0, 160), confidence: ctxStl != null ? "high" : "medium", sourceLine: l.slice(0, 160) });
      continue;
    }
    const allIn = l.match(/(\d+(?:\.\d+)?)\s*%?\s*(?:fixed\s*margin|margin)\s+of\s+(\d+(?:\.\d+)?)\s*%\s*\+\s*(3|6|1|12)?\s*-?\s*months?\s*eibor/i);
    if (allIn) {
      quotes.push({ stl: ctxStl, termYears: 0, ftvMax: ctxFtvMax, rateType: (allIn[3] || "3") + "M_EIBOR",
        marginPct: parseFloat(allIn[2]), txn: ctxTxn, note: l.slice(0, 160),
        confidence: ctxStl != null ? "high" : "medium", sourceLine: l.slice(0, 160) });
    }
  }
  const seen = new Set();
  return quotes.filter(q => { const k = JSON.stringify([q.stl, q.termYears, q.ftvMax, q.rateType, q.ratePct, q.marginPct, q.txn]); if (seen.has(k)) return false; seen.add(k); return true; });
}

const TYPE_FIELDS = ["maxLtvNational","maxLtvExpatriate","tenorYears","minLoan","maxLoan","minSalary",
  "totalTatDays","paTatDays","paValidityDays","folValidityDays","valuationValidityDays"];

let filled = {}, quoteFilled = 0, intelFilled = 0, unmatched = [];
const perBank = {};
const banks = await db.bankItem.findMany();

// ---- 1) bank-level intel ----
for (const [name, obj] of Object.entries(intel)) {
  const b = banks.find(x => x.name.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(x.name.toLowerCase()));
  if (!b) continue;
  const patch = {};
  if (!b.posPoints && obj.pos) patch.posPoints = obj.pos;
  if (!b.negPoints && obj.neg) patch.negPoints = obj.neg;
  if (Object.keys(patch).length) { await db.bankItem.update({ where: { id: b.id }, data: patch }); intelFilled++; }
}

// ---- 2) typed fields per product ----
for (const p of await db.bankProduct.findMany({ include: { bank: { select: { name: true } } } })) {
  const s = products.find(x =>
    x.bankName === p.bank.name && x.name === p.name && x.sheet === p.sheet)
    || products.find(x => x.bankName === p.bank.name && x.name === p.name);
  if (!s) { unmatched.push(`${p.bank.name} — ${p.name}`); continue; }
  const patch = {};
  for (const f of TYPE_FIELDS) {
    const cur = p[f], next = s[f];
    if ((cur == null || cur === 0) && next != null && next !== 0) patch[f] = next;
  }
  for (const f of ["rateTable","stressTest","eligibility","documents","notes","axesJson"]) {
    if (!(p[f] && p[f].trim()) && s[f] && String(s[f]).trim()) patch[f] = s[f];
  }
  // quotes: parse from the (possibly just-filled) rate table if none exist
  let hasQuotes = false; try { hasQuotes = JSON.parse(p.pricingJson || "{}").quotes?.length > 0; } catch {}
  if (!hasQuotes && (s.rateTable || p.rateTable)) {
    const q = parseRateTable(s.rateTable || p.rateTable);
    if (q.length) {
      patch.pricingJson = JSON.stringify({ quotes: q }); quoteFilled++;
      const bk = perBank[p.bank.name] = perBank[p.bank.name] || { products: 0, quotes: 0, fields: 0 };
      bk.quotes++;
    }
  }
  if (Object.keys(patch).length) {
    await db.bankProduct.update({ where: { id: p.id }, data: patch });
    const bk = perBank[p.bank.name] = perBank[p.bank.name] || { products: 0, quotes: 0, fields: 0 };
    bk.products++; bk.fields += Object.keys(patch).length - (patch.pricingJson ? 1 : 0);
    for (const k of Object.keys(patch)) filled[k] = (filled[k] || 0) + 1;
  }
}

console.log("== PER BANK (1 bank at a time) ==");
for (const [b, v] of Object.entries(perBank).sort()) console.log(`  ${b}: ${v.products} products updated, ${v.fields} fields, ${v.quotes} quote-sets parsed`);
console.log("");
for (const [k, v] of Object.entries(filled).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
console.log("");
console.log(`banks given intel: ${intelFilled}`);
console.log(`products with NO source match (${unmatched.length}):`);
for (const u of unmatched) console.log("  " + u);
await db.$disconnect();
