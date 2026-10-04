// Propose DocRules from the document requirements already transcribed in
// src/data/seed/bankProducts.json.
//
// WHY: per-bank document variation ALREADY EXISTS in the data — someone wrote
// the banks' own lists down. It lives in `axesJson`, a real key→value map (54
// keys per product), so unlike the `documents` / `eligibility` fields it is NOT a
// positionless blob with the labels stripped. Those two are the same content with
// the keys removed, which is why maintaining them alongside DocRule by hand is
// hopeless — nobody can line them up.
//
// IT ONLY WRITES A PREVIEW FILE. It never touches the database: a guessed
// requirement must be reviewed by a person, because a rule marked `mandatory`
// DOES block case progression.
//
//   node scripts/extract-doc-rules.js          # summary + writes the preview
//   node scripts/extract-doc-rules.js --print  # summary only

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src", "data", "seed", "bankProducts.json");
const OUT = path.join(__dirname, "..", "data", "proposed-doc-rules.json");
const PRINT_ONLY = process.argv.includes("--print");

// axesJson keys describing a DOCUMENT someone must produce. Loose on purpose —
// banks label these inconsistently ("Bank Statements" vs "Bank Statement").
const DOC_KEY_RE = /(passport|visa|\beid\b|application form|other form|consent|salary cert|payslip|pay slip|payroll|bank statement|liability|valuation|employment|address|proof of residence|tenancy|contract|sale|agreement|declaration|letter|statement|form$)/i;

// Keys that read document-ish but are policy text, not a document to collect.
const SKIP_RE = /^(valuation fee|processing fee|pre approval fee|minimum salary|ltv|loan length|total tat|stress test|pa validity|fol validity|commercial|other information|consider |minimum length)/i;

const CATEGORY_FOR = [
  [/valuation/i, "Valuation"],
  [/salary cert|payslip|pay slip|payroll|employment/i, "Income"],
  [/bank statement|liability/i, "Bank & Liabilities"],
  [/contract|sale|agreement|tenancy|address|proof of residence|declaration/i, "Property"],
  [/application form|other form|consent/i, "Application Form"],
  [/passport|visa|\beid\b/i, "KYC"],
];

function categoryFor(name) {
  for (const [re, cat] of CATEGORY_FOR) if (re.test(name)) return cat;
  return "Other";
}

/** Collapse "Yes, PDF—Yes, PDF" into one value. The doubling exists because a
 *  product row covers both the Islamic and Conventional variants of one bank;
 *  the document itself is identical. */
function dedupeValue(raw) {
  const flat = String(raw).replace(/\r/g, "").trim();
  const halves = flat.split(/\n\s*—\s*\n|—/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  return [...new Set(halves)].join(" · ");
}

function verdict(value) {
  const v = value.toLowerCase();
  if (/^no\b|^not required|should match with/.test(v)) return false;
  if (/optional|if required|only if|if .* varies/.test(v)) return false;
  if (/^yes|required|within \d+ days/.test(v)) return true;
  return false; // ambiguous → optional, never guess "required"
}

function collect() {
  const products = JSON.parse(fs.readFileSync(SRC, "utf8"));
  const byBank = new Map();
  let skipped = 0;
  for (const p of products) {
    const bank = (p.bankName || "").trim();
    if (!bank) continue;
    let axes = {};
    try { axes = JSON.parse(p.axesJson || "{}"); } catch { axes = {}; }
    if (!byBank.has(bank)) byBank.set(bank, new Map());
    for (const [key, raw] of Object.entries(axes)) {
      const k = key.trim();
      if (SKIP_RE.test(k)) { skipped++; continue; }
      if (!DOC_KEY_RE.test(k)) continue;
      const value = dedupeValue(raw);
      if (!value) continue;
      const bucket = byBank.get(bank);
      if (!bucket.has(k)) bucket.set(k, { label: k, values: new Set(), votes: new Set() });
      const e = bucket.get(k);
      e.values.add(value);
      e.votes.add(verdict(value));
    }
  }
  return { byBank, skipped };
}

function main() {
  if (!fs.existsSync(SRC)) { console.error(`cannot find ${SRC}`); process.exit(1); }
  const { byBank, skipped } = collect();

  const proposed = [];
  let needsReview = 0;
  for (const [bank, bucket] of [...byBank.entries()].sort()) {
    for (const e of bucket.values()) {
      // Majority vote on required; a genuine split is flagged, never guessed.
      const votes = [...e.votes];
      const mandatory = votes.filter(Boolean).length > votes.length / 2;
      const split = votes.length > 1;
      if (split) needsReview++;
      proposed.push({
        bank,
        name: e.label,
        category: categoryFor(e.label),
        // MUST match BankItem.name exactly or the rule silently never applies.
        applicableBank: [bank],
        applicableEmployment: ["all"],
        applicablePropertyType: ["any"],
        applicableTransaction: ["any"],
        applicableResidency: ["all"],
        mandatory,
        // An application form is broker-produced and sent TO the bank, so the
        // client must not be asked to upload it.
        clientCanUpload: !/application form|other form|consent/i.test(e.label),
        visibleToClient: true,
        verifyNotes: [...e.values].join(" | "),
        source: "bankProducts.json → axesJson",
        ...(split ? { _review: "required votes split across product variants" } : {}),
      });
    }
  }

  console.log(`banks covered      : ${byBank.size}  (${[...byBank.keys()].join(", ")})`);
  console.log(`proposed rules     : ${proposed.length}`);
  console.log(`required           : ${proposed.filter((r) => r.mandatory).length}`);
  console.log(`optional           : ${proposed.filter((r) => !r.mandatory).length}`);
  console.log(`flagged for review : ${needsReview}`);
  console.log(`skipped policy axes: ${skipped}  (fees / LTV / TAT text, not documents)`);
  console.log("");
  if (proposed.length === 0) { console.log("Nothing extracted."); return; }

  const grouped = proposed.reduce((a, r) => { (a[r.bank] ??= []).push(r); return a; }, {});
  for (const [bank, rules] of Object.entries(grouped)) {
    console.log(`${bank}  (${rules.length})`);
    for (const r of rules) {
      console.log(`   ${r.mandatory ? "REQ " : "opt "} [${r.category}] ${r.name}`);
      console.log(`        ${r.verifyNotes.slice(0, 96)}`);
    }
  }
  console.log("");

  if (PRINT_ONLY) { console.log("--print given: no file written."); return; }

  // Never write into src/data/seed — that is loaded at boot. A standalone
  // proposal that a human reviews before anything is imported.
  // mkdirSync rather than assuming data/ exists — a fresh clone has no such dir.
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ generatedFrom: "bankProducts.json", rules: proposed }, null, 2));
  console.log(`written: ${path.relative(process.cwd(), OUT)}`);
  console.log("Review every row before importing — `mandatory` BLOCKS a case.");
}

main();
