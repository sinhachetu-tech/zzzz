// Report the banks' nationality restrictions as the engine would need them —
// READ-ONLY. It writes nothing; it exists so a human can check the reading
// against the bank's own words before any of it is typed into a quote.
//
// WHY this exists: `RateQuote.nationalityRule` is a fully built, enforced axis
// (bank-pricing.ts -> quoteMatches -> nationalityAllowed) and it was set on ZERO
// of the 470 quotes. Meanwhile 12 banks state a restriction in free text inside
// `axesJson["Restricted Nationalities"]`, so the engine cannot see them.
//
// WHY the classification is so careful: the same sheet label carries four
// DIFFERENT real-world meanings, and only one of them is a hard ban.
//
//   BAN         "Iranians"                   -> excluded outright
//   CONDITIONAL "Iranians - Non ENBD Banking
//                 clients & STL is mandatory" -> ALLOWED, with conditions
//   LTV_CAP     "Iranian - LTV is restricted
//                 to 60%"                    -> ALLOWED at a lower LTV
//   APPROVAL    "Russia ... compliance
//                 approval"                  -> ALLOWED, slower
//
// Mapping all four to DENY would refuse clients the bank actively lends to — a
// worse error than the one it fixes, because it loses real business instead of
// merely failing to catch a case. Only unambiguous BAN rows are safe to apply.
//
//   node scripts/check-nationality-rules.mjs
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/** The axis the banks actually use. Only this key is read — the other
 *  "sanction"-ish hits (Baroda's "recovered on sanction", ENBD's "sanction
 *  letter") are about payment settlement, not who may be a client. */
const AXIS = "Restricted Nationalities";

// Country names as the banks spell them. Word-boundary matched, so "Iran" does
// not fire inside "Iranian" twice, and demonym + country are one person.
const NAMES = [
  "Iran", "Syria", "Pakistan", "Afghanistan", "North Korea", "Somalia",
  "Mauritius", "Nigeria", "Yemen", "Russia", "Belarus", "Israel", "Qatar", "Congo",
];
const canonical = (raw) => {
  const t = raw.trim().toLowerCase();
  if (t.startsWith("iran")) return "Iran";
  if (t.startsWith("syri")) return "Syria";
  if (t.startsWith("pakist")) return "Pakistan";
  if (t.startsWith("afghan")) return "Afghanistan";
  if (t.startsWith("somal")) return "Somalia";
  if (t.startsWith("yemen")) return "Yemen";
  if (t.startsWith("russ")) return "Russia";
  if (t.startsWith("belar")) return "Belarus";
  if (t.startsWith("israel")) return "Israel";
  if (t.startsWith("qatar")) return "Qatar";
  if (t.startsWith("niger")) return "Nigeria";
  if (t.startsWith("maurit")) return "Mauritius";
  if (t.includes("korea")) return "North Korea";
  if (t.startsWith("congo")) return "Congo";
  return raw.trim();
};

/** Phrases meaning "not a ban" — the client IS lent to, under a condition. */
const SOFT_LTV = ["ltv", "restricted to"];
const SOFT_DEV = ["deviation", "subject to"];
const SOFT_APPROVAL = ["compliance approval", "basis compliance", "pre approval", "no restriction"];
const SOFT_COND = ["non banking", "non-banking", "stl is mandatory", "mandatory"];

/** A statement that nobody is restricted at all. */
const NONE = [/^\s*none\b/i, /^no\b\s*[.(]/i, /^no restrictions?\b/i];

const found = (text) => {
  const out = new Set();
  for (const n of NAMES) {
    const alt = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[ -]/g, "[ -]");
    // "Iran" + optional "s" also covers the demonym: iran -> irani|iranian|iranians
    if (new RegExp(`\\b${alt}(?:s|ian|ians|i)?\\b`, "i").test(text)) out.add(canonical(n));
  }
  return [...out].sort();
};

/** Classify one cell -> { kind, countries, why }. null when nothing is named. */
function classify(raw) {
  const t = String(raw).replace(/\s+/g, " ").trim();
  const countries = found(t);
  if (NONE.some((r) => r.test(t))) {
    return { kind: countries.length ? "AMBIGUOUS" : "NONE", countries, why: t };
  }
  if (!countries.length) return null;

  const lower = t.toLowerCase();
  const has = (list) => list.some((s) => lower.includes(s));

  // "Accept applications from these countries ONLY: UK, France, ..." is an
  // ALLOW-list — the named countries are the only ones welcome and everything
  // else is excluded. Reading it as a ban of the named countries would be the
  // exact inversion that refuses good clients, so it is caught FIRST.
  if (/only\b/.test(lower) && /accept|applic|we (lend|serve)|countries/.test(lower)) {
    return { kind: "ALLOWLIST", countries, why: t };
  }
  // A bare demonym with no qualifier ("Iranians") is the only clean ban.
  const bare = /^(iranians?|syrians?|russians?|somalis?|yemenis?|nigerians?|pakistani|afghans?)\b/i.test(t);

  if (has(SOFT_LTV)) return { kind: "LTV_CAP", countries, why: t };
  if (has(SOFT_DEV)) return { kind: "CONDITIONAL", countries, why: t };
  if (has(SOFT_APPROVAL)) return { kind: "APPROVAL", countries, why: t };
  if (has(SOFT_COND)) return { kind: "CONDITIONAL", countries, why: t };
  if (bare) return { kind: "BAN", countries, why: t };
  if (/sanction/i.test(lower)) return { kind: "BAN", countries, why: t };
  return { kind: "NEEDS_REVIEW", countries, why: t };
}

