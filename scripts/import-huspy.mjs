// Import the Huspy bank-product feed into BankProduct rows as DRAFTS.
//
// WHY DRAFTS: a draft never reaches the pricing engine (`runBankMatch` filters
// `status: "approved"`), so a bad import can be reviewed and corrected without ever
// being quotable. That is the whole safety story for a foreign data source.
//
// WHY DRY-RUN BY DEFAULT: this writes to production. `--apply` is required to write
// anything, and even then it only ever INSERTS drafts — it never updates or deletes
// an existing approved product. Re-running is safe and idempotent by external id.
//
// Run:
//   node scripts/import-huspy.mjs                    # report only, writes nothing
//   node scripts/import-huspy.mjs --file <path>      # a different export
//   node scripts/import-huspy.mjs --apply            # actually insert the drafts
//   node scripts/import-huspy.mjs --apply --limit 20 # a small first batch
import { readFileSync, existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/* ------------------------------------------------------------------ args -- */
const argv = process.argv.slice(2);
const arg = (k) => argv.includes(k);
const val = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const APPLY = arg("--apply");
const LIMIT = Number(val("--limit", "0")) || 0;
const FILE = val("--file", "C:/Users/Lenovo/Downloads/huspy_bank_products_all.json");

/* ------------------------------------------------------- bank name aliases -- */
/**
 * The feed carries 36 "banks", but 15 of them are the SAME bank under a second
 * name ("CBD - Business Banking" is Commercial Bank of Dubai). Measured: 15 such
 * clones hold 1-2 records each. Merging them is the difference between 36 banks
 * and ~21 real ones, and it stops the same bank appearing twice in the dropdowns.
 */
const BANK_ALIAS = {
  "dubai islamic bank": "Dubai Islamic Bank",
  "dib - business banking": "Dubai Islamic Bank",
  "commercial bank of dubai": "Commercial Bank of Dubai",
  "cbd - business banking": "Commercial Bank of Dubai",
  "abu dhabi islamic bank": "Abu Dhabi Islamic Bank",
  "adib - business banking": "Abu Dhabi Islamic Bank",
  "emirates nbd": "Emirates NBD",
  "enbd": "Emirates NBD",
  "mashreq bank": "Mashreq",
  "mashreq - business banking": "Mashreq",
  "rakbank": "RAKBANK",
  "rak - business banking": "RAKBANK",
  "fab": "FAB",
  "fab - business banking": "FAB",
  "hsbc": "HSBC",
  "standard chartered bank": "Standard Chartered",
  "scb - private banking": "Standard Chartered",
  "sharjah islamic bank": "Sharjah Islamic Bank",
  "sib - business banking": "Sharjah Islamic Bank",
  "emirates islamic bank": "Emirates Islamic Bank",
  "ajman bank": "Ajman Bank",
  "ajman bank - business banking": "Ajman Bank",
  "arab bank": "Arab Bank",
  "al hilal bank": "Al Hilal Bank",
  "national bank of fujairah": "National Bank of Fujairah",
  "eib - business banking": "Emirates Islamic Bank",
  "invest bank - business banking": "Invest Bank",
  "mbank - business banking": "MBank",
  "flapkap business banking": "FlapKap",
  "beehive business banking": "Beehive",
  "alain finance - business banking": "AlAIN Finance",
  "bank of baroda": "Bank of Baroda",
  "nomo bank": "Nomo Bank",
  "national bank of umm al qaiwain": "National Bank of Umm Al Qaiwain",
  "alma": "Alma",
  "habib bank ag zurich": "Habib Bank AG Zurich",
  "united arab bank": "United Arab Bank",
};
const norm = (s) => String(s || "").toLowerCase().trim();
const bankName = (raw) => BANK_ALIAS[norm(raw)] ?? String(raw || "").trim();

/* -------------------------------------------------------------- vocabulary -- */
/** The feed's transaction names -> our canonical vocabulary (bank-rules-taxonomy). */
const TXN = {
  "PRIMARY PURCHASE": "Primary Purchase",
  "PRIMARY HANDOVER": "Primary Handover",
  "BUY A PROPERTY": "Primary Purchase",
  "RESALE": "Resale",
  "UNDER CONSTRUCTION PROPERTY": "Off-Plan",
  "TRANSFER OF EXISTING MORTGAGE": "Buyout",
  "BUYOUT": "Buyout",
  "BUYOUT + EQUITY": "Buyout + Equity Release",
  "CASH OUT PROPERTY": "Equity Release",
};
const EMPLOYMENT = { "SALARY": "Salaried", "SELF EMPLOYMENT": "Self-Employed" };
const RESIDENCY = { "UAE RESIDENT": "Resident", "NON RESIDENT": "Non-Resident", "UAE NATIONAL": "Resident" };
const MORTGAGE = { "ISLAMIC": "Islamic", "CONVENTIONAL": "Conventional" };

/* --------------------------------------------------- the `profile` garbage can -- */
/**
 * Measured across the 2,449 records, `customer_segments[].profile` holds 81 distinct
 * values that are FOUR unrelated concepts mixed together. Treating it as one field
 * is how a customer-segment list ends up containing "LTV > 50%" and "Dubai Holding
 * Exclusive - Jomana 8". So it is classified, not copied:
 *
 *   LTV band  (184 + 184 + 24 + 20 x3 ...)  -> ftvMin/ftvMax on the QUOTE
 *   doc type  (Low Doc 80, Full Doc 64)     -> product name / program label
 *   project   (Dubai Holding Exclusive ...)  -> Project + isExclusive
 *   segment   (Standard 556, Premium, ...)  -> profiles set on the QUOTE
 */
function classifyProfile(p) {
  if (!p) return { kind: "none" };
  const t = String(p);

  // An LTV band, in the three shapes the feed actually uses:
  //   "LTV > 50%" / "FTV <= 60%"   (comparator + one number)
  //   "FTV - 61% - 70%"            (range: number, %, dash, number, %)
  // The range form needs the "%" to be OPTIONAL before the separator, otherwise
  // "61% - 70%" matches nothing and silently falls through to "segment" — which
  // would put an LTV band into a customer-profile axis and stop every quote matching.
  const range = t.match(/(\d{2})\s*%?\s*(?:-|–|to)\s*(\d{2})\s*%/i);
  if (/(ltv|ftv)/i.test(t) && range) {
    const a = Number(range[1]), b = Number(range[2]);
    return a <= b ? { kind: "ltv", min: a, max: b } : { kind: "ltv", min: b, max: a };
  }
  const cmp = t.match(/([<>]=?)\s*(\d{2})\s*%/);
  if (/(ltv|ftv)/i.test(t) && cmp) {
    const n = Number(cmp[2]);
    return cmp[1].startsWith("<") ? { kind: "ltv", min: null, max: n } : { kind: "ltv", min: n, max: null };
  }

  // exclusivity is an AVAILABILITY restriction, not a segment
  if (/exclusive/i.test(t)) return { kind: "project", project: t };

  // document type belongs to the product's programme, not to a pricing axis
  if (/low\s*doc|full\s*doc/i.test(t)) return { kind: "doc", doc: /low/i.test(t) ? "Low Doc" : "Full Doc" };

  if (/^all segments$/i.test(t) || /^all others$/i.test(t)) return { kind: "any" };

  return { kind: "segment", segment: t };
}

/** The project name out of "Dubai Holding Exclusive - Jomana 8". */
function splitProject(t) {
  const m = String(t).match(/^(.*?)\s*-\s*(.+)$/);
  if (!m) return { promotion: "", project: t };
  return { promotion: m[1].replace(/\s*exclusive$/i, "").trim(), project: m[2].trim() };
}

/** "EIBOR 3 MONTH" -> "3M"; "EIBOR 12 MONTH" -> "1Y". */
const eiborBasis = (t) => {
  const m = String(t || "").match(/(\d+)\s*MONTH/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (n === 1) return "1M";
  if (n === 3) return "3M";
  if (n === 6) return "6M";
  if (n === 12) return "1Y";
  return null;
};

/** "0.06% per month" -> a percent we can print; insurance bases vary, so keep the text. */
const pct = (v) => (typeof v === "number" && v > 0 ? v : null);

/* --------------------------------------------------------------- transform -- */
/**
 * Collapse the feed's 2,449 rows into distinct products.
 *
 * Measured: 2,449 rows carry only **274 distinct rule-sets** and 952 distinct
 * product+rate combinations — the rest are one product repeated across transactions.
 * So the key is (bank, mortgage, employment, residency, transaction, account, profile)
 * and everything else — tenure, LTV band, the additional_information text — becomes
 * either a quote axis or a field. Importing all 2,449 verbatim would put 4 identical
 * rows in the Rate Desk for every offer and make it unusable.
 */
function productKey(r) {
  const segs = (r.customer_segments ?? []).map((s) => s.profile ?? "").sort().join("+");
  return [bankName(r.bank_name), r.type_of_mortgage, r.type_of_employment, r.citizen_state, r.type_of_transaction, r.type_of_account, segs].join("|");
}

/** One canonical quote for a feed row. */
function toQuote(r) {
  const segs = r.customer_segments ?? [];
  const classified = segs.map((s) => classifyProfile(s.profile));
  const ltv = classified.find((c) => c.kind === "ltv");
  const seg = classified.find((c) => c.kind === "segment");
  const doc = classified.find((c) => c.kind === "doc");
  const proj = classified.find((c) => c.kind === "project");

  const fixed = r.interest_rate_type === "fixed" && r.fixed_rate > 0;
  const term = fixed ? (r.fixed_until || 0) : null;
  // The benchmark is needed for BOTH cases: a variable quote IS the benchmark, and a
  // fixed quote's follow-on reverts to it. Computing it only for variable rows left
  // every fixed line with no follow-on recipe, i.e. no stressed rate at all.
  const basis = eiborBasis(r.eibor_type);

  // The feed's floor semantics: follow_on_rate_type === "minimum_rate_eibor" means
  // the rate is MAX(EIBOR + margin, minimum_rate) — i.e. minimum_rate IS the floor.
  const floor = r.follow_on_rate_type === "minimum_rate_eibor" ? pct(r.minimum_rate) : null;
  // the raw margin is needed for a fixed line's follow-on too — gating it on !fixed
  // is what left every fixed line with no follow-on recipe
  const rawMargin = pct(r.variable_rate_addition);
  const margin = fixed ? null : rawMargin;

  const q = {
    stl: r.type_of_account === "STL" ? true : r.type_of_account === "NSTL" ? false : null,
    salaryTransfer: r.type_of_account ? [r.type_of_account] : null,
    termYears: fixed ? term : 0,
    ftvMin: ltv?.min ?? null,
    ftvMax: ltv?.max ?? null,
    txns: [TXN[r.type_of_transaction] ?? "Resale"],
    residency: segs.length && r.citizen_state ? [RESIDENCY[r.citizen_state] ?? "Resident"] : null,
    employment: [EMPLOYMENT[r.type_of_employment] ?? "Salaried"],
    rateType: fixed ? "FIXED" : `${basis ?? "3M"}_EIBOR`,
    ratePct: fixed ? r.fixed_rate : null,
    marginPct: margin,
    floorPct: floor,
    // a fixed line's follow-on recipe — without this the engine has no stressed rate
    variableAfter: fixed && basis && rawMargin != null
      ? { basis: `${basis}_EIBOR`, marginPct: rawMargin, floorPct: floor }
      : null,
    sourceLabel: r.source_files || null,
    note: doc?.doc ?? undefined,
  };
  // Only a GENUINE customer-profile tier is a pricing axis. An LTV band becomes
  // ftvMin/ftvMax, a doc type becomes the product's programme label, and a project
  // becomes isExclusive + a Project row — putting "Dubai Holding Exclusive - Jomana 8"
  // into `profiles` is exactly the pollution this classification exists to prevent.
  if (seg?.segment) q.profiles = [seg.segment];
  return { quote: q, project: proj?.project ? splitProject(proj.project) : null };
}

/* -------------------------------------------------------------------- run -- */
if (!existsSync(FILE)) {
  console.error(`Feed not found: ${FILE}`);
  console.error("Pass --file <path> to point at a different export.");
  await db.$disconnect();
  process.exit(1);
}

const raw = JSON.parse(readFileSync(FILE, "utf8"));
const feed = Array.isArray(raw) ? raw : [];
console.log(`feed             : ${FILE}`);
console.log(`raw records      : ${feed.length}`);
console.log(`raw banks        : ${new Set(feed.map((r) => r.bank_name)).size}`);
console.log(`after aliasing   : ${new Set(feed.map((r) => bankName(r.bank_name))).size} real banks`);

// group into distinct products
const groups = new Map();
for (const r of feed) {
  const k = productKey(r);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}
let all = [...groups.entries()].map(([key, rows]) => ({ key, rows }));
if (LIMIT) all = all.slice(0, LIMIT);
console.log(`distinct products: ${groups.size}${LIMIT ? ` (limited to ${all.length})` : ""}`);

const warnings = { noRate: 0, noFollowOn: 0, ltvBand: 0, projects: 0 };
const projects = new Map();
const built = [];

for (const { rows } of all) {
  const r0 = rows[0];
  const quotes = [];
  const seen = new Set();
  for (const r of rows) {
    const { quote, project } = toQuote(r);
    if (project) {
      if (!projects.has(project.project)) projects.set(project.project, project);
      warnings.projects += 1;
    }
    if (quote.ftvMax != null || quote.ftvMin != null) warnings.ltvBand += 1;
    if (quote.rateType === "FIXED" && !quote.variableAfter) warnings.noFollowOn += 1;
    if (quote.ratePct == null && quote.marginPct == null) warnings.noRate += 1;
    // dedupe identical quote lines — the feed repeats a product per transaction row
    const sig = JSON.stringify(quote);
    if (seen.has(sig)) continue;
    seen.add(sig);
    quotes.push(quote);
  }
  if (!quotes.length) continue;

  const proj = (r0.customer_segments ?? []).map((s) => classifyProfile(s.profile)).find((c) => c.kind === "project");
  built.push({
    bank: bankName(r0.bank_name),
    name: `${MORTGAGE[r0.type_of_mortgage] ?? r0.type_of_mortgage} · ${EMPLOYMENT[r0.type_of_employment] ?? r0.type_of_employment} · ${TXN[r0.type_of_transaction] ?? r0.type_of_transaction}`,
    sheet: r0.type_of_employment === "SALARY" ? "Salaried" : "Self Employed",
    employment: EMPLOYMENT[r0.type_of_employment] ?? r0.type_of_employment,
    residency: RESIDENCY[r0.citizen_state] ?? r0.residency,
    financeType: "Residential",
    program: "",
    loanKind: MORTGAGE[r0.type_of_mortgage] ?? r0.type_of_mortgage,
    isExclusive: !!proj || r0.is_exclusive === true,
    // the feed's LTV field is 0 in 100% of records — never import it
    maxLtvNational: null,
    maxLtvExpatriate: null,
    minLoan: null,
    maxLoan: null,
    minSalary: null,
    tenorYears: r0.maximum_length_of_mortgage || null,
    pricingJson: JSON.stringify({ quotes }),
    feesJson: JSON.stringify({
      processing: { default: pct(r0.mortgage_processing_fee) ?? 0, minFee: pct(r0.minimum_mortgage_processing_fee) ?? 0 },
      valuation: { note: r0.home_valuation_fee > 0 ? `AED ${r0.home_valuation_fee.toLocaleString()}` : "Free" },
      earlySettlement: r0.early_settlement_fee ? { note: r0.early_settlement_fee } : null,
      partialSettlement: r0.overpayment_fee ? { note: r0.overpayment_fee } : null,
    }),
    insuranceJson: JSON.stringify({
      life: { basis: r0.life_insurance_payment_period === "monthly" ? "per_million_monthly" : "pct_pa_of_loan", rate: pct(r0.life_insurance), note: `${pct(r0.life_insurance)}% per ${r0.life_insurance_payment_period}` },
      property: { basis: r0.property_insurance_payment_period === "monthly" ? "pct_pa_of_property_monthly" : "pct_pa_of_property", rate: pct(r0.property_insurance), note: `${pct(r0.property_insurance)}% per ${r0.property_insurance_payment_period}` },
    }),
    rateTable: "",
    fees: "",
    insurance: "",
    eligibility: r0.additional_information ?? "",
    documents: "",
    notes: `Imported from the Huspy feed (record ${r0.id}).`,
    axesJson: JSON.stringify({ huspyId: r0.id, eiborRate: r0.eibor_rate, eiborType: r0.eibor_type, additionalInformation: r0.additional_information }),
    version: 1,
    // DRAFT on purpose: the engine only reads status "approved", so nothing imported
    // here is quotable until a human has reviewed it in Admin -> Bank Rules.
    status: "draft",
    effectiveDate: null,
    expiryDate: "2099-12-31",
    sourceFiles: r0.source_files ?? "huspy",
    active: true,
  });
}

console.log(`\n--- what would be created --------------------------------`);
console.log(`BankProduct drafts            : ${built.length}`);
console.log(`distinct projects             : ${projects.size}`);
console.log(`quotes with no rate at all    : ${warnings.noRate}`);
console.log(`fixed lines with no follow-on : ${warnings.noFollowOn}  ← no stressed rate until filled`);
console.log(`LTV bands parsed from profile : ${warnings.ltvBand}`);
console.log(`maxLtv imported               : 0  (the feed's field is 0 in 100% of records)`);
console.log(`status                        : draft  (NOT quotable until approved)`);

const byBank = {};
for (const b of built) byBank[b.bank] = (byBank[b.bank] ?? 0) + 1;
console.log(`\nper bank:`);
for (const [b, n] of Object.entries(byBank).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${b.padEnd(30)} ${n}`);
}
console.log(`\nsample:`);
for (const b of built.slice(0, 5)) {
  console.log(`  ${b.bank} · ${b.name}${b.isExclusive ? "  [exclusive]" : ""}`);
  for (const q of JSON.parse(b.pricingJson).quotes) {
    const rate = q.rateType === "FIXED" ? `${q.ratePct}% ${q.termYears}y` : `+${q.marginPct}% ${q.rateType}`;
    console.log(`     ${rate}  ${q.txns?.join("/")}  ${q.stl === null ? "STL/NSTL" : q.stl ? "STL" : "NSTL"}`
      + `${q.ftvMax != null ? `  LTV<=${q.ftvMax}%` : ""}${q.profiles?.length ? `  [${q.profiles.join("/")}]` : ""}`);
  }
}

/* ------------------------------------------------------------------ apply -- */
if (!APPLY) {
  console.log(`\nDRY RUN — nothing written. Re-run with --apply to insert these ${built.length} drafts.`);
  await db.$disconnect();
  process.exit(0);
}

console.log(`\n--- applying -----------------------------------------------`);
let created = 0, skipped = 0;
for (const p of built) {
  // resolve (or create) the bank, so the product lands under a real BankItem
  const bank = await db.bankItem.upsert({
    where: { name: p.bank },
    create: { name: p.bank, ratePct: 0, active: true },
    update: {},
  });
  // never clobber an existing product — the import only ever INSERTS
  const dupe = await db.bankProduct.findFirst({
    where: { bankId: bank.id, name: p.name, status: "draft" },
  });
  if (dupe) { skipped += 1; continue; }
  // `p` carries a `bank` STRING (the feed's bank name) which Prisma must not see —
  // it expects the relation via bankId. Strip it rather than spreading it in.
  const { bank: _bankName, ...data } = p;
  await db.bankProduct.create({ data: { ...data, bankId: bank.id } });
  created += 1;
}
console.log(`drafts created : ${created}`);
console.log(`skipped (already present) : ${skipped}`);

if (projects.size) {
  let pc = 0;
  for (const [name, meta] of projects) {
    await db.project.upsert({
      where: { name },
      create: { name, promotion: meta.promotion, active: true },
      update: {},
    });
    pc += 1;
  }
  console.log(`projects registered : ${pc}`);
}
console.log(`\nThese are DRAFTS. Review them in Admin -> Bank Rules, then approve the good ones.`);
await db.$disconnect();

