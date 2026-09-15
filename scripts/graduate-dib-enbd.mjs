// Graduate DIB + ENBD policy from their raw axes (zz_bank_extract_dib_enbd.json)
// into typed fields + rate quotes. Fill-only: never overwrites existing values.
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
const db = new PrismaClient();
const ext = JSON.parse(readFileSync("./zz_bank_extract_dib_enbd.json", "utf8"));

const num = (s) => { const m = String(s ?? "").match(/(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : null; };
const percentsIn = (s) => [...String(s ?? "").matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map(m => parseFloat(m[1]));

function parseQuotes(text) {
  const lines = String(text || "").split(/\n|(?=STL|NSTL)/g).map(l => l.trim()).filter(Boolean);
  const out = []; let stl = null, txn = null;
  for (const l of lines) {
    if (/\bSTL\b/i.test(l) && !/\bNSTL\b/i.test(l)) stl = true;
    if (/\bNSTL\b/i.test(l)) stl = false;
    if (/equity release|cash ?out/i.test(l)) txn = "Equity Release";
    else if (/buyout/i.test(l)) txn = "Buyout";
    else if (/handover|developer|primary/i.test(l)) txn = "Primary Handover";
    else if (/resale/i.test(l)) txn = "Resale";
    // rate-then-term: "4.10% Fixed for 3 years"
    const a = l.match(/(\d+(?:\.\d+)?)\s*%?\s*[-–]?\s*fixed[^0-9]{0,20}(\d+)\s*year/i);
    // term-then-rate: "1 Years Fixed -4.99%" / "3 years fixed @ 4.5%"
    const b = l.match(/(\d+)\s*years?\s*fixed[^0-9%]{0,15}(\d+(?:\.\d+)?)\s*%/i);
    if (a) out.push({ stl, termYears: parseInt(a[2], 10), rateType: "FIXED", ratePct: parseFloat(a[1]), txn, note: l.slice(0, 160), confidence: stl != null ? "high" : "medium", sourceLine: l.slice(0, 160) });
    else if (b) out.push({ stl, termYears: parseInt(b[1], 10), rateType: "FIXED", ratePct: parseFloat(b[2]), txn, note: l.slice(0, 160), confidence: stl != null ? "high" : "medium", sourceLine: l.slice(0, 160) });
    else {
      const v = l.match(/(\d+(?:\.\d+)?)\s*%?\s*(?:[-+]|margin\s*(?:of|:)?\s*|\bplus\b\s*)?\s*(3|6|1|12)?\s*-?\s*(?:months?|m)\s*(?:\+\s*)?eibor/i)
        || l.match(/(3|6|1|12)\s*-?\s*months?\s*eibor\s*\+\s*(\d+(?:\.\d+)?)/i);
      if (v && /eibor/i.test(l)) {
        const margin = /^\d/.test(v[1]) && !/eibor/i.test(v[1]) ? parseFloat(v[1]) : parseFloat(v[2]);
        const basis = (v[2] && /^\d+$/.test(v[2]) ? v[2] : v[1]);
        out.push({ stl, termYears: 0, rateType: (/^\d+$/.test(String(basis)) ? basis : "3") + "M_EIBOR", marginPct: margin, txn, note: l.slice(0, 160), confidence: stl != null ? "high" : "medium", sourceLine: l.slice(0, 160) });
      }
    }
  }
  const seen = new Set();
  return out.filter(q => { const k = JSON.stringify([q.stl, q.termYears, q.rateType, q.ratePct, q.marginPct, q.txn]); if (seen.has(k)) return false; seen.add(k); return true; });
}

const KEYMAP = [
  ["tenorYears", ["Max loan length", "Loan Tenor", "Maximum Tenor", "Maximum Finance Tenure"], (t) => { const ys = [...String(t).matchAll(/(\d+)\s*year/gi)].map(m => +m[1]); return ys.length ? Math.max(...ys) : null; }],
  ["minSalary", ["Minimum salary", "Minimum Income"], (t) => { const m = String(t).match(/(?:aed)?\s*([\d,]{4,7})/i); return m ? parseInt(m[1].replace(/,/g, "")) : null; }],
  ["totalTatDays", ["TOTAL EXPECTED TAT (working days)", "Total TAT"], (t) => num(t)],
  ["paTatDays", ["PA TAT (working days)"], (t) => num(t)],
  ["paValidityDays", ["PA Validity"], (t) => num(t)],
  ["folValidityDays", ["FOL Validity"], (t) => num(t)],
  ["valuationValidityDays", ["Valuation Report Validity"], (t) => num(t)],
  ["stressTest", ["Stress Test for DSR", "Stress Test Rate for DSR"], (t) => String(t).trim().slice(0, 300) || null],
];

const ltvFrom = (t) => {
  // split into chunks; assign % to national/expat by keyword proximity, else expat
  const chunks = String(t ?? "").split(/[\n;]+|(?=UAE|Expats?|Nationals?)/gi).map(c => c.trim()).filter(Boolean);
  let nat = null, exp = null;
  for (const c of chunks) {
    const ps = percentsIn(c);
    if (!ps.length) continue;
    const v = Math.max(...ps);
    if (/national|emirati|uae/i.test(c)) nat = Math.max(nat ?? 0, v);
    else if (/expat|resident/i.test(c)) exp = Math.max(exp ?? 0, v);
    else exp = Math.max(exp ?? 0, v);
  }
  return { nat, exp };
};

const report = {};
for (const [key, entry] of Object.entries(ext)) {
  if (key.includes("Neg-Positive Point")) continue;
  const [bankName, sheet] = key.split("||");
  const prod = (await db.bankProduct.findMany({ include: { bank: { select: { name: true } } } }))
    .find(p => p.bank.name === bankName && p.sheet === sheet);
  if (!prod) { (report[bankName] = report[bankName] || { fields: 0, quotes: 0, unmatched: [] }).unmatched.push(sheet); continue; }
  const R = report[bankName] = report[bankName] || { fields: 0, quotes: 0, unmatched: [] };
  const patch = {};
  const axes = entry.axes || {};
  const get = (names) => { for (const n of names) if (axes[n] != null && String(axes[n]).trim()) return axes[n]; return null; };

  for (const [field, keys, fn] of KEYMAP) {
    if (prod[field] != null) continue;
    const raw = get(keys);
    if (raw == null) continue;
    const v = fn(raw);
    if (v != null) patch[field] = v;
  }
  // LTV
  const ltvRaw = get(["Max LTV", "Finance to Value (FTV)", "LTV", "Maximum Finance Value"]);
  if (ltvRaw) {
    const { nat, exp } = ltvFrom(ltvRaw);
    if (prod.maxLtvExpatriate == null && exp) patch.maxLtvExpatriate = exp;
    if (prod.maxLtvNational == null && nat) patch.maxLtvNational = nat;
  }
  // min/max loan
  if (prod.minLoan == null) { const v = num(get(["Min Loan Amount"])); if (v) patch.minLoan = v; }
  if (prod.maxLoan == null) { const v = num(get(["Max Loan Amount", "Maximum Finance Value"])); if (v) patch.maxLoan = v; }
  // quotes from all rate-ish axes
  if (!(JSON.parse(prod.pricingJson || "{}").quotes?.length)) {
    const rateText = ["Fixed Rate", "Variable Rate post fixed period", "Fully Variable Day 1", "Variable Day 1", "Follow on", "Rates and Fees"]
      .map(k => axes[k]).filter(Boolean).join("\n");
    const q = parseQuotes(rateText);
    if (q.length) { patch.pricingJson = JSON.stringify({ quotes: q }); R.quotes++; }
  }
  // intel: ENBD neg
  if (key.includes("ENBD")) {
    const np = ext["ENBD||Neg-Positive Point"];
    const bankRow = await db.bankItem.findFirst({ where: { name: "ENBD" } });
    if (bankRow && !bankRow.negPoints && np?.neg) { await db.bankItem.update({ where: { id: bankRow.id }, data: { negPoints: np.neg } }); }
  }
  if (Object.keys(patch).length) {
    await db.bankProduct.update({ where: { id: prod.id }, data: patch });
    R.fields += Object.keys(patch).length;
  }
}
console.log("== DIB/ENBD graduation ==");
for (const [b, r] of Object.entries(report)) console.log(`  ${b}: ${r.fields} fields, ${r.quotes} quote-sets${r.unmatched.length ? `, UNMATCHED sheets: ${r.unmatched.join(", ")}` : ""}`);
await db.$disconnect();