const LABEL = {
  BAN: "HARD BAN -> auto-applicable as nationalityRule DENY",
  ALLOWLIST: "ALLOW-LIST -> these countries are the ONLY ones welcome (NOT a deny of them)",
  CONDITIONAL: "CONDITIONAL -> allowed, but only with a condition (NOT a deny)",
  LTV_CAP: "LTV CAP -> allowed at a lower LTV (NOT a deny)",
  APPROVAL: "APPROVAL -> allowed, compliance sign-off first (NOT a deny)",
  NEEDS_REVIEW: "NEEDS REVIEW -> wording not machine-classifiable",
  AMBIGUOUS: "AMBIGUOUS -> says 'none' but names countries",
  NONE: "NONE -> no restriction; leave the axis blank",
};

async function main() {
const out = [];
const say = (s = "") => out.push(s);
const rows = [];
const products = await db.bankProduct.findMany({
  select: { id: true, bank: { select: { name: true } }, axesJson: true, pricingJson: true },
});
const typedCount = (p) => {
  try {
    return (JSON.parse(p.pricingJson || "{}").quotes || []).filter((q) => q.nationalityRule).length;
  } catch { return 0; }
};

for (const p of products) {
  let axes = {};
  try { axes = JSON.parse(p.axesJson || "{}"); } catch { /* unparseable = nothing to read */ }
  const raw = axes[AXIS];
  if (!raw) continue;
  const c = classify(raw);
  if (!c) continue;
  rows.push({ bank: p.bank.name, ...c, hasRule: typedCount(p) > 0 });
}

// A bank states the same thing on several products; collapse to one row each but
// KEEP every distinct wording, so disagreement is visible rather than averaged away.
const byBank = new Map();
for (const r of rows) {
  const cur = byBank.get(r.bank) ?? { bank: r.bank, kinds: new Set(), countries: new Set(), wordings: new Set(), hasRule: false };
  cur.kinds.add(r.kind);
  (r.countries ?? []).forEach((c) => cur.countries.add(c));
  cur.wordings.add(r.why);
  cur.hasRule ||= r.hasRule;
  byBank.set(r.bank, cur);
}

const totalTyped = products.reduce((n, p) => n + typedCount(p), 0);
const totalQuotes = products.reduce((n, p) => {
  try { return n + (JSON.parse(p.pricingJson || "{}").quotes || []).length; } catch { return n; }
}, 0);

say("Restricted Nationalities — what the engine cannot currently see");
say();
say(`READ-ONLY. Nothing is written. Typed rules today: ${totalTyped} of ${totalQuotes} quotes.`);
say(`${byBank.size} banks state a restriction in text.`);

for (const kind of ["BAN", "ALLOWLIST", "CONDITIONAL", "LTV_CAP", "APPROVAL", "NEEDS_REVIEW", "AMBIGUOUS", "NONE"]) {
  const list = [...byBank.values()].filter((b) => b.kinds.has(kind));
  if (!list.length) continue;
  say();
  say(`=== ${kind} — ${LABEL[kind]}  (${list.length} bank${list.length === 1 ? "" : "s"})`);
  for (const b of list.sort((x, y) => x.bank.localeCompare(y.bank))) {
    say();
    say(`  ${b.bank}${b.hasRule ? "   [already has a typed rule]" : ""}`);
    say(`    countries: ${[...b.countries].join(", ") || "(none named)"}`);
    for (const w of b.wordings) say(`    source:    "${w}"`);
    if (b.kinds.size > 1) say(`    NOTE: states BOTH ${[...b.kinds].join(" and ")} — needs a human call.`);
  }
}

const bans = [...byBank.values()].filter((b) => b.kinds.has("BAN"));
say();
say();
say(`Summary: ${bans.length} of ${byBank.size} banks read as an unambiguous hard ban.`);
say("Only those are safe to type in automatically. The rest need a human decision —");
say("denying them would refuse clients the bank does lend to.");

// Written to a file as well as stdout: the terminal this runs in is not always
// able to capture piped output, and a compliance report you cannot read is
// no report at all.
const text = out.join("\n");
console.log(text);
const { writeFileSync } = await import("node:fs");
writeFileSync(new URL("./nationality-report.txt", import.meta.url), text + "\n", "utf8");
await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.stack || e.message : e);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});

